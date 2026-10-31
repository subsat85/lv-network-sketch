import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import type { CableElement, ConsumerElement, DistanceFlag, DrawingElement, ElectricalSettings } from '../../types/drawing';
import { buildNetwork, type Network } from '../../utils/network';
import { computeVoltageDrop, type VoltageDropResult } from '../../utils/voltageDrop';
import { effectiveSettings } from '../../utils/electricalSettings';
import { pairKey } from '../../utils/cableSegments';
import { goldenCases, goldenOutput, goldenTreeCases, type GoldenCase } from '../../utils/__tests__/vdGoldenNetworks';
import { runStudy, studyWith } from '../index';
import type { ProjectDocument } from '../model';

// E1: the core runs the existing engine unchanged. These tests prove it on the 240
// golden networks (and on constant power / the studies, which golden does not cover).

const golden = JSON.parse(readFileSync(new URL('../../utils/__tests__/fixtures/vd-golden-7_8.json', import.meta.url), 'utf8'));
const CASES = [...goldenCases(), ...goldenTreeCases()];
const docOf = (g: GoldenCase, flags: Record<string, DistanceFlag> = {}, electrical: ElectricalSettings = g.settings): ProjectDocument =>
  ({ elements: g.elements, connectionDistances: g.distances, distanceFlags: flags, electrical });

/** goldenOutput's body, for a given network and result (goldenOutput itself computes both). */
const outputOf = (n: Network, r: VoltageDropResult) => {
  const round = (v: number | undefined) => (v === undefined ? null : Math.round(v * 1e9) / 1e9);
  return {
    circuits: n.circuits.map((c) => ({ status: c.status, source: c.sourcePoleId ?? null, kind: c.sourceKind ?? null, spans: c.spans.map((s) => `${s.cableId}#${s.index}:${s.fromPole}>${s.toPole}`), issues: c.issues.map((i) => JSON.stringify(i)).sort() })),
    issues: n.issues.map((i) => JSON.stringify(i)).sort(),
    settingsMissing: r.settingsMissing,
    spans: [...r.bySpan.values()].map((s) => ({ k: s.key, ok: s.computable, dv: round(s.dropV), cum: round(s.cumulativeDropV), i: round(s.phaseCurrentA), miss: s.missing, prov: s.provisional })).sort((a, b) => a.k.localeCompare(b.k)),
    poles: [...r.byPole.entries()].map(([p, list]) => ({ p, r: list.map((x) => ({ st: x.status, dv: round(x.dropV), pc: round(x.percent), ll: round(x.lineV), why: x.reason ?? null, prov: x.provisional })) })).sort((a, b) => a.p.localeCompare(b.p)),
  };
};

/**
 * Strict structural comparison: numbers and other primitives with Object.is (no rounding,
 * NaN and −0 told apart), Map and Set entries in insertion order, object keys as sets.
 * Returns the path of the first difference, or null.
 */
const firstDifference =(a: unknown, b: unknown, path = '$', seen = new WeakMap<object, object>()): string | null => {
  if (Object.is(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${String(a)} ≠ ${String(b)}`;
  if (seen.get(a) === b) return null;
  seen.set(a, b);
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return `${path}: different types`;
  if (a instanceof Map) {
    const ea = [...a.entries()], eb = [...(b as Map<unknown, unknown>).entries()];
    if (ea.length !== eb.length) return `${path}: Map size ${ea.length} ≠ ${eb.length}`;
    for (let i = 0; i < ea.length; i++) {
      const d = firstDifference(ea[i][0], eb[i][0], `${path}<key ${i}>`, seen) ?? firstDifference(ea[i][1], eb[i][1], `${path}[${String(ea[i][0])}]`, seen);
      if (d) return d;
    }
    return null;
  }
  if (a instanceof Set) return firstDifference([...a], [...(b as Set<unknown>)], `${path}<set>`, seen);
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return `${path}: length ${a.length} ≠ ${bb.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDifference(a[i], bb[i], `${path}[${i}]`, seen); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join('\u0000') !== kb.join('\u0000')) return `${path}: keys ${ka.join(',')} ≠ ${kb.join(',')}`;
  for (const k of ka) { const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, seen); if (d) return d; }
  return null;
};

/** Golden networks with constant power, and with both studies switched on and something to study. */
const withStudies = (g: GoldenCase): GoldenCase => {
  const elements: DrawingElement[] = g.elements.map((e) => {
    if (e.type !== 'cable' || e.poleIds.length < 3) return e;
    return { ...e, suggestedSplits: [e.poleIds[1]] } as CableElement;
  });
  const cable = elements.find((e): e is CableElement => e.type === 'cable');
  if (cable) elements.push({ id: `prop-${g.name}`, type: 'consumer', x: 0, y: 0, poleId: cable.poleIds[cable.poleIds.length - 1], color: cable.strokeColor, count: 2, variant: 'circle', label: '', strokeColor: '#000', fillColor: '#000', strokeWidth: 2, proposal: { status: 'proposed', connection: { cableId: cable.id, occurrence: 0 } } } as ConsumerElement);
  return { ...g, name: `${g.name}+studies`, elements, settings: { ...g.settings, studySuggestedSplits: true, studyProposedConsumers: true } };
};
const VARIANTS: { name: string; cases: GoldenCase[] }[] = [
  { name: 'constant power', cases: CASES.map((g) => ({ ...g, name: `${g.name}+cp`, settings: { ...g.settings, loadModel: 'constant-power' as const } })) },
  { name: 'studies on', cases: CASES.map(withStudies) },
  { name: 'studies on + constant power', cases: CASES.map(withStudies).map((g) => ({ ...g, settings: { ...g.settings, loadModel: 'constant-power' as const } })) },
];

describe('P1. the core gives the golden results (recorded from 7.8)', () => {
  it('covers 240 networks', () => expect(CASES).toHaveLength(240));
  it('the copy of goldenOutput is the same as goldenOutput (so P1 checks what golden checks)', () => {
    for (const g of CASES) expect(outputOf(buildNetwork(g.elements), computeVoltageDrop(g.elements, g.distances, g.settings))).toEqual(goldenOutput(g));
  });
  it.each(CASES.map((g) => [g.name, g] as const))('%s', (_n, g) => {
    const study = studyWith(docOf(g), g.settings);
    expect(outputOf(buildNetwork(g.elements), study.legacy)).toEqual(golden[g.name]);
  });
});

describe('P2. studyWith = computeVoltageDrop called directly, value for value (Object.is)', () => {
  it('240 golden networks', () => {
    for (const g of CASES) expect(firstDifference(studyWith(docOf(g), g.settings).legacy, computeVoltageDrop(g.elements, g.distances, g.settings)), g.name).toBeNull();
  });
});

describe('P3. constant power and the studies (not in golden: the reference is the existing engine itself)', () => {
  it.each(VARIANTS.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    let converged = 0, notConverged = 0, studiedSplits = 0;
    for (const g of v.cases) {
      const direct = computeVoltageDrop(g.elements, g.distances, g.settings);
      expect(firstDifference(studyWith(docOf(g), g.settings).legacy, direct), g.name).toBeNull();
      for (const c of direct.circuits) if (c.loadModel === 'constant-power' && c.status === 'ok') { if (c.converged) converged++; else notConverged++; }
      if (g.settings.studySuggestedSplits) studiedSplits += direct.issues.filter((i) => i.kind === 'split-side-unassigned').length;
    }
    // the variants really reach the paths they are meant to test
    if (v.name.includes('constant power')) expect(converged).toBeGreaterThan(0);
    if (v.name.includes('studies')) expect(studiedSplits).toBeGreaterThan(0);
    console.info(`P3 ${v.name}: ${v.cases.length} networks, constant-power circuits converged ${converged}, not converged ${notConverged}, study split issues ${studiedSplits}`);
  });
});

describe('P4. runStudy = what useVoltageDrop computes (effectiveSettings)', () => {
  it('with and without a stored power factor, with distance flags', () => {
    let defaulted = 0;
    for (const g of CASES) {
      const flags: Record<string, DistanceFlag> = {};
      for (const k of Object.keys(g.distances).slice(0, 2)) flags[k] = { estimated: true };
      const doc = docOf(g, flags);
      const study = runStudy(doc);
      expect(firstDifference(study.legacy, computeVoltageDrop(g.elements, g.distances, effectiveSettings(g.settings), flags)), g.name).toBeNull();
      if (g.settings.powerFactor === undefined) { defaulted++; expect(study.settings.powerFactor).toBe(0.9); }
      else expect(study.settings).toBe(g.settings);
    }
    expect(defaulted).toBeGreaterThan(0);
  });
  it('the distance flag key used above is the one the engine reads', () => expect(pairKey('B', 'A')).toBe('A_B'));
});

describe('P5. currents: copied only where the existing engine computed them, never derived', () => {
  const all = [...CASES, ...VARIANTS.flatMap((v) => v.cases), ...CASES.map((g) => ({ ...g, name: `${g.name}+balanced`, settings: { ...g.settings, singlePhaseMode: 'balanced' as const } }))];
  it('per-phase and neutral currents are never available', () => {
    for (const g of all) {
      const study = studyWith(docOf(g), g.settings);
      for (const b of study.scenarios[study.approved]!.branches.values())
        for (const k of ['ia', 'ib', 'ic', 'in'] as const) expect(b[k], `${g.name} ${b.key} ${k}`).toEqual({ origin: 'not-available', reason: 'legacy-does-not-compute-per-phase' });
    }
  });
  it('the three copied currents follow the rule of section 4.1, with the same numbers', () => {
    const counts = { computed: 0, circuit: 0, cpNotFinal: 0, systemUnusable: 0 };
    for (const g of all) {
      const study = studyWith(docOf(g), g.settings);
      const out = study.scenarios[study.approved]!;
      expect(out.branches.size).toBe(study.legacy.bySpan.size);
      for (const cr of study.legacy.circuits) cr.spans.forEach((sp, i) => {
        const b = out.branches.get(sp.key)!;
        const at = `${g.name} ${sp.key}`;
        if (cr.status !== 'ok') {
          counts.circuit++;
          for (const v of [b.checkedPhaseA, b.threePhaseDownstreamA, b.singlePhaseDownstreamA]) expect(v, at).toEqual({ origin: 'not-available', reason: 'circuit-not-computed' });
          return;
        }
        if (cr.loadModel === 'constant-power' && !(cr.converged === true && sp.computable)) {
          counts.cpNotFinal++;
          for (const v of [b.checkedPhaseA, b.threePhaseDownstreamA, b.singlePhaseDownstreamA]) expect(v, at).toEqual({ origin: 'not-available', reason: 'constant-power-not-final' });
          return;
        }
        expect(b.threePhaseDownstreamA, at).toEqual({ value: sp.threePhaseA, origin: 'legacy-computed' });
        expect(b.singlePhaseDownstreamA, at).toEqual({ value: sp.singlePhaseA, origin: 'legacy-computed' });
        if (cr.loadModel === 'constant-current') {
          // evidence for section 4.1: with constant current these are the downstream load sums
          expect(Object.is(sp.threePhaseA, cr.circuit.downstream[i].three), at).toBe(true);
          expect(Object.is(sp.singlePhaseA, cr.circuit.downstream[i].single), at).toBe(true);
        }
        if (sp.system === undefined || (sp.system === '1ph2w' && sp.threePhaseA > 0)) {
          counts.systemUnusable++;
          expect(b.checkedPhaseA, at).toEqual({ origin: 'not-available', reason: 'span-not-computed' });
          return;
        }
        counts.computed++;
        expect(Object.is(b.checkedPhaseA.value, sp.phaseCurrentA), at).toBe(true);
        // evidence for section 4.1: the expression of phaseCurrentA in the existing engine
        const I3 = sp.threePhaseA, I1 = sp.singlePhaseA;
        const expected = sp.system === '1ph2w' ? I1 : g.settings.singlePhaseMode === 'balanced' ? I3 + I1 / 3 : I3 + I1;
        expect(Object.is(sp.phaseCurrentA, expected), at).toBe(true);
      });
    }
    console.info(`P5 spans: computed ${counts.computed}, circuit not computed ${counts.circuit}, constant power not final ${counts.cpNotFinal}, no / unusable system ${counts.systemUnusable}`);
    for (const v of Object.values(counts)) expect(v).toBeGreaterThan(0);
  });
});

describe('P6. drops, voltages and statuses are the existing engine\'s numbers', () => {
  it('every span and every pole result', () => {
    for (const g of [...CASES, ...VARIANTS.flatMap((v) => v.cases)]) {
      const study = studyWith(docOf(g), g.settings);
      const out = study.scenarios[study.approved]!;
      for (const sp of study.legacy.bySpan.values()) {
        const b = out.branches.get(sp.key)!;
        expect(Object.is(b.dropV.value, sp.computable ? sp.dropV : undefined), `${g.name} ${sp.key} dropV`).toBe(true);
        expect(Object.is(b.cumulativeDropV.value, sp.cumulativeDropV), `${g.name} ${sp.key} cum`).toBe(true);
        expect(b.dropV.origin === 'legacy-computed').toBe(b.dropV.value !== undefined);
      }
      let poles = 0;
      for (const list of study.legacy.byPole.values()) for (const p of list) {
        poles++;
        const o = out.buses.get(p.bus)!;
        expect(o.status).toBe(p.status);
        for (const k of ['dropV', 'percent', 'phaseV', 'lineV'] as const) {
          expect(Object.is(o[k].value, p[k]), `${g.name} ${p.bus} ${k}`).toBe(true);
          expect(o[k].origin === 'legacy-computed').toBe(p[k] !== undefined);
        }
      }
      expect(out.buses.size).toBe(poles);
    }
  });
});

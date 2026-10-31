import { describe, expect, it } from 'vitest';
import type { CableElement, DrawingElement, ElectricalSettings, SpanProps } from '../../types/drawing';
import { buildNetwork } from '../../utils/network';
import { networkOptions, spanLength } from '../../utils/voltageDrop';
import { normalizeElements, withSpanProps } from '../../utils/spanModel';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';
import { goldenCases, goldenTreeCases, type GoldenCase } from '../../utils/__tests__/vdGoldenNetworks';
import { toNetwork } from '../adapter';
import { studyWith } from '../index';
import type { ProjectDocument } from '../model';

// E1: the adapter reads the existing engine's network and adds nothing to it.

const CASES = [...goldenCases(), ...goldenTreeCases()];
const docOf = (g: GoldenCase): ProjectDocument => ({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: g.settings });

describe('adapter: same topology and loads as buildNetwork', () => {
  it('circuits, statuses, sources, branch order and buses', () => {
    for (const g of CASES) {
      const { network, legacy } = toNetwork(docOf(g), g.settings);
      const ref = buildNetwork(g.elements, networkOptions(g.settings));
      expect(network.circuits.length, g.name).toBe(ref.circuits.length);
      ref.circuits.forEach((c, ci) => {
        const n = network.circuits[ci];
        expect(n.id).toBe(c.id);
        expect(n.status).toBe(c.status);
        expect(n.source?.poleId).toBe(c.sourcePoleId);
        expect(n.source?.kind).toBe(c.sourceKind);
        expect(n.branches.map((b) => `${b.key}:${b.fromPole}>${b.toPole}:${b.fromBus}>${b.toBus}`)).toEqual(c.spans.map((s) => `${s.cableId}#${s.index}:${s.fromPole}>${s.toPole}:${s.fromBus}>${s.toBus}`));
        expect(n.buses.map((b) => b.id)).toEqual(c.buses);
      });
      // the network handed to the solver is the one built here (not rebuilt)
      expect(legacy.circuits.length).toBe(ref.circuits.length);
    }
  });

  it('loads per bus: valid amps sum exactly to busLoad, invalid ones carry no value, same subscribers', () => {
    let invalid = 0;
    for (const g of CASES) {
      const { network, legacy } = toNetwork(docOf(g), g.settings);
      for (const c of network.circuits) {
        const ref = legacy.circuits.find((x) => x.id === c.id)!;
        for (const b of c.buses) {
          const bl = ref.busLoad.get(b.id);
          let single = 0, three = 0;
          for (const l of b.loads) {
            if (l.amps.status === 'invalid') { invalid++; expect(l.amps.value).toBeUndefined(); continue; }
            if (l.kind === 'single') single += l.amps.value!; else three += l.amps.value!;
            expect(l.phase).toBeUndefined();
          }
          expect(single, `${g.name} ${b.id}`).toBe(bl?.single ?? 0);
          expect(three, `${g.name} ${b.id}`).toBe(bl?.three ?? 0);
          expect(b.loads.map((l) => l.consumerId)).toEqual(bl?.consumerIds ?? []);
        }
      }
    }
    expect(invalid).toBeGreaterThan(0);
  });

  it('lengths: the engine\'s spanLength, and a missing length is never 0', () => {
    for (const g of CASES) {
      const { network } = toNetwork(docOf(g), g.settings);
      for (const c of network.circuits) for (const b of c.branches) {
        const ref = spanLength(g.distances, b.fromPole, b.toPole);
        expect(b.lengthM.value).toBe(ref.m);
        if (ref.m === undefined) { expect(b.lengthM.provenance).toBe('missing'); expect(b.lengthMissing).toBe(ref.missing); }
      }
    }
  });

  it('the drawing elements are passed as they are (no copy, no change)', () => {
    const g = CASES[0];
    const before = JSON.stringify(g.elements);
    toNetwork(docOf(g), g.settings);
    expect(JSON.stringify(g.elements)).toBe(before);
  });
});

// T —— A: one span, a 3-phase load at A; impedance values: documented / zero / missing / rule
const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const line = (props: Omit<SpanProps, 'poles'>) => {
  let els = normalizeElements([pole('T', 'transformer'), pole('A'),
    { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement,
    { id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'A', color: '#ff0000', count: 1, variant: 'square', label: '40', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as DrawingElement]);
  const c = els[2] as CableElement;
  els = els.map((e) => (e.id === 'c' ? withSpanProps(c, c.spanIds![0], { poles: ['T', 'A'], ...props }) : e));
  return els;
};
const branch = (props: Omit<SpanProps, 'poles'>, settings: ElectricalSettings) => {
  const doc: ProjectDocument = { elements: line(props), connectionDistances: { A_T: '100' }, distanceFlags: {}, electrical: settings };
  const s = studyWith(doc, settings);
  return s.scenarios[s.approved]!.branches.get('c#0')!;
};
const S = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };
const base = { system: '3ph4w', cableKind: 'abc', material: 'al', crossSectionMm2: 95, dataSource: 'test' } as const;

describe('values: documented, documented zero, missing, and the existing engine\'s own rule are told apart', () => {
  it('X typed as 0.08 → project', () => {
    const b = branch({ ...base, xOhmPerKm: 0.08 }, S);
    expect(b.impedance.x).toEqual({ value: 0.08, provenance: 'project', status: 'complete' });
    expect(b.dropV.origin).toBe('legacy-computed');
  });
  it('X typed as 0 → a documented zero (project), not missing', () => {
    const b = branch({ ...base, xOhmPerKm: 0 }, S);
    expect(b.impedance.x).toEqual({ value: 0, provenance: 'project', status: 'complete' });
  });
  it('X not given, cos φ < 1 → missing, no value, span not computed', () => {
    const b = branch({ ...base }, S);
    expect(b.impedance.x).toEqual({ provenance: 'missing', status: 'missing' });
    expect(b.dropV).toEqual({ origin: 'not-available', reason: 'span-not-computed' });
    expect(b.missing).toContain('reactance');
  });
  it('X not given, cos φ = 1 → the existing engine\'s rule (0), marked as such', () => {
    const b = branch({ ...base }, { ...S, powerFactor: 1 });
    expect(b.impedance.x.value).toBe(0);
    expect(b.impedance.x.provenance).toBe('legacy-rule');
  });
  it('R from the IEC table, Rn not required for a three-phase load, Xn always missing', () => {
    const b = branch({ ...base, xOhmPerKm: 0.08 }, S);
    expect(b.impedance.r.provenance).toBe('iec-table');
    expect(b.impedance.rn).toEqual({ provenance: 'not-required' });
    expect(b.impedance.xn.provenance).toBe('missing');
    expect(b.impedance.xn.value).toBeUndefined();
  });
});

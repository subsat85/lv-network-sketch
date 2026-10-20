// Deterministic random networks used to prove that results of existing projects
// do not change (Stage 7.9). The generator must never be changed once the golden
// file (vd-golden-7_8.json) has been recorded from the Stage 7.8 code.
import type { CableArcElement, CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../types/drawing';
import { normalizeElements, withSpanProps } from '../spanModel';
import { buildNetwork } from '../network';
import { computeVoltageDrop } from '../voltageDrop';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';

const COLORS = ['#ff0000', '#0000ff', '#00aa00'];

export interface GoldenCase { name: string; elements: DrawingElement[]; distances: Record<string, string>; settings: ElectricalSettings }

export const goldenCases = (): GoldenCase[] => {
  const out: GoldenCase[] = [];
  let seed = 20261020;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
  let idc = 0;
  for (let t = 0; t < 160; t++) {
    const nPoles = 3 + rnd(9);
    const els: DrawingElement[] = [];
    const poles: string[] = [];
    for (let i = 0; i < nPoles; i++) {
      const id = `p${t}_${i}`;
      const symbolId = i === 0 || rnd(14) === 0 ? 'transformer' : 'lv-pole';
      const modifiers = rnd(20) === 0 ? { vdSource: true } : undefined;
      els.push({ id, type: 'symbol', symbolId, x: rnd(800), y: rnd(600), width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...(modifiers ? { modifiers } : {}) } as SymbolElement);
      poles.push(id);
    }
    const nCables = 1 + rnd(5);
    for (let c = 0; c < nCables; c++) {
      const len = 2 + rnd(Math.min(5, nPoles - 1));
      const start = rnd(nPoles);
      const ids: string[] = [poles[start]];
      for (let k = 1; k < len; k++) {
        const next = rnd(3) === 0 ? poles[rnd(nPoles)] : poles[(start + k) % nPoles];
        if (next !== ids[ids.length - 1]) ids.push(next);
      }
      if (ids.length < 2) continue;
      els.push({ id: `c${t}_${c}`, type: 'cable', x: 0, y: 0, poleIds: ids, cableIndex: c, offset: 0, strokeColor: COLORS[rnd(3)], fillColor: 'none', strokeWidth: 2 } as CableElement);
    }
    const cables = els.filter((e): e is CableElement => e.type === 'cable');
    for (let u = 0, n = rnd(8); u < n; u++) {
      const cab = cables[rnd(cables.length)];
      if (!cab) break;
      const pole = cab.poleIds[rnd(cab.poleIds.length)];
      const variant = rnd(2) ? 'circle' : 'square';
      const labels = ['', '63', '25', '-10', '0', 'x', '40'];
      els.push({ id: `u${idc++}`, type: 'consumer', x: 0, y: 0, poleId: pole, color: rnd(6) === 0 ? COLORS[rnd(3)] : cab.strokeColor, count: 1 + rnd(4), variant, label: variant === 'square' ? labels[rnd(labels.length)] : '', strokeColor: '#000', fillColor: '#000', strokeWidth: 2 } as ConsumerElement);
    }
    // an occasional Jumper between two cable ends at a shared pole
    if (rnd(4) === 0 && cables.length >= 2) {
      const a = cables[0], b = cables[1];
      const shared = a.poleIds.find((p) => b.poleIds.includes(p));
      if (shared) {
        const sideOf = (c: CableElement) => (c.poleIds.indexOf(shared) > 0 ? 'prev' : 'next') as 'prev' | 'next';
        els.push({ id: `j${t}`, type: 'cable_arc', poleId: shared, from: { cableId: a.id, side: sideOf(a), occurrence: 0 }, to: { cableId: b.id, side: sideOf(b), occurrence: 0 }, x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as CableArcElement);
      }
    }
    let norm = normalizeElements(els, (() => { let k = 0; return () => `g${t}_${k++}`; })());
    norm = norm.map((e) => {
      if (e.type !== 'cable') return e;
      let c = e;
      c.poleIds.slice(0, -1).forEach((p, i) => {
        if (rnd(5) === 0) return; // some spans without data
        const props: SpanProps = {
          poles: [p, c.poleIds[i + 1]], system: rnd(6) === 0 ? '1ph2w' : '3ph4w', cableKind: (['abc', 'underground', 'bare', 'other'] as const)[rnd(4)],
          material: rnd(3) ? 'al' : 'cu', crossSectionMm2: [16, 25, 35, 50, 70, 95, 120, 150][rnd(8)], neutralCrossSectionMm2: [25, 50, 70, 95][rnd(4)],
          neutralMaterial: (['al', 'cu', 'alloy'] as const)[rnd(3)], xOhmPerKm: [0.08, 0.1, 0.3][rnd(3)], dataSource: rnd(4) ? 'golden' : undefined,
        };
        if (rnd(4) === 0) props.parallel = 2;
        if (rnd(5) === 0) props.rOhmPerKm = 0.3 + rnd(10) / 10;
        if (rnd(6) === 0) props.review = ['split'];
        c = withSpanProps(c, c.spanIds![i], props);
      });
      return c;
    });
    const distances: Record<string, string> = {};
    for (const e of norm) if (e.type === 'cable') e.poleIds.slice(0, -1).forEach((p, i) => {
      const k = [p, e.poleIds[i + 1]].sort().join('_');
      if (rnd(7) !== 0) distances[k] = ['30', '40', '45.5', '50', '1', '60', 'abc'][rnd(7)];
    });
    const settings: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: rnd(5) ? 0.9 : undefined, conductorTempC: rnd(5) ? 70 : undefined, singlePhaseMode: rnd(3) ? 'worst' : 'balanced' };
    out.push({ name: `net${t}`, elements: norm, distances, settings });
  }
  return out;
};

/** Everything a user sees from the topology and the calculation, as plain data. */
export const goldenOutput = (g: GoldenCase) => {
  const n = buildNetwork(g.elements);
  const r = computeVoltageDrop(g.elements, g.distances, g.settings);
  const round = (v: number | undefined) => (v === undefined ? null : Math.round(v * 1e9) / 1e9);
  return {
    circuits: n.circuits.map((c) => ({ status: c.status, source: c.sourcePoleId ?? null, kind: c.sourceKind ?? null, spans: c.spans.map((s) => `${s.cableId}#${s.index}:${s.fromPole}>${s.toPole}`), issues: c.issues.map((i) => JSON.stringify(i)).sort() })),
    issues: n.issues.map((i) => JSON.stringify(i)).sort(),
    settingsMissing: r.settingsMissing,
    spans: [...r.bySpan.values()].map((s) => ({ k: s.key, ok: s.computable, dv: round(s.dropV), cum: round(s.cumulativeDropV), i: round(s.phaseCurrentA), miss: s.missing, prov: s.provisional })).sort((a, b) => a.k.localeCompare(b.k)),
    poles: [...r.byPole.entries()].map(([p, list]) => ({ p, r: list.map((x) => ({ st: x.status, dv: round(x.dropV), pc: round(x.percent), ll: round(x.lineV), why: x.reason ?? null, prov: x.provisional })) })).sort((a, b) => a.p.localeCompare(b.p)),
  };
};

/** Radial trees from one transformer with complete data: most spans are computed. */
export const goldenTreeCases = (): GoldenCase[] => {
  const out: GoldenCase[] = [];
  let seed = 7919;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
  for (let t = 0; t < 80; t++) {
    const color = COLORS[rnd(3)];
    const els: DrawingElement[] = [{ id: `T${t}`, type: 'symbol', symbolId: 'transformer', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 } as SymbolElement];
    const poles: string[] = [`T${t}`];
    const distances: Record<string, string> = {};
    // trunk then branches, each a separate cable starting at an existing pole
    const nCables = 1 + rnd(4);
    let pc = 0;
    for (let c = 0; c < nCables; c++) {
      const from = c === 0 ? poles[0] : poles[1 + rnd(poles.length - 1)] ?? poles[0];
      const ids = [from];
      for (let k = 0, len = 1 + rnd(4); k < len; k++) {
        const id = `q${t}_${pc++}`;
        els.push({ id, type: 'symbol', symbolId: 'lv-pole', x: pc * 50, y: c * 50, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 } as SymbolElement);
        poles.push(id);
        distances[[ids[ids.length - 1], id].sort().join('_')] = String(20 + rnd(60));
        ids.push(id);
      }
      els.push({ id: `k${t}_${c}`, type: 'cable', x: 0, y: 0, poleIds: ids, cableIndex: c, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2 } as CableElement);
    }
    for (let u = 0, n = 1 + rnd(8); u < n; u++) {
      const pole = poles[1 + rnd(poles.length - 1)];
      const variant = rnd(2) ? 'circle' : 'square';
      els.push({ id: `v${t}_${u}`, type: 'consumer', x: 0, y: 0, poleId: pole, color, count: 1 + rnd(4), variant, label: variant === 'square' ? ['', '63', '25', '40'][rnd(4)] : '', strokeColor: '#000', fillColor: '#000', strokeWidth: 2 } as ConsumerElement);
    }
    let norm = normalizeElements(els, (() => { let k = 0; return () => `h${t}_${k++}`; })());
    norm = norm.map((e) => {
      if (e.type !== 'cable') return e;
      let c = e;
      c.poleIds.slice(0, -1).forEach((p, i) => {
        const props: SpanProps = {
          poles: [p, c.poleIds[i + 1]], system: '3ph4w', cableKind: rnd(2) ? 'abc' : 'underground', material: rnd(4) ? 'al' : 'cu',
          crossSectionMm2: [35, 50, 70, 95, 120][rnd(5)], neutralCrossSectionMm2: [35, 50, 70, 95][rnd(4)], neutralMaterial: rnd(3) ? 'al' : 'cu',
          xOhmPerKm: [0.08, 0.1][rnd(2)], dataSource: 'golden',
        };
        if (rnd(5) === 0) props.parallel = 2;
        if (rnd(8) === 0) props.review = ['split'];
        c = withSpanProps(c, c.spanIds![i], props);
      });
      return c;
    });
    const settings: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: [0.85, 0.9, 1][rnd(3)], conductorTempC: [20, 70, 90][rnd(3)], singlePhaseMode: rnd(3) ? 'worst' : 'balanced' };
    out.push({ name: `tree${t}`, elements: norm, distances, settings });
  }
  return out;
};

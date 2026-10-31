import { describe, expect, it } from 'vitest';
import { ar } from '../../i18n/ar';
import { en } from '../../i18n/en';
import {
  circuitQuantities, hasValue, inputOfReason, issueTextKey, issueViews, makeNamer, numText, phasorText, REASON_CODES, reasonGroups, runE2Study, sourcePoleOf, spanInputs, spanPlace, STATUSES,
  studyOverview, WARNING_CODES, type CircuitResult, type E2StudyResult, type Quantity,
} from '../e2Presentation';
import type { CableElement, DrawingElement } from '../../types/drawing';
import { translate } from '../../i18n';
import { poleNamer } from '../poleNames';
import { fourStatusDoc, networkIssueDoc } from './e2Fixtures';

// E2 UI integration: the presentation adapter (logic only, no rendering).

const has = (dict: unknown, key: string) => key.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), dict);
const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]); }
  return v;
};
const byColour = (r: E2StudyResult, cableId: string): CircuitResult => r.circuits.find((c) => c.spans.some((s) => s.key.startsWith(`${cableId}#`)))!;
const quantities = (c: CircuitResult): Quantity<unknown>[] => [c.pLossW, c.qAbsorbedVar,
  ...c.nodes.flatMap((n) => [...Object.values(n.voltage), n.neutralShiftV, ...Object.values(n.lineV), ...Object.values(n.dropV), ...Object.values(n.dropPercent)]),
  ...c.spans.flatMap((s) => [...Object.values(s.current), ...Object.values(s.perSetCurrentA), ...Object.values(s.arithmeticSumA), ...Object.values(s.dropV), s.pLossW, s.qAbsorbedVar])];

describe('the input adapter (decision D-B)', () => {
  it('an existing project, no allocation, the empty catalogue: nothing is filled in', () => {
    const r = runE2Study(fourStatusDoc());
    expect(r.inputOrigin).toBe('legacy-project');
    expect(r.catalogueErrors).toEqual([]);
    // the single-phase subscribers have no phase: their circuit has no voltage result
    const green = byColour(r, 'k3');
    expect(green.completeness).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
    for (const q of quantities(green).filter((q) => q.status === 'unavailable' || q.status === 'not-run')) expect(q.value).toBeUndefined();
    // no catalogue value anywhere
    expect(JSON.stringify(r)).not.toContain('"provenance":"catalogue"');
  });
  it('the document is never written (deep-frozen), and the same document gives the same result', () => {
    const d = fourStatusDoc();
    const before = JSON.stringify(d);
    const frozen = deepFreeze(structuredClone(d));
    const a = runE2Study(frozen), b = runE2Study(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the study overview', () => {
  it('counts the circuits by completeness: one of each of the four statuses', () => {
    const r = runE2Study(fourStatusDoc());
    expect(studyOverview(r)).toEqual({ total: 4, computed: 1, provisional: 1, unavailable: 1, 'not-run': 1 });
    expect(byColour(r, 'k1').completeness.status).toBe('computed');
    expect(byColour(r, 'k2').completeness.status).toBe('provisional');
    expect(byColour(r, 'k4').completeness).toMatchObject({ status: 'not-run', reason: 'parallel-invalid' });
  });
  it('completeness, not the solve: a circuit whose sweep did not start is not counted as not-run when its data are only missing', () => {
    const green = byColour(runE2Study(fourStatusDoc()), 'k3');
    expect(green.solve.status).toBe('not-run');
    expect(green.completeness.status).toBe('unavailable');
  });
  it('the source of a calculable circuit is its first node; none for a network that cannot be calculated', () => {
    expect(sourcePoleOf(byColour(runE2Study(fourStatusDoc()), 'k1'))).toBe('T1');
    const loop = runE2Study(networkIssueDoc()).circuits[0];
    expect(loop.solve.reason).toBe('circuit-not-computed');
    expect(sourcePoleOf(loop)).toBeUndefined();
  });
});

describe('values', () => {
  it('a value is shown only when it exists: unavailable and not-run are "—", never 0', () => {
    const r = runE2Study(fourStatusDoc());
    for (const c of r.circuits) for (const q of quantities(c)) {
      if (hasValue(q)) continue;
      const t = typeof (q as Quantity<unknown> & { unit: string }).unit === 'string' && q.unit === 'A' && 'magnitude' in Object(q.value) ? phasorText(q as never) : numText(q as Quantity<number>);
      expect(t, JSON.stringify(q)).toBe('—');
    }
  });
  it('a provisional value is marked ≈; a computed one is not', () => {
    const r = runE2Study(fourStatusDoc());
    const red = byColour(r, 'k1').nodes[1].dropV.a, blue = byColour(r, 'k2').nodes[1].dropV.a;
    expect(red.status).toBe('computed');
    expect(numText(red)).toMatch(/^\d+\.\d{2} V$/);
    expect(blue.status).toBe('provisional');
    expect(numText(blue)).toMatch(/^≈\d+\.\d{2} V$/);
  });
});

describe('spans', () => {
  it('a calculated span shows the inputs it was calculated with, with their provenance', () => {
    const r = runE2Study(fourStatusDoc());
    const s = byColour(r, 'k1').spans[0];
    expect(spanInputs(s).map((i) => [i.name, i.value, i.provenance])).toEqual([
      ['L', 100, 'project'], ['system', '3ph4w', 'project'], ['R', 0.5, 'project'], ['X', 0.08, 'project'], ['np', 1, 'project'],
    ]);
  });
  it('a span without a result has no inputs shown (nothing is read from the drawing instead)', () => {
    expect(spanInputs(byColour(runE2Study(fourStatusDoc()), 'k4').spans[0])).toEqual([]);
  });
  it('the cable and the two poles of a span (names only)', () => {
    const d = fourStatusDoc();
    const cables = new Map(d.elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c]));
    expect(spanPlace('k1#1', cables)).toMatchObject({ index: 1, from: 'A', to: 'E' });
    expect(spanPlace('gone#0', cables).cable).toBeUndefined();
  });
});

describe('issues', () => {
  it('every issue is kept, those that block first; the E1 network fields, source and circuits are kept', () => {
    const r = runE2Study(networkIssueDoc());
    const v = issueViews(r);
    expect(v).toHaveLength(r.issues.length);
    const loop = v.find((i) => i.code === 'network:loop')!;
    expect(loop).toMatchObject({ severity: 'reported', source: 'e1-network', fields: [['poleIds', 'A,B,T']] });
    expect(loop.circuitIds).toEqual([r.circuits[0].id]);
    expect(v.find((i) => i.code === 'network:legacy-jumper')).toMatchObject({ target: { kind: 'element', id: 'L' }, source: 'e1-network', fields: [['elementId', 'L']] });
    const four = issueViews(runE2Study(fourStatusDoc()));
    expect(four[0]).toMatchObject({ code: 'parallel-invalid', severity: 'blocks', target: { kind: 'span', id: 'k4#0' }, fields: [['value', '1.5']] });
    expect(four.find((i) => i.code === 'network:orphan-consumer')).toMatchObject({ severity: 'provisional', fields: [['consumerId', 'orphan'], ['poleId', 'F'], ['color', '#123456']] });
  });
  it('every code E2 can give has a text in both languages; an unknown code has none (and is shown as a data issue)', () => {
    const codes = ['parallel-spans', 'loop', 'transformer-not-source', 'orphan-consumer', 'legacy-jumper', 'missing-pole', 'passes-source-pole', 'same-colour-crossing',
      'ambiguous-junction', 'invalid-load', 'isolated-end-jumpered', 'connected-end-alone', 'three-phase-on-single-phase', 'split-side-unassigned',
      'proposed-consumer-unconnected', 'inferred-junction'].map((k) => `network:${k}`)
      .concat(['setting-default:powerFactor', 'setting-default:phase-parallel', 'catalogue:entry-refused', 'catalogue:entry-not-found', 'study:proposed-consumer',
        'allocation:approval-incomplete', 'length-suspect', 'parallel-invalid']);
    for (const c of codes) {
      const k = issueTextKey(c);
      expect(k, c).toBeDefined();
      expect(typeof has(ar, k!), c).toBe('string');
      expect(typeof has(en, k!), c).toBe('string');
    }
    expect(issueTextKey('network:something-new')).toBeUndefined();
  });
});

describe('texts of the codes', () => {
  it('every status, reason and warning of E2 has a text in both languages', () => {
    for (const s of STATUSES) for (const d of [ar, en]) expect(typeof has(d, `e2.status.${s}`), s).toBe('string');
    for (const r of REASON_CODES) for (const d of [ar, en]) expect(typeof has(d, `e2.reason.${r}`), r).toBe('string');
    for (const w of WARNING_CODES) for (const d of [ar, en]) expect(typeof has(d, `e2.warning.${w}`), w).toBe('string');
    expect(REASON_CODES).toHaveLength(22);
    expect(WARNING_CODES).toHaveLength(13);
  });
  it('the arithmetic sum is named as such, never as a guaranteed upper bound', () => {
    expect(ar.e2.q.arithmeticSum).toBe('المجموع الحسابي للتيارات');
    expect(en.e2.q.arithmeticSum).toBe('Arithmetic sum of currents');
    expect(ar.e2.q.arithmeticSumNote).toContain('ليس حداً أعلى مضموناً');
    expect(en.e2.q.arithmeticSumNote).toContain('not a guaranteed upper bound');
  });
});

describe('names and reason groups', () => {
  const d = fourStatusDoc();
  const r = runE2Study(d);
  const t = (key: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('en', key, p);
  const names = makeNamer(d.elements, r.circuits.map((c) => c.id), poleNamer(d.elements as DrawingElement[], t), t);
  it('names every kind of id the result uses', () => {
    expect(names.span('k1#1')).toBe('Pole 1 – Pole 5 · span 2 of cable 1');
    expect(names.cable('k1')).toBe('Cable 1 (Transformer 1 – Pole 5)');
    expect(names.consumer('uC')).toBe('Single-phase subscriber ×3 at Pole 3');
    // one subscriber: no count
    expect(names.consumer('uA')).toBe('Three-phase subscriber at Pole 1');
    expect(names.circuit(r.circuits[3].id)).toBe('Circuit 4');
    expect(names.element('k4#0')).toBe(names.span('k4#0'));
    expect(names.element('uC')).toBe(names.consumer('uC'));
    expect(names.element('nothing')).toBe('Unknown element');
    expect(names.target({ kind: 'pole', id: 'A|B' })).toBe('Pole 1, Pole 2');
    expect(names.span('gone#0')).toBe('A span of a cable that is not in the drawing');
  });
  it('each reason of a circuit once, with every value without a value linked to it; values are never grouped', () => {
    for (const c of r.circuits) {
      const { groups, groupOf } = reasonGroups(c, r.issues);
      expect(new Set(groups.map((g) => `${g.status}|${g.reason}`)).size).toBe(groups.length);
      for (const { q } of circuitQuantities(c)) {
        const g = groupOf(q);
        if (q.status === 'computed' || q.status === 'provisional' || q.reason === 'phase-not-present') expect(g).toBeUndefined();
        else expect(g, JSON.stringify(q)).toBeDefined();
      }
      expect(groups.reduce((n, g) => n + g.count, 0)).toBe(circuitQuantities(c).filter((x) => groupOf(x.q) !== undefined).length);
    }
    expect(reasonGroups(r.circuits.find((c) => c.completeness.status === 'computed')!, r.issues).groups).toEqual([]);
  });
  it('the group of an invalid input carries its input, the entered value (from the issue) and the element', () => {
    const c = r.circuits.find((x) => x.completeness.status === 'not-run')!;
    const [g, ...rest] = reasonGroups(c, r.issues).groups;
    expect(rest).toEqual([]);
    expect(g).toMatchObject({ n: 1, status: 'not-run', reason: 'parallel-invalid', blockedBy: ['k4#0'], inputKey: 'e2.inputOf.parallel-invalid', entered: '1.5' });
    expect(g.affected.map((a) => a.place.kind)).toEqual(expect.arrayContaining(['totals', 'node', 'span', 'load']));
  });
  it('a missing input: its input, no entered value', () => {
    const c = r.circuits.find((x) => x.completeness.status === 'unavailable')!;
    const g = reasonGroups(c, r.issues).groups.find((x) => x.reason === 'phase-allocation-missing')!;
    expect(g).toMatchObject({ status: 'unavailable', inputKey: 'e2.inputOf.phase-allocation-missing' });
    expect(g.blockedBy).toContain('uC');
    // one group per reason: the elements the result names are merged
    expect(reasonGroups(c, r.issues).groups.filter((x) => x.reason === 'phase-allocation-missing')).toHaveLength(1);
    expect(g.entered).toBeUndefined();
  });
  it('every reason that is about an input has the name of that input in both languages', () => {
    for (const reason of REASON_CODES) {
      const k = inputOfReason(reason);
      if (k) for (const dict of [ar, en]) expect(typeof has(dict, k), reason).toBe('string');
    }
  });
});

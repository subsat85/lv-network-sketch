import { describe, expect, it, vi } from 'vitest';

// In-memory IndexedDB stand-in for the projects (idb-keyval API).
const db = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data,
    api: {
      get: async (k: string) => clone(data.get(k)),
      set: async (k: string, v: unknown) => { data.set(k, clone(v)); },
      del: async (k: string) => { data.delete(k); },
      setMany: async (entries: [string, unknown][]) => { for (const [k, v] of entries) data.set(k, clone(v)); },
    },
  };
});
vi.mock('idb-keyval', () => db.api);

import type { CableElement, DrawingElement, SpanProps } from '../../../types/drawing';
import { goldenCases } from '../../../utils/__tests__/vdGoldenNetworks';
import { loadProject, saveProject } from '../../../utils/projectStorage';
import { serializeProject, validateProjectFile } from '../../../utils/projectSerialization';
import { withSpanProps } from '../../../utils/spanModel';
import { useDrawingStore } from '../../../store/drawingStore';
// the values the removed IEC 60228 table had for Al 70 mm² (20 °C) — written here only to show that
// they appear nowhere (the table itself was removed with the default-cable change)
const IEC_AL70_R20 = 0.443;
import { runStudyE2 } from '../index';
import type { CircuitResult } from '../model';
import type { PhaseAllocation } from '../phases';
import { drawing } from './references';
import { issueTextKey } from '../../../utils/e2Presentation';
import { translate } from '../../../i18n';

// Final decision (Stage B): no IEC 60228 fallback in E2. Old projects are test drawings: they keep
// every drawing datum and stay editable; their E2 results may become unavailable where an R / RN was
// only implied by the conductor material and section. ALL VALUES ARE SYNTHETIC.

/** an old span: conductor described (material, section, kind) but no R / X / RN entered */
const OLD: Omit<SpanProps, 'poles'> = { cableKind: 'abc', system: '3ph4w', material: 'al', crossSectionMm2: 70, neutralMaterial: 'al', neutralCrossSectionMm2: 70, parallel: 1 };
const ON_A = (n: number): PhaseAllocation => ({ consumers: { u0: { a: n, source: 'design', verification: { status: 'checked' } } }, singlePhaseSpans: {} });
const A = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!;
const e2 = (props: Omit<SpanProps, 'poles'>, o: { balanced?: boolean; tempC?: number; ambientC?: number } = {}) => {
  const { doc } = drawing({ Lm: 100, props, consumers: [o.balanced ? { variant: 'square', label: '30' } : { variant: 'circle', count: 5 }], electrical: { ...(o.tempC !== undefined ? { conductorTempC: o.tempC } : {}), ...(o.ambientC !== undefined ? { ambientTempC: o.ambientC } : {}) } });
  const r = runStudyE2(doc, { inputOrigin: 'legacy-project', ...(o.balanced ? {} : { allocation: ON_A(5) }) });
  return { doc, r, c: r.circuits.find((x) => x.spans.length)! };
};
const inputs = (c: CircuitResult, name: string) => [...c.nodes.flatMap((n) => [...Object.values(n.dropV), ...Object.values(n.voltage)]), ...c.spans.flatMap((s) => [...Object.values(s.current), ...Object.values(s.dropV), s.pLossW, s.qAbsorbedVar])]
  .flatMap((q) => q.inputs).filter((i) => i.name === name);
const style = { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
const spanOf = (els: DrawingElement[]) => { const k = els.find((e): e is CableElement => e.type === 'cable')!; return { cable: k, props: k.spanProps![k.spanIds![0]] }; };

describe('no IEC 60228 fallback in E2', () => {
  it('1 / 3. an old span without R gets no R from the table (any conductor temperature, any ambient): unavailable, the missing R named', () => {
    for (const [tempC, ambientC] of [[undefined, undefined], [70, undefined], [90, 45]] as const) {
      const { r, c } = e2({ ...OLD, xOhmPerKm: 0.08 }, { balanced: true, tempC, ambientC });
      expect(inputs(c, 'R'), String(tempC)).toEqual([]);
      expect(A(c).dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
      expect(r.issues).toContainEqual({ code: 'phase:resistance-missing', severity: 'blocks', target: { kind: 'span', id: 'k1#0' }, params: { property: 'R' } });
      const text = JSON.stringify(r);
      expect(text).not.toContain('iec-table');
      expect(text).not.toContain('IEC 60228');
      expect(text).not.toContain('dc-resistance-used');
      expect(text).not.toContain(String(IEC_AL70_R20));
    }
  });
  it('2 / 4. an old span without RN gets no RN from the table (and never R): the neutral results unavailable, the missing RN named', () => {
    const { r, c } = e2({ ...OLD, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 'synthetic' }, { tempC: 70 });
    expect(inputs(c, 'RN')).toEqual([]);
    expect(r.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code).sort()).toEqual(['neutral:reactance-missing', 'neutral:resistance-missing']);
    expect(JSON.stringify(r)).not.toContain('iec-table');
    expect(c.spans[0].pLossW).toMatchObject({ status: 'unavailable', reason: 'neutral-impedance-missing' });
  });
  it('8. unavailable only where the missing value is needed: a balanced circuit without RN is still computed', () => {
    const { c } = e2({ ...OLD, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 'synthetic' }, { balanced: true, tempC: 70 });
    expect(A(c).dropV.a.status).toBe('computed');
    expect(inputs(c, 'R').every((i) => i.value === 0.5 && i.provenance === 'project')).toBe(true);
    // R missing blocks the span whatever the balance
    expect(A(e2(OLD, { balanced: true, tempC: 70 }).c).dropV.a.status).toBe('unavailable');
  });
});

describe('old projects stay intact and editable', () => {
  const CASES = goldenCases().slice(0, 25);
  const fileOf = (els: DrawingElement[], g = CASES[0]) => serializeProject(els, style, 1, 'circle', g.distances, {}, 'p1', 'old', undefined, undefined, g.settings, {});

  it('5. an old project opens with every drawing datum (elements, distances, settings) unchanged', () => {
    for (const g of CASES) {
      const file = fileOf(g.elements, g);
      const v = validateProjectFile(JSON.parse(file));
      expect(v.ok, g.name).toBe(true);
      if (!v.ok) continue;
      expect(v.data.elements, g.name).toEqual(JSON.parse(file).elements);
      expect(v.data.connectionDistances).toEqual(g.distances);
      useDrawingStore.getState().loadProject({ ...v.data });
      expect(useDrawingStore.getState().elements, g.name).toEqual(JSON.parse(file).elements);
    }
  });
  it('6. the cable properties of an old span can be entered / changed with the existing data functions, and E2 then uses them as entered', () => {
    const { doc } = e2(OLD, { balanced: true, tempC: 70 });
    const { cable, props } = spanOf(doc.elements as DrawingElement[]);
    const edited: SpanProps = { ...props, rOhmPerKm: 0.641, xOhmPerKm: 0.0921, rNeutralOhmPerKm: 0.7, material: 'cu', crossSectionMm2: 50, neutralMaterial: 'cu', neutralCrossSectionMm2: 50, parallel: 2, system: '3ph4w', dataSource: 'manufacturer table' };
    const next = withSpanProps(cable, cable.spanIds![0], edited);
    // the drawing of the cable is the same: poles, span ids, position, colour
    expect([next.poleIds, next.spanIds, next.x, next.y, next.strokeColor]).toEqual([cable.poleIds, cable.spanIds, cable.x, cable.y, cable.strokeColor]);
    const doc2 = { ...doc, elements: (doc.elements as DrawingElement[]).map((e) => (e.id === cable.id ? next : e)) };
    const c = runStudyE2(doc2, { inputOrigin: 'legacy-project' }).circuits.find((x) => x.spans.length)!;
    expect([...new Set(inputs(c, 'R').map((i) => i.value))]).toEqual([0.641]);
    expect([...new Set(inputs(c, 'X').map((i) => i.value))]).toEqual([0.0921]);
    expect([...new Set(inputs(c, 'np').map((i) => i.value))]).toEqual([2]);
    expect(A(c).dropV.a.status).toBe('computed');
  });
  it('7 / 10. save and reopen keeps the drawing and the cable properties; running E2 writes nothing into the project', async () => {
    const { doc } = e2(OLD, { tempC: 70 });
    const project = { id: 'old-1', name: 'old', createdAt: 1, updatedAt: 2, data: { elements: doc.elements as DrawingElement[], style, poleSizeScale: 1, consumerVariant: 'circle' as const, connectionDistances: doc.connectionDistances, electrical: doc.electrical } };
    await saveProject(project);
    const stored = JSON.stringify(db.data.get('project_old-1'));
    const reopened = (await loadProject('old-1'))!;
    expect(JSON.stringify(reopened.data)).toBe(JSON.stringify(project.data));
    expect(spanOf(reopened.data.elements).props).toMatchObject({ material: 'al', crossSectionMm2: 70, neutralMaterial: 'al', neutralCrossSectionMm2: 70, cableKind: 'abc' });
    const before = JSON.stringify(reopened.data);
    runStudyE2({ elements: reopened.data.elements, connectionDistances: reopened.data.connectionDistances!, distanceFlags: {}, electrical: reopened.data.electrical! }, { inputOrigin: 'legacy-project' });
    expect(JSON.stringify(reopened.data)).toBe(before);
    expect(JSON.stringify(db.data.get('project_old-1'))).toBe(stored);
    expect(spanOf(reopened.data.elements).props.rOhmPerKm).toBeUndefined();
  });
});

describe('phase:reactance-missing', () => {
  const codesOf = (r: ReturnType<typeof e2>['r']) => r.issues.filter((i) => i.target.kind === 'span' && i.target.id === 'k1#0').map((i) => i.code);
  it('R entered, X missing: one blocking issue naming X on the span, the results unavailable (X is never 0 or taken from R)', () => {
    for (const balanced of [true, false]) {
      const { r, c } = e2({ ...OLD, rOhmPerKm: 0.5, rNeutralOhmPerKm: 0.6, dataSource: 'synthetic' }, { balanced, tempC: 70 });
      expect(r.issues.filter((i) => i.code === 'phase:reactance-missing')).toEqual([{ code: 'phase:reactance-missing', severity: 'blocks', target: { kind: 'span', id: 'k1#0' }, params: { property: 'X' } }]);
      expect(r.issues.some((i) => i.code === 'phase:resistance-missing')).toBe(false);
      expect(inputs(c, 'X')).toEqual([]);
      expect(A(c).dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
      expect(c.spans[0].pLossW).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
      expect(c.completeness).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
    }
  });
  it('R and X both missing: each named once, no duplicate and nothing contradictory; with both entered neither appears', () => {
    const { r, c } = e2(OLD, { tempC: 70 });
    const codes = codesOf(r);
    expect(codes.filter((x) => x === 'phase:resistance-missing')).toHaveLength(1);
    expect(codes.filter((x) => x === 'phase:reactance-missing')).toHaveLength(1);
    expect(new Set(r.issues.map((i) => JSON.stringify(i))).size).toBe(r.issues.length);
    expect(A(c).dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
    const entered = e2({ ...OLD, rOhmPerKm: 0.5, xOhmPerKm: 0.08 }, { balanced: true, tempC: 70 }).r;
    expect(codesOf(entered).filter((x) => x.startsWith('phase:'))).toEqual([]);
    // X missing alone: only X named
    expect(codesOf(e2({ ...OLD, xOhmPerKm: 0.08 }, { tempC: 70 }).r).filter((x) => x.startsWith('phase:'))).toEqual(['phase:resistance-missing']);
  });
  it('the texts in both languages', () => {
    const key = issueTextKey('phase:reactance-missing')!;
    expect(translate('ar', key)).toBe('مفاعلة الطور X غير مُدخلة؛ لا يمكن حساب هذا المقطع دونها');
    expect(translate('en', key)).toBe('Phase reactance X is missing; this span cannot be calculated without it.');
  });
});

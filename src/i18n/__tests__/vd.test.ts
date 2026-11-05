import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { translate, type TKey, type TParams } from '..';
import { voltageDropReportText, poleStatusText } from '../../components/VoltageDropPanel';
import { computeVoltageView } from '../../utils/__tests__/vdTestView';
import { reasonLabel, warningLabel, type VdPole } from '../../utils/e2Presentation';
import { normalizeElements, withSpanProps } from '../../utils/spanModel';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';
import { poleNamer } from '../../utils/poleNames';
import { issueText, CIRCUIT_STATUS_LABEL, LOAD_MODEL_LABEL, circuitStatusLabel, type Tr } from '../../utils/vdLabels';
import type { NetworkIssue } from '../../utils/network';
import type { CableElement, DrawingElement } from '../../types/drawing';

// Batch 1 of phase 4: the voltage drop panel, its messages, tables and text report.

const EN: Tr = (k: TKey, p?: TParams) => translate('en', k, p);
const AR: Tr = (k: TKey, p?: TParams) => translate('ar', k, p);
const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));

const ISSUES: NetworkIssue[] = [
  { kind: 'parallel-spans', poles: ['A', 'B'], cableIds: ['x', 'y'] }, { kind: 'loop', poleIds: ['A'] },
  { kind: 'transformer-not-source', poleId: 'T' }, { kind: 'orphan-consumer', consumerId: 'u', poleId: 'A', color: '#f00' },
  { kind: 'legacy-jumper', elementId: 'j' }, { kind: 'missing-pole', cableId: 'c', poleId: 'Z' },
  { kind: 'passes-source-pole', poleId: 'T', cableId: 'c' }, { kind: 'same-colour-crossing', poleId: 'A', cableIds: [] },
  { kind: 'ambiguous-junction', poleId: 'A', cableIds: [] }, { kind: 'invalid-load', consumerId: 'u', poleId: 'A', label: '0' },
  { kind: 'isolated-end-jumpered', poleId: 'A', cableId: 'c' }, { kind: 'connected-end-alone', poleId: 'A', cableId: 'c' },
  { kind: 'three-phase-on-single-phase', spanKey: 's' }, { kind: 'split-side-unassigned', poleId: 'A', cableId: 'c', occurrence: 0 },
  { kind: 'proposed-consumer-unconnected', consumerId: 'u', poleId: 'A' },
];

const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
// network 1 (red): T–A–B with data on both spans; network 2 (blue): T2–C with no span data (read with the
// default supply system 3ph+N; no R / X is assumed, so it is not calculated)
const network = () => {
  const DATA = { system: '3ph4w' as const, cableKind: 'abc' as const, material: 'al' as const, crossSectionMm2: 95, rOhmPerKm: 0.38448, xOhmPerKm: 0.08, parallel: 1, dataSource: 'test' };
  let els = normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'), pole('T2', 'transformer'), pole('C'),
    { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement,
    { id: 'd', type: 'cable', x: 0, y: 0, poleIds: ['T2', 'C'], cableIndex: 0, offset: 0, strokeColor: '#0000ff', fillColor: 'none', strokeWidth: 2 } as CableElement,
    { id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#ff0000', count: 1, variant: 'square', label: '63', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as DrawingElement,
    { id: 'w', type: 'consumer', x: 0, y: 0, poleId: 'C', color: '#0000ff', count: 1, variant: 'square', label: '20', strokeColor: '#00f', fillColor: '#00f', strokeWidth: 2 } as DrawingElement]);
  const c = els.find((e) => e.id === 'c') as CableElement;
  els = els.map((e) => (e.id === 'c' ? [0, 1].reduce((x, i) => withSpanProps(x, x.spanIds![i], { poles: [x.poleIds[i], x.poleIds[i + 1]], ...DATA }), c) : e));
  return els;
};
const D = { A_T: '100', A_B: '50', C_T2: '40' };

describe('voltage drop texts', () => {
  it('the vd, common and poles sections have the same keys in both languages, all filled', () => {
    for (const sec of ['vd', 'common', 'poles'] as const) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it('English has no Arabic letters; Arabic uses the approved terms (no «كيبل», no «الفولتية»)', () => {
    for (const [k, v] of leaves(en.vd)) expect(v, k).not.toMatch(ARABIC);
    for (const [k, v] of leaves(ar.vd)) expect(v, k).not.toMatch(/كيبل|فولتية/);
    expect(ar.vd.title).toBe('هبوط الجهد');
    expect(en.vd.title).toBe('Voltage Drop');
  });

  it('every network warning has a text in both languages, with the pole names put in', () => {
    const name = (id: string) => `<${id}>`;
    for (const i of ISSUES) {
      const a = issueText(i, name, AR), e = issueText(i, name, EN);
      expect(a.length, i.kind).toBeGreaterThan(0);
      expect(e, i.kind).not.toMatch(ARABIC);
      expect(e, i.kind).not.toMatch(/\{\w+\}/); // every placeholder filled
      if ('poleId' in i && i.kind !== 'missing-pole') expect(e, i.kind).toContain(`<${i.poleId}>`);
    }
    expect(issueText(ISSUES[0], name, EN)).toContain('<A> and <B> (2)');
    expect(issueText(ISSUES[9], name, EN)).toContain('«0»');
  });

  it('without a translator the texts stay Arabic (screens not translated yet read the same)', () => {
    expect(circuitStatusLabel('ok')).toBe(CIRCUIT_STATUS_LABEL.ok);
    expect(reasonLabel('length-missing', AR)).toBe(ar.e2.reason['length-missing']);
    expect(reasonLabel('length-missing', EN)).toBe(en.e2.reason['length-missing']);
    // the exported legend keeps its Arabic load model names
    expect(LOAD_MODEL_LABEL).toEqual({ 'constant-current': 'تيار ثابت', 'constant-power': 'قدرة ثابتة' });
  });

  it('pole status texts in both languages, provisional values never shown as plain «within the limit»', () => {
    const base = { poleId: 'A', bus: 'A', circuitId: 'c', color: '#f00', consumerIds: [], provisional: false, warnings: [] } as unknown as VdPole;
    expect(poleStatusText({ ...base, status: 'ok' }, EN)).toBe('✓ Within limit');
    expect(poleStatusText({ ...base, status: 'na', reason: 'length-missing' }, EN)).toBe(`? Cannot be calculated (${en.e2.reason['length-missing']})`);
    expect(poleStatusText({ ...base, status: 'na', reason: 'length-missing' })).toBe(`؟ غير قابل للحساب (${ar.e2.reason['length-missing']})`);
    const prov = poleStatusText({ ...base, status: 'ok', provisional: true, warnings: ['span-review', 'allocation-unverified'] }, EN);
    expect(prov).toBe(`⚑ Estimated — needs review (estimated value: Within limit) — ${warningLabel('span-review', EN)}; ${warningLabel('allocation-unverified', EN)}`);
  });

  it('the text report in English: settings, poles, sections, warnings and method', () => {
    const els = network();
    const r = computeVoltageView(els, D, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 });
    const cables = new Map(els.filter((e): e is CableElement => e.type === 'cable').map((x) => [x.id, x]));
    const text = voltageDropReportText(r, poleNamer(els, EN), cables, false, EN);
    expect(text.split('\n')[0]).toBe('Voltage Drop Report');
    expect(text).toContain('source Transformer 1 (transformer)');
    expect(text).toContain('  Pole 1 (a): 2.40 V (1.04%)'); // the same numbers as the Arabic report
    expect(text).toContain(`  Pole 3: cannot be calculated (${en.e2.reason['impedance-missing']})`);
    expect(text).not.toContain(en.e2.reason['system-missing']); // the default 3ph+N is used, never «not set»
    expect(text).toContain('Engine E2');
    expect(text).not.toContain('IEC 60228'); // no conductor table any more
    expect(text).toContain('Load model: Constant current');
    expect(text).toContain('is thermally safe');
    // the Arabic report has the same lines with the same numbers
    const arText = voltageDropReportText(r, poleNamer(els), cables, false);
    expect(arText.split('\n').length).toBe(text.split('\n').length);
    expect(arText.split('\n')[0]).toBe('تقرير هبوط الجهد');
    const nums = (s: string) => s.match(/\d+(\.\d+)?/g);
    expect(nums(arText.replace(/\b(Table|class) \d+/g, ''))?.slice(0, 12)).toEqual(nums(text.replace(/\b(Table|class) \d+/g, ''))?.slice(0, 12));
  });

  it('no visible Arabic text is left in the panel code', () => {
    const code = readFileSync(resolve(__dirname, '../../components/VoltageDropPanel.tsx'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(ARABIC);
    expect(code).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
  });
});

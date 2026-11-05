import { describe, expect, it } from 'vitest';
import { voltageDropReportText } from '../../components/VoltageDropPanel';
import { computeVoltageView } from './vdTestView';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { poleNamer } from '../poleNames';
import type { CableElement, DrawingElement } from '../../types/drawing';

const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;

describe('voltage-drop report text', () => {
  it('lists settings, each pole and span with its E2 values or why there is none, the warnings and the method', () => {
    const DATA = { system: '3ph4w' as const, cableKind: 'abc' as const, material: 'al' as const, crossSectionMm2: 95, rOhmPerKm: 0.38448, xOhmPerKm: 0.08, parallel: 1, dataSource: 'test' };
    let els = normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'), pole('T2', 'transformer'), pole('C'),
      { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement,
      { id: 'd', type: 'cable', x: 0, y: 0, poleIds: ['T2', 'C'], cableIndex: 0, offset: 0, strokeColor: '#0000ff', fillColor: 'none', strokeWidth: 2 } as CableElement,
      { id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#ff0000', count: 1, variant: 'square', label: '63', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as DrawingElement,
      { id: 'w', type: 'consumer', x: 0, y: 0, poleId: 'C', color: '#0000ff', count: 1, variant: 'square', label: '20', strokeColor: '#00f', fillColor: '#00f', strokeWidth: 2 } as DrawingElement]);
    const c = els.find((e) => e.id === 'c') as CableElement;
    // c: both spans with data; d: no span data at all (read with the default 3ph+N; no R / X is assumed:
    // E2 gives no value for it, and says why)
    els = els.map((e) => (e.id === 'c' ? [0, 1].reduce((x, i) => withSpanProps(x, x.spanIds![i], { poles: [x.poleIds[i], x.poleIds[i + 1]], ...DATA }), c) : e));
    const r = computeVoltageView(els, { A_T: '100', A_B: '50', C_T2: '40' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 });
    const text = voltageDropReportText(r, poleNamer(els), new Map(els.filter((e): e is CableElement => e.type === 'cable').map((x) => [x.id, x])));
    expect(text).toContain('المصدر محول 1');
    expect(text).toContain('عمود 1 (a): 2.40 V (1.04%)'); // 63 A, 100 m: the E2 phasor value (≈ 63 × 0.380903 × 0.1)
    expect(text).toContain('عمود 3: غير قابل للحساب (ممانعة الطور (R أو X) غير معروفة)');
    expect(text).toContain('الشبكة 2: غير قابل للحساب (ممانعة الطور (R أو X) غير معروفة)'); // not «computed»: E2 has no value for it
    expect(text).not.toContain('نظام التغذية غير محدد'); // the default 3ph+N is used
    expect(text).not.toContain('IEC 60228'); // no conductor table any more
    expect(text).toContain('لا يعني أن الكابل آمن حراريًا'); // approved term «كابل»
    expect(text).toContain('نموذج الحمل: تيار ثابت');
    // the default method: Equal Phase Current, named as balanced; no Worst Case mark or guarantee
    expect(text).toContain('توزيع الأحمال أحادية الطور: تيار متساوٍ على الأطوار — موزّعة');
    expect(text).not.toContain('▲');
    expect(text).not.toContain('ضمان أسوأ حالة');
    // Worst Case: named, marked, and how the worst was found (this resistive cable: the condition holds)
    const w = computeVoltageView(els, { A_T: '100', A_B: '50', C_T2: '40' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, singlePhaseMode: 'worst' });
    const wt = voltageDropReportText(w, poleNamer(els), new Map(els.filter((e): e is CableElement => e.type === 'cable').map((x) => [x.id, x])));
    expect(wt).toContain('توزيع الأحمال أحادية الطور: أسوأ حالة ▲');
    expect(text).toContain('الحمل الاسمي للمشترك أحادي الطور: 4 A');
    expect(text).toContain('المحرك E2');
    const cp = computeVoltageView(els, { A_T: '100', A_B: '50', C_T2: '40' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, loadModel: 'constant-power', singlePhaseMode: 'balanced', singlePhaseNominalA: 5 });
    const t2 = voltageDropReportText(cp, poleNamer(els), new Map());
    expect(t2).toContain('نموذج الحمل: قدرة ثابتة');
    expect(t2).toContain('توزيع الأحمال أحادية الطور: تيار متساوٍ على الأطوار');
    expect(t2).toContain('الحمل الاسمي للمشترك أحادي الطور: 5 A');
  });
});

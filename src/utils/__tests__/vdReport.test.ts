import { describe, expect, it } from 'vitest';
import { voltageDropReportText } from '../../components/VoltageDropPanel';
import { computeVoltageDrop } from '../voltageDrop';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { poleNamer } from '../poleNames';
import type { CableElement, DrawingElement } from '../../types/drawing';

const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;

describe('voltage-drop report text', () => {
  it('lists settings, each pole and span with its values or what is missing, the warnings and the method', () => {
    let els = normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'),
      { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement,
      { id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#ff0000', count: 1, variant: 'square', label: '63', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as DrawingElement]);
    const c = els[3] as CableElement;
    els = els.map((e) => (e.id === 'c' ? withSpanProps(c, c.spanIds![0], { poles: ['T', 'A'], system: '3ph4w', cableKind: 'abc', material: 'al', crossSectionMm2: 95, xOhmPerKm: 0.08, dataSource: 'test' }) : e));
    const r = computeVoltageDrop(els, { A_T: '100', A_B: '50' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 });
    const text = voltageDropReportText(r, poleNamer(els), new Map(els.filter((e): e is CableElement => e.type === 'cable').map((x) => [x.id, x])));
    expect(text).toContain('المصدر محول 1');
    expect(text).toContain('عمود 1: 2.40 V (1.04%)'); // 63 A × 0.380903 Ω/km × 0.1 km
    expect(text).toContain('عمود 2: غير قابل للحساب');
    expect(text).toContain('نظام التغذية');           // missing on span A → B
    expect(text).toContain('IEC 60228');
    expect(text).toContain('لا يعني أن الكابل آمن حراريًا'); // approved term «كابل»
    expect(text).toContain('نموذج الحمل: تيار ثابت');
    const cp = computeVoltageDrop(els, { A_T: '100', A_B: '50' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70, loadModel: 'constant-power' });
    expect(voltageDropReportText(cp, poleNamer(els), new Map())).toContain('نموذج الحمل: قدرة ثابتة');
  });
});

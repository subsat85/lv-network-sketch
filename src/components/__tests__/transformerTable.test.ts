import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translate, type TKey, type TParams } from '../../i18n';
import { TABLE_COLORS, transformerTableRows, transformerTableSize } from '../TransformerTableSvg';

// The transformer table drawn on the canvas and in the share preview / PDF: one shared drawing.

const AR = (k: TKey, p?: TParams) => translate('ar', k, p);
const EN = (k: TKey, p?: TParams) => translate('en', k, p);
const info = (boxes: number) => ({
  transformerNumber: 'T-17', mainCable: '300', mainLinesCount: '4', cableType: 'copper', distributionBoxesCount: String(boxes),
  circuitsPerBox: '4', emptyCircuitsPerBox: '1', perBoxCircuits: Array.from({ length: boxes }, () => ({ circuits: '4', emptyCircuits: '1' })),
  installationMethod: 'ground', transformerType: 'public', boxInstallationMethod: 'ground', lightingBox: 'none', capacitor: 'yes',
});
const strip = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const code = (f: string) => strip(readFileSync(resolve(__dirname, '..', f), 'utf8'));

describe('transformer table (shared drawing)', () => {
  it('one box: the 11 rows in their order, in Arabic and English', () => {
    expect(transformerTableRows(info(1), AR).map((r) => r.label)).toEqual(['الكابل الرئيسي', 'عدد الخطوط', 'نوع الخط', 'صناديق التوزيع', 'دوائر لكل صندوق', 'دوائر فارغة', 'تركيب المحول', 'نوع المحول', 'تركيب الصندوق', 'صندوق الإنارة', 'المكثف']);
    expect(transformerTableRows(info(1), EN).map((r) => r.label)).toEqual(['Main cable', 'Number of lines', 'Line type', 'Distribution boxes', 'Circuits per box', 'Empty circuits', 'Transformer installation', 'Transformer type', 'Box installation', 'Lighting box', 'Capacitor']);
    expect(transformerTableRows(info(1), AR).map((r) => r.value)).toEqual(['300 مم²', '4', 'نحاسي', '1', '4', '1', 'على الأرض', 'عام', 'على الأرض', 'لا يوجد', 'موجود']);
  });

  it('three boxes: a header row, one row per box, then the rest (13 rows)', () => {
    const rows = transformerTableRows(info(3), AR);
    expect(rows).toHaveLength(13);
    expect(rows.slice(4, 8).map((r) => [r.label.trim(), r.value])).toEqual([['الدوائر لكل صندوق', ''], ['صندوق 1', 'تشغيل: 4 | فارغ: 1'], ['صندوق 2', 'تشغيل: 4 | فارغ: 1'], ['صندوق 3', 'تشغيل: 4 | فارغ: 1']]);
    expect(rows.at(-1)).toEqual({ label: 'المكثف', value: 'موجود', capacitor: true });
  });

  it('only the capacitor row is marked; its value follows the saved code', () => {
    expect(transformerTableRows(info(1), EN).filter((r) => r.capacitor).map((r) => r.value)).toEqual(['Present']);
    expect(transformerTableRows({ ...info(1), capacitor: 'no' }, EN).at(-1)!.value).toBe(EN('tfTable.absent'));
  });

  it('the frame holds every row: header 48 + 25 per row + 25, times the table scale', () => {
    expect(transformerTableSize(11)).toEqual({ width: 300, height: 348 });
    expect(transformerTableSize(13)).toEqual({ width: 300, height: 398 });
    expect(transformerTableSize(11, 1.5)).toEqual({ width: 450, height: 522 });
  });

  it('the saved table data is only read', () => {
    const i = info(3); const before = JSON.stringify(i);
    transformerTableRows(i, AR); transformerTableRows(i, EN);
    expect(JSON.stringify(i)).toBe(before);
  });

  it('the canvas and the share preview draw the same table, and size it the same way', () => {
    const canvas = code('SketchCanvas.tsx'), preview = code('PreviewCanvas.tsx');
    expect(canvas).toContain('<TransformerTableSvg info={transformerInfo} scale={scale} t={tr} />');
    expect(preview).toContain('<TransformerTableSvg info={table.transformerInfo} scale={table.scale} t={t} />');
    expect(canvas).toContain('transformerTableSize(transformerTableRows(transformerInfo, tr).length, scale)');
    expect(canvas).not.toMatch(/baseRows|headerGradient|#00000020/);
    expect(preview).not.toMatch(/baseRows|headerGradient|#00000020/);
  });

  it('the zoom buttons are placed with numbers (the old "5 * scale" text made the transform invalid)', () => {
    const canvas = code('SketchCanvas.tsx');
    expect(canvas).toContain('transform={`translate(${tableWidth - 5 * scale}, ${5 * scale})`}');
    expect(canvas).not.toContain('5 * scale)`}>\n');
  });

  it('the calm blue palette', () => {
    expect(TABLE_COLORS).toMatchObject({ frame: '#2f5d8a', header: '#e9f0f7', title: '#1f3b5c', rule: '#d6e1ec' });
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';

// Phase 5 / batch C: the share preview page and what is printed on it (and so in the PDF).
// The export itself (html2canvas → JPEG → jsPDF, A4, resolution) is not changed.

const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const strip = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const raw = (f: string) => readFileSync(resolve(__dirname, '../../components', f), 'utf8');

describe('preview and export texts', () => {
  it('share and tfTable: same keys in both languages, filled; English has no Arabic', () => {
    for (const sec of ['share', 'tfTable', 'recovery'] as const) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, `${sec}.${k}`).toBeGreaterThan(0);
      for (const [k, v] of leaves(en[sec])) expect(v, `${sec}.${k}`).not.toMatch(ARABIC);
    }
  });

  it('the Arabic table printed on the page keeps its words (the PDF reads as before in Arabic)', () => {
    const before = ['الكابل الرئيسي', 'عدد الخطوط', 'نوع الخط', 'صناديق التوزيع', 'الدوائر لكل صندوق', 'دوائر لكل صندوق', 'دوائر فارغة', 'تركيب المحول', 'نوع المحول', 'تركيب الصندوق', 'صندوق الإنارة', 'المكثف', 'نحاسي', 'ألمونيوم', 'على الأرض', 'معلق', 'داخل غرفة', 'عام', 'خاص', 'داخلي', 'خارجي', 'لا يوجد', 'موجود', 'غير موجود', 'معلومات المحول'];
    const values = new Set(Object.values(ar.tfTable));
    for (const w of before) expect(values.has(w), w).toBe(true);
    expect(ar.tfTable.titleNumber).toBe('محول {n}');
    expect(ar.tfTable.boxValue).toBe('تشغيل: {used} | فارغ: {empty}');
  });

  it('the legend on the page: the approved term in Arabic, same pieces in English', () => {
    expect(ar.share.legend.startsWith('هبوط الجهد — نموذج الحمل: {model} — cos φ {pf} — الحد {limit}%')).toBe(true);
    expect(en.share.legend.startsWith('Voltage drop — load model: {model} — cos φ {pf} — limit {limit}%')).toBe(true);
  });

  it('the legend explains the «cannot be calculated» mark as it is drawn on the poles, in both languages', () => {
    const c = strip(raw('SharePreview.tsx'));
    expect(c).toContain('na: POLE_STATUS_MARK.na');
    expect(c).not.toContain("t('vd.naMark')");
  });

  it('the export path is unchanged: same html2canvas / jsPDF calls, A4 portrait, 3× / 2× / 1× resolution', () => {
    const c = raw('SharePreview.tsx');
    expect(c.match(/await html2canvas\(contentRef\.current/g)).toHaveLength(3);
    expect(c).toContain("orientation: 'portrait'");
    expect(c).toContain("format: 'a4'");
    expect(c).toContain('let targetWidth = A4_WIDTH * 3;');
    expect(c).toContain('targetWidth = A4_WIDTH * 2;');
    expect(c).toContain("pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);");
  });

  it('no visible text is written into the preview code (the drawing copy keeps its symbols)', () => {
    for (const f of ['SharePreview.tsx', 'PreviewCanvas.tsx', 'PreviewErrorBoundary.tsx', 'TransformerTableSvg.tsx']) {
      const c = strip(raw(f));
      expect(c, f).not.toMatch(ARABIC);
      expect(c, f).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
      expect(c, f).not.toMatch(/>\s*[A-Z][a-z]+( [A-Za-z]+)+\s*</);
    }
  });
});

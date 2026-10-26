import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { translate, type TKey, type TParams } from '..';
import { spanSummary } from '../../components/SpanPropertiesSheet';
import { cableChoices } from '../../utils/cableHits';
import type { CableElement, DrawingElement } from '../../types/drawing';

// Batch 2 of phase 4: the cable and section properties (look panel, section sheet, cable ends,
// choosing among close cables).

const EN = (k: TKey, p?: TParams) => translate('en', k, p);
const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const code = (f: string) => readFileSync(resolve(__dirname, '../../components', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const cable = (id: string, poleIds: string[], strokeColor: string) => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor, fillColor: 'none', strokeWidth: 2 }) as CableElement;

describe('cable and section texts', () => {
  it('span, ends, picker and style have the same keys in both languages, all filled', () => {
    for (const sec of ['span', 'ends', 'picker', 'style'] as const) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });

  it('English has no Arabic letters; Arabic uses «كابل», never «كيبل» or «الفولتية»', () => {
    for (const sec of ['span', 'ends', 'picker', 'style'] as const) {
      for (const [k, v] of leaves(en[sec])) expect(v, `${sec}.${k}`).not.toMatch(ARABIC);
      for (const [k, v] of leaves(ar[sec])) expect(v, `${sec}.${k}`).not.toMatch(/كيبل|فولتية/);
    }
    expect(ar.picker.style).toBe('تنسيق الكابل');
    expect(ar.span.cableKind).toBe('نوع الكابل');
  });

  it('the one-line summary of a section in both languages', () => {
    expect(spanSummary(undefined)).toBe('بدون خصائص كهربائية');
    expect(spanSummary(undefined, EN)).toBe('No electrical properties');
    expect(spanSummary({ poles: ['a', 'b'] }, EN)).toBe('Incomplete properties');
    expect(spanSummary({ poles: ['a', 'b'], material: 'al', crossSectionMm2: 95, parallel: 2, system: '3ph4w' }, EN)).toBe('Al 95 mm² · ×2 · 3φ+N');
  });

  it('the rows of the cable chooser in English: pole names, section counts, cable numbers', () => {
    const els = [pole('T', 'transformer'), pole('A'), pole('B'), cable('m1', ['A', 'B'], '#EF4444'), cable('m2', ['A', 'B'], '#ef4444'), cable('f', ['T', 'A', 'B'], '#3B82F6')];
    const hits = [{ cableId: 'm1', d: 0, span: { index: 0, fromId: 'A', toId: 'B' } }, { cableId: 'm2', d: 0, span: { index: 0, fromId: 'A', toId: 'B' } }, { cableId: 'f', d: 0, span: { index: 1, fromId: 'A', toId: 'B' } }] as never;
    const rows = cableChoices(els, hits, EN);
    expect(rows.map((r) => [r.ends, r.spans, r.spanHere, r.extra])).toEqual([
      ['Pole 1 ← Pole 2', '1 section', 'Pole 1 ← Pole 2', 'Cable no. 1'],
      ['Pole 1 ← Pole 2', '1 section', 'Pole 1 ← Pole 2', 'Cable no. 2'],
      ['Transformer 1 ← Pole 2', '2 sections', 'Pole 1 ← Pole 2', null],
    ]);
    // without a translator: Arabic, with the approved term
    expect(cableChoices(els, hits).map((r) => r.extra)).toEqual(['كابل رقم 1', 'كابل رقم 2', null]);
  });

  it('no visible text is written into the code of these screens', () => {
    for (const f of ['SpanPropertiesSheet.tsx', 'CableEndsDialog.tsx', 'CablePicker.tsx', 'StylePanel.tsx']) {
      const c = code(f);
      expect(c, f).not.toMatch(ARABIC);
      expect(c, f).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
      expect(c, f).not.toMatch(/>\s*[A-Z][a-z]+( [A-Za-z]+)*\s*</); // no literal English text between tags
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';

// Batch 3 of phase 4: the project manager and the transformer information form.

const ARABIC = /[؀-ۿ]/;
const leaves = (o: unknown, p = ''): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v as string]]));
const code = (f: string) => readFileSync(resolve(__dirname, '../../components', f), 'utf8');
const strip = (c: string) => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('project manager and transformer form texts', () => {
  it('pm and tf have the same keys in both languages, all filled; English has no Arabic', () => {
    for (const sec of ['pm', 'tf'] as const) {
      expect(leaves(en[sec]).map(([k]) => k)).toEqual(leaves(ar[sec]).map(([k]) => k));
      for (const [k, v] of [...leaves(ar[sec]), ...leaves(en[sec])]) expect(v.trim().length, k).toBeGreaterThan(0);
      for (const [k, v] of leaves(en[sec])) expect(v, `${sec}.${k}`).not.toMatch(ARABIC);
      for (const [k, v] of leaves(ar[sec])) expect(v, `${sec}.${k}`).not.toMatch(/كيبل|فولتية/);
    }
    expect(ar.tf.title).toBe('معلومات المحول');
  });

  it('the replace warning keeps its {name} slot (the name is shown isolated in a <bdi>)', () => {
    expect(ar.pm.replaceWarning.split('{name}')).toHaveLength(2);
    expect(en.pm.replaceWarning.split('{name}')).toHaveLength(2);
  });

  it('no visible text is written into the project manager code; confirm/alert use the dictionaries', () => {
    const c = strip(code('ProjectManager.tsx'));
    expect(c).not.toMatch(ARABIC);
    expect(c).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
    expect(c).not.toMatch(/(confirm|alert)\(\s*['"`]/);
    expect(c).not.toMatch(/>\s*[A-Z][a-z]+( [A-Za-z]+)*\.*\s*</);
    expect((c.match(/confirm\(t\('pm\./g) ?? []).length).toBe(4);
  });

  it('the transformer form has no written text; the table drawn on the canvas is left as it is', () => {
    const all = code('TransformerInfoModal.tsx');
    const form = strip(all.slice(0, all.indexOf('export const TransformerTable')));
    expect(form).not.toMatch(ARABIC);
    expect(form).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
    expect(all.slice(all.indexOf('export const TransformerTable'))).toContain("'الكابل الرئيسي'"); // drawing, unchanged
  });
});

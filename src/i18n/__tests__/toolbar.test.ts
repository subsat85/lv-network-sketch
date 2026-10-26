import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ar } from '../ar';
import { en } from '../en';
import { translate, type TKey } from '..';

// The top toolbar reads all of its texts from the dictionaries (Toolbar.tsx, LanguageSwitch.tsx).

const src = (f: string) => readFileSync(resolve(__dirname, '../../components', f), 'utf8');
const files = ['Toolbar.tsx', 'LanguageSwitch.tsx'];
const usedKeys = (code: string) => [...code.matchAll(/\bt\(\s*['`]([\w.${}]+)['`]/g)].map((m) => m[1]);

describe('top toolbar texts', () => {
  it('every key the toolbar uses exists in both dictionaries', () => {
    const keys = new Set(files.flatMap((f) => usedKeys(src(f))));
    // the language button builds language.ar / language.en from the current language
    const expanded = [...keys].flatMap((k) => (k.includes('${') ? ['language.ar', 'language.en'] : [k]));
    expect(expanded.length).toBeGreaterThanOrEqual(14);
    for (const k of expanded) {
      expect(() => translate('ar', k as TKey), k).not.toThrow();
      expect(() => translate('en', k as TKey), k).not.toThrow();
    }
  });

  it('every toolbar text is used by the toolbar (no stale keys)', () => {
    const used = new Set(usedKeys(src('Toolbar.tsx')));
    for (const k of Object.keys(ar.toolbar)) expect(used.has(`toolbar.${k}`), k).toBe(true);
    expect(Object.keys(en.toolbar).sort()).toEqual(Object.keys(ar.toolbar).sort());
  });

  it('no visible text is written into the toolbar code itself', () => {
    for (const f of files) {
      const code = src(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // no Arabic letters anywhere, and no literal label / title / placeholder / alert text
      expect(code, f).not.toMatch(/[؀-ۿ]/);
      expect(code, f).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
      expect(code, f).not.toMatch(/label:\s*['"]/);
    }
  });

  it('uses the approved terms in Arabic and plain English', () => {
    expect(ar.toolbar.voltageDrop).toBe('هبوط الجهد');
    expect(ar.toolbar.cable).toBe('كابل');
    expect(ar.toolbar.transformerInfo).toContain('المحول');
    for (const [k, v] of Object.entries(ar.toolbar)) expect(v, k).not.toMatch(/كيبل|الفولتية/);
    expect(en.toolbar.voltageDrop).toBe('Voltage Drop');
  });

  it('the language button names the current language and the other one', () => {
    expect(translate('ar', 'language.switchName', { current: ar.language.ar, other: ar.language.en }))
      .toBe('اللغة: العربية. التبديل إلى English');
    expect(translate('en', 'language.switchName', { current: en.language.en, other: en.language.ar }))
      .toBe('Language: English. Switch to العربية');
  });
});

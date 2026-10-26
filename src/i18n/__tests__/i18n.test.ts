import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ar } from '../ar';
import { en } from '../en';
import { DEFAULT_LOCALE, DICTIONARIES, directionOf, isLocale, translate, type TKey } from '..';
import {
  LOCALE_STORAGE_KEY, applyDocumentLocale, loadLocale, saveLocale, useLocale, t, type LocaleStorage,
} from '../../store/localeStore';
import { useDrawingStore } from '../../store/drawingStore';

// ---- helpers ---------------------------------------------------------------
/** every dotted key of a dictionary, with its text */
const leaves = (o: unknown, p = ''): [string, unknown][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, v] as [string, unknown]]);

const memStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const s: LocaleStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  return { s, data };
};

/** a minimal stand-in for document.documentElement (the tests run without a DOM) */
const fakeDoc = (attrs: Record<string, string> = {}) => {
  const a = new Map(Object.entries(attrs));
  const writes: string[] = [];
  const documentElement = {
    getAttribute: (n: string) => a.get(n) ?? null,
    setAttribute: (n: string, v: string) => { writes.push(`${n}=${v}`); a.set(n, v); },
  } as unknown as HTMLElement;
  return { doc: { documentElement }, a, writes };
};

// ---- dictionaries ------------------------------------------------------------
describe('dictionaries', () => {
  it('Arabic and English have exactly the same keys', () => {
    expect(leaves(en).map(([k]) => k).sort()).toEqual(leaves(ar).map(([k]) => k).sort());
  });

  it('every text is a non-empty string, in both languages', () => {
    for (const d of [ar, en]) for (const [k, v] of leaves(d)) {
      expect(typeof v, k).toBe('string');
      expect((v as string).trim().length, k).toBeGreaterThan(0);
    }
  });

  // texts made only of engineering symbols and placeholders, the same in both languages
  const SYMBOLS = new Set(['vd.settings.pf', 'vd.table.percent', 'vd.report.pole', 'span.x', 'colourBar.scopeItem']);
  it('the Arabic texts are Arabic (except the name of the other language and symbol-only texts)', () => {
    for (const [k, v] of leaves(ar)) if (k !== 'language.en' && !SYMBOLS.has(k)) expect(v as string, k).toMatch(/[؀-ۿ]/);
    for (const k of SYMBOLS) expect(leaves(ar).find(([x]) => x === k)?.[1], k).toBe(leaves(en).find(([x]) => x === k)?.[1]);
  });

  it('the English texts carry no Arabic letters (except the name of the other language)', () => {
    for (const [k, v] of leaves(en)) if (k !== 'language.ar') expect(v as string, k).not.toMatch(/[؀-ۿ]/);
  });

  it('uses the approved terms «كابل», «هبوط الجهد», «المحول»', () => {
    expect(translate('ar', 'terms.cable')).toBe('كابل');
    expect(translate('ar', 'terms.voltageDrop')).toBe('هبوط الجهد');
    expect(translate('ar', 'terms.transformer')).toBe('المحول');
    // and never the old spelling «كيبل»
    for (const [k, v] of leaves(ar)) expect(v as string, k).not.toMatch(/كيبل/);
  });

  it('translate gives each language its text and fills {params}', () => {
    expect(translate('en', 'terms.voltageDrop')).toBe('Voltage Drop');
    expect(translate('ar', 'language.label')).toBe('اللغة');
    expect(translate('en', 'language.label')).toBe('Language');
    // interpolation (on a text built for the test through the same function)
    DICTIONARIES.en.language.label = 'Language ({n})';
    try { expect(translate('en', 'language.label', { n: 2 })).toBe('Language (2)'); }
    finally { DICTIONARIES.en.language.label = 'Language'; }
  });

  it('a key with no text throws in tests (it is never shown silently)', () => {
    expect(() => translate('ar', 'terms.nope' as TKey)).toThrow(/terms\.nope/);
  });
});

// ---- default language and direction -----------------------------------------
describe('default language', () => {
  it('is Arabic', () => {
    expect(DEFAULT_LOCALE).toBe('ar');
    expect(loadLocale(null)).toBe('ar');
    expect(loadLocale(memStorage().s)).toBe('ar');
  });

  it('Arabic is RTL, English LTR', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(isLocale('ar') && isLocale('en')).toBe(true);
    expect(isLocale('fr') || isLocale('') || isLocale(null)).toBe(false);
  });
});

// ---- persistence ---------------------------------------------------------------
describe('saving and restoring the choice', () => {
  it('is kept under its own key, apart from project data', () => {
    const { s, data } = memStorage({ unrelated: 'x' });
    saveLocale('en', s);
    expect(LOCALE_STORAGE_KEY).toBe('lv_ui_language');
    expect(data.get(LOCALE_STORAGE_KEY)).toBe('en');
    expect(data.get('unrelated')).toBe('x');
    expect([...data.keys()].sort()).toEqual(['lv_ui_language', 'unrelated']);
  });

  it('a saved choice is restored', () => {
    const { s } = memStorage();
    saveLocale('en', s); expect(loadLocale(s)).toBe('en');
    saveLocale('ar', s); expect(loadLocale(s)).toBe('ar');
  });

  it('an invalid saved value or a failing storage falls back to Arabic', () => {
    expect(loadLocale(memStorage({ [LOCALE_STORAGE_KEY]: 'fr' }).s)).toBe('ar');
    const broken: LocaleStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadLocale(broken)).toBe('ar');
    expect(() => saveLocale('en', broken)).not.toThrow();
  });
});

// ---- <html lang/dir> -------------------------------------------------------------
describe('document lang and dir', () => {
  it('follow the language', () => {
    const { doc, a } = fakeDoc({ lang: 'en' });
    applyDocumentLocale('ar', doc);
    expect([a.get('lang'), a.get('dir')]).toEqual(['ar', 'rtl']);
    applyDocumentLocale('en', doc);
    expect([a.get('lang'), a.get('dir')]).toEqual(['en', 'ltr']);
  });

  it('are only written when they differ (the current direction is checked first)', () => {
    const { doc, writes } = fakeDoc({ lang: 'ar', dir: 'rtl' });
    applyDocumentLocale('ar', doc);
    expect(writes).toEqual([]);
    applyDocumentLocale('en', doc);
    expect(writes).toEqual(['lang=en', 'dir=ltr']);
  });

  it('nothing happens without a document', () => {
    expect(() => applyDocumentLocale('en', null)).not.toThrow();
  });
});

// ---- the store ------------------------------------------------------------------
describe('language store', () => {
  beforeEach(() => useLocale.setState({ locale: 'ar' }));
  afterEach(() => useLocale.setState({ locale: 'ar' }));

  it('starts in Arabic (nothing saved in the test environment)', () => {
    expect(loadLocale()).toBe('ar');
    expect(useLocale.getState().locale).toBe('ar');
  });

  it('switching changes t() and ignores invalid values', () => {
    expect(t('terms.cable')).toBe('كابل');
    useLocale.getState().setLocale('en');
    expect(useLocale.getState().locale).toBe('en');
    expect(t('terms.cable')).toBe('Cable');
    useLocale.getState().setLocale('xx' as never);
    expect(useLocale.getState().locale).toBe('en');
  });

  it('switching leaves the drawing, selection and undo/redo untouched', () => {
    const before = useDrawingStore.getState();
    const snap = JSON.stringify({ e: before.elements, s: (before as unknown as Record<string, unknown>).selectedIds });
    let calls = 0;
    const unsub = useDrawingStore.subscribe(() => { calls++; });
    useLocale.getState().setLocale('en');
    useLocale.getState().setLocale('ar');
    unsub();
    expect(calls).toBe(0);
    const after = useDrawingStore.getState();
    expect(after).toBe(before);
    expect(JSON.stringify({ e: after.elements, s: (after as unknown as Record<string, unknown>).selectedIds })).toBe(snap);
  });
});

// ---- types: a missing or extra key does not compile (checked by tsc) ----------------
import type { Dict } from '..';
describe('dictionary type', () => {
  it('rejects a dictionary with a missing or an extra key', () => {
    // @ts-expect-error — `terms` is missing
    const missing: Dict = { language: { label: 'L', ar: 'A', en: 'E' } };
    // @ts-expect-error — `extra` is not an Arabic key
    const extra: Dict = { ...en, language: { ...en.language, extra: 'x' } };
    // @ts-expect-error — not a key
    const badKey: TKey = 'terms.cabel';
    expect([missing, extra, badKey].length).toBe(3);
  });
});

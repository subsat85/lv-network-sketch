import { create } from 'zustand';
import { DEFAULT_LOCALE, directionOf, isLocale, translate, type Locale, type TKey, type TParams } from '../i18n';

// The interface language. Kept apart from everything else: it is not part of a project, of the
// drawing, of the selection or of undo/redo, and it is saved under its own localStorage key
// (projects and the autosave draft live in IndexedDB, untouched by this).

export const LOCALE_STORAGE_KEY = 'lv_ui_language';

/** where the choice is kept (localStorage in the browser; a fake in tests) */
export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStorage = (): LocaleStorage | null => {
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
};

/** The saved language, or Arabic when nothing valid is saved (or storage is unavailable). */
export const loadLocale = (storage: LocaleStorage | null = browserStorage()): Locale => {
  try {
    const v = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : DEFAULT_LOCALE;
  } catch { return DEFAULT_LOCALE; }
};

export const saveLocale = (locale: Locale, storage: LocaleStorage | null = browserStorage()) => {
  try { storage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* private mode / full: the choice lasts this visit only */ }
};

/**
 * Sets <html lang> and <html dir>. Only the document element changes: the app root is held
 * at direction: ltr in index.css (as the page is today), so the tool columns and the drawing
 * (SVG text anchors included) do not move or mirror when the language changes.
 */
export const applyDocumentLocale = (locale: Locale, doc: Pick<Document, 'documentElement'> | null = typeof document !== 'undefined' ? document : null) => {
  if (!doc) return;
  const el = doc.documentElement;
  if (el.getAttribute('lang') !== locale) el.setAttribute('lang', locale);
  const dir = directionOf(locale);
  if (el.getAttribute('dir') !== dir) el.setAttribute('dir', dir);
};

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocale = create<LocaleState>((set, get) => ({
  locale: loadLocale(),
  setLocale: (locale) => {
    if (!isLocale(locale)) return;
    saveLocale(locale);
    applyDocumentLocale(locale);
    if (get().locale !== locale) set({ locale });
  },
}));

/** Applies the starting language to the document (called once at start-up). */
export const initLocale = () => applyDocumentLocale(useLocale.getState().locale);

/** The text of `key` in the current language, for code outside React. */
export const t = (key: TKey, params?: TParams) => translate(useLocale.getState().locale, key, params);

/** Hook: a `t` bound to the current language; components using it re-render on a switch. */
export const useT = () => {
  const locale = useLocale((s) => s.locale);
  return (key: TKey, params?: TParams) => translate(locale, key, params);
};

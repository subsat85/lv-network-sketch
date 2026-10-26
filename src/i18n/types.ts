import { ar } from './ar';

/** The interface languages. */
export type Locale = 'ar' | 'en';
export const LOCALES: readonly Locale[] = ['ar', 'en'];
export const DEFAULT_LOCALE: Locale = 'ar';
export const isLocale = (v: unknown): v is Locale => v === 'ar' || v === 'en';
export const directionOf = (l: Locale): 'rtl' | 'ltr' => (l === 'ar' ? 'rtl' : 'ltr');

/** A dictionary has exactly the keys of the Arabic one; every leaf is a string. */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Dict = Widen<typeof ar>;

/** Every translation key, as a dotted path to a text ('terms.voltageDrop', …). */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TKey = Paths<Dict>;

/** Values put into a text: {name} in the text is replaced by params.name. */
export type TParams = Record<string, string | number>;

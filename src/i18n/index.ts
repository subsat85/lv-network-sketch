import { ar } from './ar';
import { en } from './en';
import type { Dict, Locale, TKey, TParams } from './types';

export * from './types';

export const DICTIONARIES: Record<Locale, Dict> = { ar, en };

const lookup = (dict: Dict, key: string): string | undefined => {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
};

/**
 * The text of `key` in `locale`, with {name} replaced by params.name. A key with no text is a
 * mistake (the types prevent it in code): in development and tests it throws; in a built
 * site it shows the key itself rather than breaking the page.
 */
export const translate = (locale: Locale, key: TKey, params?: TParams): string => {
  const text = lookup(DICTIONARIES[locale], key);
  if (text === undefined) {
    if (import.meta.env?.DEV || import.meta.env?.MODE === 'test') throw new Error(`i18n: no text for "${key}" (${locale})`);
    return key;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
};

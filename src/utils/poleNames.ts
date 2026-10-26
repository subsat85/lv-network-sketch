import type { DrawingElement } from '../types/drawing';
import { translate } from '../i18n';

/**
 * Display names for poles in reports: poles are numbered in drawing order
 * (transformers separately), e.g. "عمود 3", "محول 1". The same numbers are shown
 * next to the poles while voltage-drop results are displayed on the drawing.
 */
export const poleNumbers = (elements: DrawingElement[]) => {
  const out = new Map<string, { n: number; transformer: boolean }>();
  let p = 0, t = 0;
  for (const e of elements) {
    if (e.type !== 'symbol') continue;
    const transformer = e.symbolId === 'transformer';
    out.set(e.id, { n: transformer ? ++t : ++p, transformer });
  }
  return out;
};

/** `tr` picks the language (i18n `poles.*`); without one the names are Arabic, as before */
export const poleNamer = (elements: DrawingElement[], tr: (key: 'poles.pole' | 'poles.transformer' | 'poles.deleted', params?: { n: number }) => string = (k, p) => translate('ar', k, p)) => {
  const nums = poleNumbers(elements);
  return (id: string) => {
    const x = nums.get(id);
    return x ? tr(x.transformer ? 'poles.transformer' : 'poles.pole', { n: x.n }) : tr('poles.deleted');
  };
};

export const poleTag = (elements: DrawingElement[]) => {
  const nums = poleNumbers(elements);
  return (id: string) => {
    const x = nums.get(id);
    return x ? `${x.transformer ? 'T' : ''}${x.n}` : '?';
  };
};

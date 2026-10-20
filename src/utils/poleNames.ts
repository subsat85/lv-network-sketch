import type { DrawingElement } from '../types/drawing';

/**
 * Display names for poles in reports: poles are numbered in drawing order
 * (transformers separately), e.g. "عمود 3", "محولة 1". The same numbers are shown
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

export const poleNamer = (elements: DrawingElement[]) => {
  const nums = poleNumbers(elements);
  return (id: string) => {
    const x = nums.get(id);
    return x ? `${x.transformer ? 'محولة' : 'عمود'} ${x.n}` : 'عمود محذوف';
  };
};

export const poleTag = (elements: DrawingElement[]) => {
  const nums = poleNumbers(elements);
  return (id: string) => {
    const x = nums.get(id);
    return x ? `${x.transformer ? 'T' : ''}${x.n}` : '?';
  };
};

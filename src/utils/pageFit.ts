import type { DrawingElement, TransformerTableElement } from '../types/drawing';
import type { TKey, TParams } from '../i18n';
import { transformerTableRows, transformerTableSize } from '../components/TransformerTableSvg';

// Placing the drawing on the A4 page of the share preview (and so in the PDF / image): only the
// preview's view transform is computed here; no element, coordinate or saved value is changed.

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
type Translate = (key: TKey, params?: TParams) => string;

export const EMPTY_BOX: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
export const isEmptyBox = (b: Box) => !(b.maxX >= b.minX && b.maxY >= b.minY);
export const unionBox = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });

/** The full rectangle of every transformer table (its frame holds every row: transformerTableSize). */
export const tableBoxes = (elements: DrawingElement[], t: Translate): Box[] =>
  elements.filter((e): e is TransformerTableElement => e.type === 'transformer_table').map((e) => {
    const { width, height } = transformerTableSize(transformerTableRows(e.transformerInfo, t).length, e.scale ?? 1);
    return { minX: e.x, minY: e.y, maxX: e.x + width, maxY: e.y + height };
  });

/**
 * A fallback when the drawn content cannot be measured: the elements' own extents from their data.
 * Cables, consumers and jumpers are drawn from their poles (their own x / y are 0), so the poles
 * stand for them; a path's points are relative to its x / y; poles count with their drawn radius.
 */
export const elementBoxes = (elements: DrawingElement[], t: Translate, poleRadius: number): Box[] => {
  const out: Box[] = [];
  for (const el of elements) {
    const e = el as any;
    if (el.type === 'path') {
      for (const p of e.points ?? []) out.push({ minX: e.x + p.x, minY: e.y + p.y, maxX: e.x + p.x, maxY: e.y + p.y });
    } else if (el.type === 'symbol') {
      out.push({ minX: e.x - poleRadius, minY: e.y - poleRadius, maxX: e.x + poleRadius, maxY: e.y + poleRadius });
    } else if (el.type === 'shape') {
      out.push({ minX: Math.min(e.x, e.x + e.width), minY: Math.min(e.y, e.y + e.height), maxX: Math.max(e.x, e.x + e.width), maxY: Math.max(e.y, e.y + e.height) });
    } else if (el.type === 'text' || el.type === 'arc') {
      out.push({ minX: e.x, minY: e.y, maxX: e.x, maxY: e.y });
      if (el.type === 'arc' && [e.x2, e.y2].every(Number.isFinite)) out.push({ minX: e.x2, minY: e.y2, maxX: e.x2, maxY: e.y2 });
    }
  }
  return [...out, ...tableBoxes(elements, t)];
};

export interface PageFit { x: number; y: number; scale: number }

/**
 * The view transform that fits `content` (drawing units) on a page `pageW` × `pageH`, keeping its
 * proportions, inside the part of the page above `reservedBottom` (e.g. the voltage-drop legend):
 * `padding` drawing units around it, scale capped at `maxScale`, centred in that area.
 */
export const fitToPage = (content: Box, pageW: number, pageH: number, reservedBottom = 0, padding = 100, maxScale = 2): PageFit => {
  const availH = Math.max(1, pageH - Math.max(0, reservedBottom));
  const minX = content.minX - padding, minY = content.minY - padding, maxX = content.maxX + padding, maxY = content.maxY + padding;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const scale = Math.min(pageW / w, availH / h, maxScale);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x: pageW / 2 - cx * scale, y: availH / 2 - cy * scale, scale };
};

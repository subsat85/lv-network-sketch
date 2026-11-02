import type { ConsumerElement } from '../types/drawing';

// Where an auto-placed subscriber is drawn beside its pole (display only: nothing here is stored —
// a subscriber's stored x / y are not used until it is moved by hand, `hasManualPosition`).
//
// Subscribers on a pole are stacked outward from the pole along the free direction (dx, dy) chosen
// from the cables at the pole. The label of a three-phase subscriber (square) used to be drawn
// above its square whatever that direction; when the stack goes DOWN from the pole, «above» is the
// pole's side, so the label was drawn on the pole (and on the square before it in a stack).
// The label now goes on the side away from the pole, and a vertical stack leaves room for it.

/** sizes at consumer scale 1 (the drawing's own units) */
export const CONSUMER_RADIUS = 16;
export const CONSUMER_MARGIN = 5;
/** gap between a square's edge and the centre line of its label (unchanged from the original drawing) */
export const SQUARE_LABEL_GAP = 10;
/** label font size at scale 1 */
export const SQUARE_LABEL_FONT = 14;

type Stacked = Pick<ConsumerElement, 'variant' | 'label'>;
const squareLabel = (c: Stacked | undefined) => !!c && c.variant === 'square' && !!c.label;

/** the room a square's label takes beyond the square in a vertical stack (to its far half-height) */
export const squareLabelRoom = (scale: number) => SQUARE_LABEL_GAP + (SQUARE_LABEL_FONT * scale) / 2;

/**
 * Distance from the pole centre to the centre of subscriber `index` of `list` (the pole's
 * subscribers in drawing order). Unchanged for a horizontal stack; a vertical stack (up or down)
 * keeps room for the label of every square before this one.
 */
export const autoConsumerOffset = (list: readonly Stacked[], index: number, poleRadius: number, scale: number, vertical: boolean): number => {
  const r = CONSUMER_RADIUS * scale, margin = CONSUMER_MARGIN * scale;
  let t = poleRadius + r + margin + index * (r * 2 + margin);
  if (vertical) for (let j = 0; j < index; j++) if (squareLabel(list[j])) t += squareLabelRoom(scale);
  return t;
};

/**
 * The vertical offset of a square's label centre from the square centre: below the square when the
 * stack goes down from the pole, above it otherwise (as before: up, sideways, or placed by hand).
 */
export const squareLabelY = (radius: number, stackDy: number): number => (stackDy > 0 ? radius + SQUARE_LABEL_GAP : -(radius + SQUARE_LABEL_GAP));

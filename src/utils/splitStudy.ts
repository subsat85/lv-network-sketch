import type { CableElement, DrawingElement } from '../types/drawing';

// Voltage-drop study with the suggested split points (ElectricalSettings.studySuggestedSplits).
//
// A suggested split (CableElement.suggestedSplits) stays a drawing mark. Only when the
// study is switched on does network.ts calculate the suggestions at the INTERIOR poles of
// a cable as electrical open points: at that visit of the pole the cable's two sides are
// separate. The side chosen in splitConsumerSides stays connected to the pole (its
// consumers and its other connections, by the usual rules); the other side is an open end
// there, connected only by a Jumper that names that side. Suggestions at the first / last
// pole of a cable are not used by the study (use «منفصل» in «ربط الكوابل» for a cable end).

export type SplitSide = 'prev' | 'next';

export const splitSideKey = (poleId: string, occurrence: number) => `${poleId}#${occurrence}`;

export interface StudySplitPoint {
  cableId: string;
  poleId: string;
  /** which visit of the pole by this cable */
  occurrence: number;
  /** index in poleIds */
  index: number;
  /** neighbouring poles: towards the previous / next pole in poleIds */
  prevPoleId: string;
  nextPoleId: string;
  /** the side kept connected to the pole, if chosen */
  consumerSide?: SplitSide;
}

/** Suggested split points of a cable at interior poles (each visit separately), in pole order. */
export const studySplitPoints = (cable: CableElement): StudySplitPoint[] => {
  const ids = new Set(cable.suggestedSplits ?? []);
  if (!ids.size) return [];
  const out: StudySplitPoint[] = [];
  const seen = new Map<string, number>();
  cable.poleIds.forEach((pid, i) => {
    const occurrence = seen.get(pid) ?? 0;
    seen.set(pid, occurrence + 1);
    if (!ids.has(pid) || i === 0 || i === cable.poleIds.length - 1) return;
    out.push({ cableId: cable.id, poleId: pid, occurrence, index: i, prevPoleId: cable.poleIds[i - 1], nextPoleId: cable.poleIds[i + 1], consumerSide: cable.splitConsumerSides?.[splitSideKey(pid, occurrence)] });
  });
  return out;
};

/** Suggested split points at a first / last pole (not used by the study). */
export const endSplitPoints = (cable: CableElement): { cableId: string; poleId: string }[] => {
  const ids = new Set(cable.suggestedSplits ?? []);
  const n = cable.poleIds.length;
  return [...new Set([cable.poleIds[0], cable.poleIds[n - 1]].filter((p) => p !== undefined && ids.has(p)))].map((poleId) => ({ cableId: cable.id, poleId }));
};

/** All study split points of the drawing. */
export const allStudySplitPoints = (elements: DrawingElement[]): StudySplitPoint[] =>
  elements.filter((e): e is CableElement => e.type === 'cable').flatMap(studySplitPoints);

/** The cable change that sets (or clears, with undefined) the side kept at one split point. */
export const setSplitConsumerSide = (cable: CableElement, poleId: string, occurrence: number, side: SplitSide | undefined): Partial<CableElement> => {
  const next = { ...(cable.splitConsumerSides ?? {}) };
  const k = splitSideKey(poleId, occurrence);
  if (side) next[k] = side; else delete next[k];
  return { splitConsumerSides: Object.keys(next).length ? next : undefined };
};

const visits = (poleIds: string[], pid: string) => poleIds.reduce((n, p) => n + (p === pid ? 1 : 0), 0);

/**
 * Side choices stay only where they still mean the same place: the pole is still a
 * suggested split of the cable, that visit still exists and is interior, and the number
 * of visits of that pole by the cable did not change (otherwise the visit numbering may
 * now point at another place, so the choice is dropped and must be made again).
 */
export const pruneSplitSides = (prev: CableElement | undefined, next: CableElement): CableElement => {
  const sides = next.splitConsumerSides;
  if (!sides) return next;
  const ids = new Set(next.suggestedSplits ?? []);
  const keep: Record<string, SplitSide> = {};
  for (const [k, v] of Object.entries(sides)) {
    const at = k.lastIndexOf('#');
    const pid = k.slice(0, at), occ = Number(k.slice(at + 1));
    if (!ids.has(pid) || !Number.isInteger(occ) || occ < 0 || (v !== 'prev' && v !== 'next')) continue;
    if (prev && visits(prev.poleIds, pid) !== visits(next.poleIds, pid)) continue;
    let seen = 0, index = -1;
    next.poleIds.forEach((p, i) => { if (p === pid) { if (seen === occ) index = i; seen++; } });
    if (index <= 0 || index >= next.poleIds.length - 1) continue;
    keep[k] = v;
  }
  if (Object.keys(keep).length === Object.keys(sides).length) return next;
  return { ...next, splitConsumerSides: Object.keys(keep).length ? keep : undefined };
};

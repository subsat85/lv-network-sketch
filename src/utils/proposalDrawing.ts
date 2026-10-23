import type { CableElement, ConsumerElement, DrawingElement, Point } from '../types/drawing';
import { endPosition, jumperRadius, occurrenceIndex } from './cableArcs';
import { consumerLoad } from './loads';
import { addPoleTagObstacles, addRect, drawingObstacles, pickCandidate, type Candidate, type LayoutContext } from './overlayLayout';

// How a proposed subscriber is drawn (canvas, share preview, PDF): a box with «مشترك»
// and its load in A under it, a line from the box to the pole, and a jumper from that
// line, around the pole, to the cable it is connected to. The box sits on the side of
// the pole farthest from the cables (the side the existing subscribers use is left to
// them) unless the user moved it (ConsumerProposal.boxOffset, relative to the pole).
// The automatic position (layoutProposalBoxes) starts from that same place and moves
// only when it would cover a pole, a cable, an arrowhead, a distance number, a pole
// number of the results, an existing subscriber or another box (overlayLayout.ts). A box the user moved is kept
// exactly where it was put. The box layout does not depend on whether the voltage-drop
// results are shown (those labels make room for the boxes instead); it depends on the
// zoom only below the zoom where the box text reaches the on-screen minimum (the box is
// then drawn larger, and placed at that size).

export const PROPOSAL_BOX = { w: 64, h: 38, gap: 8 } as const;

export interface ProposalGeometry {
  box: { cx: number; cy: number; w: number; h: number };
  /** line from the box edge to the jumper ring */
  line: [Point, Point];
  /** jumper from the end of the line to the cable (missing when the connection does not exist) */
  jumper?: { d: string; dot: Point; dotRadius: number; color: string };
  amps?: number;
  connected: boolean;
}

const DIRS = [{ dx: 1, dy: 0, a: 0 }, { dx: 0, dy: 1, a: 90 }, { dx: -1, dy: 0, a: 180 }, { dx: 0, dy: -1, a: 270 }];

/** The 4 box directions, best first (farthest from the cables at the pole), as the subscriber placement does. */
const rankedDirections = (elements: DrawingElement[], poleId: string) => {
  const pole = elements.find((e) => e.id === poleId)!;
  const angles: number[] = [];
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    c.poleIds.forEach((pid, i) => {
      if (pid !== poleId) return;
      for (const j of [i - 1, i + 1]) {
        const n = elements.find((x) => x.id === c.poleIds[j]);
        if (n) { let a = (Math.atan2(n.y - pole.y, n.x - pole.x) * 180) / Math.PI; if (a < 0) a += 360; angles.push(a); }
      }
    });
  }
  const score = (a: number) => (angles.length ? Math.min(...angles.map((x) => { const d = Math.abs(a - x); return d > 180 ? 360 - d : d; })) : 360);
  return DIRS.map((d, i) => ({ ...d, s: score(d.a), i })).sort((p, q) => q.s - p.s || p.i - q.i);
};

/** The box position used before the layout (and its first candidate). */
const originalBoxCenter = (elements: DrawingElement[], c: ConsumerElement, poleRadius: number, scale: number): Point | null => {
  const pole = elements.find((e) => e.id === c.poleId);
  if (!pole) return null;
  const ranked = rankedDirections(elements, c.poleId);
  // existing subscribers (auto placed) take the best side: the boxes go on the next one
  const regular = elements.some((e) => e.type === 'consumer' && (e as ConsumerElement).poleId === c.poleId && !(e as ConsumerElement).proposal && !(e as ConsumerElement).hasManualPosition);
  const dir = ranked[regular ? 1 : 0];
  const auto = elements.filter((e) => e.type === 'consumer' && (e as ConsumerElement).poleId === c.poleId && (e as ConsumerElement).proposal && !(e as ConsumerElement).proposal!.boxOffset);
  const k = Math.max(0, auto.findIndex((e) => e.id === c.id));
  const w = PROPOSAL_BOX.w * scale, h = PROPOSAL_BOX.h * scale, g = PROPOSAL_BOX.gap * scale;
  const along = dir.dx !== 0 ? w : h;
  const dist = jumperRadius(poleRadius, 0) + 18 * scale + along / 2 + k * (along + g);
  return { x: pole.x + dir.dx * dist, y: pole.y + dir.dy * dist };
};

/** Automatic centres of the proposal boxes that the user has not moved (id → centre). */
export const layoutProposalBoxes = (elements: DrawingElement[], ctx: LayoutContext, scale = 1, drawScale = scale): Map<string, Point> => {
  const out = new Map<string, Point>();
  const props = elements.filter((e): e is ConsumerElement => e.type === 'consumer' && !!(e as ConsumerElement).proposal);
  if (!props.length) return out;
  // the boxes are placed at the size they are drawn (drawScale > scale only at a small zoom)
  scale = drawScale;
  const w = PROPOSAL_BOX.w * scale, h = PROPOSAL_BOX.h * scale, g = PROPOSAL_BOX.gap * scale;
  // the distance numbers count whether shown or not, and arrows at a fixed size: the result does not change with the view
  const set = drawingObstacles(elements, { ...ctx, showDistances: true, arrowSize: 12 });
  // the pole numbers of the voltage-drop overlay are fixed: the boxes keep off them (shown or not)
  addPoleTagObstacles(elements, ctx, set);
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const c of props) {
    const off = c.proposal!.boxOffset, pole = byId.get(c.poleId);
    if (off && pole) addRect(set, { x: pole.x + off.x - w / 2, y: pole.y + off.y - h / 2, w, h });
  }
  for (const c of props) {
    if (c.proposal!.boxOffset) continue;
    const pole = byId.get(c.poleId);
    const first = originalBoxCenter(elements, c, ctx.poleRadius, scale);
    if (!pole || !first) continue;
    const cands: Candidate[] = [{ x: first.x - w / 2, y: first.y - h / 2, leader: false }];
    const base = jumperRadius(ctx.poleRadius, 0) + 18 * scale;
    for (let m = 0; m <= 3; m++) for (const d of rankedDirections(elements, c.poleId)) {
      const along = d.dx !== 0 ? w : h;
      const dist = base + along / 2 + m * (along + g);
      cands.push({ x: pole.x + d.dx * dist - w / 2, y: pole.y + d.dy * dist - h / 2, leader: false });
    }
    const pick = pickCandidate(set, w, h, cands);
    const centre = { x: pick.x + w / 2, y: pick.y + h / 2 };
    out.set(c.id, centre);
    addRect(set, { x: pick.x, y: pick.y, w, h });
  }
  return out;
};

/** Centre of the box (world): where the user put it, else the automatic layout (when given), else the original rule. */
export const proposalBoxCenter = (elements: DrawingElement[], c: ConsumerElement, poleRadius: number, scale = 1, layout?: Map<string, Point>): Point | null => {
  const pole = elements.find((e) => e.id === c.poleId);
  if (!pole) return null;
  const off = c.proposal?.boxOffset;
  if (off) return { x: pole.x + off.x, y: pole.y + off.y };
  return layout?.get(c.id) ?? originalBoxCenter(elements, c, poleRadius, scale);
};

/** `layout`: automatic box centres (layoutProposalBoxes); `drawScale`: the drawn size factor of the box (≥ scale, for small zoom) */
export const proposalGeometry = (elements: DrawingElement[], c: ConsumerElement, poleRadius: number, scale = 1, layout?: Map<string, Point>, drawScale = scale): ProposalGeometry | null => {
  const pole = elements.find((e) => e.id === c.poleId);
  const B = proposalBoxCenter(elements, c, poleRadius, scale, layout);
  scale = drawScale;
  if (!pole || !B) return null;
  const w = PROPOSAL_BOX.w * scale, h = PROPOSAL_BOX.h * scale;
  const P = { x: pole.x, y: pole.y };
  const rr = jumperRadius(poleRadius, 0);
  const vx = B.x - P.x, vy = B.y - P.y, L = Math.hypot(vx, vy) || 1;
  const u = { x: vx / L, y: vy / L };
  // box edge towards the pole
  const tEdge = Math.min(Math.abs(u.x) > 1e-9 ? w / 2 / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-9 ? h / 2 / Math.abs(u.y) : Infinity);
  const edge = { x: B.x - u.x * tEdge, y: B.y - u.y * tEdge };
  const Q = { x: P.x + u.x * rr, y: P.y + u.y * rr };
  const l = consumerLoad(c);
  const geo: ProposalGeometry = { box: { cx: B.x, cy: B.y, w, h }, line: [edge, Q], amps: l.invalid ? undefined : l.amps, connected: false };
  const conn = c.proposal?.connection;
  const cable = conn ? (elements.find((e) => e.id === conn.cableId) as CableElement | undefined) : undefined;
  const i = cable && cable.type === 'cable' ? occurrenceIndex(cable, c.poleId, conn!.occurrence) : -1;
  if (!cable || i < 0) return geo;
  // the cable side to land on: the one named (study split), else the nearer of the two
  const sides = conn!.side ? [conn!.side] : (['prev', 'next'] as const).filter((s) => (s === 'prev' ? i > 0 : i < cable.poleIds.length - 1));
  let best: Point | null = null, bestD = Infinity;
  for (const side of sides) {
    const p = endPosition(elements, c.poleId, { cableId: cable.id, side, occurrence: conn!.occurrence }, rr);
    if (!p) continue;
    const d = Math.hypot(p.x - Q.x, p.y - Q.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return geo;
  const C = best as Point;
  const th0 = Math.atan2(Q.y - P.y, Q.x - P.x), th1 = Math.atan2(C.y - P.y, C.x - P.x);
  let dlt = th1 - th0; while (dlt <= -Math.PI) dlt += 2 * Math.PI; while (dlt > Math.PI) dlt -= 2 * Math.PI;
  const d = Math.abs(dlt) < 1e-6 ? `M ${Q.x} ${Q.y}` : `M ${Q.x} ${Q.y} A ${rr} ${rr} 0 0 ${dlt > 0 ? 1 : 0} ${C.x} ${C.y}`;
  geo.jumper = { d, dot: C, dotRadius: Math.max(2, poleRadius * 0.16), color: cable.strokeColor };
  geo.connected = true;
  return geo;
};

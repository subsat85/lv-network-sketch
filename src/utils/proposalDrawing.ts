import type { CableElement, ConsumerElement, DrawingElement, Point } from '../types/drawing';
import { endPosition, jumperRadius, occurrenceIndex } from './cableArcs';
import { consumerLoad } from './loads';

// How a proposed subscriber is drawn (canvas, share preview, PDF): a box with «مشترك»
// and its load in A under it, a line from the box to the pole, and a jumper from that
// line, around the pole, to the cable it is connected to. The box sits on the side of
// the pole farthest from the cables (the side the existing subscribers use is left to
// them) unless the user moved it (ConsumerProposal.boxOffset, relative to the pole).

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

/** Centre of the box (world). */
export const proposalBoxCenter = (elements: DrawingElement[], c: ConsumerElement, poleRadius: number, scale = 1): Point | null => {
  const pole = elements.find((e) => e.id === c.poleId);
  if (!pole) return null;
  const off = c.proposal?.boxOffset;
  if (off) return { x: pole.x + off.x, y: pole.y + off.y };
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

export const proposalGeometry = (elements: DrawingElement[], c: ConsumerElement, poleRadius: number, scale = 1): ProposalGeometry | null => {
  const pole = elements.find((e) => e.id === c.poleId);
  const B = proposalBoxCenter(elements, c, poleRadius, scale);
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

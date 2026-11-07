import type { CableElement, DrawingElement } from '../types/drawing';
import type { PoleStatus, VdCircuit, VdPole, VdSpan, VoltageView } from './e2Presentation';
import type { Circuit, CircuitStatus, NetSpan } from './network';
import { ampacityWarnings, spanMaxCurrentA, type AmpacityWarning } from './ampacity';
import { cableNameOf } from './cableNameLayout';
import { poleTag } from './poleNames';
import { spanAt } from './spanModel';

// Network analysis (display only): the E2 results of the drawing, arranged per cable — nothing is
// calculated here. Every number comes from the voltage view (e2Presentation.ts, the same calculation
// the drawing, the panel and the PDF show):
//   - a card per cable run: a span leaving the source (or where the colour changes) and every span of
//     the same colour downstream of it in E2's tree. E2 solves everything fed by one transformer as one
//     circuit (the cables meet at its busbar), so a circuit can hold several cards; two cables of one
//     colour leaving the source are two cards — never joined by colour alone;
//   - the cable's load: E2's current on the card's first span (the highest phase) — once per card;
//   - over the limit: the ampacity check (ampacity.ts) of the spans of that circuit, against each span's
//     own cable (its library snapshot); no limit stated → «not stated», never «ok»;
//   - per pole: E2's cumulative voltage drop at that pole (the node result, the worst phase), with E2's
//     status against the project's limit — not the drop of one span;
//   - the poles in the order of the network from the source (E2's tree: each span oriented downstream),
//     branches after the run they leave, marked with the pole they leave from.
// A value E2 does not give is undefined (shown «not available»), never 0 and never «ok».

export type LoadStatus = 'ok' | 'over' | 'no-limit' | 'na';

export interface AnalysisRow {
  poleId: string;
  /** the number shown at the pole on the drawing (poleTag) */
  tag: string;
  bus: string;
  /** 0 on the run from the source, +1 on each branch */
  depth: number;
  /** a branch starts here: the pole it leaves from */
  branchFrom?: string;
  /** the run of the card this pole is on (index into AnalysisCard.runs) */
  run: number;
  /** the span feeding this pole (its cable, for the drawing) */
  feedKey?: string;
  percent?: number;
  status: PoleStatus;
  provisional: boolean;
  reason?: VdPole['reason'];
}

/** one span of a card, checked against its own cable (its own type and limit) */
export interface AnalysisSpan {
  key: string;
  fromTag: string;
  toTag: string;
  /** the span's library cable: name and size, if linked */
  type?: string;
  size?: string;
  /** E2 current per cable assembly (the highest phase), A — the value the ampacity check compares */
  currentA?: number;
  /** this span's own stated limit, A */
  limitA?: number;
  status: LoadStatus;
  provisional: boolean;
}

/** a run of a card: the main run (from the source) or a branch, with the pole it leaves from */
export interface AnalysisRun {
  depth: number;
  /** the pole the branch leaves from (its number on the drawing); none on the main run */
  branchFrom?: string;
}

export interface AnalysisCard {
  id: string;
  /** the colour of the cable (the first span from the source); every colour of the circuit */
  color: string;
  colors: string[];
  cableIds: string[];
  status: CircuitStatus;
  reason?: VdCircuit['reason'];
  sourcePoleId?: string;
  sourceTag?: string;
  /** library cable types on the spans: name and size (3x120), each once, from the source on */
  types: { name: string; size?: string }[];
  /** spans without a library cable */
  unlinkedSpans: number;
  /** E2 current leaving the source (highest phase), A; per cable assembly where cables are in parallel */
  loadA?: number;
  loadPerCableA?: number;
  parallel?: number;
  /** more than one span leaves the source: no single load value */
  severalFeeders: boolean;
  /** the limit stated by every span of the card, A — only when it is the same on all of them */
  limitA?: number;
  /** the spans do not all state the same limit, or are of different types: each span is checked
   *  against its own limit (see spans); no one value is shown for the card */
  limitVaries: boolean;
  /** the card's spans in the order of its rows (main run, then its branches), each with its own limit */
  spans: AnalysisSpan[];
  spansWithoutLimit: number;
  loadStatus: LoadStatus;
  /** spans above their cable's limit */
  over: (AmpacityWarning & { fromTag: string; toTag: string })[];
  maxPercent?: number;
  worstPoleId?: string;
  worstTag?: string;
  provisional: boolean;
  rows: AnalysisRow[];
  /** the runs of the rows: [0] the main run, then the branches in the order they are shown */
  runs: AnalysisRun[];
}

export interface NetworkAnalysis {
  cards: AnalysisCard[];
  limitPercent: number;
  nearLimitFraction: number;
  phaseVoltage: number;
  lineVoltage: number;
  method: VoltageView['method'];
  /** cards whose load is over (any span above its limit) */
  overLoad: number;
  /** cards with at least one pole over the drop limit */
  overDrop: number;
  maxPercent?: number;
  worstCardId?: string;
}

const maxPhase = (r: Partial<Record<'a' | 'b' | 'c' | 'n', number>>) => {
  const v = (['a', 'b', 'c'] as const).map((k) => r[k]).filter((x): x is number => x !== undefined && Number.isFinite(x));
  return v.length ? Math.max(...v) : undefined;
};

/**
 * The poles of a card in the order of its network: the main run first, whole, from the source to its
 * end; then the branches, in the order of the poles they leave along that run, each whole and followed
 * by its own branches. A run goes on along the same drawn cable (its identity), else along the first
 * span E2 lists; every other span out of a pole starts a branch, marked with the pole it leaves.
 * (E2's tree, each span oriented downstream: only read, nothing is changed.)
 */
const orderRows = (spans: readonly NetSpan[], rootBus: string, polesByBus: Map<string, VdPole>, tag: (id: string) => string, rootPole?: string): { rows: AnalysisRow[]; runs: AnalysisRun[] } => {
  type Kid = { bus: string; key: string; cableId: string };
  const row = (bus: string, depth: number, run: number, feedKey?: string, branchFrom?: string): AnalysisRow | undefined => {
    const p = polesByBus.get(bus);
    if (!p) return undefined;
    return { poleId: p.poleId, tag: tag(p.poleId), bus, depth, run, ...(branchFrom ? { branchFrom } : {}), ...(feedKey ? { feedKey } : {}),
      ...(p.percent !== undefined ? { percent: p.percent } : {}), status: p.status, provisional: p.provisional, ...(p.reason ? { reason: p.reason } : {}) };
  };
  const children = new Map<string, Kid[]>();
  for (const s of spans) children.set(s.fromBus, [...(children.get(s.fromBus) ?? []), { bus: s.toBus, key: `${s.cableId}#${s.index}`, cableId: s.cableId }]);
  const poleOf = (bus: string) => polesByBus.get(bus)?.poleId ?? (bus === rootBus ? rootPole : undefined);
  const out: AnalysisRow[] = [];
  const runs: AnalysisRun[] = [];
  const seen = new Set<string>([rootBus]);
  const emitRun = (first: Kid, depth: number, branchFrom?: string) => {
    const run: Kid[] = [];
    const branches: { fromBus: string; kid: Kid }[] = [];
    let cur: Kid | undefined = first;
    while (cur && !seen.has(cur.bus)) {
      seen.add(cur.bus);
      run.push(cur);
      const kids: Kid[] = (children.get(cur.bus) ?? []).filter((k) => !seen.has(k.bus));
      const via: string = cur.cableId;
      const next: Kid | undefined = kids.find((k) => k.cableId === via) ?? kids[0];
      for (const k of kids) if (k !== next) branches.push({ fromBus: cur.bus, kid: k });
      cur = next;
    }
    const n = runs.push({ depth, ...(branchFrom ? { branchFrom } : {}) }) - 1;
    run.forEach((k, i) => { const r = row(k.bus, depth, n, k.key, i === 0 ? branchFrom : undefined); if (r) out.push(r); });
    for (const b of branches) {
      if (seen.has(b.kid.bus)) continue;
      const from = poleOf(b.fromBus);
      emitRun(b.kid, depth + 1, from ? tag(from) : undefined);
    }
  };
  const top = children.get(rootBus) ?? [];
  top.forEach((k, i) => {
    if (seen.has(k.bus)) return;
    emitRun(k, i === 0 ? 0 : 1, i === 0 ? undefined : rootPole ? tag(rootPole) : undefined);
  });
  return { rows: out, runs };
};

/** the cards of one solved circuit: a card per span that starts a run (from the source, or a colour change) */
const runsOf = (circuit: Circuit): { root: NetSpan; spans: NetSpan[] }[] => {
  const feeding = new Map(circuit.spans.map((s) => [s.toBus, s]));
  const byFrom = new Map<string, NetSpan[]>();
  for (const s of circuit.spans) byFrom.set(s.fromBus, [...(byFrom.get(s.fromBus) ?? []), s]);
  const runs: { root: NetSpan; spans: NetSpan[] }[] = [];
  for (const s of circuit.spans) {
    const up = feeding.get(s.fromBus);
    if (up && up.color === s.color) continue; // continues the run above it
    const spans: NetSpan[] = [];
    const stack = [s];
    while (stack.length) {
      const x = stack.pop()!;
      spans.push(x);
      for (const y of byFrom.get(x.toBus) ?? []) if (y.color === s.color) stack.push(y);
    }
    // in E2's order (from the source)
    const order = new Map(circuit.spans.map((x, i) => [x, i]));
    spans.sort((p, q) => order.get(p)! - order.get(q)!);
    runs.push({ root: s, spans });
  }
  return runs;
};

export const networkAnalysis = (elements: readonly DrawingElement[], view: VoltageView): NetworkAnalysis => {
  const tag = poleTag(elements as DrawingElement[]);
  const cables = new Map(elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c]));
  const warnings = ampacityWarnings(elements, view);
  const cards: AnalysisCard[] = [];
  for (const c of view.circuits) {
    const circuit = c.circuit;
    const polesByBus = new Map(c.poles.map((p) => [p.bus, p]));
    const groups = c.status === 'ok' && circuit.sourceBus
      ? runsOf(circuit).map((r) => ({ id: `${circuit.id}:${r.root.cableId}#${r.root.index}`, spans: r.spans, rootBus: r.root.fromBus, head: r.root as NetSpan | undefined }))
      : [{ id: circuit.id, spans: circuit.spans, rootBus: '', head: undefined }];
    for (const g of groups) {
      const keys = new Set(g.spans.map((s) => `${s.cableId}#${s.index}`));
      // library cable types on the spans (from the source on), each once; spans without a link counted
      const types: AnalysisCard['types'] = [];
      let unlinkedSpans = 0;
      const limits: (number | undefined)[] = [];
      for (const s of g.spans) {
        const cable = cables.get(s.cableId);
        const props = cable ? spanAt(cable, s.index).props : undefined;
        const ct = props?.cableType;
        if (!ct) { unlinkedSpans++; limits.push(undefined); continue; }
        const size = cableNameOf(props);
        if (!types.some((t) => t.name === ct.snapshot.name)) types.push({ name: ct.snapshot.name, ...(size ? { size } : {}) });
        limits.push(cable ? spanMaxCurrentA(cable, s.index) : undefined);
      }
      // the load: E2's current on the card's first span (one value per card)
      const head: VdSpan | undefined = g.head ? view.bySpan.get(`${g.head.cableId}#${g.head.index}`) : undefined;
      const loadA = head ? maxPhase(head.currentA) : undefined;
      const loadPerCableA = head ? maxPhase(head.perSetCurrentA) : undefined;
      const parallel = loadA !== undefined && loadPerCableA !== undefined && loadPerCableA > 0 ? Math.round(loadA / loadPerCableA) : undefined;
      const stated = limits.filter((x): x is number => x !== undefined);
      const over = warnings.filter((w) => keys.has(w.key)).map((w) => ({ ...w, fromTag: tag(w.fromPole), toTag: tag(w.toPole) }));
      const computed = c.status === 'ok' && [...keys].some((k) => { const s = view.bySpan.get(k); return !!s && maxPhase(s.currentA) !== undefined; });
      const loadStatus: LoadStatus = over.length ? 'over' : !computed ? 'na' : stated.length ? 'ok' : 'no-limit';
      const { rows, runs } = g.head
        ? orderRows(g.spans, g.rootBus, polesByBus, tag, g.head.fromPole)
        : { runs: [{ depth: 0 }], rows: circuit.buses.map((b) => polesByBus.get(b)).filter((p): p is VdPole => !!p)
          .map((p): AnalysisRow => ({ poleId: p.poleId, tag: tag(p.poleId), bus: p.bus, depth: 0, run: 0, ...(p.percent !== undefined ? { percent: p.percent } : {}), status: p.status, provisional: p.provisional, ...(p.reason ? { reason: p.reason } : {}) })) };
      // the highest drop on the card's route: the highest of E2's values at its poles
      // every span against its own limit (the same rule as the ampacity check: over only when current > limit)
      const order = new Map(rows.map((r, i) => [r.feedKey, i]));
      const spanRows: AnalysisSpan[] = [...g.spans]
        .sort((p, q) => (order.get(`${p.cableId}#${p.index}`) ?? 1e9) - (order.get(`${q.cableId}#${q.index}`) ?? 1e9))
        .map((s) => {
          const key = `${s.cableId}#${s.index}`;
          const cable = cables.get(s.cableId);
          const props = cable ? spanAt(cable, s.index).props : undefined;
          const ct = props?.cableType;
          const size = cableNameOf(props);
          const lim = cable ? spanMaxCurrentA(cable, s.index) : undefined;
          const vs = view.bySpan.get(key);
          const cur = vs && c.status === 'ok' ? maxPhase(vs.perSetCurrentA) : undefined;
          const status: LoadStatus = cur === undefined ? 'na' : lim === undefined ? 'no-limit' : cur > lim ? 'over' : 'ok';
          return { key, fromTag: tag(s.fromPole), toTag: tag(s.toPole), ...(ct ? { type: ct.snapshot.name } : {}), ...(size ? { size } : {}),
            ...(cur !== undefined ? { currentA: cur } : {}), ...(lim !== undefined ? { limitA: lim } : {}), status, provisional: vs?.provisional ?? false };
        });
      const limitVaries = new Set(limits.map((l) => l ?? 'none')).size > 1 || types.length > 1;
      const limitA = !limitVaries && stated.length === limits.length ? stated[0] : undefined;
      const worstRow = rows.filter((r) => r.percent !== undefined).reduce<AnalysisRow | undefined>((w, r) => (!w || r.percent! > w.percent! ? r : w), undefined);
      const color = g.spans[0]?.color ?? [...circuit.colors][0] ?? '#000000';
      cards.push({
        id: g.id, color, colors: [...new Set(g.spans.map((s) => s.color))], cableIds: [...new Set(g.spans.map((s) => s.cableId))], status: c.status,
        ...(c.reason ?? c.completeness.reason ? { reason: (c.reason ?? c.completeness.reason)! } : {}),
        ...(circuit.sourcePoleId ? { sourcePoleId: circuit.sourcePoleId, sourceTag: tag(circuit.sourcePoleId) } : {}),
        types, unlinkedSpans,
        ...(loadA !== undefined ? { loadA } : {}), ...(parallel && parallel > 1 ? { loadPerCableA, parallel } : {}),
        severalFeeders: false,
        ...(limitA !== undefined ? { limitA } : {}),
        limitVaries, spans: spanRows,
        spansWithoutLimit: limits.filter((l) => l === undefined).length,
        loadStatus, over,
        ...(worstRow ? { maxPercent: worstRow.percent, worstPoleId: worstRow.poleId, worstTag: worstRow.tag, provisional: worstRow.provisional } : { provisional: false }),
        rows, runs,
      });
    }
  }
  const withMax = cards.filter((c) => c.maxPercent !== undefined);
  const worst = withMax.reduce<AnalysisCard | undefined>((w, c) => (!w || c.maxPercent! > w.maxPercent! ? c : w), undefined);
  return {
    cards,
    limitPercent: view.settings.limitPercent, nearLimitFraction: view.settings.nearLimitFraction,
    phaseVoltage: view.settings.phaseVoltage, lineVoltage: view.settings.lineVoltage, method: view.method,
    overLoad: cards.filter((c) => c.loadStatus === 'over').length,
    overDrop: cards.filter((c) => c.rows.some((r) => r.status === 'over')).length,
    ...(worst ? { maxPercent: worst.maxPercent, worstCardId: worst.id } : {}),
  };
};

/**
 * «Hide the results within the limit»: rows within the limit (ok, near) are hidden; rows over the
 * limit and rows without a result (never taken as within the limit) stay. A card stays while it has a
 * row left, its load is over, or its result is not available; the data is never changed.
 */
export const filterAnalysis = (a: NetworkAnalysis, hideOk: boolean): { cards: AnalysisCard[]; hidden: number } => {
  if (!hideOk) return { cards: a.cards, hidden: 0 };
  const cards: AnalysisCard[] = [];
  for (const c of a.cards) {
    const rows = c.rows.filter((r) => r.status === 'over' || r.status === 'na');
    if (rows.length || c.loadStatus === 'over' || c.loadStatus === 'na') cards.push({ ...c, rows });
  }
  return { cards, hidden: a.cards.length - cards.length };
};

/**
 * The rows of a card as they are shown — in the panel and in the PDF alike: the main run, then each
 * branch under a heading naming the pole it leaves from (a run with no row left after «hide the
 * results within the limit» has no heading). One list, so the two can never differ.
 */
export type CardItem =
  | { kind: 'run'; run: number; depth: number; branchFrom?: string }
  | { kind: 'row'; row: AnalysisRow };
export const cardItems = (c: Pick<AnalysisCard, 'rows' | 'runs'>): CardItem[] => {
  const out: CardItem[] = [];
  const branches = c.runs.length > 1;
  let last = -1;
  for (const r of c.rows) {
    if (r.run !== last) {
      last = r.run;
      const run = c.runs[r.run];
      // the main run gets a heading only when the card has branches (else it is the whole table)
      if (run && (run.branchFrom || branches)) out.push({ kind: 'run', run: r.run, depth: run.depth, ...(run.branchFrom ? { branchFrom: run.branchFrom } : {}) });
    }
    out.push({ kind: 'row', row: r });
  }
  return out;
};

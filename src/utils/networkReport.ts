import { cardItems, type AnalysisCard, type AnalysisRow, type AnalysisSpan, type NetworkAnalysis } from './networkAnalysis';
import type { Locale } from '../i18n';
import { directionOf } from '../i18n';

// «Network Analysis Report» (PDF): the network analysis (networkAnalysis.ts) laid out on A4 pages.
// Nothing is calculated here either: the values are the analysis', shown as they are («—» / «not
// available» where E2 gives none). Pages are written as HTML (so Arabic is shaped and read right to
// left by the browser), then each page is turned into an image and the images make the PDF.
//   - rows are never cut: a page takes whole rows only; a table that goes on is continued on the next
//     page under its header again («continued»), and under its run's heading again (a branch keeps the
//     pole it leaves from in view);
//   - the cover, the summary and the drawing each have their own page; the cables then follow one
//     another on the pages (a cable starts on a new page only when its head, its table's header and a
//     first row do not fit) — no page left almost empty;
//   - the order of the poles is the panel's (cardItems): the main run, then each branch under its heading;
//   - every page: the project's name, the date of the export and «page i of n».

export const PAGE_W = 794;   // A4 at 96 px per inch
export const PAGE_H = 1123;
const MARGIN = 44;
const HEADER_H = 46;
const FOOTER_H = 34;
/** room for content on a page */
export const CONTENT_H = PAGE_H - 2 * MARGIN - HEADER_H - FOOTER_H;
export const H = {
  summaryHead: 168, cardsHead: 34, cardsRow: 30, units: 190,
  /** a cable's head: its title and three lines of values, two to a line */
  cardHead: 108, overHead: 26, overRow: 24, overBox: 12, noPoles: 24,
  spansHead: 56, spanRow: 26, tableHead: 32, run: 28, row: 28,
  /** the space above a cable that follows another on the same page, and below its parts */
  gap: 20, partGap: 10,
} as const;

export type ReportBlock =
  | { kind: 'cover' }
  | { kind: 'summary' }
  | { kind: 'cardsHead'; cont: boolean }
  | { kind: 'cardsRow'; card: AnalysisCard; index: number }
  | { kind: 'units' }
  | { kind: 'cardHead'; card: AnalysisCard; index: number; first: boolean }
  /** the spans of a cable whose types or limits differ: each span against its own limit */
  | { kind: 'spansHead'; card: AnalysisCard; index: number; cont: boolean }
  | { kind: 'spanRow'; card: AnalysisCard; span: AnalysisSpan }
  | { kind: 'tableHead'; card: AnalysisCard; index: number; cont: boolean }
  /** the heading of a run: the main run, or a branch with the pole it leaves from */
  | { kind: 'run'; card: AnalysisCard; run: number; depth: number; branchFrom?: string; cont: boolean }
  | { kind: 'row'; card: AnalysisCard; row: AnalysisRow };

/** the height of a cable's head without the space above it */
const cardHeadInner = (c: AnalysisCard) =>
  H.cardHead + (c.over.length ? H.overBox + H.overHead + c.over.length * H.overRow : 0) + (c.rows.length ? 0 : H.noPoles) + H.partGap;

/** the height a block takes on the page (each block is drawn at exactly this height) */
export const blockHeight = (b: ReportBlock): number => {
  switch (b.kind) {
    case 'cover': return CONTENT_H;
    case 'summary': return H.summaryHead;
    case 'cardsHead': return H.cardsHead;
    case 'cardsRow': return H.cardsRow;
    case 'units': return H.units;
    case 'cardHead': return cardHeadInner(b.card) + (b.first ? 0 : H.gap);
    case 'spansHead': return H.spansHead;
    case 'spanRow': return H.spanRow;
    case 'tableHead': return H.tableHead;
    case 'run': return H.run;
    case 'row': return H.row;
  }
};

/** the spans shown for a cable: only when its spans differ in type or limit (else the card's limit says it all) */
export const reportSpans = (c: AnalysisCard): AnalysisSpan[] => (c.limitVaries ? c.spans : []);

/** The pages of the report: whole blocks only, the tables' headers (and run headings) again on a page they go on to. */
export const paginateReport = (a: NetworkAnalysis): ReportBlock[][] => {
  const pages: ReportBlock[][] = [[{ kind: 'cover' }]];
  let page: ReportBlock[] = [];
  let used = 0;
  const newPage = () => { if (page.length) pages.push(page); page = []; used = 0; };
  const put = (b: ReportBlock) => { page.push(b); used += blockHeight(b); };
  const fits = (h: number) => used + h <= CONTENT_H;

  // summary, the list of the cables (a table that may go on), the units and limits
  put({ kind: 'summary' });
  if (!fits(H.cardsHead + H.cardsRow)) newPage();
  put({ kind: 'cardsHead', cont: false });
  a.cards.forEach((card, index) => {
    if (!fits(H.cardsRow)) { newPage(); put({ kind: 'cardsHead', cont: true }); }
    put({ kind: 'cardsRow', card, index });
  });
  if (!fits(H.units)) newPage();
  put({ kind: 'units' });

  // the cables, one after the other from a new page: each head kept with the start of what follows it
  newPage();
  a.cards.forEach((card, index) => {
    const spans = reportSpans(card);
    const items = cardItems(card);
    const firstItem = items[0]?.kind === 'run' ? H.run + H.row : H.row;
    const after = spans.length ? H.spansHead + H.spanRow : items.length ? H.tableHead + firstItem : 0;
    if (!fits(cardHeadInner(card) + (used ? H.gap : 0) + after)) newPage();
    put({ kind: 'cardHead', card, index, first: used === 0 });
    if (spans.length) {
      put({ kind: 'spansHead', card, index, cont: false });
      for (const span of spans) {
        if (!fits(H.spanRow)) { newPage(); put({ kind: 'spansHead', card, index, cont: true }); }
        put({ kind: 'spanRow', card, span });
      }
    }
    if (!items.length) return;
    // away from its head (on the next page) the table says which cable it belongs to
    const moved = !fits(H.tableHead + firstItem);
    if (moved) newPage();
    put({ kind: 'tableHead', card, index, cont: moved });
    let run: Extract<ReportBlock, { kind: 'run' }> | undefined;
    items.forEach((it, k) => {
      if (it.kind === 'run') {
        run = { kind: 'run', card, run: it.run, depth: it.depth, ...(it.branchFrom ? { branchFrom: it.branchFrom } : {}), cont: false };
        // a heading never stays alone at the foot of a page
        const next = items[k + 1]?.kind === 'row' ? H.row : 0;
        if (!fits(H.run + next)) { newPage(); put({ kind: 'tableHead', card, index, cont: true }); }
        put(run);
        return;
      }
      if (!fits(H.row)) {
        newPage();
        put({ kind: 'tableHead', card, index, cont: true });
        if (run) put({ ...run, cont: true });
      }
      put({ kind: 'row', card, row: it.row });
    });
  });
  newPage();
  return pages;
};

// ---------- the pages as HTML ----------

export interface ReportText {
  title: string; subtitle: string; project: string; projectUnnamed: string; exported: string; page: (i: number, n: number) => string;
  summary: string; cables: string; cablesOverLoad: string; cablesOverDrop: string; maxDrop: string; atPole: string; method: string; methodName: string;
  cablesList: string; cable: string; type: string; load: string; limit: string; loadStatus: string; worstDrop: string; continued: string;
  unitsTitle: string; units: string[];
  source: string; section: string; noLibrary: string; perCable: (a: string, n: number) => string; severalFeeders: string;
  limitNotStated: string; limitVaries: string; spansNoLimit: (n: number) => string;
  mainRun: (p: string) => string; branchHead: (p: string) => string; spansTitle: string; span: string; spanCurrent: string;
  status: Record<'ok' | 'over' | 'no-limit' | 'na', string>;
  overSpans: string; overSpan: (from: string, to: string, i: string, lim: string) => string;
  pole: string; drop: string; state: string; poleStatus: Record<'ok' | 'near' | 'over' | 'na', string>; branchFrom: (p: string) => string;
  notComputed: (reason: string) => string; reason: (r: string | undefined) => string;
  noPoles: string; provisional: string; empty: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (v: number | undefined, d: number) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const RED = '#b91c1c', AMBER = '#b45309', GREEN = '#15803d', GREY = '#6b7280', LINE = '#d1d5db';
const statusColor = (s: string) => (s === 'over' ? RED : s === 'near' ? AMBER : s === 'ok' ? GREEN : GREY);
// a status as coloured text with a mark (a framed chip is drawn off its frame by html2canvas)
const chip = (text: string, color: string) => `<span style="color:${color};font-weight:700;font-size:12px;white-space:nowrap">● ${esc(text)}</span>`;
/** a name from the project or the library, isolated so its own direction is kept (e.g. «ABC 3x120 (x)» in Arabic) */
const iso = (s: string) => `<bdi>${esc(s)}</bdi>`;
const ltr = (s: string) => `<bdi dir="ltr">${esc(s)}</bdi>`;
const swatch = (c: string) => `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${esc(c)};vertical-align:-2px;border:1px solid rgba(0,0,0,.15)"></span>`;

export interface ReportContext { analysis: NetworkAnalysis; projectName?: string; dateText: string; locale: Locale; text: ReportText }

const loadText = (c: AnalysisCard, x: ReportText) =>
  c.loadA === undefined ? (c.severalFeeders ? x.severalFeeders : '—') : `${ltr(`${num(c.loadA, 1)} A`)}${c.parallel ? ` <span style="color:${GREY}">(${esc(x.perCable(`${num(c.loadPerCableA, 1)} A`, c.parallel))})</span>` : ''}`;
// one value only when every span states the same one; else «varies by span» (each span is checked
// against its own limit, listed under the cable) — never the first span's limit for all
const limitText = (c: AnalysisCard, x: ReportText) =>
  c.limitA !== undefined ? ltr(`${c.limitA} A`) : `<span style="color:${GREY}">${esc(c.limitVaries ? x.limitVaries : x.limitNotStated)}</span>`;
/** «the span 12 ← 13: 140.0 A / 120 A», the numbers kept left to right inside the sentence */
const overSpanText = (o: AnalysisCard['over'][number], x: ReportText) => {
  const marks = ['\u0001', '\u0002', '\u0003', '\u0004'];
  const vals = [ltr(o.fromTag), ltr(o.toTag), ltr(`${num(o.currentA, 1)} A`), ltr(`${o.limitA} A`)];
  return marks.reduce((h, m, i) => h.replace(m, vals[i]), esc(x.overSpan(marks[0], marks[1], marks[2], marks[3])));
};
/** the title of a cable: its cable type; several types (they would not fit) → their sizes, as in the panel */
const cardTitle = (c: AnalysisCard, x: ReportText) => (c.types.length === 1 ? iso(c.types[0].name) : c.types.length ? c.types.map((t) => (t.size ? ltr(t.size) : iso(t.name))).join('، ') : `<span style="color:${GREY}">${esc(x.noLibrary)}</span>`);

const block = (b: ReportBlock, ctx: ReportContext): string => {
  const { analysis: a, text: x } = ctx;
  const th = `box-sizing:border-box;padding:0 8px;align-items:center;text-align:start;font-size:12px;font-weight:700;color:#374151;background:#f3f4f6;border-bottom:1px solid ${LINE}`;
  const td = `box-sizing:border-box;padding:0 8px;align-items:center;font-size:12.5px;border-bottom:1px solid #eef0f3;height:${H.row}px`;
  switch (b.kind) {
    case 'cover':
      return `<div style="height:${CONTENT_H}px;display:flex;flex-direction:column;justify-content:center;gap:18px">
        <div style="font-size:13px;letter-spacing:.08em;color:${GREY};direction:ltr;text-align:start">NETWORK ANALYSIS REPORT</div>
        <div style="font-size:34px;font-weight:700;color:#111827">${esc(x.title)}</div>
        <div style="height:4px;width:120px;background:#1f2937;border-radius:2px"></div>
        <div style="font-size:20px;color:#111827">${iso(ctx.projectName?.trim() || x.projectUnnamed)}</div>
        <div style="font-size:14px;color:${GREY}">${esc(x.subtitle)}</div>
        <div style="font-size:14px;color:#374151">${esc(x.exported)}: ${ltr(ctx.dateText)}</div>
      </div>`;
    case 'summary': {
      const worst = a.cards.find((c) => c.id === a.worstCardId);
      const cell = (label: string, value: string, color = '#111827') => `<div style="flex:1;min-width:150px;border:1px solid ${LINE};border-radius:8px;padding:10px 12px"><div style="font-size:12px;color:${GREY}">${esc(label)}</div><div style="font-size:22px;font-weight:700;color:${color};margin-top:2px">${value}</div></div>`;
      return `<div style="height:${H.summaryHead}px;box-sizing:border-box;overflow:hidden"><h2 style="font-size:20px;margin:0 0 12px">${esc(x.summary)}</h2>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          ${cell(x.cables, String(a.cards.length))}
          ${cell(x.cablesOverLoad, String(a.overLoad), a.overLoad ? RED : '#111827')}
          ${cell(x.cablesOverDrop, String(a.overDrop), a.overDrop ? RED : '#111827')}
          ${cell(x.maxDrop, a.maxPercent !== undefined ? `${ltr(`${num(a.maxPercent, 2)} %`)}${worst?.worstTag ? ` <span style="font-size:13px;font-weight:400;color:${GREY}">${esc(x.atPole)} ${ltr(worst.worstTag)}</span>` : ''}` : '—', a.maxPercent !== undefined && a.maxPercent > a.limitPercent ? RED : '#111827')}
        </div>
        <div style="font-size:12.5px;color:#374151">${esc(x.method)}: ${esc(x.methodName)}</div>
        </div>`;
    }
    case 'cardsHead':
      return `<div style="font-size:15px;font-weight:700;margin:4px 0 6px">${esc(x.cablesList)}${b.cont ? ` <span style="font-weight:400;color:${GREY}">(${esc(x.continued)})</span>` : ''}</div>`;
    case 'cardsRow': {
      const c = b.card;
      return `<div style="box-sizing:border-box;display:grid;grid-template-columns:28px 1.5fr 1fr 1fr 1fr 1fr;gap:6px;align-items:center;height:${H.cardsRow}px;line-height:1.6;border-bottom:1px solid #eef0f3;font-size:12px;white-space:nowrap">
        <div>${swatch(c.color)}</div><div style="white-space:nowrap;overflow:hidden;line-height:${H.cardsRow - 2}px">${cardTitle(c, x)}</div>
        <div>${loadText(c, x)}</div><div>${limitText(c, x)}</div>
        <div>${chip(x.status[c.loadStatus], statusColor(c.loadStatus === 'no-limit' ? 'na' : c.loadStatus))}</div>
        <div>${c.maxPercent !== undefined ? `${ltr(`${num(c.maxPercent, 2)} %`)} ${c.worstTag ? `<span style="color:${GREY}">(${ltr(c.worstTag)})</span>` : ''}` : '—'}</div>
      </div>`;
    }
    case 'units':
      return `<div style="height:${H.units}px;box-sizing:border-box;padding-top:14px;overflow:hidden"><div style="border:1px solid ${LINE};border-radius:8px;padding:10px 14px;background:#fafafa">
        <div style="font-size:14px;font-weight:700;margin-bottom:6px">${esc(x.unitsTitle)}</div>
        <ul style="margin:0;padding-inline-start:18px;font-size:12px;line-height:1.7;color:#374151">${x.units.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
      </div></div>`;
    case 'cardHead': {
      const c = b.card;
      const kv = (k: string, v: string) => `<div style="display:flex;gap:8px;font-size:12.5px;height:24px;line-height:24px;white-space:nowrap;min-width:0"><span style="color:${GREY};flex:none;width:150px">${esc(k)}</span><span>${v}</span></div>`;
      const over = c.over.length ? `<div style="box-sizing:border-box;margin-top:4px;height:${H.overBox - 4 + H.overHead + c.over.length * H.overRow}px;border:1px solid ${RED};border-radius:6px;padding:2px 10px">
          <div style="font-size:12px;font-weight:700;color:${RED};height:${H.overHead - 6}px;line-height:${H.overHead - 6}px">${esc(x.overSpans)}</div>
          ${c.over.map((o) => `<div style="font-size:12px;height:${H.overRow}px;line-height:${H.overRow}px;color:${RED}">⚠ ${overSpanText(o, x)}</div>`).join('')}
        </div>` : '';
      return `<div style="height:${blockHeight(b)}px;box-sizing:border-box;padding-top:${b.first ? 0 : H.gap}px;padding-bottom:${H.partGap}px" data-card-head="${esc(c.id)}"><div style="border-inline-start:6px solid ${esc(c.color)};padding-inline-start:12px">
        <div style="display:flex;align-items:center;gap:8px;font-size:17px;font-weight:700;height:${H.cardHead - 3 * 24}px;line-height:${H.cardHead - 3 * 24}px;white-space:nowrap;overflow:hidden">${swatch(c.color)} <span style="flex:none">${esc(x.cable)} ${b.index + 1} —</span> <span style="min-width:0;overflow:hidden">${cardTitle(c, x)}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1.25fr;column-gap:16px">
        ${kv(x.section, c.types.map((t) => t.size ? ltr(t.size) : '—').join('، ') || '—')}
        ${kv(x.source, c.sourceTag ? ltr(c.sourceTag) : '—')}
        ${kv(x.load, loadText(c, x))}
        ${kv(x.limit, limitText(c, x) + (c.limitVaries && c.spansWithoutLimit ? ` <span style="color:${GREY}">· ${esc(x.spansNoLimit(c.spansWithoutLimit))}</span>` : ''))}
        ${kv(x.loadStatus, chip(x.status[c.loadStatus], statusColor(c.loadStatus === 'no-limit' ? 'na' : c.loadStatus)))}
        ${kv(x.worstDrop, c.maxPercent !== undefined ? `${ltr(`${num(c.maxPercent, 2)} %`)}${c.worstTag ? ` — ${esc(x.atPole)} ${ltr(c.worstTag)}` : ''}${c.provisional ? ` <span style="color:${AMBER}">(${esc(x.provisional)})</span>` : ''}` : (c.status !== 'ok' ? esc(x.notComputed(x.reason(c.reason))) : '—'))}
        </div>
        ${over}
        ${c.rows.length ? '' : `<div style="font-size:12px;color:${GREY};height:${H.noPoles}px;line-height:${H.noPoles}px">${esc(x.noPoles)}</div>`}
      </div></div>`;
    }
    case 'spansHead': {
      const cols = 'grid-template-columns:1fr 1.6fr 1fr 1fr 1fr';
      return `<div style="height:${H.spansHead}px;box-sizing:border-box">
        <div style="font-size:13px;font-weight:700;height:${H.spansHead - H.tableHead + 4}px;line-height:${H.spansHead - H.tableHead - 6}px">${esc(x.spansTitle)}${b.cont ? ` <span style="font-weight:400;color:${GREY}">— ${esc(x.cable)} ${b.index + 1} (${esc(x.continued)})</span>` : ''}</div>
        <div style="display:grid;${cols};${th};height:${H.tableHead - 4}px;line-height:${H.tableHead - 5}px"><div>${esc(x.span)}</div><div>${esc(x.type)}</div><div>${esc(x.spanCurrent)}</div><div>${esc(x.limit)}</div><div>${esc(x.state)}</div></div>
      </div>`;
    }
    case 'spanRow': {
      const sp = b.span;
      const over = sp.status === 'over';
      return `<div style="display:grid;grid-template-columns:1fr 1.6fr 1fr 1fr 1fr;${td};height:${H.spanRow}px;line-height:${H.spanRow - 1}px;${over ? 'background:#fef2f2;' : ''}" data-span="${esc(sp.key)}">
        <div>${ltr(`${sp.fromTag} – ${sp.toTag}`)}</div>
        <div style="white-space:nowrap;overflow:hidden">${sp.size ? ltr(sp.size) : sp.type ? iso(sp.type) : `<span style="color:${GREY}">${esc(x.noLibrary)}</span>`}</div>
        <div style="${over ? `color:${RED};font-weight:700` : ''}">${sp.currentA !== undefined ? ltr(`${sp.provisional ? '≈' : ''}${num(sp.currentA, 1)} A`) : '—'}</div>
        <div>${sp.limitA !== undefined ? ltr(`${sp.limitA} A`) : '—'}</div>
        <div>${chip(x.status[sp.status], statusColor(sp.status === 'no-limit' ? 'na' : sp.status))}</div>
      </div>`;
    }
    case 'run':
      return `<div style="box-sizing:border-box;height:${H.run}px;line-height:${H.run - 1}px;padding-inline-start:${8 + Math.max(0, b.depth - 1) * 14}px;font-size:12px;font-weight:700;color:#374151;background:#f9fafb;border-bottom:1px solid #eef0f3" data-run="${b.run}"${b.branchFrom ? ` data-branch-from="${esc(b.branchFrom)}"` : ''}>${b.branchFrom ? `↳ ${esc(x.branchHead(b.branchFrom))}` : esc(x.mainRun(b.card.sourceTag ?? ''))}${b.cont ? ` <span style="font-weight:400;color:${GREY}">(${esc(x.continued)})</span>` : ''}</div>`;
    case 'tableHead':
      return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;${th};height:${H.tableHead}px;line-height:${H.tableHead - 1}px"><div>${esc(x.pole)}${b.cont ? ` <span style="font-weight:400;color:${GREY}">— ${esc(x.cable)} ${b.index + 1} (${esc(x.continued)})</span>` : ''}</div><div>${esc(x.drop)}</div><div>${esc(x.state)}</div></div>`;
    case 'row': {
      const r = b.row;
      const over = r.status === 'over';
      return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;${td};line-height:${H.row - 1}px;${over ? 'background:#fef2f2;' : ''}" data-row="${esc(r.poleId)}">
        <div style="padding-inline-start:${r.depth * 14}px">${ltr(r.tag)}</div>
        <div style="${over ? `color:${RED};font-weight:700` : ''}">${r.percent !== undefined ? ltr(`${num(r.percent, 2)} %`) : '—'}${r.provisional ? ` <span style="color:${AMBER}">⚑</span>` : ''}</div>
        <div>${chip(x.poleStatus[r.status], statusColor(r.status))}${r.status === 'na' && r.reason ? ` <span style="color:${GREY};font-size:11px">${esc(x.reason(r.reason))}</span>` : ''}</div>
      </div>`;
    }
  }
};

/** one page of the report as HTML (A4, the project's name and date on top, «page i of n» below) */
export const reportPageHtml = (blocks: ReportBlock[], i: number, n: number, ctx: ReportContext): string => {
  const dir = directionOf(ctx.locale);
  const name = iso(ctx.projectName?.trim() || ctx.text.projectUnnamed);
  const cover = blocks[0]?.kind === 'cover';
  return `<div dir="${dir}" lang="${ctx.locale}" data-report-page="${i}" style="width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:${MARGIN}px;background:#fff;color:#111827;font-family:'Segoe UI',Tahoma,'Noto Naskh Arabic','Geeza Pro',Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden">
    <div style="height:${HEADER_H}px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:${cover ? 0 : 1}px solid ${LINE};font-size:11.5px;color:${GREY}">
      ${cover ? '' : `<span>${esc(ctx.text.title)} — ${name}</span><span>${ltr(ctx.dateText)}</span>`}
    </div>
    <div style="flex:1;padding-top:${cover ? 0 : 10}px">${blocks.map((b) => block(b, ctx)).join('')}</div>
    <div style="height:${FOOTER_H}px;display:flex;justify-content:center;align-items:flex-end;font-size:11px;color:${GREY}">${esc(ctx.text.page(i, n))}</div>
  </div>`;
};

export const reportHtmlPages = (ctx: ReportContext): string[] => {
  const pages = paginateReport(ctx.analysis);
  return pages.map((p, k) => reportPageHtml(p, k + 1, pages.length, ctx));
};

/**
 * The report as a PDF (jsPDF), in the browser: each page drawn off screen, turned into an image
 * (html2canvas) and added as one A4 page. `after` adds more pages (the drawing) to the same file.
 */
export const buildReportPdf = async (ctx: ReportContext, opts: { after?: (pdf: import('jspdf').jsPDF) => void | Promise<void> } = {}) => {
  const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const host = document.createElement('div');
  host.setAttribute('data-report-render', '');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;pointer-events:none;`;
  document.body.appendChild(host);
  try {
    const pages = reportHtmlPages(ctx);
    for (let k = 0; k < pages.length; k++) {
      host.innerHTML = pages[k];
      const el = host.firstElementChild as HTMLElement;
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W, windowHeight: PAGE_H, logging: false, useCORS: true });
      if (k > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    if (opts.after) await opts.after(pdf);
  } finally {
    host.remove();
  }
  return pdf;
};

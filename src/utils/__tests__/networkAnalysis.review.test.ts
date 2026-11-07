import { describe, expect, it } from 'vitest';
import { voltageView } from '../e2Presentation';
import { cardItems, networkAnalysis, type AnalysisCard } from '../networkAnalysis';
import { CONTENT_H, blockHeight, paginateReport, reportHtmlPages, reportSpans } from '../networkReport';
import { pdfFilename, safeFilePart } from '../pdfFilename';
import { reportText } from '../../components/NetworkAnalysisPanel';
import { translate } from '../../i18n';
import { RED, branched, docOf, network, pole, rev, sub } from './networkAnalysis.fixture';

// Final review of the network analysis: the order of the runs and branches (the same in the panel and
// the PDF), the use of the PDF pages, the names of the three PDF files, and spans of different cable
// types checked each against its own limit. ALL VALUES SYNTHETIC.

const tr = (k: string, p?: Record<string, string | number>) => translate('ar', k as never, p as never);
const en = (k: string, p?: Record<string, string | number>) => translate('en', k as never, p as never);
const analyse = (d: ReturnType<typeof network>) => networkAnalysis(d.elements, voltageView(d));
const redOf = (a: ReturnType<typeof networkAnalysis>) => a.cards.find((c) => c.color === RED)!;

describe('review 1: the main run whole, then its branches in the order of their poles', () => {
  it('main run from the source to its end, then the branch at A (with its sub-branch), at B, at D', () => {
    const c = redOf(analyse(branched()));
    const tagOf = new Map(c.rows.map((r) => [r.poleId, r.tag]));
    expect(c.rows.map((r) => r.poleId)).toEqual(['A', 'B', 'C', 'D', 'E', 'P', 'Q', 'S', 'M', 'X']);
    expect(c.rows.map((r) => r.depth)).toEqual([0, 0, 0, 0, 0, 1, 1, 2, 1, 1]);
    // every branch says which pole it leaves from
    expect(c.runs).toEqual([
      { depth: 0 },
      { depth: 1, branchFrom: tagOf.get('A') },
      { depth: 2, branchFrom: tagOf.get('P') },
      { depth: 1, branchFrom: tagOf.get('B') },
      { depth: 1, branchFrom: tagOf.get('D') },
    ]);
    expect(c.rows.find((r) => r.poleId === 'S')!.branchFrom).toBe(tagOf.get('P'));
  });
  it('the items shown: a heading for the main run and for each branch, before its poles', () => {
    const c = redOf(analyse(branched()));
    const tagOf = new Map(c.rows.map((r) => [r.poleId, r.tag]));
    const shown = cardItems(c).map((it) => (it.kind === 'run' ? `[${it.branchFrom ?? 'main'}]` : it.row.poleId));
    expect(shown).toEqual(['[main]', 'A', 'B', 'C', 'D', 'E', `[${tagOf.get('A')}]`, 'P', 'Q', `[${tagOf.get('P')}]`, 'S', `[${tagOf.get('B')}]`, 'M', `[${tagOf.get('D')}]`, 'X']);
  });
  it('a cable that ends at a pole where one other span goes on (a joint) continues the run, it is not a branch', () => {
    const R = rev(120, 0.32, 250);
    const d = docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 100), pole('B', 0, 200), pole('C', 0, 300)],
      [{ id: 'k1', poles: ['T', 'A', 'B'], color: RED, revs: [R, R] }, { id: 'k2', poles: ['B', 'C'], color: RED, revs: [R] }],
      [sub('u', 'C', RED, 20)], { 'T-A': '50', 'A-B': '50', 'B-C': '50' });
    const c = redOf(analyse(d));
    expect(c.rows.map((r) => [r.poleId, r.depth])).toEqual([['A', 0], ['B', 0], ['C', 0]]);
    expect(c.runs.length).toBe(1);
  });
  it('a card with no branch has no heading (its table is its main run)', () => {
    const d = docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 100), pole('B', 0, 200)], [{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [rev(120, 0.32, 250), rev(120, 0.32, 250)] }],
      [sub('u', 'B', RED, 20)], { 'T-A': '50', 'A-B': '50' });
    expect(cardItems(redOf(analyse(d))).every((it) => it.kind === 'row')).toBe(true);
  });
  it('the PDF lists the poles and headings in exactly the panel\'s order', () => {
    const a = analyse(branched());
    const pages = paginateReport(a);
    for (const c of a.cards) {
      const pdf = pages.flat().filter((b) => (b.kind === 'row' || (b.kind === 'run' && !b.cont)) && b.card.id === c.id)
        .map((b) => (b.kind === 'run' ? `[${b.branchFrom ?? 'main'}]` : b.kind === 'row' ? b.row.poleId : ''));
      expect(pdf).toEqual(cardItems(c).map((it) => (it.kind === 'run' ? `[${it.branchFrom ?? 'main'}]` : it.row.poleId)));
    }
    // and in the HTML of the pages, in the same order
    const html = reportHtmlPages({ analysis: a, projectName: 'p', dateText: 'd', locale: 'ar', text: reportText(tr, a) }).join('');
    const order = [...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(redOf(a).rows.map((r) => r.poleId));
    expect(html).toContain(tr('analysis.branchHead', { p: redOf(a).rows.find((r) => r.poleId === 'A')!.tag }));
  });
  it('E2\'s values are unchanged by the order: each row is the pole\'s own E2 result', () => {
    const d = branched();
    const view = voltageView(d);
    for (const r of redOf(networkAnalysis(d.elements, view)).rows) {
      const p = view.byPole.get(r.poleId)!.find((x) => x.bus === r.bus)!;
      expect(r.percent).toBe(p.percent);
      expect(r.status).toBe(p.status);
    }
  });
});

describe('review 2: the PDF pages are used, never cut', () => {
  it('cables follow one another on a page; the cover and the summary have their own pages', () => {
    const a = analyse(network());
    const pages = paginateReport(a);
    expect(pages[0]).toEqual([{ kind: 'cover' }]);
    expect(pages[1][0].kind).toBe('summary');
    expect(pages[1].some((b) => b.kind === 'cardHead')).toBe(false);
    // both small cables share one page (no page per cable)
    const heads = pages.map((p) => p.filter((b) => b.kind === 'cardHead').length);
    expect(Math.max(...heads)).toBe(2);
    expect(pages.length).toBe(3);
  });
  it('many cables: whole blocks within the height, every page but the last well filled, a head never left alone', () => {
    const n = 14;
    const poles = [pole('T', 0, 0, 'transformer')];
    const cables: Parameters<typeof docOf>[1] = [];
    const subs = [];
    const dist: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      const ps = [0, 1, 2, 3].map((j) => `C${i}P${j}`);
      ps.forEach((id, j) => poles.push(pole(id, i * 100, (j + 1) * 100)));
      cables.push({ id: `c${i}`, poles: ['T', ...ps], color: `#${(0x100000 + i * 0x0a0b0c).toString(16).slice(0, 6)}`, revs: Array(4).fill(rev(120, 0.32, 250)) });
      ps.forEach((id, j) => { dist[`${j ? ps[j - 1] : 'T'}-${id}`] = '40'; subs.push(sub(`u${i}${j}`, id, cables[i].color, 5)); });
    }
    const d = docOf(poles, cables, subs, dist);
    const a = networkAnalysis(d.elements, voltageView(d));
    expect(a.cards.length).toBe(n);
    const pages = paginateReport(a);
    const cardPages = pages.filter((p) => p.some((b) => b.kind === 'cardHead' || b.kind === 'row'));
    for (const p of pages) expect(p.reduce((s, b) => s + blockHeight(b), 0)).toBeLessThanOrEqual(CONTENT_H);
    // no near-empty page: each page of cables but the last is at least 60 % full
    for (const p of cardPages.slice(0, -1)) expect(p.reduce((s, b) => s + blockHeight(b), 0)).toBeGreaterThan(CONTENT_H * 0.6);
    // a cable's head is followed on its page by its table's header and a first row
    for (const p of cardPages) p.forEach((b, i) => { if (b.kind === 'cardHead') expect([p[i + 1]?.kind, p[i + 2]?.kind, p[i + 3]?.kind]).toContain('row'); });
    // every pole once
    expect(pages.flat().filter((b) => b.kind === 'row').length).toBe(n * 4);
    // far fewer pages than one per cable
    expect(cardPages.length).toBeLessThan(n / 2);
  });
  it('a branch going on to a new page keeps its heading (the pole it leaves from) above its rows', () => {
    const n = 50;
    const R = rev(120, 0.32, 250);
    const main = Array.from({ length: n }, (_, i) => `M${i}`);
    const br = Array.from({ length: n }, (_, i) => `B${i}`);
    const poles = [pole('T', 0, 0, 'transformer'), ...main.map((id, i) => pole(id, 0, (i + 1) * 50)), ...br.map((id, i) => pole(id, 100 + i * 50, 50))];
    const dist: Record<string, string> = {};
    ['T', ...main].forEach((id, i, arr) => { if (i) dist[`${arr[i - 1]}-${id}`] = '20'; });
    ['M0', ...br].forEach((id, i, arr) => { if (i) dist[`${arr[i - 1]}-${id}`] = '20'; });
    const d = docOf(poles, [{ id: 'm', poles: ['T', ...main], color: RED, revs: Array(n).fill(R) }, { id: 'b', poles: ['M0', ...br], color: RED, revs: Array(n).fill(R) }],
      [...main, ...br].map((p, i) => sub(`u${i}`, p, RED, 1)), dist);
    const a = networkAnalysis(d.elements, voltageView(d));
    const pages = paginateReport(a);
    for (const p of pages) {
      const first = p.find((b) => b.kind === 'row');
      if (!first || first.kind !== 'row' || first.row.depth === 0) continue;
      // a page that starts inside the branch shows the branch heading again, before the first row
      const runIdx = p.findIndex((b) => b.kind === 'run' && b.branchFrom);
      expect(runIdx).toBeGreaterThanOrEqual(0);
      expect(runIdx).toBeLessThan(p.indexOf(first));
    }
  });
});

describe('review 3: the names of the three PDF files', () => {
  it('Arabic: the project\'s name and what the file is', () => {
    expect(pdfFilename('شبكة حي النور', 'drawing', tr)).toBe('شبكة حي النور - الرسم.pdf');
    expect(pdfFilename('شبكة حي النور', 'report', tr)).toBe('شبكة حي النور - تقرير تحليل الشبكة.pdf');
    expect(pdfFilename('شبكة حي النور', 'full', tr)).toBe('شبكة حي النور - التقرير الشامل.pdf');
  });
  it('English', () => {
    expect(pdfFilename('Site A', 'drawing', en)).toBe('Site A - Drawing.pdf');
    expect(pdfFilename('Site A', 'report', en)).toBe('Site A - Network Analysis Report.pdf');
    expect(pdfFilename('Site A', 'full', en)).toBe('Site A - Full Report.pdf');
  });
  it('never «download»; no name → what it is and the date; unsafe characters replaced', () => {
    const d = new Date(2026, 10, 7, 9, 5);
    for (const k of ['drawing', 'report', 'full'] as const) {
      expect(pdfFilename('x', k, tr)).not.toMatch(/^download/i);
      expect(pdfFilename(undefined, k, tr, d)).toMatch(/ 2026-11-07\.pdf$/);
    }
    expect(pdfFilename('  ', 'report', tr, d)).toBe('تقرير تحليل الشبكة 2026-11-07.pdf');
    expect(pdfFilename(null, 'drawing', en, d)).toBe('Drawing 2026-11-07.pdf');
    expect(pdfFilename('a/b:c*?', 'full', en)).toBe('a_b_c__ - Full Report.pdf');
    expect(safeFilePart('..\u0007x')).toBe('x');
    // the three are distinct
    expect(new Set((['drawing', 'report', 'full'] as const).map((k) => pdfFilename('p', k, tr))).size).toBe(3);
  });
});

describe('review 4: spans of different cable types, each against its own limit', () => {
  /** red T–A–B–C: T–A a 3x150 (limit 300 A), A–B a 3x120 (limit 200 A), B–C a 3x70 (limit 120 A). */
  const mixed = (loads: [number, number, number]) => {
    const R150 = rev(150, 0.25, 300), R120 = rev(120, 0.32, 200), R70 = rev(70, 0.55, 120);
    return docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 100), pole('B', 0, 200), pole('C', 0, 300)],
      [{ id: 'k', poles: ['T', 'A', 'B', 'C'], color: RED, revs: [R150, R120, R70] }],
      [sub('ua', 'A', RED, loads[0]), sub('ub', 'B', RED, loads[1]), sub('uc', 'C', RED, loads[2])], { 'T-A': '50', 'A-B': '50', 'B-C': '50' });
  };
  const spanOf = (c: AnalysisCard, from: string, to: string) => c.spans.find((s) => s.fromTag === from && s.toTag === to)!;
  it('each span carries its own type and limit; the card gives no single limit', () => {
    const c = redOf(analyse(mixed([10, 10, 10])));
    expect(c.limitVaries).toBe(true);
    expect(c.limitA).toBeUndefined(); // never the first span's 300 A for all of them
    expect(c.spans.map((s) => s.limitA)).toEqual([300, 200, 120]);
    expect(c.spans.map((s) => s.size)).toEqual([expect.stringContaining('150'), expect.stringContaining('120'), expect.stringContaining('70')]);
    expect(c.spans.every((s) => s.status === 'ok')).toBe(true);
  });
  it('a small span over its own limit is over, though under the first span\'s limit', () => {
    // B–C carries ≈ 150 A: over its 120 A, under the 300 A of T–A
    const c = redOf(analyse(mixed([20, 20, 150])));
    const bc = spanOf(c, c.rows[1].tag, c.rows[2].tag);
    expect(bc.currentA!).toBeGreaterThan(120);
    expect(bc.currentA!).toBeLessThan(300);
    expect(bc.status).toBe('over');
    expect(c.loadStatus).toBe('over');
    expect(c.over.map((o) => [o.limitA])).toEqual([[120]]);
    // and the spans within their own limits are ok
    expect(c.spans.filter((s) => s !== bc).every((s) => s.status === 'ok')).toBe(true);
  });
  it('a big span is not over against a smaller span\'s limit', () => {
    // T–A carries ≈ 250 A: under its own 300 A, though above 200 A and 120 A
    const c = redOf(analyse(mixed([200, 25, 25])));
    const ta = c.spans[0];
    expect(ta.currentA!).toBeGreaterThan(200);
    expect(ta.status).toBe('ok');
    expect(c.over).toEqual([]);
    expect(c.loadStatus).toBe('ok');
  });
  it('a span without a stated limit is «not stated», never ok; one limit for all → the card states it', () => {
    const R = rev(120, 0.32, 250), N = rev(95, 0.41);
    const d = docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 100), pole('B', 0, 200)], [{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [R, N] }],
      [sub('u', 'B', RED, 20)], { 'T-A': '50', 'A-B': '50' });
    const c = redOf(analyse(d));
    expect(c.limitA).toBeUndefined();
    expect(c.spans.map((s) => s.status)).toEqual(['ok', 'no-limit']);
    expect(redOf(analyse(network())).limitA).toBe(250);
    expect(redOf(analyse(network())).limitVaries).toBe(false);
  });
  it('the report lists the spans with their own limits, and «varies by span» for the card', () => {
    const a = analyse(mixed([20, 20, 150]));
    const c = redOf(a);
    expect(reportSpans(c).length).toBe(3);
    const html = reportHtmlPages({ analysis: a, projectName: 'p', dateText: 'd', locale: 'ar', text: reportText(tr, a) }).join('');
    expect(html).toContain(tr('analysis.spansTitle'));
    expect(html).toContain(tr('analysis.limitVaries'));
    for (const s of c.spans) expect(html).toContain(`data-span="${s.key}"`);
    expect(html).toContain('<bdi dir="ltr">120 A</bdi>');
    expect(html).toContain('<bdi dir="ltr">300 A</bdi>');
    // the spans table is not printed when all spans are the same cable
    expect(reportSpans(redOf(analyse(network())))).toEqual([]);
  });
});

describe('review 5: the report stays Arabic, right to left', () => {
  it('every page RTL with lang=ar; headings in Arabic; numbers and pole numbers isolated LTR', () => {
    const a = analyse(branched());
    const pages = reportHtmlPages({ analysis: a, projectName: 'مشروع (synthetic)', dateText: '2026-11-07 12:00', locale: 'ar', text: reportText(tr, a) });
    expect(pages.every((p) => p.includes('dir="rtl"') && p.includes('lang="ar"'))).toBe(true);
    const all = pages.join('');
    expect(all).toContain(tr('analysis.mainRun', { p: 'T1' }));
    expect(all).toMatch(/<bdi dir="ltr">\d+\.\d{2} %<\/bdi>/);
    expect(all).toMatch(/data-row="A"[^>]*>\s*<div[^>]*><bdi dir="ltr">\d+<\/bdi>/);
    expect(all).not.toContain('كيبل');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { voltageView, runE2Study } from '../e2Presentation';
import { cardItems, filterAnalysis, networkAnalysis } from '../networkAnalysis';
import { CONTENT_H, blockHeight, paginateReport, reportHtmlPages, reportSpans } from '../networkReport';
import { reportText } from '../../components/NetworkAnalysisPanel';
import { translate } from '../../i18n';
import { useAnalysisFocus } from '../../store/analysisFocusStore';
import { BLUE, RED, docOf, network, pole, rev, sub } from './networkAnalysis.fixture';
import type { CableElement } from '../../types/drawing';

// The network analysis and its report: a view of the E2 results, nothing calculated. ALL VALUES SYNTHETIC.

const tr = (k: string, p?: Record<string, string | number>) => translate('ar', k as never, p as never);
const en = (k: string, p?: Record<string, string | number>) => translate('en', k as never, p as never);
const analyse = (d: ReturnType<typeof network>) => { const view = voltageView(d); return { view, a: networkAnalysis(d.elements, view) }; };
const red = (a: ReturnType<typeof networkAnalysis>) => a.cards.find((c) => c.color === RED)!;
const blue = (a: ReturnType<typeof networkAnalysis>) => a.cards.find((c) => c.color === BLUE)!;

describe('network analysis: the cards, from E2', () => {
  it('1. the load of a cable is one value on its card (E2\'s current on its first span), never repeated on the poles', () => {
    const { view, a } = analyse(network());
    const k = red(a);
    const head = view.bySpan.get('k#2')!; // T→A, the span leaving the source (the cable is drawn from its far end)
    expect(k.loadA).toBe(Math.max(head.currentA.a!, head.currentA.b!, head.currentA.c!));
    expect(k.loadA).toBeCloseTo(210, 1); // ≈ 60 + 50 + 40 + 30 + 30 (phasors: E2's own sum)
    for (const r of k.rows) expect(Object.keys(r)).not.toContain('loadA');
    expect(blue(a).loadA).toBeCloseTo(20, 1);
  });
  it('2. the load against the maximum allowable current: ok, then over (every span against its own cable)', () => {
    expect(red(analyse(network({ limit: 250 })).a)).toMatchObject({ loadStatus: 'ok', limitA: 250, over: [] });
    const over = red(analyse(network({ limit: 150 })).a);
    expect(over.loadStatus).toBe('over');
    // T→A (210 A) and A→B (150 A = 50+40+30+30) — A→B is equal to the limit: not over
    expect(over.over.map((o) => `${o.fromTag}→${o.toTag}`)).toEqual(['T1→6']);
    expect(over.over[0].limitA).toBe(150);
  });
  it('3. no maximum allowable current: «not stated», never «ok», no excess', () => {
    const { a } = analyse(network({ limit: 0 }));
    expect(red(a)).toMatchObject({ loadStatus: 'no-limit', over: [], spansWithoutLimit: 5 });
    expect(red(a).limitA).toBeUndefined();
    expect(blue(a).loadStatus).toBe('no-limit');
  });
  it('4. the voltage drop of each pole is E2\'s cumulative value at that pole (not a span\'s drop)', () => {
    const { view, a } = analyse(network());
    for (const r of red(a).rows) {
      const p = view.byPole.get(r.poleId)!.find((x) => x.bus === r.bus)!;
      expect(r.percent).toBe(p.percent);
      expect(r.status).toBe(p.status);
    }
    // cumulative: it grows away from the source along a run
    const main = red(a).rows.filter((r) => r.depth === 0).map((r) => r.percent!);
    expect(main).toEqual([...main].sort((x, y) => x - y));
    expect(red(a).maxPercent).toBe(Math.max(...red(a).rows.map((r) => r.percent!)));
  });
  it('5. the poles in the order of the network from the source, not the order of the drawing', () => {
    const { a } = analyse(network());
    // poles listed E, C, G, B, D, A, F, T and the main cable drawn from C to T: the rows still go T→A→B→C
    expect(red(a).rows.filter((r) => r.depth === 0).map((r) => r.poleId)).toEqual(['A', 'B', 'C']);
    expect(red(a).sourceTag).toBe('T1');
  });
  it('6. a branch is laid out after the run it leaves, from its pole; separate cables of one colour are not joined', () => {
    const { a } = analyse(network());
    expect(red(a).rows.map((r) => [r.poleId, r.depth, r.branchFrom ?? ''])).toEqual([['A', 0, ''], ['B', 0, ''], ['C', 0, ''], ['D', 1, '4'], ['E', 1, '']]);
    expect(a.cards.length).toBe(2); // red and blue meet at the transformer's busbar: still two cables
    // two red cables leaving the transformer: two cards, not one
    const two = docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 200), pole('B', 200, 0)],
      [{ id: 'x', poles: ['T', 'A'], color: RED, revs: [rev(120, 0.32, 250)] }, { id: 'y', poles: ['T', 'B'], color: RED, revs: [rev(120, 0.32, 250)] }],
      [sub('u1', 'A', RED, 30), sub('u2', 'B', RED, 70)], { 'T-A': '100', 'T-B': '100' });
    const t = networkAnalysis(two.elements, voltageView(two));
    expect(t.cards.map((c) => [c.cableIds.join(), Math.round(c.loadA!)]).sort()).toEqual([['x', 30], ['y', 70]]);
  });
  it('7. «hide the results within the limit»: ok and near rows hidden, over and not-available rows kept; off shows all', () => {
    const { a } = analyse(network({ long: '120' }));
    const statuses = red(a).rows.map((r) => r.status);
    expect(statuses).toContain('ok');
    expect(statuses.some((s) => s === 'over' || s === 'near')).toBe(true);
    const f = filterAnalysis(a, true);
    const kept = f.cards.find((c) => c.color === RED);
    expect(kept?.rows.every((r) => r.status === 'over' || r.status === 'na') ?? true).toBe(true);
    expect(kept?.rows.length ?? 0).toBe(red(a).rows.filter((r) => r.status === 'over' || r.status === 'na').length);
    expect(filterAnalysis(a, false).cards).toBe(a.cards);
    // nothing is changed in the analysis itself
    expect(red(a).rows.map((r) => r.status)).toEqual(statuses);
  });
  it('8. a cable whose load is over stays shown with the filter on, even when every pole is within the limit', () => {
    const { a } = analyse(network({ limit: 150, long: '20' }));
    expect(red(a).rows.every((r) => r.status === 'ok')).toBe(true);
    const f = filterAnalysis(a, true);
    expect(f.cards.map((c) => c.color)).toEqual([RED]); // the blue (all ok, no excess) is hidden
    expect(f.cards[0].rows).toEqual([]);
    expect(f.hidden).toBe(1);
  });
  it('a result that is not available is never taken as within the limit', () => {
    const d = docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 200)], [{ id: 'k', poles: ['T', 'A'], color: RED, revs: [rev(120, 0.32, 250)] }], [sub('u', 'A', RED, 30)], {});
    const a = networkAnalysis(d.elements, voltageView(d));
    expect(a.cards[0].rows.map((r) => r.status)).toEqual(['na']);
    expect(a.cards[0].loadStatus).not.toBe('ok');
    expect(filterAnalysis(a, true).cards.length).toBe(1);
  });
});

describe('network analysis: showing a result on the drawing', () => {
  beforeEach(() => useAnalysisFocus.setState({ open: true, focus: null, canReturn: false, hideOk: false, openCard: 'c1' }));
  it('9. a pole asks the drawing for that pole and its cable; the panel closes and offers the way back, where it was', () => {
    const { a } = analyse(network());
    const row = red(a).rows.find((r) => r.poleId === 'D')!;
    useAnalysisFocus.getState().show({ poleId: row.poleId, spanKeys: [row.feedKey!], color: RED });
    const s = useAnalysisFocus.getState();
    expect(s.focus).toMatchObject({ poleId: 'D', spanKeys: ['br#0'], color: RED });
    expect([s.open, s.canReturn]).toEqual([false, true]);
    const seq = s.focus!.seq;
    useAnalysisFocus.getState().show({ poleId: 'D' }); // the same pole again: a new request
    expect(useAnalysisFocus.getState().focus!.seq).toBe(seq + 1);
    useAnalysisFocus.getState().back();
    expect(useAnalysisFocus.getState()).toMatchObject({ open: true, canReturn: false, openCard: 'c1' });
    // the feeding span of every row is a span of the card's own cables
    for (const r of red(a).rows) expect(red(a).cableIds).toContain(r.feedKey!.split('#')[0]);
  });
});

describe('Network Analysis Report (PDF pages)', () => {
  const pagesOf = (d: ReturnType<typeof network>, locale: 'ar' | 'en' = 'ar') => {
    const { a } = analyse(d);
    return { a, html: reportHtmlPages({ analysis: a, projectName: 'مشروع تجريبي (synthetic)', dateText: '2026-11-07 12:00', locale, text: reportText(locale === 'ar' ? tr : en, a) }) };
  };
  it('10. every result is in the report: each cable, its load and limit, every pole with its drop; excesses marked', () => {
    const { a, html } = pagesOf(network({ limit: 150 }));
    const all = html.join('');
    for (const c of a.cards) {
      for (const r of c.rows) {
        expect(all).toContain(`data-row="${r.poleId}"`);
        expect(all).toContain(`${r.percent!.toFixed(2)} %`);
      }
      if (c.loadA !== undefined) expect(all).toContain(`${c.loadA.toFixed(1)} A`);
    }
    expect(all).toContain('150 A');
    expect(all).toContain(tr('analysis.overSpans'));
    expect(all).toContain('#fef2f2'); // a pole over the limit is shaded
    expect(all).toContain(tr('analysis.unitsTitle'));
    expect(all).toContain('مشروع تجريبي (synthetic)');
    expect(all).toContain('2026-11-07 12:00');
  });
  it('10b. no row is cut: every page holds whole blocks within its height; a table that goes on repeats its header; pages are numbered', () => {
    // a long network: a run of 60 poles
    const n = 60;
    const poles = [pole('T', 0, 0, 'transformer'), ...Array.from({ length: n }, (_, i) => pole(`P${i}`, 0, (i + 1) * 100))];
    const ids = ['T', ...poles.slice(1).map((p) => p.id)];
    const d = docOf(poles, [{ id: 'k', poles: ids, color: RED, revs: Array(n).fill(rev(120, 0.32, 250)) }], poles.slice(1).map((p, i) => sub(`u${i}`, p.id, RED, 2)),
      Object.fromEntries(ids.slice(1).map((id, i) => [`${ids[i]}-${id}`, '30'])));
    const { a } = analyse(d);
    const pages = paginateReport(a);
    for (const p of pages) expect(p.reduce((s, b) => s + blockHeight(b), 0)).toBeLessThanOrEqual(CONTENT_H);
    const rows = pages.flat().filter((b) => b.kind === 'row');
    expect(rows.length).toBe(n); // every pole once
    const tablePages = pages.filter((p) => p.some((b) => b.kind === 'row'));
    expect(tablePages.length).toBeGreaterThan(1);
    for (const p of tablePages) expect(p.findIndex((b) => b.kind === 'tableHead')).toBeLessThan(p.findIndex((b) => b.kind === 'row'));
    expect(tablePages.slice(1).every((p) => p.some((b) => b.kind === 'tableHead' && b.cont))).toBe(true);
    const html = reportHtmlPages({ analysis: a, projectName: 'x', dateText: 'd', locale: 'ar', text: reportText(tr, a) });
    expect(html.length).toBe(pages.length);
    html.forEach((pg, i) => expect(pg).toContain(tr('analysis.page', { i: i + 1, n: html.length })));
    expect(pages[0]).toEqual([{ kind: 'cover' }]);
  });
  it('11. Arabic is written right to left (and English left to right); numbers and pole numbers stay left to right', () => {
    const ar = pagesOf(network()).html;
    expect(ar.every((p) => p.includes('dir="rtl"') && p.includes('lang="ar"'))).toBe(true);
    expect(ar.join('')).toContain('تقرير تحليل الشبكة');
    expect(ar.join('')).toMatch(/<bdi dir="ltr">\d+\.\d{2} %<\/bdi>/);
    const e = pagesOf(network(), 'en').html;
    expect(e.every((p) => p.includes('dir="ltr"'))).toBe(true);
    expect(e.join('')).toContain('Network Analysis Report');
    // text from the project is escaped, never markup
    const { a } = analyse(network());
    const x = reportHtmlPages({ analysis: a, projectName: '<b>x</b>', dateText: 'd', locale: 'ar', text: reportText(tr, a) }).join('');
    expect(x).not.toContain('<b>x</b>');
    expect(x).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('the analysis changes nothing', () => {
  it('12. E2\'s results and the drawing are the same with or without the analysis and its report', () => {
    const d = network({ limit: 150 });
    const before = JSON.stringify(d.elements);
    const strip = (r: unknown) => JSON.stringify(r, (k, x) => (k === 'inputs' ? undefined : x));
    const s0 = strip(runE2Study(d).circuits);
    const view = voltageView(d);
    const a = networkAnalysis(d.elements, view);
    filterAnalysis(a, true);
    reportHtmlPages({ analysis: a, projectName: 'x', dateText: 'd', locale: 'ar', text: reportText(tr, a) });
    expect(JSON.stringify(d.elements)).toBe(before);
    expect(strip(runE2Study(d).circuits)).toBe(s0);
    // the view's values are those E2 gave (read, not changed)
    const v2 = voltageView(d);
    for (const [k, s] of view.bySpan) expect(v2.bySpan.get(k)!.currentA).toEqual(s.currentA);
    for (const [p, l] of view.byPole) expect(v2.byPole.get(p)!.map((x) => x.percent)).toEqual(l.map((x) => x.percent));
    expect((d.elements.find((e) => e.id === 'k') as CableElement).strokeColor).toBe(RED);
  });
});

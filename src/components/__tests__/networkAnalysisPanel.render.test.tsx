import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardView, reportText } from '../NetworkAnalysisPanel';
import { voltageView } from '../../utils/e2Presentation';
import { cardItems, networkAnalysis } from '../../utils/networkAnalysis';
import { reportHtmlPages } from '../../utils/networkReport';
import { translate } from '../../i18n';
import { RED, branched, docOf, pole, rev, sub } from '../../utils/__tests__/networkAnalysis.fixture';

// The analysis panel (static markup, no DOM): the order of the poles and of the branch headings is the
// report's order. Taps and the drawing are checked in a browser. ALL VALUES SYNTHETIC.

const tr = (k: string, p?: Record<string, string | number>) => translate('ar', k as never, p as never);
// a card of the panel as it is shown open (the panel's own component, with the translator)
const renderPanel = (d: ReturnType<typeof branched>, cardOf: (a: ReturnType<typeof networkAnalysis>) => string) => {
  const a = networkAnalysis(d.elements, voltageView(d));
  const card = a.cards.find((c) => c.id === cardOf(a))!;
  return { a, html: renderToStaticMarkup(<CardView card={card} index={0} open onToggle={() => undefined} t={tr as never} />) };
};

describe('analysis panel: the same order as the PDF', () => {
  it('main run, then each branch under «branch from pole …», in the report\'s order', () => {
    const d = branched();
    const { a, html } = renderPanel(d, (x) => x.cards.find((c) => c.color === RED)!.id);
    const card = a.cards.find((c) => c.color === RED)!;
    // the panel's sequence: run headings and pole rows
    const ui = [...html.matchAll(/data-analysis-(?:run="\d+" data-analysis-branch-from="([^"]*)"|row="([^"]+)")/g)].map((m) => (m[2] ?? `[${m[1] || 'main'}]`));
    const expected = cardItems(card).map((it) => (it.kind === 'run' ? `[${it.branchFrom ?? 'main'}]` : it.row.poleId));
    expect(ui).toEqual(expected);
    // the report's pole order is the same
    const pdf = reportHtmlPages({ analysis: a, projectName: 'p', dateText: 'd', locale: 'ar', text: reportText(tr, a) }).join('');
    expect([...pdf.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1])).toEqual(ui.filter((x) => !x.startsWith('[')));
    expect(html).toContain(tr('analysis.branchHead', { p: card.rows.find((r) => r.poleId === 'A')!.tag }));
    expect(html).toContain(tr('analysis.mainRun', { p: 'T1' }));
  });
  it('spans of different types: listed each with its own limit; the card shows «varies by span»', () => {
    const R150 = rev(150, 0.25, 300), R70 = rev(70, 0.55, 120);
    const d = docOf([pole('T', 0, 0, 'transformer'), pole('A', 0, 100), pole('B', 0, 200)], [{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [R150, R70] }],
      [sub('ua', 'A', RED, 20), sub('ub', 'B', RED, 150)], { 'T-A': '50', 'A-B': '50' });
    const { a, html } = renderPanel(d, (x) => x.cards[0].id);
    const c = a.cards[0];
    expect(html).toContain('data-analysis-spans=');
    expect([...html.matchAll(/data-analysis-span="([^"]+)" data-analysis-span-status="([^"]+)"/g)].map((m) => [m[1], m[2]])).toEqual(c.spans.map((s) => [s.key, s.status]));
    expect(c.spans.map((s) => s.status)).toEqual(['ok', 'over']);
    expect(html).toMatch(/data-analysis-limit[^>]*>.*يختلف حسب المقطع/);
    expect(html).not.toMatch(/data-analysis-limit[^>]*><bdi dir="ltr">300 A/);
  });
});

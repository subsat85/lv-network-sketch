import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate, type Locale, type TKey, type TParams } from '../../i18n';
import { E2ResultsView, StatusBadge } from '../E2ResultsPanel';
import { runE2Study, type E2StudyResult } from '../../utils/e2Presentation';
import { fourStatusDoc, networkIssueDoc } from '../../utils/__tests__/e2Fixtures';

// E2 UI integration: RENDERING tests (static markup, no DOM). Interaction (opening the panel,
// expanding a circuit, closing, switching language, mobile layout) is checked in a browser.

const tr = (l: Locale) => (key: TKey, params?: TParams) => translate(l, key, params);
const render = (r: E2StudyResult, elements: ReturnType<typeof fourStatusDoc>['elements'], l: Locale) =>
  renderToStaticMarkup(<E2ResultsView result={r} elements={elements} locale={l} tr={tr(l)} />);
/** the markup of one circuit (its <details> element) */
const circuitHtml = (html: string, id: string) => {
  const start = html.indexOf(`data-e2-circuit="${id}"`);
  const next = html.indexOf('data-e2-circuit="', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
};
const ARABIC = /[؀-ۿ]/;

describe('E2 results: rendering', () => {
  const d = fourStatusDoc();
  const r = runE2Study(d);
  const ids = Object.fromEntries(r.circuits.map((c) => [c.spans[0]?.key.split('#')[0], c.id]));

  it('the study overview: totals by completeness, every status shown with its own label and mark', () => {
    const html = render(r, d.elements, 'ar');
    for (const [k, n] of [['total', 4], ['computed', 1], ['provisional', 1], ['unavailable', 1], ['not-run', 1]] as const)
      expect(html, k).toMatch(new RegExp(`data-e2-count="${k}"[\\s\\S]*?>${n}</p>`));
    for (const s of ['computed', 'provisional', 'unavailable', 'not-run'] as const) expect(html).toContain(`data-e2-status="${s}"`);
    expect(renderToStaticMarkup(<StatusBadge status="provisional" tr={tr('ar')} />)).toContain('≈');
    expect(renderToStaticMarkup(<StatusBadge status="provisional" tr={tr('ar')} />)).toContain('مؤقت');
    expect(renderToStaticMarkup(<StatusBadge status="unavailable" tr={tr('ar')} />)).toContain('غير متاح');
  });

  it('each circuit carries its completeness and, apart, its numerical solve', () => {
    const html = render(r, d.elements, 'ar');
    expect(circuitHtml(html, ids.k1)).toContain('data-e2-completeness="computed" data-e2-solve="computed"');
    expect(circuitHtml(html, ids.k2)).toContain('data-e2-completeness="provisional" data-e2-solve="provisional"');
    // the sweep did not start, the circuit result is unavailable (missing data), not "not run"
    expect(circuitHtml(html, ids.k3)).toContain('data-e2-completeness="unavailable" data-e2-solve="not-run"');
    expect(circuitHtml(html, ids.k4)).toContain('data-e2-completeness="not-run" data-e2-solve="not-run"');
  });

  it('a not-run circuit shows no value and is never shown as calculated', () => {
    const c = circuitHtml(render(r, d.elements, 'ar'), ids.k4);
    expect(c).not.toContain('data-e2-q="computed"');
    expect(c).not.toContain('data-e2-q="provisional"');
    expect(c).not.toMatch(/\d+\.\d+ (V|A|W|var)/);
    expect(c).toContain(translate('ar', 'e2.solveNotStarted'));
    expect(c).toContain(translate('ar', 'e2.reason.parallel-invalid'));
  });

  it('an unavailable value is "—" with its reason, never 0', () => {
    const c = circuitHtml(render(r, d.elements, 'ar'), ids.k3);
    expect(c).toContain('data-e2-q="unavailable"');
    expect(c).not.toMatch(/data-e2-q="unavailable"[^>]*><bdi[^>]*>0/);
    expect(c).toContain(translate('ar', 'e2.reason.phase-allocation-missing'));
    expect(c).not.toMatch(/>0\.00 V</);
  });

  it('a provisional circuit is told apart: its values are marked ≈ and its warnings are listed', () => {
    const c = circuitHtml(render(r, d.elements, 'ar'), ids.k2);
    expect(c).toContain('data-e2-q="provisional"');
    expect(c).toMatch(/≈\d+\.\d+ V/);
    expect(c).toContain('data-e2-warning="source-unknown"');
    expect(c).toContain(translate('ar', 'e2.warning.source-unknown'));
  });

  it('a circuit of several spans: every span, with its cable, poles and inputs', () => {
    const c = circuitHtml(render(r, d.elements, 'ar'), ids.k1);
    expect(c).toContain('data-e2-span="k1#0"');
    expect(c).toContain('data-e2-span="k1#1"');
    expect((c.match(/data-e2-node=/g) ?? []).length).toBe(3);
    expect(c).toContain(translate('ar', 'e2.input.R'));
    expect(c).toContain('0.5 Ω/km');
    expect(c).toContain(translate('ar', 'e2.provenance.project'));
  });

  it('the arithmetic sum is labelled «المجموع الحسابي للتيارات» with its note', () => {
    const html = render(r, d.elements, 'ar');
    expect(html).toContain('المجموع الحسابي للتيارات');
    expect(html).toContain(translate('ar', 'e2.q.arithmeticSumNote'));
    expect(render(r, d.elements, 'en')).toContain('Arithmetic sum of currents');
  });

  it('issues: every issue, with its code, target, source, circuits and fields', () => {
    const html = render(r, d.elements, 'ar');
    expect(html).toContain(`data-e2-issues="${r.issues.length}"`);
    expect(html).toContain('data-e2-issue="parallel-invalid" data-e2-severity="blocks"');
    const n = runE2Study(networkIssueDoc());
    const nh = render(n, networkIssueDoc().elements, 'ar');
    for (const code of ['network:loop', 'network:legacy-jumper']) expect(nh).toContain(`data-e2-issue="${code}"`);
    expect(nh).toContain(translate('ar', 'e2.issue.network.loop'));
    expect(nh).toContain('e1-network');
    expect(nh).toContain('poleIds=A,B,T');
    expect(nh).toContain(n.circuits[0].id);
  });

  it('Arabic is RTL, English LTR; the English page carries no Arabic text', () => {
    const a = render(r, d.elements, 'ar'), e = render(r, d.elements, 'en');
    expect(a).toMatch(/^<div dir="rtl"/);
    expect(e).toMatch(/^<div dir="ltr"/);
    expect(a).toMatch(ARABIC);
    expect(e).not.toMatch(ARABIC);
    // numbers and units keep their own direction inside the Arabic page
    expect(a).toMatch(/<bdi dir="ltr" class="tabular-nums">\d+\.\d+ V<\/bdi>/);
  });

  it('an empty drawing: no circuits, said so', () => {
    const empty = runE2Study({ elements: [], connectionDistances: {}, distanceFlags: {}, electrical: d.electrical });
    expect(render(empty, [], 'ar')).toContain(translate('ar', 'e2.overview.none'));
  });
});

// ---------- Phase "final review": names, reasons once, input problems ----------

/** the text a user reads: no technical details, no attributes */
const visible = (html: string) => html.replace(/<details data-e2-tech[\s\S]*?<\/details>/g, '').replace(/\s[\w-]+="[^"]*"/g, '');
const techOnly = (html: string) => (html.match(/<details data-e2-tech[\s\S]*?<\/details>/g) ?? []).join('\n');
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('E2 results: names, reasons and inputs (rendering)', () => {
  const d = fourStatusDoc();
  const r = runE2Study(d);
  const ids = Object.fromEntries(r.circuits.map((c) => [c.spans[0]?.key.split('#')[0], c.id]));
  const T = (l: Locale) => tr(l);

  it('the user reads names, not ids: no span key, subscriber id, colour code or circuit id outside the technical details', () => {
    for (const l of ['ar', 'en'] as const) {
      const v = visible(render(r, d.elements, l));
      for (const raw of ['k1#0', 'k1#1', 'k4#0', 'uA', 'uC', 'uD', '#ff0000', '#0000ff', 'net:', 'parallel-invalid', 'phase-allocation-missing', 'source-unknown']) expect(v, `${l}: ${raw}`).not.toContain(raw);
    }
    const v = visible(render(r, d.elements, 'ar'));
    // span: its poles, its number and its cable; subscriber: its kind, count and pole
    expect(v).toContain(translate('ar', 'e2.name.span', { from: translate('ar', 'poles.transformer', { n: 4 }), to: translate('ar', 'poles.pole', { n: 4 }), n: 1, cable: 4 }));
    expect(v).toContain(translate('ar', 'e2.name.consumerSingle', { count: 3, pole: translate('ar', 'poles.pole', { n: 3 }) }));
    expect(visible(render(r, d.elements, 'en'))).toContain('Single-phase subscriber ×3 at Pole 3');
  });

  it('the ids and codes stay in the technical details', () => {
    const tech = techOnly(render(r, d.elements, 'ar'));
    for (const raw of ['k1#1', 'k4#0', 'uC', '#ff0000', ids.k4, 'parallel-invalid', 'phase-allocation-missing', 'source-unknown', 'e1-network', 'color=#123456']) expect(tech, raw).toContain(raw);
  });

  it('each reason once per circuit, linked from the values it affects', () => {
    const html = render(r, d.elements, 'ar');
    const notRun = circuitHtml(html, ids.k4);
    expect(count(visible(notRun), translate('ar', 'e2.reason.parallel-invalid'))).toBe(1);
    expect(count(notRun, 'data-e2-group="')).toBe(1);
    expect(notRun).toContain(`href="#e2-c4-r1"`);
    expect(notRun).toContain('id="e2-c4-r1"');
    expect(count(notRun, 'data-e2-ref="1"')).toBeGreaterThanOrEqual(4);
    const unavailable = circuitHtml(html, ids.k3);
    expect(count(visible(unavailable), translate('ar', 'e2.reason.phase-allocation-missing'))).toBe(1);
    // the affected values are listed with the group: the nodes and the span of that circuit
    expect(unavailable).toContain(translate('ar', 'e2.group.affected'));
    expect(visible(unavailable)).toContain(translate('ar', 'poles.pole', { n: 3 }));
  });

  it('an invalid input: its name, "invalid", the value entered and the element', () => {
    const g = circuitHtml(render(r, d.elements, 'ar'), ids.k4);
    expect(g).toMatch(new RegExp(`data-e2-group-input[^>]*><span[^>]*>${translate('ar', 'e2.inputOf.parallel-invalid')}</span> · ${translate('ar', 'e2.group.invalid')}`));
    expect(g).toMatch(/data-e2-group-entered[^>]*><bdi[^>]*>1\.5<\/bdi>/);
    expect(visible(g)).toContain(translate('ar', 'e2.group.element'));
    // and in the span itself, where its inputs are listed
    expect(g).toContain('data-e2-input-problem="parallel-invalid"');
  });

  it('a missing input: its name, "missing", and the subscriber it is about', () => {
    const g = visible(circuitHtml(render(r, d.elements, 'ar'), ids.k3)).replace(/<[^>]+>/g, '');
    expect(g).toContain(`${translate('ar', 'e2.inputOf.phase-allocation-missing')} · ${translate('ar', 'e2.group.missing')}`);
    expect(g).toContain(translate('ar', 'e2.name.consumerSingle', { count: 3, pole: translate('ar', 'poles.pole', { n: 3 }) }));
  });

  it('a computed circuit has no reason section; an element with no value at all is shown as one line', () => {
    const html = render(r, d.elements, 'en');
    expect(circuitHtml(html, ids.k1)).not.toContain('data-e2-groups');
    expect(circuitHtml(html, ids.k4)).toContain('data-e2-no-values="1"');
    expect(T('en')('e2.group.noValues')).toBe('No values for this element');
  });
});

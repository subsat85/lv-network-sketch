import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CableTypeData, CableTypeRevision } from '../../types/cableType';
import { translate, type Locale, type TKey, type TParams } from '../../i18n';
import { createCableType, editCableType, latestRevision, setCableTypeVerification } from '../../utils/cableTypeModel';
import { createCableLibraryController, INITIAL_CABLE_LIBRARY_STATE, type CableLibraryState } from '../../store/cableLibraryStore';
import type { CableLibraryBackend } from '../../utils/cableLibraryStorage';
import { NO_FILTER, type LibraryFilter } from '../../utils/cableLibraryView';
import { useLocale } from '../../store/localeStore';
import { CableTypeDetailsView, LibraryListView, RevisionCompareView, RevisionHistoryView, type ViewCtx } from '../cables/CableTypeViews';
import { CableLibrarySheet } from '../cables/CableLibrarySheet';
import { Toolbar } from '../Toolbar';

// Stage C2: RENDERING tests (static markup, no DOM). The project has no DOM test tools: taps,
// typing in the search field, opening / closing the sheet and the mobile layout are checked in a
// browser (NOT TESTED here). The search / filter logic itself is tested in cableLibraryView.test.ts.
// ALL VALUES ARE SYNTHETIC.

const tr = (l: Locale) => (key: TKey, params?: TParams) => translate(l, key, params);
const ctx = (l: Locale): ViewCtx => ({ tr: tr(l), locale: l });
const noop = () => undefined;
const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz', status: 'unverified' | 'checked' | 'approved' = 'checked', more: object = {}) =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km', basis, verification: { status }, ...more }) as never;
const data = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'ABC 3x70', description: 'overhead feeder', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.443, 'dc', 'checked', { referenceTempC: 20 }), x: v(0.08, 'ac-50hz', 'approved'), rn: v(0.6, 'unspecified', 'unverified'), xn: v(undefined, 'ac-50hz', 'unverified'),
  source: { name: 'maker', page: '12' }, ...o,
});
const T1 = latestRevision(createCableType('t1', data(), { now: Date.UTC(2026, 9, 1, 10) }));
const T2 = latestRevision(createCableType('t2', data({ name: 'UG 4x95', construction: 'underground', description: 'copper', phase: { material: 'cu', sectionMm2: 95 }, neutral: { material: 'cu', sectionMm2: 95 }, r: v(0.2, 'ac', 'approved'), rn: v(0.2, 'ac', 'approved'), xn: v(0.07, 'ac-50hz', 'approved') }), { now: 1 }));
const stateOf = (o: Partial<CableLibraryState>): CableLibraryState => ({ ...INITIAL_CABLE_LIBRARY_STATE, ...o });
const list = (state: CableLibraryState, l: Locale = 'ar', filter: LibraryFilter = NO_FILTER) =>
  renderToStaticMarkup(<LibraryListView state={state} filter={filter} onFilter={noop} onOpen={noop} onRetry={noop} onClose={noop} ctx={ctx(l)} />);
const count = (html: string, s: string) => html.split(s).length - 1;
const ARABIC = /[؀-ۿ]/;

describe('the list', () => {
  it('2 / 1. the list from the store: every cable, its name, construction, conductors, revision, completeness, verification', () => {
    const html = list(stateOf({ status: 'ready', types: [T1, T2] }));
    expect(count(html, 'data-cl-card=')).toBe(2);
    expect(html).toContain('ABC 3x70');
    expect(html).toContain('data-cl-count="2"');
    expect(html).toContain(translate('ar', 'cableLibrary.count', { n: 2 }));
    expect(html).toContain('data-cl-revision="1"');
    expect(html).toContain(translate('ar', 'vd.cableKind.underground'));
    expect(html).toContain(translate('ar', 'cableLibrary.view.conductors', { p: 3, n: 1 }));
    expect(html).toContain('data-cl-completeness="draft"'); // T1 has no Xn
    expect(html).toContain('data-cl-completeness="complete"');
    expect(html).toContain('data-cl-verification="unverified"');
    expect(html).toContain('data-cl-verification="approved"');
    expect(html).not.toContain('data-cl-loading');
  });
  it('3. empty, loading, error with retry, unreadable records (not deleted)', () => {
    expect(list(stateOf({ status: 'empty' }))).toContain('data-cl-empty');
    expect(list(stateOf({ status: 'empty' }))).not.toContain('data-cl-field="search"');
    expect(list(stateOf({ status: 'loading' }))).toContain('data-cl-loading');
    const err = list(stateOf({ status: 'error', error: { operation: 'load', kind: 'read', message: 'x' } }));
    expect(err).toContain('data-cl-error="read"');
    expect(err).toContain('data-cl-action="retry"');
    expect(err).toContain(translate('ar', 'cableLibrary.loadFailed'));
    expect(err).toContain(translate('ar', 'cableLibrary.errors.read'));
    const prob = list(stateOf({ status: 'ready', types: [T1], problems: [{ key: 'type:x', problem: 'id' }] }));
    expect(prob).toContain(translate('ar', 'cableLibrary.unreadable', { n: 1 }));
  });
  it('the list stays while reloading, with a small indicator; a failed reload keeps it too', () => {
    const html = list(stateOf({ status: 'loading', types: [T1] }));
    expect(html).toContain('data-cl-reloading');
    expect(html).toContain('data-cl-card="t1"');
    expect(html).not.toContain('data-cl-loading');
    const failed = list(stateOf({ status: 'error', types: [T1], error: { operation: 'load', kind: 'read', message: '' } }));
    expect(failed).toContain('data-cl-card="t1"');
    expect(failed).toContain('data-cl-action="retry"');
  });
  it('5–9. search and filters applied to the shown list; no results with a way back', () => {
    const s = stateOf({ status: 'ready', types: [T1, T2] });
    const only = (f: Partial<LibraryFilter>) => { const h = list(s, 'ar', { ...NO_FILTER, ...f }); return ['t1', 't2'].filter((id) => h.includes(`data-cl-card="${id}"`)); };
    expect(only({ query: 'feeder' })).toEqual(['t1']);
    expect(only({ constructions: ['underground'] })).toEqual(['t2']);
    expect(only({ completeness: 'draft' })).toEqual(['t1']);
    expect(only({ verification: ['approved'] })).toEqual(['t2']);
    expect(only({ query: 'copper', constructions: ['underground'], verification: ['approved'] })).toEqual(['t2']);
    const none = list(s, 'ar', { ...NO_FILTER, query: 'zzz' });
    expect(none).toContain('data-cl-no-results');
    expect(none).toContain('data-cl-action="clear-filters"');
    expect(none).toContain(translate('ar', 'cableLibrary.view.showing', { shown: 0, total: 2 }));
    // the chosen filters are marked
    const bare = list(s, 'ar', { ...NO_FILTER, constructions: ['bare'] }).match(/<button[^>]*data-cl-filter-construction="bare"[^>]*>/)![0];
    expect(bare).toContain('aria-pressed="true"');
    // the short name on the chip, the full name as its accessible name / title
    expect(bare).toContain(`aria-label="${translate('ar', 'vd.cableKind.bare')}"`);
    expect(list(s, 'ar')).toContain(`>${translate('ar', 'cableLibrary.view.constructionShort.bare')}</button>`);
  });
  it('11 / 12 / 13. the card shows R, X, Rn, Xn apart; a missing value is not 0; a DC value says DC', () => {
    const html = list(stateOf({ status: 'ready', types: [T1] }));
    for (const p of ['r', 'x', 'rn', 'xn']) expect(html).toContain(`data-cl-prop="${p}"`);
    const xn = html.slice(html.indexOf('data-cl-prop="xn"'));
    expect(xn.slice(0, 300)).toContain('data-cl-value="missing"');
    expect(xn.slice(0, 300)).not.toMatch(/>0 Ω\/km/);
    const r = html.slice(html.indexOf('data-cl-prop="r"'), html.indexOf('data-cl-prop="x"'));
    expect(r).toContain('0.443 Ω/km');
    expect(r).toContain('data-cl-basis="dc"');
  });
});

describe('details', () => {
  const details = (t: CableTypeRevision, current: number, l: Locale = 'ar') =>
    renderToStaticMarkup(<CableTypeDetailsView t={t} current={current} ctx={ctx(l)} onBack={noop} onClose={noop} onHistory={noop} />);
  it('10. general information: name, description, construction, conductors, materials, sections, current revision', () => {
    const html = details(T1, 1);
    for (const k of ['name', 'description', 'construction', 'phaseConductors', 'neutralConductors', 'phase.material', 'phase.sectionMm2', 'neutral.material', 'neutral.sectionMm2', 'revision']) expect(html, k).toContain(`data-cl-info="${k}"`);
    expect(html).toContain('overhead feeder');
    expect(html).toContain('54.6 mm²');
    expect(html).toContain(translate('ar', 'span.alloy'));
    expect(html).not.toContain('data-cl-readonly');
  });
  it('11 / 12 / 13. the electrical table: one row per value, basis and reference temperature only as stored, source, verification', () => {
    const html = details(T1, 1);
    const row = (p: string) => { const i = html.indexOf(`data-cl-row="${p}"`); return html.slice(i, html.indexOf('data-cl-row=', i + 12) > 0 ? html.indexOf('data-cl-row=', i + 12) : undefined); };
    expect(row('r')).toContain('0.443 Ω/km');
    expect(row('r')).toContain(translate('ar', 'cableLibrary.basis.dc'));
    expect(row('r')).toContain(translate('ar', 'cableLibrary.basis.refTemp', { t: '\u206620°C\u2069' }));
    expect(row('r')).not.toContain(translate('ar', 'cableLibrary.basis.ac'));
    expect(row('rn')).toContain(translate('ar', 'cableLibrary.basis.unspecified'));
    expect(row('rn')).toContain(translate('ar', 'cableLibrary.basis.refTempUnspecified'));
    expect(row('rn')).not.toMatch(/(20|70|90)°C/);
    expect(row('x')).toContain(translate('ar', 'cableLibrary.basis.ac-50hz'));
    expect(row('xn')).toContain('data-cl-entered="no"');
    expect(row('xn')).toContain(translate('ar', 'cableLibrary.view.missing'));
    expect(row('xn')).not.toMatch(/>0 Ω\/km/);
    expect(row('r')).toContain('data-cl-source="type"');
    expect(row('r')).toContain('maker');
    expect(row('x')).toContain('data-cl-verification="approved"');
    expect(row('rn')).toContain('data-cl-verification="unverified"');
  });
  it('a stored conversion request is shown as not applied; an earlier revision is marked read only', () => {
    const conv = latestRevision(createCableType('c', data({ r: v(0.443, 'dc', 'checked', { referenceTempC: 20, conversion: 'dc20-to-conductor-temp' }) }), { now: 1 }));
    expect(details(conv, 1)).toContain('data-cl-conversion');
    expect(details(T1, 3)).toContain('data-cl-readonly');
    expect(details(T1, 3)).toContain(translate('ar', 'cableLibrary.view.currentRevision', { n: 3 }));
  });
});

describe('revision history and comparison', () => {
  const h1 = createCableType('ct', data(), { now: Date.UTC(2026, 9, 1, 10), by: 'eng A' });
  const h2 = editCableType(h1, { r: { value: 0.5, unit: 'ohm/km', basis: 'ac' }, xn: { value: 0.09, unit: 'ohm/km', basis: 'ac-50hz' } }, { now: Date.UTC(2026, 9, 2, 10), note: 'from the new sheet' }).history;
  const h3 = setCableTypeVerification(h2, 'x', { status: 'checked' }, { now: Date.UTC(2026, 9, 3, 10) }).history;
  const history = (l: Locale = 'ar') => renderToStaticMarkup(<RevisionHistoryView name="ABC" revisions={h3.revisions} ctx={ctx(l)} onOpenRevision={noop} onCompare={noop} onRetry={noop} onBack={noop} onClose={noop} />);
  it('every revision: number, date from the record, name, author / note only when stored, changes, verification per value', () => {
    const html = history('en');
    expect(html.indexOf('data-cl-rev="3"')).toBeLessThan(html.indexOf('data-cl-rev="1"'));
    expect(count(html, 'data-cl-rev-date')).toBe(3);
    expect(html).toContain('2026');
    expect(count(html, 'data-cl-rev-by')).toBe(1);
    expect(html).toContain('eng A');
    expect(count(html, 'data-cl-rev-note')).toBe(1);
    expect(html).toContain('from the new sheet');
    expect(html).toContain(translate('en', 'cableLibrary.view.firstRevision'));
    expect(html).toContain(translate('en', 'cableLibrary.view.changed', { list: translate('en', 'cableLibrary.field.verificationOf', { p: 'X' }) }));
    expect(count(html, 'data-cl-badge="r"')).toBe(3);
    expect(count(html, 'data-cl-open=')).toBe(3);
    expect(html).toContain('data-cl-action="compare"');
  });
  it('14. an earlier revision opens with its own data, read only', () => {
    const html = renderToStaticMarkup(<CableTypeDetailsView t={h3.revisions[0]} current={3} ctx={ctx('ar')} onBack={noop} onClose={noop} />);
    expect(html).toContain('data-cl-revision="1"');
    expect(html).toContain('data-cl-readonly');
    expect(html).toContain('0.443 Ω/km');
    expect(html).not.toContain('data-cl-action="history"');
  });
  it('15. two revisions compared: added / changed / removed, unchanged rows on request', () => {
    const cmp = (show: boolean) => renderToStaticMarkup(<RevisionCompareView revisions={h3.revisions} from={1} to={3} showUnchanged={show} ctx={ctx('ar')} onChange={noop} onShowUnchanged={noop} onBack={noop} onClose={noop} />);
    const html = cmp(false);
    expect(html).toContain('data-cl-diff="r" data-cl-diff-status="changed"');
    expect(html).toContain('data-cl-diff="xn" data-cl-diff-status="added"');
    expect(html).toContain('data-cl-diff="x.verification" data-cl-diff-status="changed"');
    expect(html).not.toContain('data-cl-diff-status="unchanged"');
    expect(cmp(true)).toContain('data-cl-diff="name" data-cl-diff-status="unchanged"');
    const back = renderToStaticMarkup(<RevisionCompareView revisions={h3.revisions} from={3} to={1} showUnchanged={false} ctx={ctx('ar')} onChange={noop} onShowUnchanged={noop} onBack={noop} onClose={noop} />);
    expect(back).toContain('data-cl-diff="xn" data-cl-diff-status="removed"');
  });
});

describe('the sheet, the toolbar, both languages', () => {
  afterEach(() => useLocale.getState().setLocale('ar'));
  const memory = (): CableLibraryBackend & { writes: number } => {
    const data = new Map<string, unknown>();
    const b = { writes: 0, get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, x: unknown) => { b.writes++; data.set(k, structuredClone(x)); }, keys: async () => [...data.keys()] };
    return b;
  };
  it('17. RTL in Arabic and LTR in English; every visible text from the dictionary', () => {
    const c = createCableLibraryController({ backend: memory() });
    const ar = renderToStaticMarkup(<CableLibrarySheet onClose={noop} controller={c} />);
    expect(ar).toContain('dir="rtl"');
    expect(ar).toContain(translate('ar', 'cableLibrary.title'));
    // (a static render reads zustand's initial language; the sheet's dir comes from directionOf(locale))
    expect(readFileSync(resolve(__dirname, '../cables/CableLibrarySheet.tsx'), 'utf8')).toContain('dir={directionOf(locale)}');
    // the views follow the language they are given: English texts, LTR back arrow; Arabic, RTL back arrow
    const enDetails = renderToStaticMarkup(<CableTypeDetailsView t={T1} current={1} ctx={ctx('en')} onBack={noop} onClose={noop} />);
    const arDetails = renderToStaticMarkup(<CableTypeDetailsView t={T1} current={1} ctx={ctx('ar')} onBack={noop} onClose={noop} />);
    expect(enDetails).toContain('lucide-chevron-left');
    expect(arDetails).toContain('lucide-chevron-right');
    expect(enDetails).not.toMatch(ARABIC);
    expect(list(stateOf({ status: 'ready', types: [T1, T2] }), 'en')).not.toMatch(ARABIC);
    expect(list(stateOf({ status: 'ready', types: [T1, T2] }), 'en')).toContain('Cable Library');
    for (const f of ['CableTypeViews.tsx', 'CableLibrarySheet.tsx']) {
      const code = readFileSync(resolve(__dirname, '../cables', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, f).not.toMatch(/[؀-ۿ]/);
      expect(code, f).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
    }
  });
  it('1 / 16. opening the sheet reads the list only — nothing is written to the library', async () => {
    const b = memory();
    const c = createCableLibraryController({ backend: b });
    await c.create(data());
    const before = b.writes;
    renderToStaticMarkup(<CableLibrarySheet onClose={noop} controller={c} />);
    await c.load();
    await c.history((c.store.getState().types[0]).id);
    await c.revision(c.store.getState().types[0].id, 1);
    expect(b.writes).toBe(before);
  });
  it('1 / 18. the toolbar: one more button at the end of the info group; every other button in its place; no sheet until pressed', () => {
    const html = renderToStaticMarkup(<Toolbar />);
    const order = [...html.matchAll(/data-toolbar-tool="([\w]+)"/g)].map((m) => m[1]);
    // (the statistics / load report button was removed from the toolbar: removedTools.test.tsx)
    expect(order).toEqual(['projects', 'share', 'fullScreen', 'select', 'cable', 'cable_straight', 'transformer', 'voltageDrop', 'cableLibrary', 'deleteSelected']);
    expect(html).toContain(`aria-label="${translate('ar', 'toolbar.cableLibrary')}"`);
    expect(html).not.toContain('data-cable-library');
    const code = readFileSync(resolve(__dirname, '../Toolbar.tsx'), 'utf8');
    expect(code).toContain("onClick: () => setShowCableLibrary(true)");
    expect(code).toContain('{showCableLibrary && <CableLibrarySheet onClose={() => setShowCableLibrary(false)} />}');
  });
});

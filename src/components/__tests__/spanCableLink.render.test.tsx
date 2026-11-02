import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CableTypeData, CableTypeRevision, SpanCableType } from '../../types/cableType';
import type { CableLibraryState } from '../../store/cableLibraryStore';
import { translate, directionOf, type Locale } from '../../i18n';
import { assignCableType, createCableType, latestRevision, setCableTypeOverride } from '../../utils/cableTypeModel';
import type { LinkRecordState } from '../../utils/spanCableLink';
import { SpanCablePicker, SpanCableSection } from '../cables/SpanCableLink';
import type { ViewCtx } from '../cables/CableTypeViews';

// Stage C4: the span's library cable in the span sheet, and the picker — rendered in Arabic and
// English. ALL VALUES ARE SYNTHETIC.

const ctxOf = (locale: Locale): ViewCtx => ({ locale, tr: (k, p) => translate(locale, k, p) });
const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz') =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status: 'unverified' } }) as never;
const data = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'ABC 3x70 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.443, 'dc'), x: v(0, 'ac-50hz'), rn: v(0.63, 'unspecified'), xn: v(undefined, 'ac-50hz'), source: { name: 'synthetic sheet' }, ...o,
});
const REV = latestRevision(createCableType('ct_r1', data(), { now: 1 }));
const UG = latestRevision(createCableType('ct_ug', data({ name: 'UG 4x95 (synthetic)', construction: 'underground', r: v(0.32, 'ac'), rn: v(0.32, 'ac'), xn: v(0.07, 'ac-50hz') }), { now: 2 }));
const link: SpanCableType = assignCableType({ poles: ['A', 'B'] }, REV, 3).cableType!;
const section = (locale: Locale, o: { link?: SpanCableType; record?: LinkRecordState; conflict?: boolean } = {}) =>
  renderToStaticMarkup(<div dir={directionOf(locale)}><SpanCableSection link={'link' in o ? o.link : link} record={o.record ?? { kind: 'current' }} conflict={!!o.conflict} ctx={ctxOf(locale)} onChoose={() => undefined} onUnlink={() => undefined} /></div>);
const lib = (types: CableTypeRevision[]): CableLibraryState => ({ status: types.length ? 'ready' : 'empty', types, problems: [], saving: false });
const picker = (locale: Locale, o: { preview?: CableTypeRevision; linked?: SpanCableType } = {}) =>
  renderToStaticMarkup(<div dir={directionOf(locale)}><SpanCablePicker state={lib([REV, UG])} linked={o.linked} ctx={ctxOf(locale)} check={async () => ({ ok: false, reason: 'failed' })} onLink={() => undefined} onRetry={() => undefined} onBack={() => undefined} {...(o.preview ? { initial: { preview: o.preview } } : {})} /></div>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ARABIC = /[؀-ۿ]/;

describe('C4 3, 13: the linked cable in the span sheet', () => {
  it('3. a span with a link shows its cable from the snapshot: name, linked revision, values, basis, status', () => {
    for (const locale of ['ar', 'en'] as const) {
      const h = section(locale);
      expect(h).toContain('data-span-cable="linked"');
      expect(h).toContain(`data-span-cable-type="${REV.id}"`);
      expect(h).toContain('data-span-cable-linked-revision="1"');
      expect(text(h)).toContain(translate(locale, 'spanCable.linkedRevision', { n: 1 }));
      expect(h).toContain('ABC 3x70 (synthetic)');
      // R 0.443 DC, X = 0 entered (not missing), Rn basis not stated, Xn not entered (never 0)
      expect(h).toMatch(/data-span-cable-prop="r" data-entered="yes"/);
      expect(h).toMatch(/data-span-cable-prop="x" data-entered="yes"/);
      expect(h).toMatch(/data-span-cable-prop="xn" data-entered="no"/);
      expect(h).toContain('0 Ω/km');
      expect(h).toContain('data-span-cable-basis="dc"');
      expect(h).toContain('data-span-cable-basis="unspecified"');
      expect(h).toContain('data-span-cable-basis="ac-50hz"');
      expect(h).toContain('data-cl-completeness="draft"');
      expect(h).toContain('data-cl-verification="unverified"');
      expect(text(h)).toContain(translate(locale, 'spanCable.missingValues', { list: 'Xn' }));
      expect(text(h)).toContain(translate(locale, 'spanCable.dc', { p: 'R' }));
      expect(h).toContain('data-span-cable-action="change"');
      expect(h).toContain('data-span-cable-action="unlink"');
    }
  });
  it('13. the E1 / E2 data-source notice is shown for a linked span, in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      const h = section(locale);
      expect(h).toContain('data-span-cable-note="engines"');
      const t = translate(locale, 'spanCable.engines');
      expect(text(h)).toContain(t);
      // it names both engines and both sources, and never says one engine reads the other's data
      expect(t).toMatch(/E1/);
      expect(t).toMatch(/E2/);
      expect(t).toMatch(/Snapshot|snapshot/);
    }
    expect(translate('en', 'spanCable.engines')).toMatch(/does not read the other's data/);
    expect(translate('ar', 'spanCable.engines')).toMatch(/لا يقرأ بيانات الآخر/);
    // no link: no such notice
    expect(section('ar', { link: undefined })).not.toContain('data-span-cable-note="engines"');
  });
  it('7, 8. the record notices: a newer revision (not applied), not on this device, unreadable library', () => {
    for (const locale of ['ar', 'en'] as const) {
      expect(text(section(locale, { record: { kind: 'newer', latest: 3 } }))).toContain(translate(locale, 'spanCable.newer', { n: 3, m: 1 }));
      expect(section(locale, { record: { kind: 'missing' } })).toContain('data-span-cable-record="missing"');
      expect(section(locale, { record: { kind: 'unknown' } })).toContain('data-span-cable-record="unknown"');
      expect(section(locale, { record: { kind: 'ahead', latest: 0 } })).toContain('data-span-cable-record="ahead"');
      expect(section(locale)).not.toContain('data-span-cable-record');
    }
  });
  it('a span without a link: «not linked» and the choose button; an unresolved merge says to choose', () => {
    for (const locale of ['ar', 'en'] as const) {
      const h = section(locale, { link: undefined });
      expect(h).toContain('data-span-cable="none"');
      expect(text(h)).toContain(translate(locale, 'spanCable.notLinked'));
      expect(h).toContain('data-span-cable-action="choose"');
      expect(section(locale, { link: undefined, conflict: true })).toContain('data-span-cable-note="conflict"');
    }
  });
  it('a project override is marked', () => {
    const o = setCableTypeOverride({ poles: ['A', 'B'], cableType: link }, 'xn', v(0.09, 'ac-50hz')).cableType!;
    expect(section('en', { link: o })).toContain('data-span-cable-overridden');
  });
});

describe('C4 1, 14: the picker', () => {
  it('the list: name, construction, conductors, material and section, R/X/Rn/Xn in Ω/km with the R / Rn basis, completeness, verification, revision', () => {
    for (const locale of ['ar', 'en'] as const) {
      const h = picker(locale);
      const c = ctxOf(locale);
      expect(h).toContain('data-span-cable-picker="list"');
      expect(text(h)).toContain(translate(locale, 'spanCable.pickTitle'));
      expect(h).toContain('data-cl-field="search"');
      expect(h).toContain('data-cl-filters');
      expect(h).toContain(`data-cl-card="${REV.id}"`);
      expect(h).toContain(`data-cl-card="${UG.id}"`);
      expect(text(h)).toContain(c.tr('cableLibrary.view.conductors', { p: 3, n: 1 }));
      expect(h).toContain('data-cl-conductor="phase"');
      expect(h).toContain('70 mm²');
      expect(h).toContain('Ω/km');
      // R / Rn: AC, DC or not stated — X / Xn have no basis choice shown (AC 50 Hz always)
      expect(h).toContain('data-cl-basis="dc"');
      expect(h).toContain('data-cl-basis="unspecified"');
      expect(h).toContain('data-cl-basis="ac"');
      expect(h).not.toContain('data-cl-basis="ac-50hz"');
      expect(text(h)).toContain(translate(locale, 'spanCable.basisShort.unspecified'));
      expect(h).toContain('data-cl-completeness="draft"');
      expect(h).toContain('data-cl-completeness="complete"');
      expect(h).toContain('data-cl-verification="unverified"');
      expect(h).toContain('data-cl-revision="1"');
      expect(h).toContain('data-cl-action="back"');
      expect(h).not.toContain('data-cl-action="add"'); // no library editing from the span
    }
  });
  it('the linked cable is marked in the list', () => {
    const h = picker('en', { linked: link });
    expect(h).toMatch(new RegExp(`data-cl-card="${REV.id}" data-cl-linked=""`));
    expect(h).not.toMatch(new RegExp(`data-cl-card="${UG.id}" data-cl-linked`));
  });
  it('the preview before the link: the full details, the revision that will be linked, the link button', () => {
    for (const locale of ['ar', 'en'] as const) {
      const h = picker(locale, { preview: UG });
      expect(h).toContain('data-span-cable-picker="preview"');
      expect(h).toContain('data-cl-view="details"');
      expect(h).toContain('data-cl-electrical');
      expect(text(h)).toContain(translate(locale, 'spanCable.linkRevision', { n: 1 }));
      expect(h).toMatch(/<button type="button" class="[^"]*" data-span-cable-action="link"/);
      expect(h).not.toContain('data-cl-action="edit"');
    }
    // the revision already linked cannot be linked again
    const same = picker('en', { preview: REV, linked: link });
    expect(same).toContain('data-span-cable-same');
    expect(same).toMatch(/disabled="" class="[^"]*" data-span-cable-action="link"/);
  });
  it('14. Arabic is RTL with Arabic text, English LTR with no Arabic letters', () => {
    for (const h of [picker('ar'), picker('ar', { preview: UG }), section('ar'), section('ar', { link: undefined })]) {
      expect(h.startsWith('<div dir="rtl">')).toBe(true);
      expect(text(h)).toMatch(ARABIC);
    }
    for (const h of [picker('en'), picker('en', { preview: UG }), section('en', { record: { kind: 'newer', latest: 2 } }), section('en', { link: undefined, conflict: true })]) {
      expect(h.startsWith('<div dir="ltr">')).toBe(true);
      expect(text(h)).not.toMatch(ARABIC);
    }
  });
  it('no visible text is written into the code of the C4 component', () => {
    const c = readFileSync(join(__dirname, '..', 'cables', 'SpanCableLink.tsx'), 'utf8');
    expect(c).not.toMatch(ARABIC);
    expect(c).not.toMatch(/(aria-label|title|placeholder)="[^"]*[A-Za-z]/);
    expect(c).not.toMatch(/[^=]>\s*[A-Z][a-z]+( [A-Za-z]+)*\s*</); // (an arrow's «=> Promise<…>» is code, not text)
  });
});

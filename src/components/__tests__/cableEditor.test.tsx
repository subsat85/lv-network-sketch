import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// the projects' IndexedDB (in memory), to show the library editor never touches it
const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return { data, api: {
    get: async (k: string) => clone(data.get(k)), set: async (k: string, v: unknown) => { data.set(k, clone(v)); }, del: async (k: string) => { data.delete(k); },
    setMany: async (e: [string, unknown][]) => { for (const [k, v] of e) data.set(k, clone(v)); }, keys: async () => [...data.keys()],
    createStore: () => { throw new Error('no real IndexedDB in tests'); },
  } };
});
vi.mock('idb-keyval', () => idb.api);

import { translate, type Locale, type TKey, type TParams } from '../../i18n';
import type { CableLibraryBackend } from '../../utils/cableLibraryStorage';
import { openCableLibrary } from '../../utils/cableLibraryStorage';
import { createCableLibraryController, INITIAL_CABLE_LIBRARY_STATE } from '../../store/cableLibraryStore';
import { cableFormFrom, emptyCableForm, readCableForm, type CableForm } from '../../utils/cableTypeForm';
import { saveProject, loadProject } from '../../utils/projectStorage';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';
import { CableTypeEditor, saveCableForm } from '../cables/CableTypeEditor';
import { CableTypeDetailsView, LibraryListView, type ViewCtx } from '../cables/CableTypeViews';
import { NO_FILTER } from '../../utils/cableLibraryView';

// Stage C3: adding and editing cable types. The save is tested through the real library functions
// (in-memory IndexedDB stand-in); the form is rendered as static markup (no DOM: typing and taps are
// checked in a browser, separately). ALL VALUES ARE SYNTHETIC.

const memory = () => {
  const data = new Map<string, unknown>();
  const b: CableLibraryBackend = { get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k, v) => { data.set(k, structuredClone(v)); }, keys: async () => [...data.keys()] };
  return { data, b };
};
let ids = 0;
const controller = (b: CableLibraryBackend) => createCableLibraryController({ backend: b, now: () => 1_000 + ids, newId: () => `ct_e${++ids}` });
const tr = (l: Locale) => (key: TKey, params?: TParams) => translate(l, key, params);
const ctx = (l: Locale): ViewCtx => ({ tr: tr(l), locale: l });
const noop = () => undefined;
const filled = (o: Partial<CableForm> = {}): CableForm => {
  const f = emptyCableForm();
  return { ...f, name: 'ABC 3x70 (synthetic)', construction: 'abc', phaseConductors: '3', neutralConductors: '1', phaseMaterial: 'al', phaseSection: '70', neutralMaterial: 'alloy', neutralSection: '54.6', sourceName: 'maker',
    r: { ...f.r, value: '0.443', basis: 'dc', referenceTempC: '20' }, x: { ...f.x, value: '0.08' }, rn: { ...f.rn, value: '0.6' }, xn: { ...f.xn, value: '0.09' }, ...o };
};
const data = (f: CableForm) => { const r = readCableForm(f); expect(r.errors).toEqual([]); return r.data!; };

describe('saving through the library', () => {
  it('creates a complete cable: revision 1, every value as entered (DC kept, no temperature added)', async () => {
    const { b } = memory();
    const c = controller(b);
    const out = await saveCableForm(c, undefined, data(filled()), 'first entry');
    expect(out).toMatchObject({ ok: true, revision: 1 });
    const t = c.store.getState().types[0];
    expect(t).toMatchObject({ revision: 1, changeNote: 'first entry', r: { value: 0.443, basis: 'dc', referenceTempC: 20 }, rn: { value: 0.6, basis: 'unspecified' } });
    expect('referenceTempC' in t.rn).toBe(false);
    expect(c.store.getState().status).toBe('ready');
  });
  it('creates a draft: missing values stay undefined; X = 0 is kept', async () => {
    const { b } = memory();
    const c = controller(b);
    const f = filled({ sourceName: '' });
    await saveCableForm(c, undefined, data({ ...f, r: { ...f.r, value: '' }, x: { ...f.x, value: '0' }, xn: { ...f.xn, value: '' } }), '');
    const t = c.store.getState().types[0];
    expect(['value' in t.r, t.x.value, 'value' in t.xn]).toEqual([false, 0, false]);
    expect(t.changeNote).toBeUndefined();
  });
  it('an edit is a new revision; the earlier one stays exactly as it was', async () => {
    const { b } = memory();
    const c = controller(b);
    const first = await saveCableForm(c, undefined, data(filled()), '');
    const r1 = c.store.getState().types[0];
    const f = cableFormFrom(r1);
    const out = await saveCableForm(c, r1, data({ ...f, name: 'renamed (synthetic)', r: { ...f.r, value: '0.5', basis: 'ac', referenceTempC: '' } }), 'new sheet');
    expect(out).toEqual({ ok: true, id: first.ok ? first.id : '', revision: 2 });
    const h = await c.history(r1.id);
    expect(h.revisions).toHaveLength(2);
    expect(h.revisions[0]).toEqual(r1);
    expect(h.revisions[1]).toMatchObject({ name: 'renamed (synthetic)', changeNote: 'new sheet', r: { value: 0.5, basis: 'ac', verification: { status: 'unverified' } } });
    expect(c.store.getState().types[0].revision).toBe(2);
  });
  it('a verification the person sets is saved as its own revision, on the one before it', async () => {
    const { b } = memory();
    const c = controller(b);
    await saveCableForm(c, undefined, data(filled()), '');
    const r1 = c.store.getState().types[0];
    const f = cableFormFrom(r1);
    const out = await saveCableForm(c, r1, data({ ...f, rn: { ...f.rn, value: '0.62' }, x: { ...f.x, status: 'checked', verifiedBy: 'eng' } }), '');
    expect(out).toMatchObject({ ok: true, revision: 3 });
    const h = await c.history(r1.id);
    expect(h.revisions.map((r) => [r.revision, r.rn.value, r.x.verification.status])).toEqual([[1, 0.6, 'unverified'], [2, 0.62, 'unverified'], [3, 0.62, 'checked']]);
  });
  it('an edit made on a revision that is no longer the current one: a conflict, nothing written over', async () => {
    const { b } = memory();
    const c = controller(b);
    await saveCableForm(c, undefined, data(filled()), '');
    const r1 = c.store.getState().types[0];
    await openCableLibrary({ backend: b, now: () => 9 }).edit(r1.id, 1, { name: 'changed elsewhere' });
    const f = cableFormFrom(r1);
    const out = await saveCableForm(c, r1, data({ ...f, name: 'mine' }), '');
    expect(out).toEqual({ ok: false, kind: 'conflict' });
    expect((await c.history(r1.id)).revisions.map((r) => r.name)).toEqual(['ABC 3x70 (synthetic)', 'changed elsewhere']);
  });
  it('reopening the library (a new store on the same database) shows what was saved', async () => {
    const { b } = memory();
    await saveCableForm(controller(b), undefined, data(filled({ x: { ...emptyCableForm().x, value: '0' } })), '');
    const again = controller(b);
    await again.load();
    expect(again.store.getState().types).toHaveLength(1);
    expect(again.store.getState().types[0].x.value).toBe(0);
  });
  it('the editor never touches project data, and an old project reads back unchanged', async () => {
    const project = { id: 'old', name: 'old', createdAt: 1, updatedAt: 2, data: { elements: [], style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle' as const, electrical: DEFAULT_ELECTRICAL } };
    await saveProject(project);
    const before = JSON.stringify([...idb.data.entries()]);
    const { b } = memory();
    const c = controller(b);
    const out = await saveCableForm(c, undefined, data(filled()), '');
    const t = c.store.getState().types[0];
    await saveCableForm(c, t, data({ ...cableFormFrom(t), name: 'x (synthetic)' }), '');
    expect(out.ok).toBe(true);
    expect(JSON.stringify([...idb.data.entries()])).toBe(before);
    expect((await loadProject('old'))!.data).toEqual(project.data);
  });
});

describe('the form, rendered', () => {
  const editor = (l: Locale, o: Partial<React.ComponentProps<typeof CableTypeEditor>> = {}) =>
    renderToStaticMarkup(<CableTypeEditor controller={createCableLibraryController({ backend: memory().b })} ctx={ctx(l)} onCancel={noop} onClose={noop} onSaved={noop} onReloadLatest={noop} {...o} />);
  it('a new cable: every section, R / X / Rn / Xn apart with their unit; no field holds a value', () => {
    const html = editor('ar');
    for (const k of ['general', 'conductors', 'source', 'r', 'x', 'rn', 'xn', 'note']) expect(html, k).toContain(`data-ce-section="${k}"`);
    expect(html.match(/Ω\/km/g)!.length).toBe(4);
    expect(html.match(/°C/g)!.length).toBeGreaterThanOrEqual(2);
    for (const m of html.matchAll(/<input[^>]*type="text"[^>]*>/g)) expect(m[0], m[0]).toMatch(/value=""/);
    expect(html).toContain('data-ce-fixed-basis="x"');
    expect(html).toContain('data-ce-fixed-basis="xn"');
    expect(html).toContain(translate('ar', 'cableLibrary.add'));
    expect(html).toContain(translate('ar', 'cableLibrary.editor.emptyHint'));
    expect(html).toContain(translate('ar', 'cableLibrary.editor.xZeroHint'));
    // the selects of a new cable offer «choose», nothing chosen for the person
    expect(html).toMatch(/data-ce-input="construction"[^>]*>(<option value=""[^>]*selected|<option value="")/);
  });
  it('an edit: the stored values in the fields, the revision it is made on, Arabic RTL / English LTR texts', async () => {
    const { b } = memory();
    const c = controller(b);
    await saveCableForm(c, undefined, data(filled()), '');
    const t = c.store.getState().types[0];
    const ar = editor('ar', { prev: t });
    expect(ar).toContain(`data-ce-expected="1"`);
    expect(ar).toContain('value="0.443"');
    expect(ar).toContain(translate('ar', 'cableLibrary.edit'));
    const en = editor('en', { prev: t });
    expect(en).not.toMatch(/[؀-ۿ]/);
    expect(en).toContain('Edit cable data');
    expect(en).toContain('lucide-chevron-left');
    expect(ar).toContain('lucide-chevron-right');
  });
  it('no neutral: the neutral material / section are not asked; Rn and Xn say they are not needed', () => {
    const html = editor('ar', { initial: filled({ neutralConductors: '0' }) });
    expect(html).not.toContain('data-ce-field="neutralMaterial"');
    expect(html).toContain('data-ce-no-neutral="rn"');
    expect(html).toContain('data-ce-no-neutral="xn"');
    expect(editor('ar', { initial: filled() })).toContain('data-ce-field="neutralMaterial"');
  });
  it('the way in: «add» in the list (and on an empty library), «edit» on the current revision only', () => {
    const t = { ...readCableForm(filled()).data!, id: 't', revision: 2, typeCreatedAt: 1, revisionCreatedAt: 2 };
    const list = (status: 'ready' | 'empty') => renderToStaticMarkup(<LibraryListView state={{ ...INITIAL_CABLE_LIBRARY_STATE, status, types: status === 'ready' ? [t] : [] }} filter={NO_FILTER} onFilter={noop} onOpen={noop} onRetry={noop} onClose={noop} onAdd={noop} ctx={ctx('ar')} />);
    expect(list('ready')).toContain('data-cl-action="add"');
    expect(list('empty')).toContain('data-cl-action="add-first"');
    expect(renderToStaticMarkup(<CableTypeDetailsView t={t} current={2} ctx={ctx('ar')} onBack={noop} onClose={noop} onEdit={noop} />)).toContain('data-cl-action="edit"');
    expect(renderToStaticMarkup(<CableTypeDetailsView t={{ ...t, revision: 1 }} current={2} ctx={ctx('ar')} onBack={noop} onClose={noop} onEdit={noop} />)).not.toContain('data-cl-action="edit"');
  });
});

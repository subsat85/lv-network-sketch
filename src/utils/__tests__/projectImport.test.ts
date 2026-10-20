import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory IndexedDB stand-in (idb-keyval API). setMany is all-or-nothing like a
// real IDB transaction; `failNextWrite` makes the next write throw before anything lands.
const db = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const state = { failNextWrite: false as false | Error, failOnCall: 0, calls: 0, writes: [] as string[] };
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  const guard = () => { state.calls++; if (state.failOnCall && state.calls === state.failOnCall) throw new Error('write failed mid-way'); if (state.failNextWrite) { const e = state.failNextWrite; state.failNextWrite = false; throw e; } };
  return {
    data, state,
    api: {
      get: async (k: string) => clone(data.get(k)),
      set: async (k: string, v: unknown) => { guard(); state.writes.push(k); data.set(k, clone(v)); },
      del: async (k: string) => { guard(); state.writes.push(`del:${k}`); data.delete(k); },
      setMany: async (entries: [string, unknown][]) => { guard(); for (const [k, v] of entries) { state.writes.push(k); data.set(k, clone(v)); } },
    },
  };
});
vi.mock('idb-keyval', () => db.api);

import { useDrawingStore } from '../../store/drawingStore';
import { planImport, applyImport, copyName, DEFAULT_IMPORT_NAME, ImportPlan } from '../projectImport';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { saveProject, getProjectsMeta, loadProject, META_KEY } from '../projectStorage';
import { startAutosave, DRAFT_KEY, AutosaveHandle } from '../autosave';
import type { DrawingElement } from '../../types/drawing';

// ---- fixtures -----------------------------------------------------------------
const pole = (id: string, x = 0, y = 0) => ({ id, type: 'symbol', symbolId: 'lv_pole', x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 });
const cable = (id: string, poleIds: string[]) => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: '#f00', fillColor: 'transparent', strokeWidth: 2 });
const consumer = (id: string, poleId: string) => ({ id, type: 'consumer', x: 5, y: 5, poleId, color: '#000', count: 1, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, variant: 'circle', label: '' });

const validFile = (over: Record<string, unknown> = {}) => ({
  version: 1,
  elements: [pole('A', 0, 0), pole('B', 200, 0), pole('C', 400, 0), cable('c1', ['A', 'B', 'C']), consumer('k1', 'B')],
  style: { strokeColor: '#123456', fillColor: 'transparent', strokeWidth: 3, fontSize: 18 },
  poleSizeScale: 1.2, distanceTextScale: 1.1, consumerSizeScale: 0.9, consumerVariant: 'square',
  connectionDistances: { A_B: '25', B_C: '30' },
  connectionLabelOffsets: { A_B: { x: 3, y: -4 } },
  metadata: { id: 'P1', name: 'Line 7', exportedAt: 5000 },
  ...over,
});
const json = (o: unknown) => JSON.stringify(o);

// The drawing that is on the canvas before an import.
const currentDrawing = () => {
  const s = useDrawingStore.getState();
  s.addElement(pole('OLD1', 10, 10) as DrawingElement);
  s.addElement(pole('OLD2', 90, 10) as DrawingElement);
  s.addElement(cable('oldc', ['OLD1', 'OLD2']) as DrawingElement);
  s.updateConnectionDistance('OLD1_OLD2', '99');
  s.updateConnectionLabelOffset('OLD1_OLD2', { x: 1, y: 1 });
  s.setProjectInfo('CUR', 'Current');
};
const canvas = () => {
  const s = useDrawingStore.getState();
  return JSON.parse(JSON.stringify({ elements: s.elements, d: s.connectionDistances, o: s.connectionLabelOffsets, style: s.style, id: s.currentProjectId, name: s.currentProjectName, h: s.history.length }));
};
const storage = () => JSON.parse(JSON.stringify(Object.fromEntries(db.data)));

const savedP1 = async (updatedAt = 9000) => {
  await saveProject({ id: 'P1', name: 'Saved P1', createdAt: 100, updatedAt, data: { elements: [pole('X') as DrawingElement], style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {}, connectionLabelOffsets: {} } });
  db.state.writes.length = 0;
};

const initial = useDrawingStore.getState();
let autosave: AutosaveHandle | null = null;
beforeEach(() => {
  db.data.clear(); db.state.writes.length = 0; db.state.failNextWrite = false; db.state.failOnCall = 0; db.state.calls = 0;
  useDrawingStore.setState({ ...initial }, true);
});
afterEach(() => { autosave?.stop(); autosave = null; vi.useRealTimers(); vi.restoreAllMocks(); });

const plan = async (input: string) => {
  const r = await planImport(input);
  if (!r.ok) throw new Error((r as { message: string }).message);
  return r.plan;
};

// ---- valid file ---------------------------------------------------------------
describe('valid JSON file', () => {
  it('is accepted and opened as-is when no saved project has its id (nothing is saved)', async () => {
    currentDrawing();
    const p = await plan(json(validFile()));
    expect(p.conflict).toBeNull();
    const r = await applyImport(p, 'open');
    expect(r).toMatchObject({ ok: true, status: 'opened', projectId: 'P1', projectName: 'Line 7' });
    const s = useDrawingStore.getState();
    expect(s.elements.map((e) => e.id)).toEqual(['A', 'B', 'C', 'c1', 'k1']);
    expect(s.connectionDistances).toEqual({ A_B: '25', B_C: '30' });
    expect(s.connectionLabelOffsets).toEqual({ A_B: { x: 3, y: -4 } });
    expect(s.style).toEqual(validFile().style);
    expect([s.poleSizeScale, s.distanceTextScale, s.consumerSizeScale, s.consumerVariant]).toEqual([1.2, 1.1, 0.9, 'square']);
    expect(s.history).toEqual([]);
    expect(db.state.writes).toEqual([]);
  });

  it('export → import round trip is lossless', async () => {
    const f = validFile();
    const out = serializeProject(f.elements as DrawingElement[], f.style, f.poleSizeScale, 'square', f.connectionDistances, f.connectionLabelOffsets, 'P9', 'Round', f.distanceTextScale, f.consumerSizeScale);
    const r = parseProjectFile(out);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Stage 7: cables gain span ids and the file gains the (default) voltage-drop
    // settings; everything that was in the file is unchanged.
    const stripSpanIds = (els: DrawingElement[]) => els.map((e) => { if (e.type !== 'cable') return e; const { spanIds: _s, ...rest } = e; return rest; });
    expect({ ...r.data, elements: stripSpanIds(r.data.elements), electrical: undefined, distanceFlags: undefined, metadata: undefined }).toEqual({ ...f, electrical: undefined, distanceFlags: undefined, metadata: undefined });
    expect(r.data.electrical).toEqual(DEFAULT_ELECTRICAL);
    expect(r.data.distanceFlags).toEqual({}); // Stage 7.8: no distance markers in an older file
    // and a second round trip changes nothing at all (span ids included)
    const again = parseProjectFile(serializeProject(r.data.elements, r.data.style, r.data.poleSizeScale, 'square', r.data.connectionDistances, r.data.connectionLabelOffsets!, 'P9', 'Round', r.data.distanceTextScale, r.data.consumerSizeScale, r.data.electrical, r.data.distanceFlags));
    expect(again.ok && { ...again.data, metadata: undefined }).toEqual({ ...r.data, metadata: undefined });
  });
});

// ---- incomplete / corrupt files -----------------------------------------------
describe('incomplete or corrupt file is rejected and changes nothing', () => {
  const full = json(validFile());
  const bad: [string, string][] = [
    ['truncated JSON', full.slice(0, Math.floor(full.length / 2))],
    ['empty file', ''],
    ['not JSON', 'hello'],
    ['JSON array instead of a project', '[]'],
    ['no elements', json({ ...validFile(), elements: undefined })],
    ['elements is not a list', json(validFile({ elements: { a: 1 } }))],
    ['element without id', json(validFile({ elements: [{ type: 'symbol', x: 0, y: 0, symbolId: 's', width: 1, height: 1 }] }))],
    ['unknown element type', json(validFile({ elements: [{ id: 'z', type: 'rocket', x: 0, y: 0 }] }))],
    ['pole without size', json(validFile({ elements: [{ id: 'A', type: 'symbol', x: 0, y: 0 }] }))],
    ['element with NaN-like position', json(validFile({ elements: [{ ...pole('A'), x: 'left' }] }))],
    ['cable without poleIds', json(validFile({ elements: [pole('A'), { ...cable('c', []), poleIds: undefined }] }))],
    ['path without points', json(validFile({ elements: [{ id: 'p', type: 'path', x: 0, y: 0 }] }))],
    ['style of wrong type', json(validFile({ style: 'red' }))],
    ['distances of wrong type', json(validFile({ connectionDistances: ['25'] }))],
    ['newer file version', json(validFile({ version: 3 }))],
  ];
  it.each(bad)('%s', async (_n, input) => {
    currentDrawing();
    const before = { c: canvas(), st: storage() };
    const r = await planImport(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { message: string }).message).toMatch(/لم يتم الاستيراد/);
    expect(canvas()).toEqual(before.c);
    expect(storage()).toEqual(before.st);
  });

  it('never throws, whatever the input (random truncations and mutations of a valid file)', async () => {
    currentDrawing();
    const before = canvas();
    const inputs: string[] = [];
    for (let i = 0; i < full.length; i += 37) inputs.push(full.slice(0, i));
    const f = validFile();
    for (const k of Object.keys(f)) for (const v of [null, 0, 'x', [], {}, true]) inputs.push(json({ ...f, [k]: v }));
    f.elements.forEach((_, i) => { for (const v of [null, 1, 'x', []]) { const els = [...f.elements] as unknown[]; els[i] = v; inputs.push(json({ ...f, elements: els })); } });
    for (const input of inputs) await expect(planImport(input)).resolves.toBeDefined();
    expect(canvas()).toEqual(before);
  });
});

// ---- missing style -----------------------------------------------------------
describe('missing style', () => {
  it('is accepted with the default style (older exports)', async () => {
    const p = await plan(json(validFile({ style: undefined })));
    expect(p.data.style).toEqual({ strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 });
    await applyImport(p, 'open');
    expect(useDrawingStore.getState().style).toEqual(p.data.style);
  });
  it('a partial style is completed with defaults', async () => {
    const p = await plan(json(validFile({ style: { strokeColor: '#ff0000' } })));
    expect(p.data.style).toEqual({ strokeColor: '#ff0000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 });
  });
});

// ---- broken references ---------------------------------------------------------
describe('references to poles that do not exist', () => {
  it('a cable pointing to a missing pole is rejected, naming the cable and the pole', async () => {
    currentDrawing();
    const before = canvas();
    const r = await planImport(json(validFile({ elements: [pole('A'), pole('B'), cable('c1', ['A', 'GHOST', 'B'])] })));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect((r as { message: string }).message).toContain('c1'); expect((r as { message: string }).message).toContain('GHOST'); }
    expect(canvas()).toEqual(before);
  });
  it('a cable pointing to something that is not a pole is rejected', async () => {
    const r = await planImport(json(validFile({ elements: [pole('A'), consumer('k', 'A'), cable('c1', ['A', 'k'])] })));
    expect(r.ok).toBe(false);
  });
  it('a subscriber attached to a missing pole is rejected', async () => {
    const r = await planImport(json(validFile({ elements: [pole('A'), consumer('k1', 'NOPE')] })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { message: string }).message).toContain('NOPE');
  });
});

// ---- existing project id: the three choices -----------------------------------
describe('imported project id already exists locally', () => {
  it('is detected before anything is written', async () => {
    await savedP1();
    currentDrawing();
    const before = { c: canvas(), st: storage() };
    const p = await plan(json(validFile()));
    expect(p.conflict).toMatchObject({ id: 'P1', name: 'Saved P1', updatedAt: 9000 });
    expect(db.state.writes).toEqual([]);
    expect(canvas()).toEqual(before.c);
    expect(storage()).toEqual(before.st);
    // "open" (the old behaviour) is refused while a conflict exists
    expect((await applyImport(p, 'open')).ok).toBe(false);
    expect(canvas()).toEqual(before.c);
  });

  it('replace: overwrites that saved project (keeps its createdAt), then opens it', async () => {
    await savedP1();
    currentDrawing();
    const p = await plan(json(validFile()));
    const r = await applyImport(p, 'replace', { now: () => 12345 });
    expect(r).toMatchObject({ ok: true, status: 'replaced', projectId: 'P1', projectName: 'Line 7' });
    const meta = await getProjectsMeta();
    expect(meta).toEqual([{ id: 'P1', name: 'Line 7', createdAt: 100, updatedAt: 12345, thumbnail: undefined }]);
    const saved = await loadProject('P1');
    expect(saved?.data.elements.map((e) => e.id)).toEqual(['A', 'B', 'C', 'c1', 'k1']);
    expect(saved?.data.connectionDistances).toEqual({ A_B: '25', B_C: '30' });
    expect(useDrawingStore.getState().currentProjectId).toBe('P1');
    expect(useDrawingStore.getState().elements.map((e) => e.id)).toEqual(['A', 'B', 'C', 'c1', 'k1']);
  });

  it('copy: saves under a new id, the saved project stays untouched', async () => {
    await savedP1();
    const original = await loadProject('P1');
    currentDrawing();
    const p = await plan(json(validFile()));
    const r = await applyImport(p, 'copy', { now: () => 777, newId: () => 'NEW-ID' });
    expect(r).toMatchObject({ ok: true, status: 'copied', projectId: 'NEW-ID', projectName: copyName('Line 7') });
    expect(await loadProject('P1')).toEqual(original);
    const meta = await getProjectsMeta();
    expect(meta.map((m) => m.id).sort()).toEqual(['NEW-ID', 'P1']);
    expect((await loadProject('NEW-ID'))?.data.elements).toHaveLength(5);
    expect(useDrawingStore.getState().currentProjectId).toBe('NEW-ID');
  });

  it('cancel: nothing changes anywhere', async () => {
    await savedP1();
    currentDrawing();
    const before = { c: canvas(), st: storage() };
    const p = await plan(json(validFile()));
    expect(await applyImport(p, 'cancel')).toEqual({ ok: true, status: 'cancelled' });
    expect(canvas()).toEqual(before.c);
    expect(storage()).toEqual(before.st);
    expect(db.state.writes).toEqual([]);
  });

  it('file without a name: copy is named from the default import name', async () => {
    await savedP1();
    const p = await plan(json(validFile({ metadata: { id: 'P1', name: null, exportedAt: 1 } })));
    expect(p.name).toBe(DEFAULT_IMPORT_NAME);
  });
});

// ---- failures leave no half-written data ------------------------------------------
describe('a failing import changes neither the drawing nor the saved projects', () => {
  it.each(['replace', 'copy'] as const)('%s: storage write fails', async (choice) => {
    await savedP1();
    currentDrawing();
    const before = { c: canvas(), st: storage() };
    const p = await plan(json(validFile()));
    db.state.failNextWrite = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await applyImport(p, choice);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { message: string }).message).toMatch(/تعذّر حفظ/);
    expect(canvas()).toEqual(before.c);
    expect(storage()).toEqual(before.st);
  });
  it('saveProject writes the project list and its data in one transaction', async () => {
    await saveProject({ id: 'Q', name: 'Q', createdAt: 1, updatedAt: 1, data: validFile() as never });
    expect(db.state.writes).toEqual([META_KEY, 'project_Q']);
    expect(db.state.calls).toBe(1); // a single storage operation (one transaction)
    // even if the backend failed after the first operation, nothing would be half-written
    db.state.failOnCall = db.state.calls + 2;
    await saveProject({ id: 'S', name: 'S', createdAt: 3, updatedAt: 3, data: validFile() as never }).catch(() => {});
    expect((await getProjectsMeta()).some((m) => m.id === 'S')).toBe(db.data.has('project_S'));
    db.state.failOnCall = 0;
    db.state.failNextWrite = new Error('boom');
    await expect(saveProject({ id: 'R', name: 'R', createdAt: 2, updatedAt: 2, data: validFile() as never })).rejects.toThrow();
    expect((await getProjectsMeta()).map((m) => m.id).filter((id) => id !== 'S')).toEqual(['Q']);
    expect(db.data.has('project_R')).toBe(false);
  });
  it('reading the saved project list fails: import is refused, nothing changes', async () => {
    currentDrawing();
    const before = canvas();
    const r = await planImport(json(validFile()), { getMeta: async () => { throw new Error('IDB down'); } });
    expect(r.ok).toBe(false);
    expect(canvas()).toEqual(before);
  });
});

// ---- older valid files -----------------------------------------------------------
describe('compatibility with older valid files', () => {
  it('a minimal old export (no version, metadata, style, scales, offsets) still imports', async () => {
    const old = { elements: [pole('A'), pole('B', 100, 0), { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['A', 'B'], strokeColor: '#f00', fillColor: 'transparent', strokeWidth: 2 }], connectionDistances: { A_B: 12 } };
    const p = await plan(json(old));
    expect(p.fileId).toBeNull();
    expect(p.name).toBe(DEFAULT_IMPORT_NAME);
    expect(p.data).toMatchObject({ poleSizeScale: 1, distanceTextScale: 1, consumerSizeScale: 1, consumerVariant: 'circle', connectionDistances: { A_B: '12' }, connectionLabelOffsets: {} });
    const r = await applyImport(p, 'open');
    expect(r).toMatchObject({ ok: true, status: 'opened', projectId: null, projectName: DEFAULT_IMPORT_NAME });
    expect(useDrawingStore.getState().elements).toHaveLength(3);
  });
  it('a single-pole cable (unfinished cable in an old drawing) is still valid', async () => {
    expect((await planImport(json(validFile({ elements: [pole('A'), cable('c', ['A'])] })))).ok).toBe(true);
  });
  it('other element kinds as the app saves them are accepted', async () => {
    const els = [
      { id: 't', type: 'text', x: 1, y: 1, text: 'hi', fontSize: 16, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 1 },
      { id: 'p', type: 'path', x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 },
      { id: 'a', type: 'arc', x: 0, y: 0, x2: 5, y2: 5, controlX: 2, controlY: 8, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 },
      { id: 's', type: 'shape', shapeType: 'circle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 },
      { id: 'tt', type: 'transformer_table', x: 0, y: 0, transformerInfo: { transformerNumber: '1' }, scale: 1, strokeColor: '#000', fillColor: 'white', strokeWidth: 2 },
    ];
    expect((await planImport(json(validFile({ elements: els })))).ok).toBe(true);
  });
});

// ---- autosave is not mixed with imports --------------------------------------------
describe('import and the autosave draft', () => {
  const startWithDraft = async () => {
    vi.useFakeTimers();
    autosave = startAutosave({ lifecycle: null, debounceMs: 300 });
    currentDrawing();
    await vi.advanceTimersByTimeAsync(400);
    await autosave.idle();
    return storage()[DRAFT_KEY];
  };

  it('a rejected file leaves the draft exactly as it was', async () => {
    const draft = await startWithDraft();
    expect(draft.data.elements).toHaveLength(3);
    await planImport('{"elements": [ {"id": "c", "type": "cable", "x":0, "y":0, "poleIds": ["X"]} ]}');
    await vi.advanceTimersByTimeAsync(1000); await autosave!.flush();
    expect(storage()[DRAFT_KEY]).toEqual(draft);
  });

  it('cancelling a conflict leaves the draft exactly as it was', async () => {
    await savedP1();
    const draft = await startWithDraft();
    const p = await plan(json(validFile()));
    await applyImport(p, 'cancel');
    await vi.advanceTimersByTimeAsync(1000); await autosave!.flush();
    expect(storage()[DRAFT_KEY]).toEqual(draft);
  });

  it('after a successful import the draft holds only the imported project (nothing of the old drawing), linked to the resulting id', async () => {
    await savedP1();
    await startWithDraft();
    const p: ImportPlan = await plan(json(validFile()));
    await applyImport(p, 'copy', { newId: () => 'COPY-1' });
    await vi.advanceTimersByTimeAsync(400); await autosave!.idle();
    const d = storage()[DRAFT_KEY];
    expect(d.projectId).toBe('COPY-1');
    expect(d.data.elements.map((e: { id: string }) => e.id)).toEqual(['A', 'B', 'C', 'c1', 'k1']);
    expect(d.data.connectionDistances).toEqual({ A_B: '25', B_C: '30' });
    expect(d.data.connectionLabelOffsets).toEqual({ A_B: { x: 3, y: -4 } });
    expect(JSON.stringify(d)).not.toContain('OLD1');
  });

  it('autosave never writes into the saved projects during an import', async () => {
    await savedP1();
    await startWithDraft();
    db.state.writes.length = 0;
    await applyImport(await plan(json(validFile())), 'replace', { now: () => 50 });
    await vi.advanceTimersByTimeAsync(400); await autosave!.idle();
    // one atomic project write by the import itself, then the draft
    expect(db.state.writes).toEqual([META_KEY, 'project_P1', DRAFT_KEY]);
  });
});

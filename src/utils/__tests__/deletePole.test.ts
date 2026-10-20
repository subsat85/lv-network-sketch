import { beforeEach, describe, expect, it } from 'vitest';
import type { CableElement, ConsumerElement, DrawingElement, SymbolElement } from '../../types/drawing';
import { deletePoleCascade, pairKey, type DeletePoleFailure, type DeletePoleSuccess } from '../deletePole';
import { calculateCablePath } from '../cableLayout';
import { useDrawingStore } from '../../store/drawingStore';
import { serializeProject, deserializeProject } from '../projectSerialization';
// Stage 7: loading / importing gives every cable span ids (fixtures here are put
// into the store directly, without them), so compare without that field.
const noSpanIds = <T,>(els: T[]): T[] => els.map((e) => { const { spanIds: _s, ...rest } = e as { spanIds?: unknown }; return rest as T; });

// ---------- fixtures ----------
const pole = (id: string, x: number, y: number, symbolId = 'lv-pole'): SymbolElement => ({
  id, type: 'symbol', symbolId, x, y, width: 24, height: 24, strokeColor: '#000000', fillColor: '#FFFFFF', strokeWidth: 2,
});
let n = 0;
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({
  id, type: 'cable', x: 0, y: 0, poleIds, strokeColor: '#000000', fillColor: 'none', strokeWidth: 2,
  cableIndex: n, offset: 0, lineStyle: 'zigzag', ...extra,
});
const consumer = (id: string, poleId: string, count = 2): ConsumerElement => ({
  id, type: 'consumer', x: 0, y: 0, poleId, color: '#000000', count, strokeColor: '#000000', fillColor: '#000000', strokeWidth: 2, variant: 'circle', label: '',
});
const ids = (els: DrawingElement[]) => els.map(e => e.id).sort();
const byId = (els: DrawingElement[], id: string) => els.find(e => e.id === id);

/** Every pole pair that some cable connects directly (the "electrical connections"). */
function connections(els: DrawingElement[]): Set<string> {
  const out = new Set<string>();
  for (const e of els) if (e.type === 'cable') for (let i = 0; i < e.poleIds.length - 1; i++) out.add(pairKey(e.poleIds[i], e.poleIds[i + 1]));
  return out;
}
function noDanglingRefs(els: DrawingElement[]) {
  const all = new Set(els.map(e => e.id));
  for (const e of els) {
    if (e.type === 'cable') { expect(e.poleIds.length).toBeGreaterThanOrEqual(2); for (const p of e.poleIds) expect(all.has(p)).toBe(true); }
    if (e.type === 'consumer') expect(all.has(e.poleId)).toBe(true);
  }
}
const ok = (r: ReturnType<typeof deletePoleCascade>): DeletePoleSuccess => { if (!r.ok) throw new Error((r as DeletePoleFailure).reason); return r as DeletePoleSuccess; };

//  A ── B ── C        (+ D below B, E right of C)
//       │
//       D
const A = pole('pA', 0, 0), B = pole('pB', 100, 0), C = pole('pC', 200, 0), D = pole('pD', 100, 100), E = pole('pE', 300, 0), F = pole('pF', 100, -100);

describe('deletePoleCascade', () => {
  it('1. pole without cables: only the pole is removed', () => {
    const els = [A, B, cable('c1', ['pA', 'pB'])];
    const r = ok(deletePoleCascade([...els, C], {}, {}, 'pC'));
    expect(ids(r.elements)).toEqual(ids(els));
    expect(r.elements.find(e => e.id === 'c1')).toBe(els[2]); // untouched object
  });

  it('2. middle of a continuous cable A→B→C: same cable continues A→C', () => {
    const c1 = cable('c1', ['pA', 'pB', 'pC'], { strokeColor: '#EF4444', cableType: 'ground', arrowMode: 'end', offset: 8, cableIndex: 3 });
    const r = ok(deletePoleCascade([A, B, C, c1], { [pairKey('pA', 'pB')]: '25', [pairKey('pB', 'pC')]: '30' }, {}, 'pB'));
    const out = byId(r.elements, 'c1') as CableElement;
    expect(out.poleIds).toEqual(['pA', 'pC']);
    expect({ ...out, poleIds: undefined }).toEqual({ ...c1, poleIds: undefined }); // identity + all properties kept
    expect(r.elements.filter(e => e.type === 'cable')).toHaveLength(1);
    // distance A–C = 25 + 30 (inverse of "pole on cable halves the distance")
    expect(r.connectionDistances).toEqual({ [pairKey('pA', 'pC')]: '55' });
    noDanglingRefs(r.elements);
  });

  it('2b. middle pole, distance missing on one side: A–C distance is left unset (no guess)', () => {
    const r = ok(deletePoleCascade([A, B, C, cable('c1', ['pA', 'pB', 'pC'])], { [pairKey('pA', 'pB')]: '25' }, {}, 'pB'));
    expect(r.connectionDistances).toEqual({});
  });

  it('3. cables that end at the pole are trimmed; a cable with nothing left is removed', () => {
    const c1 = cable('c1', ['pA', 'pB']);            // only segment ends at B → removed
    const c2 = cable('c2', ['pE', 'pC', 'pB']);       // ends at B → keeps E–C
    const c3 = cable('c3', ['pB', 'pC', 'pE']);       // starts at B → keeps C–E
    const r = ok(deletePoleCascade([A, B, C, E, c1, c2, c3], { [pairKey('pC', 'pB')]: '10', [pairKey('pE', 'pC')]: '20' }, {}, 'pB'));
    expect(byId(r.elements, 'c1')).toBeUndefined();
    expect((byId(r.elements, 'c2') as CableElement).poleIds).toEqual(['pE', 'pC']);
    expect((byId(r.elements, 'c3') as CableElement).poleIds).toEqual(['pC', 'pE']);
    expect(r.connectionDistances).toEqual({ [pairKey('pE', 'pC')]: '20' });
    // never extended to another pole
    expect([...connections(r.elements)].sort()).toEqual([pairKey('pC', 'pE')]);
    noDanglingRefs(r.elements);
  });

  it('4. several independent cables at the pole are handled separately (not merged)', () => {
    const c1 = cable('c1', ['pA', 'pB']), c2 = cable('c2', ['pB', 'pD']), c3 = cable('c3', ['pC', 'pB']);
    const r = ok(deletePoleCascade([A, B, C, D, c1, c2, c3], {}, {}, 'pB'));
    expect(r.elements.filter(e => e.type === 'cable')).toHaveLength(0);
    expect(ids(r.elements)).toEqual(['pA', 'pC', 'pD']);
  });

  it('5. branch point with 4 directions: each cable on its own, no cross connections', () => {
    const through1 = cable('t1', ['pA', 'pB', 'pC']);   // A–B–C runs through
    const through2 = cable('t2', ['pD', 'pB', 'pF']);   // D–B–F runs through
    const end1 = cable('e1', ['pE', 'pC', 'pB']);       // ends at B
    const r = ok(deletePoleCascade([A, B, C, D, E, F, through1, through2, end1], {}, {}, 'pB'));
    expect((byId(r.elements, 't1') as CableElement).poleIds).toEqual(['pA', 'pC']);
    expect((byId(r.elements, 't2') as CableElement).poleIds).toEqual(['pD', 'pF']);
    expect((byId(r.elements, 'e1') as CableElement).poleIds).toEqual(['pE', 'pC']);
    const conn = connections(r.elements);
    // only through-connections are kept; no A–D, A–F, C–D, C–F created
    for (const bad of [['pA', 'pD'], ['pA', 'pF'], ['pC', 'pD'], ['pC', 'pF'], ['pE', 'pB']]) expect(conn.has(pairKey(bad[0], bad[1]))).toBe(false);
    noDanglingRefs(r.elements);
  });

  it('6. through-cable and an ending cable at the same pole', () => {
    const t = cable('t', ['pA', 'pB', 'pC']), e = cable('e', ['pD', 'pB']);
    const r = ok(deletePoleCascade([A, B, C, D, t, e], {}, {}, 'pB'));
    expect((byId(r.elements, 't') as CableElement).poleIds).toEqual(['pA', 'pC']);
    expect(byId(r.elements, 'e')).toBeUndefined();
    expect([...connections(r.elements)]).toEqual([pairKey('pA', 'pC')]);
  });

  it('7. mixed paths: some continue, some end, longer cables keep their other segments', () => {
    const long = cable('L', ['pE', 'pC', 'pB', 'pA']);       // E–C–B–A → E–C–A
    const branch = cable('Br', ['pB', 'pD']);                  // ends → removed
    const loop = cable('Lp', ['pA', 'pB', 'pA']);              // out and back → nothing left
    const r = ok(deletePoleCascade([A, B, C, D, E, long, branch, loop], {}, {}, 'pB'));
    expect((byId(r.elements, 'L') as CableElement).poleIds).toEqual(['pE', 'pC', 'pA']);
    expect(byId(r.elements, 'Br')).toBeUndefined();
    expect(byId(r.elements, 'Lp')).toBeUndefined();
    noDanglingRefs(r.elements);
  });

  it('8. no unintended new connection: only bridged through-pairs appear', () => {
    const els = [A, B, C, D, E, F, cable('t', ['pA', 'pB', 'pC']), cable('x', ['pD', 'pB']), cable('y', ['pB', 'pF']), cable('z', ['pC', 'pE'])];
    const before = connections(els);
    const r = ok(deletePoleCascade(els, {}, {}, 'pB'));
    const after = connections(r.elements);
    const added = [...after].filter(k => !before.has(k));
    expect(added).toEqual([pairKey('pA', 'pC')]);           // the through-cable only
    for (const k of after) expect(k.includes('pB')).toBe(false);
  });

  it('9. distances, label offsets and subscribers: only data of the deleted pole goes', () => {
    const els = [A, B, C, D, cable('t', ['pA', 'pB', 'pC']), cable('o', ['pC', 'pD']), consumer('uB', 'pB', 3), consumer('uC', 'pC', 2), consumer('uA', 'pA', 1)];
    const dist = { [pairKey('pA', 'pB')]: '12.5', [pairKey('pB', 'pC')]: '12.5', [pairKey('pC', 'pD')]: '40' };
    const offs = { [pairKey('pA', 'pB')]: { x: 3, y: 4 }, [pairKey('pC', 'pD')]: { x: 10, y: -5 } };
    const r = ok(deletePoleCascade(els, dist, offs, 'pB'));
    expect(ids(r.elements.filter(e => e.type === 'consumer'))).toEqual(['uA', 'uC']); // not moved, not deleted
    expect(byId(r.elements, 'uC')).toBe(els[7]);
    expect(r.connectionDistances).toEqual({ [pairKey('pA', 'pC')]: '25', [pairKey('pC', 'pD')]: '40' });
    expect(r.connectionLabelOffsets).toEqual({ [pairKey('pC', 'pD')]: { x: 10, y: -5 } });
  });

  it('9b. existing A–C distance (another cable already runs A–C) is never overwritten', () => {
    const els = [A, B, C, cable('t', ['pA', 'pB', 'pC']), cable('d', ['pA', 'pC'])];
    const r = ok(deletePoleCascade(els, { [pairKey('pA', 'pB')]: '10', [pairKey('pB', 'pC')]: '10', [pairKey('pA', 'pC')]: '18' }, {}, 'pB'));
    expect(r.connectionDistances).toEqual({ [pairKey('pA', 'pC')]: '18' });
  });

  it('12. cables not connected to the pole are returned unchanged (same objects, same geometry)', () => {
    const other = cable('o', ['pC', 'pE'], { offset: 8 }), t = cable('t', ['pA', 'pB', 'pD']);
    const els = [A, B, C, D, E, other, t];
    const before = calculateCablePath(other, els);
    const r = ok(deletePoleCascade(els, {}, {}, 'pB'));
    expect(byId(r.elements, 'o')).toBe(other);
    expect(calculateCablePath(other, r.elements)).toEqual(before);
    expect(r.changedCableIds).toEqual(['t']);
  });

  it('works for transformers and for legacy dangling ids (already invisible) without changing the picture', () => {
    const T = pole('pT', 100, 0, 'transformer');
    const legacy = cable('lg', ['pA', 'ghost', 'pT', 'pC']); // "ghost" was deleted by an older version
    const els = [A, T, C, legacy];
    const r = ok(deletePoleCascade(els, {}, {}, 'pT'));
    expect((byId(r.elements, 'lg') as CableElement).poleIds).toEqual(['pA', 'pC']);
    noDanglingRefs(r.elements);
  });

  it('refuses non-poles and unknown ids without changing anything', () => {
    const els = [A, B, cable('c', ['pA', 'pB'])];
    expect(deletePoleCascade(els, {}, {}, 'nope').ok).toBe(false);
    expect(deletePoleCascade(els, {}, {}, 'c').ok).toBe(false);
  });

  it('rebuilds the optional per-cable index distances field', () => {
    const c = cable('c', ['pA', 'pB', 'pC', 'pE'], { distances: { 0: '5', 1: '7', 2: '9' } });
    const r = ok(deletePoleCascade([A, B, C, E, c], {}, {}, 'pB'));
    expect((byId(r.elements, 'c') as CableElement).distances).toEqual({ 0: '12', 1: '9' });
  });
});

// ---------- store: one atomic undo step, redo, serialisation ----------
describe('store.deleteElement for poles', () => {
  const initial = useDrawingStore.getState();
  const dist = { [pairKey('pA', 'pB')]: '25', [pairKey('pB', 'pC')]: '30', [pairKey('pC', 'pE')]: '15' };
  const offs = { [pairKey('pA', 'pB')]: { x: 5, y: 5 }, [pairKey('pC', 'pE')]: { x: 1, y: 2 } };
  const els: DrawingElement[] = [A, B, C, D, E, cable('t', ['pA', 'pB', 'pC']), cable('e', ['pD', 'pB']), cable('o', ['pC', 'pE']), consumer('uB', 'pB'), consumer('uE', 'pE')];
  beforeEach(() => {
    useDrawingStore.setState({ ...initial, elements: els, history: [], redoStack: [], connectionDistances: { ...dist }, connectionLabelOffsets: { ...offs }, selectedId: 'pB' }, true);
  });

  it('10. delete is one undo step; undo restores everything; redo re-applies', () => {
    const s = useDrawingStore.getState();
    const res = s.deleteElement('pB');
    expect(res.ok).toBe(true);
    useDrawingStore.getState().commitHistory(); // end of the user action
    let st = useDrawingStore.getState();
    expect(st.history).toHaveLength(1);
    expect(st.selectedId).toBeNull();
    expect(ids(st.elements)).toEqual(['o', 'pA', 'pC', 'pD', 'pE', 't', 'uE']);
    expect(st.connectionDistances).toEqual({ [pairKey('pA', 'pC')]: '55', [pairKey('pC', 'pE')]: '15' });
    expect(st.connectionLabelOffsets).toEqual({ [pairKey('pC', 'pE')]: { x: 1, y: 2 } });
    const afterDelete = { elements: st.elements, d: st.connectionDistances, o: st.connectionLabelOffsets };

    st.undo();
    st = useDrawingStore.getState();
    expect(st.elements).toEqual(els);
    expect(st.connectionDistances).toEqual(dist);
    expect(st.connectionLabelOffsets).toEqual(offs);
    expect(st.history).toHaveLength(0);

    st.redo();
    st = useDrawingStore.getState();
    expect(st.elements).toEqual(afterDelete.elements);
    expect(st.connectionDistances).toEqual(afterDelete.d);
    expect(st.connectionLabelOffsets).toEqual(afterDelete.o);

    // and once more both ways
    st.undo(); st = useDrawingStore.getState();
    expect(st.connectionDistances).toEqual(dist);
    st.redo(); st = useDrawingStore.getState();
    expect(st.connectionDistances).toEqual(afterDelete.d);
  });

  it('undo of an unrelated later step does not touch distances', () => {
    // three separate user actions
    useDrawingStore.getState().deleteElement('pB');
    useDrawingStore.getState().commitHistory();
    useDrawingStore.getState().addElement(pole('pZ', 500, 500));
    useDrawingStore.getState().commitHistory();
    useDrawingStore.getState().updateConnectionDistance(pairKey('pC', 'pE'), '99');
    useDrawingStore.getState().commitHistory();
    useDrawingStore.getState().undo(); // undoes the distance edit
    expect(useDrawingStore.getState().connectionDistances[pairKey('pC', 'pE')]).toBe('15');
    useDrawingStore.getState().undo(); // removes pZ only
    const st = useDrawingStore.getState();
    expect(byId(st.elements, 'pZ')).toBeUndefined();
    expect(byId(st.elements, 'pB')).toBeUndefined();
    expect(st.connectionDistances[pairKey('pC', 'pE')]).toBe('15');
  });

  it('non-pole elements are still deleted as before', () => {
    const res = useDrawingStore.getState().deleteElement('o');
    expect(res.ok).toBe(true);
    const st = useDrawingStore.getState();
    expect(byId(st.elements, 'o')).toBeUndefined();
    expect(st.connectionDistances).toEqual(dist);
  });

  it('11. export → import after deleting keeps the data intact', () => {
    useDrawingStore.getState().deleteElement('pB');
    const st = useDrawingStore.getState();
    const json = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x');
    const back = deserializeProject(json);
    expect(noSpanIds(back.elements)).toEqual(noSpanIds(st.elements));
    expect(back.connectionDistances).toEqual(st.connectionDistances);
    expect(back.connectionLabelOffsets).toEqual(st.connectionLabelOffsets);
    noDanglingRefs(back.elements);
  });
});

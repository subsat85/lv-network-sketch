import { describe, expect, it } from 'vitest';
import type { ConsumerElement, DrawingElement } from '../../types/drawing';
import { buildNetwork } from '../../utils/network';
import { networkOptions, spanLength } from '../../utils/spanLength';
import { normalizeElements } from '../../utils/spanModel';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';
import { goldenCases, goldenTreeCases, type GoldenCase } from '../../utils/__tests__/vdGoldenNetworks';
import { toNetwork } from '../adapter';
import type { ProjectDocument } from '../model';

// The adapter E2 reads the drawing with: the topology of buildNetwork, nothing added to it.

const CASES = [...goldenCases(), ...goldenTreeCases()];
const docOf = (g: GoldenCase): ProjectDocument => ({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: g.settings });

describe('adapter: same topology and loads as buildNetwork', () => {
  it('circuits, statuses, sources, branch order and buses', () => {
    for (const g of CASES) {
      const { network, legacy } = toNetwork(docOf(g), g.settings);
      const ref = buildNetwork(g.elements, networkOptions(g.settings));
      expect(network.circuits.length, g.name).toBe(ref.circuits.length);
      ref.circuits.forEach((c, ci) => {
        const n = network.circuits[ci];
        expect(n.id).toBe(c.id);
        expect(n.status).toBe(c.status);
        expect(n.source?.poleId).toBe(c.sourcePoleId);
        expect(n.source?.kind).toBe(c.sourceKind);
        expect(n.branches.map((b) => `${b.key}:${b.fromPole}>${b.toPole}:${b.fromBus}>${b.toBus}`)).toEqual(c.spans.map((s) => `${s.cableId}#${s.index}:${s.fromPole}>${s.toPole}:${s.fromBus}>${s.toBus}`));
        expect(n.buses.map((b) => b.id)).toEqual(c.buses);
      });
      // the network handed to the solver is the one built here (not rebuilt)
      expect(legacy.circuits.length).toBe(ref.circuits.length);
    }
  });

  it('loads per bus: valid amps sum exactly to busLoad, invalid ones carry no value, same subscribers', () => {
    let invalid = 0;
    for (const g of CASES) {
      const { network, legacy } = toNetwork(docOf(g), g.settings);
      for (const c of network.circuits) {
        const ref = legacy.circuits.find((x) => x.id === c.id)!;
        for (const b of c.buses) {
          const bl = ref.busLoad.get(b.id);
          let single = 0, three = 0;
          for (const l of b.loads) {
            if (l.amps.status === 'invalid') { invalid++; expect(l.amps.value).toBeUndefined(); continue; }
            if (l.kind === 'single') single += l.amps.value!; else three += l.amps.value!;
          }
          expect(single, `${g.name} ${b.id}`).toBe(bl?.single ?? 0);
          expect(three, `${g.name} ${b.id}`).toBe(bl?.three ?? 0);
          expect(b.loads.map((l) => l.consumerId)).toEqual(bl?.consumerIds ?? []);
        }
      }
    }
    expect(invalid).toBeGreaterThan(0);
  });

  it('lengths: spanLength, and a missing length is never 0', () => {
    for (const g of CASES) {
      const { network } = toNetwork(docOf(g), g.settings);
      for (const c of network.circuits) for (const b of c.branches) {
        const ref = spanLength(g.distances, b.fromPole, b.toPole);
        expect(b.lengthM.value).toBe(ref.m);
        if (ref.m === undefined) { expect(b.lengthM.provenance).toBe('missing'); expect(b.lengthMissing).toBe(ref.missing); }
      }
    }
  });

  it('the drawing elements are passed as they are (no copy, no change)', () => {
    const g = CASES[0];
    const before = JSON.stringify(g.elements);
    toNetwork(docOf(g), g.settings);
    expect(JSON.stringify(g.elements)).toBe(before);
  });
});

// the default single-phase nominal load (a project setting): every single-phase subscriber takes it,
// a three-phase subscriber keeps its own value (ALL VALUES SYNTHETIC)
const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const sub = (id: string, o: Partial<ConsumerElement>) => ({ id, type: 'consumer', x: 0, y: 0, poleId: 'A', color: '#ff0000', count: 1, strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2, ...o }) as DrawingElement;
const loadsDoc = (electrical = DEFAULT_ELECTRICAL): ProjectDocument => ({
  elements: normalizeElements([pole('T', 'transformer'), pole('A'),
    { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as DrawingElement,
    sub('s', { variant: 'circle', count: 3 }), sub('t', { variant: 'square', label: '25' }), sub('d', { variant: 'square' })]),
  connectionDistances: { A_T: '100' }, distanceFlags: {}, electrical,
});
const loadsOf = (e = DEFAULT_ELECTRICAL) => Object.fromEntries(toNetwork(loadsDoc(e), e).network.circuits.flatMap((c) => c.buses.flatMap((b) => b.loads)).map((l) => [l.consumerId, l]));

describe('the default single-phase nominal load', () => {
  it('4 A by default: a project setting (provenance project), count × 4 A', () => {
    const l = loadsOf();
    expect(DEFAULT_ELECTRICAL.singlePhaseNominalA).toBe(4);
    expect(l.s).toMatchObject({ kind: 'single', count: 3, ampsEach: { value: 4, provenance: 'project', note: 'setting:singlePhaseNominalA' }, amps: { value: 12 } });
  });
  it('another value is used as it is (no other factor), only for single-phase subscribers', () => {
    const a = loadsOf(), b = loadsOf({ ...DEFAULT_ELECTRICAL, singlePhaseNominalA: 6.5 });
    expect(b.s.ampsEach.value).toBe(6.5);
    expect(b.s.amps.value).toBe(19.5);
    // three-phase subscribers: unchanged (their number, or the 32 A rule)
    expect(b.t).toEqual(a.t);
    expect(b.d).toEqual(a.d);
    expect(b.t.ampsEach).toMatchObject({ value: 25, provenance: 'project' });
    expect(b.d.ampsEach).toMatchObject({ value: 32, provenance: 'default' });
  });
  it('a project saved before the setting (no field) reads as 4 A', () => {
    const { singlePhaseNominalA: _x, ...old } = DEFAULT_ELECTRICAL;
    expect(loadsOf(old as typeof DEFAULT_ELECTRICAL).s.ampsEach.value).toBe(4);
  });
});

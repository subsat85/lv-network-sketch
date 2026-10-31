import { describe, expect, it } from 'vitest';
import { computeVoltageDrop } from '../../utils/voltageDrop';
import { goldenCases, goldenTreeCases } from '../../utils/__tests__/vdGoldenNetworks';
import { fromLegacy, MISSING_ITEMS, networkIssueTarget, PROVISIONAL_REASONS, SETTINGS_MISSING } from '../issues';
import { runStudy, studyWith } from '../index';
import type { CableElement, DrawingElement } from '../../types/drawing';
import { normalizeElements } from '../../utils/spanModel';
import { DEFAULT_ELECTRICAL, DEFAULT_POWER_FACTOR } from '../../utils/electricalSettings';

// E1: every problem of the existing result becomes exactly one DataIssue.
// Completeness over the unions is checked by the compiler (Record<…> tables and the
// `never` branch of networkIssueTarget); these tests check the counts and the mapping.

const CASES = [...goldenCases(), ...goldenTreeCases()];

describe('DataIssue from the existing result', () => {
  it('one DataIssue per item, nothing added or dropped, in the result\'s order of kinds', () => {
    const kinds = new Set<string>();
    for (const g of CASES) {
      const r = computeVoltageDrop(g.elements, g.distances, g.settings);
      const list = fromLegacy(r);
      const spanItems = r.circuits.reduce((n, c) => n + c.spans.reduce((m, s) => m + s.missing.length + s.provisional.length, 0), 0);
      const notOk = r.circuits.filter((c) => c.status !== 'ok').length;
      const inferred = r.circuits.reduce((n, c) => n + c.circuit.inferredJunctions.length, 0);
      expect(list.length, g.name).toBe(r.settingsMissing.length + notOk + spanItems + r.issues.length + inferred);
      for (const i of list) kinds.add(i.code);
      // severity follows what the existing engine does with the item
      for (const i of list) {
        if (i.code.startsWith('missing:') || i.code.startsWith('setting-missing:') || i.code.startsWith('circuit:')) expect(i.severity).toBe('blocks');
        else if (i.code === 'network:inferred-junction') expect(i.severity).toBe('reported');
        else if (i.code.startsWith('provisional:')) expect(i.severity).toBe('provisional');
        else expect(i.severity).toBe('reported');
      }
      // the study returns exactly this list
      expect(studyWith({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: g.settings }, g.settings).issues).toEqual(list);
    }
    // the golden networks reach every group
    for (const p of ['missing:', 'setting-missing:', 'circuit:', 'network:']) expect([...kinds].some((k) => k.startsWith(p)), p).toBe(true);
  });

  it('every code is a known value of the existing engine\'s unions', () => {
    for (const g of CASES) for (const i of fromLegacy(computeVoltageDrop(g.elements, g.distances, g.settings))) {
      const [group, value] = i.code.split(':');
      if (group === 'missing') expect(MISSING_ITEMS).toHaveProperty([value]);
      if (group === 'provisional') expect(PROVISIONAL_REASONS).toHaveProperty([value]);
      if (group === 'setting-missing') expect(SETTINGS_MISSING).toHaveProperty([value]);
    }
  });

  it('R1: every junction the auto rule made (the list the app shows for review) is one DataIssue, with its pole, cable and end', () => {
    let total = 0;
    for (const g of CASES) {
      const r = computeVoltageDrop(g.elements, g.distances, g.settings);
      const expected = r.circuits.flatMap((c) => c.circuit.inferredJunctions.map((j) => ({ c: c.circuit.id, j })));
      const got = fromLegacy(r).filter((i) => i.code === 'network:inferred-junction');
      expect(got.length, g.name).toBe(expected.length);
      got.forEach((i, k) => {
        const { c, j } = expected[k];
        expect(i).toEqual({ code: 'network:inferred-junction', severity: 'reported', target: { kind: 'pole', id: j.poleId }, params: { circuitId: c, cableId: j.cableId, end: j.end, withCableIds: j.withCableIds.join(',') } });
      });
      // same detection as before: every junction of the network is in one of its circuits
      expect(got.length, g.name).toBe(r.network.inferredJunctions.length);
      total += got.length;
    }
    expect(total).toBeGreaterThan(0);
    console.info(`R1: ${total} inferred junctions reported over ${CASES.length} networks`);
  });

  it('R1: a drawing with an auto junction (two red cables meeting at a pole) reports it; a confirmed end link does not', () => {
    const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
    const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}) => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2, ...extra }) as CableElement;
    const build = (extra: Partial<CableElement>) => normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], extra)]);
    const S = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 };
    const auto = fromLegacy(computeVoltageDrop(build({}), {}, S)).filter((i) => i.code === 'network:inferred-junction');
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((i) => i.target.id === 'A')).toBe(true);
    const confirmed = fromLegacy(computeVoltageDrop(build({ endLinks: { start: 'connected' } }), {}, S)).filter((i) => i.code === 'network:inferred-junction' && i.params?.cableId === 'c2');
    expect(confirmed).toEqual([]);
  });

  it('R2: a power factor taken from the default is reported and marked; a stored one is not; the numbers are the same', () => {
    const g = CASES.find((c) => c.settings.powerFactor !== undefined)!;
    const doc = (electrical: typeof g.settings) => ({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical });
    const defaulted = runStudy(doc({ ...g.settings, powerFactor: undefined }));
    const stored = runStudy(doc({ ...g.settings, powerFactor: DEFAULT_POWER_FACTOR }));
    expect(defaulted.settings.powerFactor).toBe(DEFAULT_POWER_FACTOR);
    expect(defaulted.settingsProvenance.powerFactor).toBe('default');
    expect(defaulted.issues[0]).toEqual({ code: 'setting-default:powerFactor', severity: 'reported', target: { kind: 'settings', id: 'powerFactor' }, params: { value: DEFAULT_POWER_FACTOR } });
    expect(stored.settingsProvenance.powerFactor).toBe('project');
    expect(stored.issues.some((i) => i.code.startsWith('setting-default:'))).toBe(false);
    // only the marking differs: the issues after the marker, and every number, are the same
    expect(defaulted.issues.slice(1)).toEqual(stored.issues);
    expect(JSON.stringify([...defaulted.legacy.bySpan.values()])).toBe(JSON.stringify([...stored.legacy.bySpan.values()]));
    expect(JSON.stringify([...defaulted.legacy.byPole.entries()])).toBe(JSON.stringify([...stored.legacy.byPole.entries()]));
    // studyWith never defaults: a missing power factor stays missing (and blocks, as in the existing engine)
    const raw = studyWith(doc({ ...g.settings, powerFactor: undefined }), { ...g.settings, powerFactor: undefined });
    expect(raw.settingsProvenance.powerFactor).toBe('missing');
    expect(raw.issues.some((i) => i.code === 'setting-default:powerFactor')).toBe(false);
    expect(raw.issues.some((i) => i.code === 'setting-missing:powerFactor')).toBe(true);
  });

  it('R2: over all golden networks, the marker appears exactly when no power factor is stored', () => {
    for (const g of CASES) {
      const s = runStudy({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: g.settings });
      const marked = s.issues.filter((i) => i.code === 'setting-default:powerFactor').length;
      expect(marked, g.name).toBe(g.settings.powerFactor === undefined ? 1 : 0);
      expect(s.settingsProvenance.powerFactor).toBe(g.settings.powerFactor === undefined ? 'default' : 'project');
    }
  });

  it('a network issue points at the element it is about', () => {
    expect(networkIssueTarget({ kind: 'orphan-consumer', consumerId: 'u1', poleId: 'p', color: '#f00' })).toEqual({ kind: 'consumer', id: 'u1' });
    expect(networkIssueTarget({ kind: 'three-phase-on-single-phase', spanKey: 'c#0' })).toEqual({ kind: 'span', id: 'c#0' });
    expect(networkIssueTarget({ kind: 'loop', poleIds: ['a', 'b'] })).toEqual({ kind: 'pole', id: 'a|b' });
    expect(networkIssueTarget({ kind: 'legacy-jumper', elementId: 'j' })).toEqual({ kind: 'element', id: 'j' });
  });
});

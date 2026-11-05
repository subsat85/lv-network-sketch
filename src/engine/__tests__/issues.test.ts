import { describe, expect, it } from 'vitest';
import { goldenCases, goldenTreeCases } from '../../utils/__tests__/vdGoldenNetworks';
import { networkIssueTarget } from '../issues';
import { runStudyE2 } from '../e2';
import type { CableElement, DrawingElement } from '../../types/drawing';
import { buildNetwork } from '../../utils/network';
import { normalizeElements } from '../../utils/spanModel';
import { networkOptions } from '../../utils/spanLength';
import { DEFAULT_ELECTRICAL, DEFAULT_POWER_FACTOR } from '../../utils/electricalSettings';

// The problems of the drawing's network, as E2 reports them (DataIssue): each once, pointing at
// the element it is about. ALL VALUES SYNTHETIC.

const CASES = [...goldenCases(), ...goldenTreeCases()];
const study = (g: (typeof CASES)[number], electrical = g.settings) =>
  runStudyE2({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical }, { inputOrigin: 'legacy-project' });

describe('DataIssue of the network (E2)', () => {
  it('R1: every junction the auto rule made (the list the app shows for review) is one DataIssue, with its pole, cable and end', () => {
    let total = 0;
    for (const g of CASES) {
      const n = buildNetwork(g.elements, networkOptions(g.settings));
      const expected = n.circuits.flatMap((c) => c.inferredJunctions.map((j) => ({ c: c.id, j })));
      const got = study(g).issues.filter((i) => i.code === 'network:inferred-junction');
      expect(got.length, g.name).toBe(expected.length);
      got.forEach((i, k) => {
        const { c, j } = expected[k];
        expect(i).toEqual({ code: 'network:inferred-junction', severity: 'reported', target: { kind: 'pole', id: j.poleId }, params: { circuitId: c, cableId: j.cableId, end: j.end, withCableIds: j.withCableIds.join(','), source: 'drawing-network' } });
      });
      expect(got.length, g.name).toBe(n.inferredJunctions.length);
      total += got.length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it('R1: a drawing with an auto junction (two red cables meeting at a pole) reports it; a confirmed end link does not', () => {
    const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
    const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}) => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2, ...extra }) as CableElement;
    const build = (extra: Partial<CableElement>) => normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], extra)]);
    const S = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 };
    const issues = (els: DrawingElement[]) => runStudyE2({ elements: els, connectionDistances: {}, distanceFlags: {}, electrical: S }, { inputOrigin: 'legacy-project' }).issues;
    const auto = issues(build({})).filter((i) => i.code === 'network:inferred-junction');
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((i) => i.target.id === 'A')).toBe(true);
    const confirmed = issues(build({ endLinks: { start: 'connected' } })).filter((i) => i.code === 'network:inferred-junction' && i.params?.cableId === 'c2');
    expect(confirmed).toEqual([]);
  });

  it('R2: a power factor taken from the default is reported and marked; a stored one is not; the numbers are the same', () => {
    const g = CASES.find((c) => c.settings.powerFactor !== undefined)!;
    const defaulted = study(g, { ...g.settings, powerFactor: undefined });
    const stored = study(g, { ...g.settings, powerFactor: DEFAULT_POWER_FACTOR });
    expect(defaulted.settings.powerFactor).toBe(DEFAULT_POWER_FACTOR);
    expect(defaulted.settingsProvenance.powerFactor).toBe('default');
    expect(defaulted.issues[0]).toEqual({ code: 'setting-default:powerFactor', severity: 'reported', target: { kind: 'settings', id: 'powerFactor' }, params: { value: DEFAULT_POWER_FACTOR } });
    expect(stored.settingsProvenance.powerFactor).toBe('project');
    expect(stored.issues.some((i) => i.code.startsWith('setting-default:'))).toBe(false);
    expect(defaulted.issues.slice(1)).toEqual(stored.issues);
    // the numbers are the same (only the marking of the power factor differs)
    const nums = (r: typeof stored) => JSON.stringify(r.circuits, (k, v) => (k === 'warnings' || k === 'provenance' || k === 'status' || k === 'inputs' ? undefined : v));
    expect(nums(defaulted)).toBe(nums(stored));
  });

  it('a network issue points at the element it is about', () => {
    expect(networkIssueTarget({ kind: 'orphan-consumer', consumerId: 'u1', poleId: 'p', color: '#f00' })).toEqual({ kind: 'consumer', id: 'u1' });
    expect(networkIssueTarget({ kind: 'three-phase-on-single-phase', spanKey: 'c#0' })).toEqual({ kind: 'span', id: 'c#0' });
    expect(networkIssueTarget({ kind: 'loop', poleIds: ['a', 'b'] })).toEqual({ kind: 'pole', id: 'a|b' });
    expect(networkIssueTarget({ kind: 'legacy-jumper', elementId: 'j' })).toEqual({ kind: 'element', id: 'j' });
  });
});

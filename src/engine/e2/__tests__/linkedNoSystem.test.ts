import { describe, expect, it } from 'vitest';
import type { CableTypeData } from '../../../types/cableType';
import { createCableType, latestRevision } from '../../../utils/cableTypeModel';
import { linkSpanCable } from '../../../utils/spanCableLink';
import { runStudyE2 } from '../index';
import type { CircuitResult } from '../model';
import { drawing } from './references';

// A span linked to a library cable is calculated by E2 from its snapshot. A span saved without a
// supply system is read with the approved default, 3ph+N (utils/supplySystem.ts) — exactly as if 3ph+N
// were written on it, and the input says it is the default. The cable's values still come only from
// its snapshot. ALL VALUES ARE SYNTHETIC.

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'unverified' } }) as never;
const REV = latestRevision(createCableType('ct_3x120', {
  name: '3x120 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 120 }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(0.2145, 'unspecified'), x: v(0.0716, 'ac-50hz'), rn: v(0.4126, 'unspecified'), xn: v(0.0754, 'ac-50hz'), source: { name: 'synthetic' },
} as CableTypeData, { now: 1 }));
const circuit = (system?: '3ph4w' | '1ph2w') => {
  const { poles: _p, ...props } = linkSpanCable(system ? { poles: ['T', 'A'], system } : undefined, ['T', 'A'], REV, 1);
  const { doc } = drawing({ Lm: 40, props, consumers: [{ variant: 'square', label: '40' }] });
  return runStudyE2(doc, { inputOrigin: 'legacy-project' }).circuits.find((x) => x.spans.length)! as CircuitResult;
};
const run = (system?: '3ph4w') => circuit(system).nodes.find((n) => n.poleId === 'A')!.dropV.a;

describe('E2 and a linked span\'s supply system', () => {
  it('system set: calculated from the snapshot (40 A × (0.2145·0.9 + 0.0716·0.43589) × 0.04 km)', () => {
    const d = run('3ph4w');
    expect(d.status).not.toBe('unavailable');
    expect((d as { value: number }).value).toBeCloseTo(40 * (0.2145 * 0.9 + 0.0716 * Math.sqrt(1 - 0.81)) * 0.04, 4); // the usual approximation; E2 solves the phasors
  });
  it('no system stored: calculated with the default 3ph+N, the same value as 3ph+N written on the span', () => {
    const d = run();
    expect(d.status).not.toBe('unavailable');
    expect((d as { value: number }).value).toBeCloseTo((run('3ph4w') as { value: number }).value, 12);
    // the input is the default, never «not set»
    const span = circuit().spans[0];
    expect(JSON.stringify(span)).not.toContain('system-missing');
    const sys = JSON.stringify(circuit()).match(/"name":"system","element":"[^"]+","provenance":"([a-z]+)","value":"([0-9a-z]+)"/);
    expect(sys?.slice(1)).toEqual(['default', '3ph4w']);
    const explicit = JSON.stringify(circuit('3ph4w')).match(/"name":"system","element":"[^"]+","provenance":"([a-z]+)"/);
    expect(explicit?.[1]).toBe('project');
  });
});

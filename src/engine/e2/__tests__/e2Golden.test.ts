import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { goldenCases, goldenTreeCases } from '../../../utils/__tests__/vdGoldenNetworks';
import { digest, e2Raw } from './e2GoldenDigest';

// E2's equations did not change when the former engine was removed: the 240 golden networks give exactly the
// numbers, phasors, reasons and structure E2 gave at bbfe219 (recorded from that commit, before
// this change), with no phase allocation as the app had then. And the results with each
// Single-Phase Load Allocation Method are recorded too (regression record of this change).
const golden = JSON.parse(readFileSync(new URL('./fixtures/e2-golden.json', import.meta.url), 'utf8')) as Record<'noAllocation' | 'worst' | 'balanced', Record<string, string>>;
const cases = [...goldenCases(), ...goldenTreeCases()];

describe('E2 golden record (240 networks)', () => {
  it('covers 240 networks', () => {
    expect(cases).toHaveLength(240);
    expect(Object.keys(golden.noAllocation)).toHaveLength(240);
  });
  it.each(cases.map((c) => [c.name, c] as const))('%s: same E2 result as bbfe219 (no allocation)', (_n, c) => {
    expect(digest(e2Raw(c))).toBe(golden.noAllocation[c.name]);
  });
  it('the allocation methods: same results as recorded', () => {
    for (const c of cases) {
      expect(digest(e2Raw(c, 'worst')), c.name).toBe(golden.worst[c.name]);
      expect(digest(e2Raw(c, 'balanced')), c.name).toBe(golden.balanced[c.name]);
    }
  });
});

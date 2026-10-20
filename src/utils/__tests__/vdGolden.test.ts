import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { goldenCases, goldenTreeCases, goldenOutput } from './vdGoldenNetworks';

// Stage 7.9: results of projects without the new settings (cable end links, load
// model) must be exactly what the Stage 7.8 code produced. The fixture was
// recorded from the 7.8 code before any 7.9 change: 240 networks (random ones
// with every kind of problem, and radial trees with complete data).
const golden = JSON.parse(readFileSync(new URL('./fixtures/vd-golden-7_8.json', import.meta.url), 'utf8'));

describe('existing projects give the same results as before (golden, recorded from 7.8)', () => {
  const cases = [...goldenCases(), ...goldenTreeCases()];
  it('covers enough: 240 networks, > 500 computed spans', () => {
    expect(cases).toHaveLength(240);
    const computed = Object.values(golden as Record<string, { spans: { ok: boolean }[] }>).reduce((n, o) => n + o.spans.filter((s) => s.ok).length, 0);
    expect(computed).toBeGreaterThan(500);
  });
  it.each(cases.map((c) => [c.name, c] as const))('%s: topology, statuses, drops and pole results unchanged', (_n, c) => {
    expect(goldenOutput(c)).toEqual(golden[c.name]);
  });
});

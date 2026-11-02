import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { goldenCases, goldenTreeCases, goldenOutput } from './vdGoldenNetworks';

// Stage 7.9: results of projects without the new settings (cable end links, load
// model) must stay exactly as recorded: 240 networks (random ones with every kind of
// problem, and radial trees with complete data).
// Re-recorded when the conductor tables were removed (company table and IEC 60228, the
// default-cable change): R and Rn are only entered values. The trees now carry entered
// SYNTHETIC R / Rn (vdGoldenNetworks.ts); spans of the random networks that relied on the
// table are now missing their resistance. Spans computed before and now (their R entered)
// have identical results (checked when re-recording: 6 of 6).
const golden = JSON.parse(readFileSync(new URL('./fixtures/vd-golden-no-tables.json', import.meta.url), 'utf8'));

describe('existing projects give the same results as recorded (golden, no conductor tables)', () => {
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

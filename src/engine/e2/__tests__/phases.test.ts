import { describe, expect, it } from 'vitest';
import { consumerPhases, EMPTY_ALLOCATION, spanPhase, type PhaseAllocation } from '../phases';
import { runStudyE2 } from '../index';
import { drawing, synCatalogue } from './references';

// Phase allocation rules 1–6 (design section 4). Nothing is ever allocated by default.

const alloc = (consumers: PhaseAllocation['consumers'], singlePhaseSpans: PhaseAllocation['singlePhaseSpans'] = {}): PhaseAllocation => ({ consumers, singlePhaseSpans });

describe('phase allocation', () => {
  it('rule 1: the counts add up to the consumer count, or it is invalid (never corrected)', () => {
    expect(consumerPhases(alloc({ u: { a: 2, b: 1, source: 'design' } }), 'u', 'single', 3)).toMatchObject({ status: 'ok', counts: { a: 2, b: 1, c: 0 } });
    expect(consumerPhases(alloc({ u: { a: 2, source: 'design' } }), 'u', 'single', 3)).toEqual({ status: 'invalid', problem: 'sum' });
    expect(consumerPhases(alloc({ u: { a: 1.5, b: 1.5, source: 'design' } }), 'u', 'single', 3)).toEqual({ status: 'invalid', problem: 'count' });
  });
  it('rule 2: a three-phase consumer is not allocated', () => {
    expect(consumerPhases(alloc({ u: { a: 1, source: 'design' } }), 'u', 'three', 1)).toEqual({ status: 'invalid', problem: 'three-phase' });
  });
  it('no allocation → missing (no default)', () => {
    expect(consumerPhases(EMPTY_ALLOCATION, 'u', 'single', 1)).toEqual({ status: 'missing' });
    expect(spanPhase(EMPTY_ALLOCATION, 'k#0')).toBeUndefined();
  });
  it('rule 6: the allocation source is carried into the inputs; an unknown source is refused', () => {
    expect(consumerPhases(alloc({ u: { a: 1, source: 'guess' as never } }), 'u', 'single', 1)).toEqual({ status: 'invalid', problem: 'source' });
    const { doc } = drawing({ Lm: 100, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }] });
    const r = runStudyE2(doc, { inputOrigin: 'legacy-project', catalogue: synCatalogue(), catalogueSelection: { k1: { entryId: 'syn-4x70' } }, allocation: alloc({ u0: { a: 5, source: 'site-survey', reference: 'survey 12', verification: { status: 'checked' } } }) });
    const c = r.circuits.find((x) => x.spans.length)!;
    expect(c.loads[0].currentA.a.inputs).toContainEqual(expect.objectContaining({ name: 'phase', provenance: 'allocation', ref: 'site-survey' }));
  });
  it('an invalid allocation stops the circuit (not-run); a missing one leaves it unavailable', () => {
    const { doc } = drawing({ Lm: 100, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }] });
    const base = { inputOrigin: 'legacy-project' as const, catalogue: synCatalogue(), catalogueSelection: { k1: { entryId: 'syn-4x70' } } };
    const bad = runStudyE2(doc, { ...base, allocation: alloc({ u0: { a: 4, source: 'design' } }) }).circuits.find((x) => x.spans.length)!;
    expect(bad.solve.status).toBe('not-run');
    expect(bad.solve.reason).toBe('phase-allocation-invalid');
    const none = runStudyE2(doc, base).circuits.find((x) => x.spans.length)!;
    expect(none.nodes.find((n) => n.poleId === 'A')!.dropV.a.reason).toBe('phase-allocation-missing');
  });
  it('rules 3 and 4: a 1ph2w span carries its subscribers on its phase (explicit allocation, Q7); a conflicting allocation is refused; no phase → not available', () => {
    const props = { system: '1ph2w' as const, cableKind: 'underground' as const, parallel: 1 };
    const { doc } = drawing({ Lm: 100, props, consumers: [{ variant: 'circle', count: 5 }] });
    const base = { inputOrigin: 'legacy-project' as const, catalogue: synCatalogue(), catalogueSelection: { k1: { entryId: 'syn-4x70' } } };
    const checked = { verification: { status: 'checked' as const } };
    // Q7: the span's phase is not given to its subscribers; their allocation is written explicitly
    const onB = runStudyE2(doc, { ...base, allocation: alloc({ u0: { b: 5, source: 'design', ...checked } }, { 'k1#0': { phase: 'b', source: 'design', ...checked } }) }).circuits.find((x) => x.spans.length)!;
    const A = onB.nodes.find((n) => n.poleId === 'A')!;
    expect(A.dropV.b.value).toBeGreaterThan(0);
    expect(A.voltage.a.reason).toBe('phase-not-present');
    const conflict = runStudyE2(doc, { ...base, allocation: alloc({ u0: { a: 5, source: 'design' } }, { 'k1#0': { phase: 'b', source: 'design' } }) }).circuits.find((x) => x.spans.length)!;
    expect(conflict.solve.reason).toBe('phase-allocation-conflict');
    const noPhase = runStudyE2(doc, base).circuits.find((x) => x.spans.length)!;
    expect(noPhase.nodes.find((n) => n.poleId === 'A')!.dropV.b.status).toBe('unavailable');
  });
  it('rule 5: partial allocation — the allocated circuit is computed, the other is not', () => {
    const { doc } = drawing({ Lm: 100, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }, { variant: 'circle', count: 5 }] });
    const r = runStudyE2(doc, { inputOrigin: 'legacy-project', catalogue: synCatalogue(), catalogueSelection: { k1: { entryId: 'syn-4x70' } }, allocation: alloc({ u0: { a: 5, source: 'design', verification: { status: 'checked' } } }) });
    const c = r.circuits.find((x) => x.spans.length)!;
    // the same circuit carries an unallocated load: nothing of it is computed
    expect(c.nodes.find((n) => n.poleId === 'A')!.dropV.a.reason).toBe('phase-allocation-missing');
    expect(c.loads.find((l) => l.consumerId === 'u0')!.currentA.a.value).toBe(20);
    expect(c.loads.find((l) => l.consumerId === 'u1')!.currentA.a.value).toBeUndefined();
  });
});

describe('Q7 no phase inheritance from a 1ph2w span', () => {
  const props = { system: '1ph2w' as const, cableKind: 'underground' as const, parallel: 1 };
  const base = { inputOrigin: 'legacy-project' as const, catalogue: synCatalogue(), catalogueSelection: { k1: { entryId: 'syn-4x70' } } };
  const checked = { verification: { status: 'checked' as const } };
  const SPAN_B = { 'k1#0': { phase: 'b' as const, source: 'design' as const, ...checked } };
  const study = (allocation: PhaseAllocation) => runStudyE2(drawing({ Lm: 100, props, consumers: [{ variant: 'circle', count: 5 }] }).doc, { ...base, allocation }).circuits.find((x) => x.spans.length)!;
  it('1. a consumer on a 1ph2w span of phase b without its own allocation gets no phase', () => {
    const c = study(alloc({}, SPAN_B));
    const l = c.loads[0];
    for (const p of ['a', 'b', 'c'] as const) expect(l.currentA[p]).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
    expect(JSON.stringify(l)).not.toContain('"name":"phase"');
    expect(c.solve).toMatchObject({ status: 'not-run', reason: 'phase-allocation-missing', blockedBy: ['u0'] });
  });
  it('2. with an explicit valid allocation it is calculated on that phase', () => {
    const c = study(alloc({ u0: { b: 5, source: 'site-survey', ...checked } }, SPAN_B));
    expect(c.solve.status).toBe('provisional');
    expect(c.loads[0].currentA.b.value).toBe(20);
    expect(c.loads[0].currentA.b.inputs).toContainEqual(expect.objectContaining({ name: 'phase', provenance: 'allocation', value: 'a0 b5 c0', ref: 'site-survey' }));
    const A = c.nodes.find((n) => n.poleId === 'A')!;
    expect(A.dropV.b.value).toBeGreaterThan(0);
    expect(A.dropV.b.warnings).toEqual(['load-default']);
    expect(A.voltage.a.reason).toBe('phase-not-present');
  });
  it('3. a missing allocation never gives a computed (or provisional) voltage, drop, current or loss', () => {
    for (const allocation of [alloc({}, SPAN_B), EMPTY_ALLOCATION]) {
      const c = study(allocation);
      const A = c.nodes.find((n) => n.poleId === 'A')!;
      const s = c.spans[0];
      for (const q of [A.voltage.b, A.dropV.b, A.dropPercent.b, A.neutralShiftV, s.current.b, s.current.n, s.dropV.b, s.pLossW, s.qAbsorbedVar, c.pLossW, c.qAbsorbedVar]) {
        expect(q.status, JSON.stringify(q)).not.toMatch(/computed|provisional/);
        expect(q.value).toBeUndefined();
      }
    }
  });
  it('the verification field of a 1ph2w span: missing → allocation-unverified; invalid → refused', () => {
    const unverified = study(alloc({ u0: { b: 5, source: 'design', ...checked } }, { 'k1#0': { phase: 'b', source: 'design' } }));
    expect(unverified.nodes.find((n) => n.poleId === 'A')!.dropV.b.warnings.slice().sort()).toEqual(['allocation-unverified', 'load-default']);
    expect(spanPhase(alloc({}, { 'k1#0': { phase: 'b', source: 'design', verification: { status: 'maybe' as never } } }), 'k1#0')).toBe('invalid');
    expect(spanPhase(alloc({}, { 'k1#0': { phase: 'b', source: 'design', verification: { status: 'approved', by: 'synthetic', on: '2026-10-31' } } }), 'k1#0')).toEqual({ phase: 'b', source: 'design', verified: true });
    // F9: approved without by / on is not approved
    expect(spanPhase(alloc({}, { 'k1#0': { phase: 'b', source: 'design', verification: { status: 'approved' } } }), 'k1#0')).toEqual({ phase: 'b', source: 'design', verified: false, approvalIncomplete: true });
    expect(consumerPhases(alloc({ u: { a: 1, source: 'design' } }), 'u', 'single', 1)).toMatchObject({ status: 'ok', verified: false });
    expect(consumerPhases(alloc({ u: { a: 1, source: 'design', verification: { status: 'unverified' } } }), 'u', 'single', 1)).toMatchObject({ status: 'ok', verified: false });
  });
});

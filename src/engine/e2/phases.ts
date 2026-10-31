// E2: phase allocation — an explicit input only (an API parameter, not stored in the
// project). Nothing is allocated by default: a single-phase load with no phase stays
// without one, and every result that needs it is not available.

export type Phase = 'a' | 'b' | 'c';
export const PHASES: readonly Phase[] = ['a', 'b', 'c'];
export type AllocationSource = 'site-survey' | 'design' | 'utility-record';
const SOURCES: ReadonlySet<string> = new Set<AllocationSource>(['site-survey', 'design', 'utility-record']);

/**
 * Who checked the allocation against the network, as given by the user. A source is not a
 * verification: a missing field counts as 'unverified' (results provisional, 'allocation-unverified').
 * The engine only reads it; it never infers or grants a verification.
 *   unverified — nothing else needed;
 *   checked    — `by` and `on` optional;
 *   approved   — `by` and `on` both required (F9): without them it is NOT approved — treated as
 *                unverified (provisional), with the issue 'allocation:approval-incomplete'.
 * `by` / `on`, when present, must be text; anything else is an invalid input (not-run).
 */
export type VerificationStatus = 'unverified' | 'checked' | 'approved';
const VERIFICATIONS: ReadonlySet<string> = new Set<VerificationStatus>(['unverified', 'checked', 'approved']);
export interface AllocationVerification { status: VerificationStatus; by?: string; on?: string }
/** the result of reading a verification */
type Verification = 'verified' | 'unverified' | 'approval-incomplete' | 'invalid';

export interface PhaseAllocation {
  /** per consumer: how many of its `count` subscribers sit on each phase */
  consumers: Record<string, { a?: number; b?: number; c?: number; source: AllocationSource; reference?: string; verification?: AllocationVerification }>;
  /** per 1ph2w span (`cableId#index`): the phase it is tapped on */
  singlePhaseSpans: Record<string, { phase: Phase; source: AllocationSource; reference?: string; verification?: AllocationVerification }>;
}

export const EMPTY_ALLOCATION: PhaseAllocation = { consumers: {}, singlePhaseSpans: {} };

export type ConsumerPhases =
  | { status: 'ok'; counts: Record<Phase, number>; source: AllocationSource; reference?: string; verified: boolean; approvalIncomplete?: true }
  | { status: 'missing' }
  | { status: 'invalid'; problem: 'sum' | 'three-phase' | 'source' | 'count' | 'verification' };

const whole = (n: unknown) => n === undefined || (typeof n === 'number' && Number.isInteger(n) && n >= 0);
const text = (x: unknown) => x === undefined || typeof x === 'string';
const filled = (x: string | undefined) => !!x && x.trim() !== '';
/** missing / 'unverified' → unverified; 'checked' → verified; 'approved' → verified only with by and on */
const verification = (v: AllocationVerification | undefined): Verification => {
  if (v === undefined) return 'unverified';
  if (!v || typeof v !== 'object' || !VERIFICATIONS.has(v.status) || !text(v.by) || !text(v.on)) return 'invalid';
  if (v.status === 'unverified') return 'unverified';
  if (v.status === 'checked') return 'verified';
  return filled(v.by) && filled(v.on) ? 'verified' : 'approval-incomplete';
};

/** Rules 1 and 2: the counts add up to the consumer's count; a three-phase consumer is not allocated. */
export const consumerPhases = (allocation: PhaseAllocation, consumerId: string, kind: 'single' | 'three', count: number): ConsumerPhases => {
  const a = allocation.consumers[consumerId];
  if (!a) return { status: 'missing' };
  if (kind === 'three') return { status: 'invalid', problem: 'three-phase' };
  if (!SOURCES.has(a.source)) return { status: 'invalid', problem: 'source' };
  const ver = verification(a.verification);
  if (ver === 'invalid') return { status: 'invalid', problem: 'verification' };
  if (!whole(a.a) || !whole(a.b) || !whole(a.c)) return { status: 'invalid', problem: 'count' };
  const counts = { a: a.a ?? 0, b: a.b ?? 0, c: a.c ?? 0 };
  if (counts.a + counts.b + counts.c !== count) return { status: 'invalid', problem: 'sum' };
  return { status: 'ok', counts, source: a.source, ...(a.reference ? { reference: a.reference } : {}), verified: ver === 'verified', ...(ver === 'approval-incomplete' ? { approvalIncomplete: true as const } : {}) };
};

/** The phase a 1ph2w span is tapped on, or undefined (rule 4: then the spans above it have no per-phase result). */
export const spanPhase = (allocation: PhaseAllocation, spanKey: string): { phase: Phase; source: AllocationSource; verified: boolean; approvalIncomplete?: true } | 'invalid' | undefined => {
  const s = allocation.singlePhaseSpans[spanKey];
  if (!s) return undefined;
  if (!(PHASES as readonly string[]).includes(s.phase) || !SOURCES.has(s.source)) return 'invalid';
  const ver = verification(s.verification);
  return ver === 'invalid' ? 'invalid' : { phase: s.phase, source: s.source, verified: ver === 'verified', ...(ver === 'approval-incomplete' ? { approvalIncomplete: true as const } : {}) };
};

// E2: the drop limits of the settings, applied to each phase (design section 6).
//   over — drop % > limitPercent, or Vpn < minPhaseVoltage, or a line voltage < minLineVoltage;
//   near — drop % ≥ nearLimitFraction × limitPercent;
// a node takes the worst of its phases; one phase without a value → 'na' (never 'ok').

import type { LimitStatus, SolveSettings } from './model';

export type LimitSettings = Pick<SolveSettings, 'limitPercent' | 'nearLimitFraction' | 'minPhaseVoltage' | 'minLineVoltage'>;

/** one phase: its drop % and phase-to-neutral voltage */
export const phaseLimit = (percent: number, vpn: number, s: LimitSettings): Exclude<LimitStatus, 'na'> =>
  percent > s.limitPercent || vpn < s.minPhaseVoltage ? 'over' : percent >= s.nearLimitFraction * s.limitPercent ? 'near' : 'ok';

const RANK: Record<LimitStatus, number> = { ok: 0, near: 1, over: 2, na: 3 };

/** a node: every present phase (undefined = no value), and its line voltages (undefined = no value) */
export const nodeLimit = (phases: ({ percent: number; vpn: number } | undefined)[], lines: (number | undefined)[], s: LimitSettings): LimitStatus => {
  if (!phases.length || phases.some((p) => p === undefined) || lines.some((v) => v === undefined)) return 'na';
  let worst: LimitStatus = 'ok';
  for (const p of phases) { const st = phaseLimit(p!.percent, p!.vpn, s); if (RANK[st] > RANK[worst]) worst = st; }
  if (lines.some((v) => v! < s.minLineVoltage)) worst = 'over';
  return worst;
};

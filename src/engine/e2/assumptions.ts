// E2: the engineering assumptions of the model, as text. Each result lists the ones it rests on.

import type { AssumptionId } from './quantity';

export const ASSUMPTIONS: Record<AssumptionId, { text: string; ref: string }> = {
  A1: { text: 'Ideal source at the LV busbar: nominal phase voltage, no transformer or upstream impedance (not stored in the project).', ref: 'design D2' },
  A2: { text: 'No mutual coupling between conductors: exact for balanced currents with the positive-sequence X of a catalogue, an approximation when the currents are unbalanced.', ref: 'design D3' },
  A3: { text: 'No earth return: the neutral is earthed at the source only; repeated earthing is not modelled.', ref: 'design section 2' },
  A4: { text: 'Fundamental 50 Hz only: no harmonics (no triplen neutral current).', ref: 'design section 2' },
  A5: { text: 'Conductor resistance at the operating temperature of the settings (F8 for DC values at 20 °C); a catalogue AC value is used at the temperature it states.', ref: 'design F8, D9' },
  A6: { text: 'Loads from the load rules (4 A per single-phase subscriber, the label or 32 A per phase for three-phase), no diversity factor; one power factor for all loads.', ref: 'design section 2' },
  A7: { text: 'Constant-current load: |I| from the load rule, power-factor angle referred to the voltage of its own node (D1-LOC), solved by iteration; the fixed phasor at the source angle is only the starting point.', ref: 'design D1' },
  A8: { text: 'Identical complete cable sets in parallel share the current equally, with no coupling between them.', ref: 'design F3, D10' },
};

/** the assumptions of every phasor result of a circuit */
export const baseAssumptions = (unbalanced: boolean, parallelSets: boolean): AssumptionId[] =>
  ['A1', ...(unbalanced ? (['A2'] as const) : []), 'A3', 'A4', 'A5', 'A6', 'A7', ...(parallelSets ? (['A8'] as const) : [])];

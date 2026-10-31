// E2: F6 — active loss and reactive power absorbed in the series impedance of a span,
// two separate quantities (W and var), never added together. With n conductors in
// parallel each carries I/n, so n·|I/n|²·R·L = |I|²·R·L/n: the span impedance already
// holds L/n. The neutral term is used only when the neutral carries current.

import { abs, type C } from './complex';

export interface SpanCurrents { phase: { i: C; z: C }[]; neutral?: { i: C; z: C } }

export const spanLosses = (s: SpanCurrents): { p: number; q: number } => {
  let p = 0, q = 0;
  for (const { i, z } of [...s.phase, ...(s.neutral ? [s.neutral] : [])]) {
    const i2 = abs(i) ** 2;
    p += i2 * z.re;
    q += i2 * z.im;
  }
  return { p, q };
};

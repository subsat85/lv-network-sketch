import type { SpanProps, SupplySystem } from '../types/drawing';

/**
 * The approved default supply system of a span: three phases + N (400/230 V). A new span starts on it,
 * and a span saved without a supply system (an older project) is read with it. A supply system stored
 * on the span (3ph+N or 1ph+N) is always used as it is; nothing else is assumed (the cable's R, X, Rn
 * and Xn still come only from its data).
 */
export const DEFAULT_SUPPLY_SYSTEM: SupplySystem = '3ph4w';

/** the span's supply system: the stored one, or the default when none is stored */
export const supplySystemOf = (p: Pick<SpanProps, 'system'> | undefined): SupplySystem => p?.system ?? DEFAULT_SUPPLY_SYSTEM;

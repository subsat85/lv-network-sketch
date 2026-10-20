import type { DistanceFlag } from '../types/drawing';

// ---------------------------------------------------------------------------
// Span distances written as text on the drawing ("33.3"), handled as exact
// decimals so that splitting and re-joining never changes a total by rounding.
//
// Only plain decimal numbers count as numbers here ("40", "33.3", "12,5"); any
// other text ("40m", "abc") is never turned into a distance.
// ---------------------------------------------------------------------------

const PLAIN = /^\s*(\d+)(?:[.,](\d+))?\s*$/;

/** A plain positive-or-zero decimal as an integer number of 10^-d units, or null. */
export const parseDecimal = (s: string | undefined): { units: bigint; d: number } | null => {
  if (s === undefined) return null;
  const m = PLAIN.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  return { units: BigInt(m[1] + frac), d: frac.length };
};

export const isPlainDistance = (s: string | undefined) => parseDecimal(s) !== null;

const format = (units: bigint, d: number): string => {
  if (d === 0) return units.toString();
  const neg = units < 0n;
  const str = (neg ? -units : units).toString().padStart(d + 1, '0');
  let int = str.slice(0, str.length - d), frac = str.slice(str.length - d);
  frac = frac.replace(/0+$/, '');
  if (!int) int = '0';
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
};

/**
 * The two equal halves of a distance, exactly: "33.3" → "16.65" + "16.65",
 * "35" → "17.5" + "17.5". Their sum is the original value to the last digit.
 * Null for anything that is not a plain decimal.
 */
export const halveExact = (s: string | undefined): [string, string] | null => {
  const p = parseDecimal(s);
  if (!p || p.units === 0n) return null;
  const half = p.units % 2n === 0n ? format(p.units / 2n, p.d) : format(p.units * 5n, p.d + 1);
  return [half, half];
};

/** Exact sum of plain decimals, or null if one of them is not a plain decimal. */
export const addExact = (values: (string | undefined)[]): string | null => {
  const parts = values.map(parseDecimal);
  if (parts.some((p) => p === null)) return null;
  const d = Math.max(0, ...parts.map((p) => p!.d));
  const total = parts.reduce((acc, p) => acc + p!.units * 10n ** BigInt(d - p!.d), 0n);
  return format(total, d);
};


const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPoint = (v: unknown): v is { x: number; y: number } => isObj(v) && Number.isFinite(v.x as number) && Number.isFinite(v.y as number);

const readFlag = (v: unknown, depth = 0): DistanceFlag | null => {
  if (!isObj(v) || depth > 20) return null;
  const out: DistanceFlag = {};
  if (v.estimated !== undefined) { if (typeof v.estimated !== 'boolean') return null; if (v.estimated) out.estimated = true; }
  if (v.splitFrom !== undefined) {
    const sf = v.splitFrom;
    if (!isObj(sf) || typeof sf.key !== 'string' || typeof sf.value !== 'string') return null;
    out.splitFrom = { key: sf.key, value: sf.value };
    if (sf.offset !== undefined) { if (!isPoint(sf.offset)) return null; out.splitFrom.offset = { x: sf.offset.x, y: sf.offset.y }; }
    if (sf.flag !== undefined) { const inner = readFlag(sf.flag, depth + 1); if (!inner) return null; out.splitFrom.flag = inner; }
  }
  return out;
};

/** Distance markers read from a file / draft / saved project; malformed entries are reported. */
export const readDistanceFlags = (raw: unknown): { flags: Record<string, DistanceFlag>; invalid: string[] } => {
  const flags: Record<string, DistanceFlag> = {};
  const invalid: string[] = [];
  if (raw === undefined || raw === null) return { flags, invalid };
  if (!isObj(raw)) return { flags, invalid: ['distanceFlags'] };
  for (const [k, v] of Object.entries(raw)) {
    const f = readFlag(v);
    if (f) flags[k] = f; else invalid.push(k);
  }
  return { flags, invalid };
};

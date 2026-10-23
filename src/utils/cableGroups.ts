import type { CableElement, DrawingElement } from '../types/drawing';
import { buildNetwork, normColor, terminalKey, type Network } from './network';
import { poleNamer } from './poleNames';

// ---------------------------------------------------------------------------
// Grouping of the cables for the colour bar (a view only: it reads the drawing and
// changes nothing — no id, colour, connection or saved field).
//
// Scope (which transformer / supply a cable belongs to): not stored in the drawing, so
// it is taken from the electrical topology (network.ts, official calculation, no study
// options), and only where it does NOT rest on colour:
//   - the network is built twice: as drawn, and with every junction the 'auto' rule
//     made (same colour at a pole, not confirmed by the user) left open;
//   - a cable belongs to supply S only when BOTH give its network the single source S
//     (a transformer, or the pole the user chose as source) — so a cable attached to S
//     only through a same-colour junction, or a network with several transformers, no
//     source, or an ambiguous junction, is "not confirmed" instead;
//   - never from the drawing position.
// Colour groups: within a scope, one group per colour (compared as the calculation
// compares them: case and spaces ignored). The same colour under two supplies gives
// two groups — the cables stay separate, each with its own id.
// ---------------------------------------------------------------------------

export const UNASSIGNED_SCOPE = 'unassigned';
export const ALL_SCOPE = 'all';

export interface CableScope {
  /** source pole id, or UNASSIGNED_SCOPE */
  key: string;
  kind: 'transformer' | 'manual' | 'unassigned';
  label: string;
  cableIds: string[];
}

export interface ColourGroup {
  /** normalised colour (normColor) */
  key: string;
  /** colour to show (the first cable's own value) */
  color: string;
  cableIds: string[];
  /** spans of all its cables */
  spans: number;
}

export interface CableGrouping {
  /** supplies in drawing order of their pole, then the unassigned one (when it has cables) */
  scopes: CableScope[];
  /** cable id → scope key */
  scopeOf: Map<string, string>;
}

/** the single source of a cable's network, or null (unknown, several, none, or the cable spans several networks) */
const sourceOf = (net: Network, c: CableElement): { pole: string; kind: 'transformer' | 'manual' } | null => {
  let found: { pole: string; kind: 'transformer' | 'manual' } | null = null;
  let any = false;
  for (let i = 0; i < c.poleIds.length; i++) {
    const bus = net.busOfTerminal.get(terminalKey(c.id, i));
    if (!bus) continue;
    any = true;
    const circuit = net.circuitOfBus.get(bus);
    if (!circuit || !circuit.sourcePoleId || !(circuit.status === 'ok' || circuit.status === 'non-radial')) return null;
    const s = { pole: circuit.sourcePoleId, kind: circuit.sourceKind === 'manual' ? 'manual' as const : 'transformer' as const };
    if (found && (found.pole !== s.pole)) return null;
    found = s;
  }
  return any ? found : null;
};

/**
 * The drawing with every junction the 'auto' rule made left open (same colour, and no
 * end of it confirmed by the user — 'connected' on any end confirms the junction);
 * nothing else changes.
 */
const withoutColourJunctions = (elements: DrawingElement[], net: Network): DrawingElement[] => {
  const byId = new Map(elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c]));
  const confirmedAt = (cableId: string, poleId: string) => {
    const c = byId.get(cableId);
    if (!c || !c.poleIds.length) return false;
    const n = c.poleIds.length;
    return (c.poleIds[0] === poleId && (c.endLinks?.start ?? (n === 1 ? c.endLinks?.end : undefined)) === 'connected')
      || (n > 1 && c.poleIds[n - 1] === poleId && c.endLinks?.end === 'connected');
  };
  const open = new Map<string, Set<'start' | 'end'>>();
  for (const j of net.inferredJunctions) {
    if ([j.cableId, ...j.withCableIds].some((id) => confirmedAt(id, j.poleId))) continue;
    open.set(j.cableId, new Set([...(open.get(j.cableId) ?? []), j.end]));
  }
  if (!open.size) return elements;
  return elements.map((e) => {
    const ends = e.type === 'cable' ? open.get(e.id) : undefined;
    if (!ends) return e;
    const c = e as CableElement;
    return { ...c, endLinks: { ...c.endLinks, ...(ends.has('start') ? { start: 'isolated' as const } : {}), ...(ends.has('end') ? { end: 'isolated' as const } : {}) } };
  });
};

export const groupCables = (elements: DrawingElement[]): CableGrouping => {
  const cables = elements.filter((e): e is CableElement => e.type === 'cable');
  const scopeOf = new Map<string, string>();
  if (!cables.length) return { scopes: [], scopeOf };
  const asDrawn = buildNetwork(elements);
  const explicit = withoutColourJunctions(elements, asDrawn);
  const strict = explicit === elements ? asDrawn : buildNetwork(explicit);
  const name = poleNamer(elements);
  const kinds = new Map<string, 'transformer' | 'manual'>();
  for (const c of cables) {
    const a = sourceOf(asDrawn, c), b = sourceOf(strict, c);
    if (a && b && a.pole === b.pole && a.kind === b.kind) { scopeOf.set(c.id, a.pole); kinds.set(a.pole, a.kind); }
    else scopeOf.set(c.id, UNASSIGNED_SCOPE);
  }
  const order = new Map(elements.map((e, i) => [e.id, i]));
  const scopes: CableScope[] = [...kinds.entries()]
    .sort((x, y) => (order.get(x[0]) ?? 0) - (order.get(y[0]) ?? 0))
    .map(([pole, kind]) => ({ key: pole, kind, label: kind === 'manual' ? `مصدر: ${name(pole)}` : name(pole), cableIds: cables.filter((c) => scopeOf.get(c.id) === pole).map((c) => c.id) }));
  const rest = cables.filter((c) => scopeOf.get(c.id) === UNASSIGNED_SCOPE).map((c) => c.id);
  if (rest.length) scopes.push({ key: UNASSIGNED_SCOPE, kind: 'unassigned', label: 'غير مؤكَّد', cableIds: rest });
  return { scopes, scopeOf };
};

/** colour groups of the given cables (drawing order; one group per colour) */
export const colourGroups = (elements: DrawingElement[], cableIds?: Iterable<string>): ColourGroup[] => {
  const wanted = cableIds ? new Set(cableIds) : null;
  const out = new Map<string, ColourGroup>();
  for (const e of elements) {
    if (e.type !== 'cable' || (wanted && !wanted.has(e.id))) continue;
    const c = e as CableElement;
    const key = normColor(c.strokeColor);
    const g = out.get(key) ?? { key, color: c.strokeColor || '#000000', cableIds: [], spans: 0 };
    g.cableIds.push(c.id);
    g.spans += Math.max(0, c.poleIds.length - 1);
    out.set(key, g);
  }
  return [...out.values()];
};

/** a short name for a cable, in two parts: its first and last pole, and its number of spans */
export const cableLabelParts = (elements: DrawingElement[], c: CableElement, name = poleNamer(elements)) => {
  const spans = Math.max(0, c.poleIds.length - 1);
  const ends = c.poleIds.length ? `${name(c.poleIds[0])} ← ${name(c.poleIds[c.poleIds.length - 1])}` : 'بدون أعمدة';
  return { ends, spans: spans === 1 ? 'مقطع واحد' : spans === 2 ? 'مقطعان' : `${spans} مقاطع` };
};

/** the same as one line */
export const cableLabel = (elements: DrawingElement[], c: CableElement, name = poleNamer(elements)) => {
  const p = cableLabelParts(elements, c, name);
  return `${p.ends} · ${p.spans}`;
};

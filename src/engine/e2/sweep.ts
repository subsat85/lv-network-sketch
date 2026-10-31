// E2: backward / forward sweep on one radial circuit, four conductors a, b, c, N.
//
//   F1  constant current (D1-LOC): Ip = |Irule| · e^{j(∠Vpn,node − φ)}; the fixed phasor at
//       the source angle (FIX) is only the starting point of the iteration (k = 0)
//   F1′ constant power: S = Vph·|Irule|·e^{jφ}, Ip = conj(S / Vpn)
//   F2  span current = Σ downstream; IN = Ia + Ib + Ic, positive from the load to the source
//   F3  Vp(child) = Vp(parent) − Zp·Ip;  VN(child) = VN(parent) + ZN·IN;  Vpn = Vp − VN
//   F4  iteration until max |ΔVpn| < 1e-4 V, at most 100 passes; never a value before it converges
//   F5  ΔVp = Vph − |Vpn|, % of Vph; Vpq = |Vpn − Vqn|
//   F6  pLossW / qAbsorbedVar per span (losses.ts)
//
// ZN is not needed only when the WHOLE circuit is symmetric (Q1 = 1a, judged once for the circuit):
//   - every span of the circuit is 3ph4w, and
//   - at every node, the loads of that node together draw the same on a, b and c
//     (three-phase loads, and/or single-phase allocations whose totals per phase are equal), and
//   - no consumer of the circuit was left out of the calculation (orphan, unconnected proposal):
//     its phases are not known (F8).
// Then IN = 0 exactly by symmetry. Otherwise ZN and nN are needed on every span that carries
// current: with D1-LOC each current follows its local node voltage, and a neutral shift
// anywhere moves every node, so a symmetric part of the circuit is not enough.
// Nothing here assumes a value: what is missing is reported with its reason.

import { abs, add, arg, conj, deg, div, isFiniteC, mul, polar, rad, sub, ZERO, type C } from './complex';
import { baseAssumptions } from './assumptions';
import { nodeLimit } from './limits';
import { spanLosses } from './losses';
import { PHASES, type Phase } from './phases';
import { notRun, unavailable, valued, type AssumptionId, type FormulaId, type InputRef, type Phasor, type Quantity, type QuantityStatus, type UnavailableReason, type WarningCode } from './quantity';
import { CONDUCTORS, type CircuitResult, type Conductor, type E2Circuit, type E2Span, type LoadResult, type NodeResult, type SolveSettings, type SpanResult } from './model';

export const SWEEP_TOLERANCE_V = 1e-4;
export const SWEEP_MAX_ITERATIONS = 100;
const THETA: Record<Phase, number> = { a: 0, b: rad(-120), c: rad(120) };
const LINES = [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['ca', 'c', 'a']] as const;

const phasor = (z: C): Phasor => ({ magnitude: abs(z), angleDeg: abs(z) === 0 ? 0 : deg(arg(z)) });
const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const per = <K extends string, V>(keys: readonly K[], f: (k: K) => V): Record<K, V> => Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<K, V>;
const spanPhases = (s: E2Span): Phase[] => (s.system === '3ph4w' ? [...PHASES] : s.system === '1ph2w' && s.phase ? [s.phase] : []);

/** invalid inputs of a span (P3-1, F4, F5): the results behind it are not-run, never unavailable */
const INVALID: ReadonlySet<UnavailableReason> = new Set<UnavailableReason>(['parallel-invalid', 'phase-allocation-invalid']);
/** notRun: an invalid input blocks here */
interface Blocker { reason: UnavailableReason; element: string; notRun?: boolean }
type U = 'A' | 'V' | '%' | 'W' | 'var' | 'VA';
const blocked = <T = number>(unit: U, method: FormulaId, why: Blocker): Quantity<T> =>
  (why.notRun ? notRun<T>(unit, method, why.reason, [why.element]) : unavailable<T>(unit, method, why.reason, [why.element]));
/** why a conductor of the span has no result: no system, a 1ph2w span without its phase, or not on this span */
const absentReason = (sp: E2Span): UnavailableReason =>
  !sp.system ? 'system-missing' : sp.system === '1ph2w' && !sp.phase ? (sp.topologyReason ?? 'phase-allocation-missing') : 'phase-not-present';
/** warnings of the circuit that change a current (the power factor does not change |Irule|) */
const CURRENT_WARNINGS: ReadonlySet<WarningCode> = new Set<WarningCode>(['orphan-consumer-excluded', 'proposed-consumer-excluded']);

/** every result of a node / span not-run (an invalid input upstream) */
const notRunNode = (b: { id: string; poleId: string }, why: Blocker): NodeResult => ({
  bus: b.id, poleId: b.poleId,
  voltage: per(PHASES, () => blocked<Phasor>('V', 'F3', why)),
  neutralShiftV: blocked<Phasor>('V', 'F3', why),
  lineV: per(['ab', 'bc', 'ca'] as const, () => blocked('V', 'F5', why)),
  dropV: per(PHASES, () => blocked('V', 'F5', why)),
  dropPercent: per(PHASES, () => blocked('%', 'F5', why)),
  limit: 'na',
});
const notRunSpan = (sp: E2Span, why: Blocker): SpanResult => ({
  key: sp.key,
  current: per(CONDUCTORS, () => blocked<Phasor>('A', 'F2', why)),
  perSetCurrentA: per(CONDUCTORS, () => blocked('A', 'F2', why)),
  arithmeticSumA: per(CONDUCTORS, () => blocked('A', 'bound', why)),
  dropV: per(PHASES, () => blocked('V', 'F5', why)),
  pLossW: blocked('W', 'F6', why),
  qAbsorbedVar: blocked('var', 'F6', why),
});

const RANK: Record<QuantityStatus, number> = { computed: 0, provisional: 1, unavailable: 2, 'not-run': 3 };
/** F6: the worst status of the circuit's quantities; a phase the node does not have does not count */
const completenessOf = (r: Omit<CircuitResult, 'completeness'>): CircuitResult['completeness'] => {
  const qs: Quantity<unknown>[] = [r.pLossW, r.qAbsorbedVar];
  for (const n of r.nodes) qs.push(...Object.values(n.voltage), n.neutralShiftV, ...Object.values(n.lineV), ...Object.values(n.dropV), ...Object.values(n.dropPercent));
  for (const sp of r.spans) qs.push(...Object.values(sp.current), ...Object.values(sp.perSetCurrentA), ...Object.values(sp.arithmeticSumA), ...Object.values(sp.dropV), sp.pLossW, sp.qAbsorbedVar);
  for (const l of r.loads) qs.push(...Object.values(l.currentA), ...Object.values(l.apparentPowerVA ?? {}));
  let worst: Quantity<unknown> | undefined;
  for (const q of qs) if (q.reason !== 'phase-not-present' && (!worst || RANK[q.status] > RANK[worst.status])) worst = q;
  if (r.solve.status === 'not-run' && (!worst || RANK[worst.status] < RANK['not-run']) && !qs.length)
    return { status: 'not-run', ...(r.solve.reason ? { reason: r.solve.reason } : {}), ...(r.solve.blockedBy ? { blockedBy: r.solve.blockedBy } : {}) };
  if (!worst) return { status: r.solve.status };
  return { status: worst.status, ...(worst.reason ? { reason: worst.reason } : {}), ...(worst.blockedBy ? { blockedBy: worst.blockedBy } : {}) };
};

/** results of a circuit where nothing can be given (not-run, or not converged) */
const nothing = (circuit: E2Circuit, s: SolveSettings, make: <T>(unit: U) => Quantity<T>, solve: CircuitResult['solve'], keepPower: boolean): Omit<CircuitResult, 'completeness'> => ({
  id: circuit.id,
  solve,
  spans: circuit.spans.map((sp) => ({
    key: sp.key,
    current: per(CONDUCTORS, () => make<Phasor>('A')),
    perSetCurrentA: per(CONDUCTORS, () => make('A')),
    arithmeticSumA: per(CONDUCTORS, () => make('A')),
    dropV: per(PHASES, () => make('V')),
    pLossW: make('W'),
    qAbsorbedVar: make('var'),
  })),
  nodes: circuit.buses.map((b) => ({
    bus: b.id, poleId: b.poleId,
    voltage: per(PHASES, () => make<Phasor>('V')),
    neutralShiftV: make<Phasor>('V'),
    lineV: per(['ab', 'bc', 'ca'] as const, () => make('V')),
    dropV: per(PHASES, () => make('V')),
    dropPercent: per(PHASES, () => make('%')),
    limit: 'na',
  })),
  loads: circuit.loads.map((l) => ({
    consumerId: l.consumerId,
    currentA: per(PHASES, () => make('A')),
    ...(s.loadModel === 'constant-power' ? { apparentPowerVA: per(PHASES, (p) => (keepPower && l.perPhase ? valued(s.Vph * l.perPhase[p], 'VA', 'input', l.inputs, [], l.warnings) : make('VA'))) } : {}),
  })),
  pLossW: make('W'),
  qAbsorbedVar: make('var'),
});

export const solveCircuit = (circuit: E2Circuit, s: SolveSettings): CircuitResult => {
  const r = solveInner(circuit, s);
  return { ...r, completeness: completenessOf(r) };
};

const solveInner = (circuit: E2Circuit, s: SolveSettings): Omit<CircuitResult, 'completeness'> => {
  const model = s.loadModel;
  // 1. a topology problem of the existing network: nothing starts
  if (circuit.status !== 'ok' || !circuit.sourceBus) {
    const make = <T>(unit: U) => notRun<T>(unit, 'F3', 'circuit-not-computed', [circuit.id]);
    return nothing(circuit, s, make, { status: 'not-run', model, reason: 'circuit-not-computed', blockedBy: [circuit.id] }, false);
  }

  // topology helpers
  const spanTo = new Map(circuit.spans.map((sp) => [sp.toBus, sp]));
  const loadsAt = new Map<string, number[]>();
  circuit.loads.forEach((l, i) => loadsAt.set(l.bus, [...(loadsAt.get(l.bus) ?? []), i]));
  // loads in the subtree of each bus (children before parents)
  const subtree = new Map<string, number[]>();
  for (let k = circuit.buses.length - 1; k >= 0; k--) {
    const b = circuit.buses[k].id;
    subtree.set(b, [...(subtree.get(b) ?? []), ...(loadsAt.get(b) ?? [])]);
    const sp = spanTo.get(b);
    if (sp) subtree.set(sp.fromBus, [...(subtree.get(sp.fromBus) ?? []), ...subtree.get(b)!]);
  }
  const downstreamLoads = (sp: E2Span) => (subtree.get(sp.toBus) ?? []).map((i) => circuit.loads[i]);
  const carries = (sp: E2Span) => downstreamLoads(sp).some((l) => l.ruleA > 0);

  // 2. invalid inputs: the calculation does not start
  const hard: Blocker[] = [];
  for (const l of circuit.loads) {
    if (l.invalid) hard.push({ reason: 'invalid-load', element: l.consumerId });
    else if (l.phaseReason && l.phaseReason !== 'phase-allocation-missing') hard.push({ reason: l.phaseReason, element: l.consumerId });
  }
  for (const sp of circuit.spans) {
    if (!carries(sp)) continue;
    if (sp.topologyReason && INVALID.has(sp.topologyReason)) hard.push({ reason: sp.topologyReason, element: sp.key });
    else if (sp.zPhase.reason && INVALID.has(sp.zPhase.reason)) hard.push({ reason: sp.zPhase.reason, element: sp.key });
  }
  if (hard.length) {
    const make = <T>(unit: U) => notRun<T>(unit, 'F3', hard[0].reason, hard.map((h) => h.element));
    return nothing(circuit, s, make, { status: 'not-run', model, reason: hard[0].reason, blockedBy: hard.map((h) => h.element) }, false);
  }

  // 3. symmetry of the whole circuit (the only case where ZN is not needed)
  // (per node: the loads of one node together draw the same on a, b and c)
  const busTotals = new Map<string, Record<Phase, number> | null>();
  for (const l of circuit.loads) {
    if (l.ruleA === 0) continue;
    const t = busTotals.get(l.bus);
    if (t === null) continue;
    if (!l.perPhase) { busTotals.set(l.bus, null); continue; }
    busTotals.set(l.bus, per(PHASES, (p) => (t?.[p] ?? 0) + l.perPhase![p]));
  }
  const symmetric = !circuit.excludedConsumers?.length && circuit.spans.every((sp) => sp.system === '3ph4w') &&
    [...busTotals.values()].every((t) => t !== null && t.a === t.b && t.b === t.c);
  const needNeutral = !symmetric;

  // 4. what stops the sweep: an unknown phase, or a missing impedance on a span that carries current
  const soft: Blocker[] = [];
  for (const l of circuit.loads) if (l.ruleA > 0 && !l.perPhase) soft.push({ reason: l.phaseReason ?? 'phase-allocation-missing', element: l.consumerId });
  for (const sp of circuit.spans) {
    if (!carries(sp)) continue;
    if (sp.topologyReason) soft.push({ reason: sp.topologyReason, element: sp.key });
    else if (sp.zPhase.reason) soft.push({ reason: sp.zPhase.reason, element: sp.key });
    else if (needNeutral && sp.zNeutral.reason) soft.push({ reason: sp.zNeutral.reason, element: sp.key });
  }

  // warnings, inputs and assumptions shared by every result of the circuit (D1-LOC couples them all)
  const W: WarningCode[] = uniq([
    ...circuit.warnings,
    ...circuit.spans.flatMap((sp) => [...sp.warnings, ...sp.zPhase.warnings, ...(needNeutral ? sp.zNeutral.warnings : [])]),
    ...circuit.loads.flatMap((l) => l.warnings),
  ]);
  const A: AssumptionId[] = baseAssumptions(!symmetric, circuit.spans.some((sp) => (sp.np ?? 1) > 1 || (sp.nN ?? 1) > 1));
  const spanInputs = (sp: E2Span): InputRef[] => [...sp.inputs, ...sp.zPhase.inputs, ...(needNeutral ? sp.zNeutral.inputs : [])];
  const nodeInputs: InputRef[] = s.inputs;

  // nodes the results cannot reach: behind a span that cannot be used (an invalid one: not-run)
  const src = circuit.sourceBus;
  const present = new Map<string, Phase[]>([[src, [...PHASES]]]);
  const unknownWhy = new Map<string, Blocker>();
  const invalid = (r: UnavailableReason) => (INVALID.has(r) ? { notRun: true } : {});
  for (const sp of circuit.spans) {
    const parent = present.get(sp.fromBus) ?? [];
    present.set(sp.toBus, parent.filter((p) => spanPhases(sp).includes(p)));
    const up = unknownWhy.get(sp.fromBus);
    if (up) unknownWhy.set(sp.toBus, { reason: 'upstream-unavailable', element: up.element, ...(up.notRun ? { notRun: true } : {}) });
    else if (sp.topologyReason) unknownWhy.set(sp.toBus, { reason: sp.topologyReason, element: sp.key, ...invalid(sp.topologyReason) });
    else if (sp.zPhase.reason) unknownWhy.set(sp.toBus, { reason: sp.zPhase.reason, element: sp.key, ...invalid(sp.zPhase.reason) });
    else if (needNeutral && sp.zNeutral.reason) unknownWhy.set(sp.toBus, { reason: sp.zNeutral.reason, element: sp.key, ...invalid(sp.zNeutral.reason) });
  }
  const known = (b: string) => !unknownWhy.has(b);
  const notRunAt = (b: string) => unknownWhy.get(b)?.notRun === true;

  // spans in the subtree of each span (itself included): the 1ph2w allocations the bound rests on
  const spansBelow = new Map<string, E2Span[]>();
  for (let k = circuit.spans.length - 1; k >= 0; k--) {
    const sp = circuit.spans[k];
    spansBelow.set(sp.key, [sp, ...circuit.spans.filter((ch) => ch.fromBus === sp.toBus).flatMap((ch) => spansBelow.get(ch.key)!)]);
  }
  // F3: the bound carries the warnings of its loads, of the circuit (excluded consumers) and of the
  // 1ph2w allocations below it — never 'computed' while it rests on one of them
  const circuitCurrentW = circuit.warnings.filter((w) => CURRENT_WARNINGS.has(w));

  // arithmetic upper bound Σ|Irule| downstream (constant current only)
  const bound = (sp: E2Span, k: Conductor): Quantity => {
    const ls = downstreamLoads(sp).filter((l) => l.ruleA > 0);
    const allocW = spansBelow.get(sp.key)!.some((x) => x.warnings.includes('allocation-unverified')) ? (['allocation-unverified'] as const) : [];
    const lw = [...ls.flatMap((l) => l.warnings), ...circuitCurrentW, ...allocW], li = ls.flatMap((l) => l.inputs);
    if (k === 'n') return valued(ls.reduce((t, l) => t + (l.kind === 'three' ? 3 * l.ruleA : l.ruleA), 0), 'A', 'bound', li, [], lw);
    if (!spanPhases(sp).includes(k)) return unavailable('A', 'bound', absentReason(sp), [sp.key]);
    const unknown = ls.filter((l) => !l.perPhase);
    if (unknown.length) return unavailable('A', 'bound', 'phase-allocation-missing', unknown.map((l) => l.consumerId));
    return valued(ls.reduce((t, l) => t + l.perPhase![k], 0), 'A', 'bound', li, [], lw);
  };

  if (soft.length) {
    const reason = soft[0].reason, by = soft.map((b) => b.element);
    if (model === 'constant-power') {
      // constant power: no current at all before the voltage is known
      const make = <T>(unit: U) => notRun<T>(unit, 'F1p', reason, by);
      return nothing(circuit, s, make, { status: 'not-run', model, reason, blockedBy: by }, true);
    }
    // constant current: |Irule| is known, the phasors and voltages are not
    const res = nothing(circuit, s, <T>(unit: U) => unavailable<T>(unit, 'F3', reason, by), { status: 'not-run', model, reason, blockedBy: by }, false);
    res.nodes = res.nodes.map((n, i) => (notRunAt(n.bus) ? notRunNode(circuit.buses[i], unknownWhy.get(n.bus)!) : n));
    res.spans = circuit.spans.map((sp, i) => {
      const r = res.spans[i];
      if (notRunAt(sp.toBus)) return notRunSpan(sp, unknownWhy.get(sp.toBus)!);
      const zero = !carries(sp);
      const has = (k: Conductor) => (k === 'n' ? !!sp.system : spanPhases(sp).includes(k));
      const cur = (k: Conductor): Quantity<Phasor> =>
        !has(k) ? unavailable<Phasor>('A', 'F2', absentReason(sp), [sp.key])
          : zero ? valued<Phasor>({ magnitude: 0, angleDeg: 0 }, 'A', 'topology', spanInputs(sp), A, W)
            : k === 'n' && symmetric ? valued<Phasor>({ magnitude: 0, angleDeg: 0 }, 'A', 'F7', spanInputs(sp), A, W)
              : unavailable<Phasor>('A', 'F2', 'node-voltage-unknown', by);
      const perSet = (k: Conductor): Quantity =>
        !has(k) ? unavailable('A', 'F2', absentReason(sp), [sp.key])
          : zero ? valued(0, 'A', 'topology', spanInputs(sp), A, W)
            : k === 'n' && symmetric ? valued(0, 'A', 'F7', spanInputs(sp), A, W)
              : unavailable('A', 'F2', 'node-voltage-unknown', by);
      return { ...r, current: per(CONDUCTORS, cur), perSetCurrentA: per(CONDUCTORS, perSet), arithmeticSumA: per(CONDUCTORS, (k) => bound(sp, k)) };
    });
    res.loads = circuit.loads.map((l) => ({
      consumerId: l.consumerId,
      currentA: per(PHASES, (p) => (l.perPhase ? valued(l.perPhase[p], 'A', 'F1', l.inputs, ['A6', 'A7'], l.warnings) : unavailable('A', 'F1', l.phaseReason ?? 'phase-allocation-missing', [l.consumerId]))),
    }));
    return res;
  }

  // 5. the sweep
  const phi = Math.acos(s.pf);

  const Vp = new Map<string, Record<Phase, C>>(), VN = new Map<string, C>();
  for (const b of circuit.buses) { Vp.set(b.id, per(PHASES, (p) => polar(s.Vph, THETA[p]))); VN.set(b.id, ZERO); }
  const vpn = (b: string, p: Phase) => sub(Vp.get(b)![p], VN.get(b)!);
  let I = new Map<string, Record<Phase, C>>(), IN = new Map<string, C>();
  const inj = new Map<string, Record<Phase, C>>();
  let iterations = 0, converged = false, failed = false;

  for (let it = 1; it <= SWEEP_MAX_ITERATIONS && !converged && !failed; it++) {
    iterations = it;
    // F1 / F1′: load currents from the voltages of the previous pass (k = 0: the source angles, FIX)
    for (const b of circuit.buses) inj.set(b.id, per(PHASES, () => ZERO));
    for (const l of circuit.loads) {
      if (!l.perPhase || l.ruleA === 0) continue;
      const tot = inj.get(l.bus)!;
      for (const p of PHASES) {
        const a = l.perPhase[p];
        if (!a) continue;
        const v = vpn(l.bus, p);
        if (!isFiniteC(v) || abs(v) <= 0) { failed = true; break; }
        tot[p] = add(tot[p], model === 'constant-current' ? polar(a, arg(v) - phi) : conj(div(polar(s.Vph * a, phi), v)));
      }
    }
    if (failed) break;
    // F2: backward
    const nextI = new Map<string, Record<Phase, C>>();
    for (let k = circuit.spans.length - 1; k >= 0; k--) {
      const sp = circuit.spans[k];
      const acc = per(PHASES, (p) => inj.get(sp.toBus)![p]);
      for (const ch of circuit.spans) if (ch.fromBus === sp.toBus) for (const p of PHASES) acc[p] = add(acc[p], nextI.get(ch.key)![p]);
      nextI.set(sp.key, acc);
    }
    I = nextI;
    IN = new Map(circuit.spans.map((sp) => [sp.key, symmetric ? ZERO : PHASES.reduce((t, p) => add(t, I.get(sp.key)![p]), ZERO)]));
    // F3: forward
    let delta = 0;
    for (const sp of circuit.spans) {
      if (!known(sp.toBus)) continue;
      const before = per(PHASES, (p) => vpn(sp.toBus, p));
      const ps = present.get(sp.toBus)!;
      const vp = per(PHASES, (p) => (ps.includes(p) ? sub(Vp.get(sp.fromBus)![p], mul(sp.zPhase.z!, I.get(sp.key)![p])) : Vp.get(sp.fromBus)![p]));
      Vp.set(sp.toBus, vp);
      VN.set(sp.toBus, needNeutral ? add(VN.get(sp.fromBus)!, mul(sp.zNeutral.z!, IN.get(sp.key)!)) : ZERO);
      for (const p of ps) {
        const v = vpn(sp.toBus, p);
        if (!isFiniteC(v)) { failed = true; break; }
        delta = Math.max(delta, abs(sub(v, before[p])));
      }
    }
    if (!failed && delta < SWEEP_TOLERANCE_V) converged = true;
  }

  if (!converged) {
    const make = <T>(unit: U) => unavailable<T>(unit, 'F4', 'not-converged', [circuit.id]);
    return nothing(circuit, s, make, { status: 'unavailable', model, converged: false, iterations, reason: 'not-converged', blockedBy: [circuit.id] }, true);
  }

  // 6. results
  const nodeWhy = (b: string): Blocker => unknownWhy.get(b)!;
  const nodes: NodeResult[] = circuit.buses.map(({ id, poleId }) => {
    const ps = present.get(id) ?? [];
    const why = known(id) ? undefined : nodeWhy(id);
    if (why?.notRun) return notRunNode({ id, poleId }, why);
    const absent = (p: Phase) => !ps.includes(p);
    const volt = (p: Phase): Quantity<Phasor> => why ? blocked('V', 'F3', why) : absent(p) ? unavailable('V', 'F3', 'phase-not-present', [id]) : valued(phasor(vpn(id, p)), 'V', 'F3', nodeInputs, A, W);
    const drop = (p: Phase): Quantity => why ? blocked('V', 'F5', why) : absent(p) ? unavailable('V', 'F5', 'phase-not-present', [id]) : valued(s.Vph - abs(vpn(id, p)), 'V', 'F5', nodeInputs, A, W);
    const dropPercent = per(PHASES, (p) => { const d = drop(p); return d.value === undefined ? { ...d, unit: '%' as const } : valued((d.value / s.Vph) * 100, '%', 'F5', nodeInputs, A, W); });
    const lineV = per(['ab', 'bc', 'ca'] as const, (k) => {
      const [, p, q] = LINES.find((l) => l[0] === k)!;
      if (why) return blocked('V', 'F5', why);
      if (absent(p) || absent(q)) return unavailable('V', 'F5', 'phase-not-present', [id]);
      return valued(abs(sub(vpn(id, p), vpn(id, q))), 'V', 'F5', nodeInputs, A, W);
    });
    const limit = why ? 'na' : nodeLimit(ps.map((p) => ({ percent: dropPercent[p].value!, vpn: abs(vpn(id, p)) })), LINES.filter(([, p, q]) => ps.includes(p) && ps.includes(q)).map(([k]) => lineV[k].value), s);
    return {
      bus: id, poleId,
      voltage: per(PHASES, volt),
      neutralShiftV: why ? blocked<Phasor>('V', 'F3', why) : valued(phasor(VN.get(id)!), 'V', 'F3', nodeInputs, A, W),
      lineV, dropV: per(PHASES, drop), dropPercent, limit,
    };
  });
  const nodeOf = new Map(nodes.map((n) => [n.bus, n]));

  const spans: SpanResult[] = circuit.spans.map((sp) => {
    const inputs = spanInputs(sp);
    const ps = spanPhases(sp);
    const why = known(sp.toBus) ? undefined : nodeWhy(sp.toBus);
    // F7: an invalid input on or above the span: nothing of it is given
    if (why?.notRun) return notRunSpan(sp, why);
    // a span that cannot be used here (why set) carries no current: the sweep stops at any blocked span that does.
    // Its currents and losses are zero by topology ('topology'), not results of the sweep; its drop needs the
    // voltage behind it, which is not known.
    const zero = !carries(sp);
    const topo = <T>(v: T, unit: U): Quantity<T> => valued<T>(v, unit, 'topology', inputs, A, W);
    const cur = (k: Conductor): Quantity<Phasor> => {
      if (k === 'n') {
        if (!sp.system) return unavailable('A', 'F2', 'system-missing', [sp.key]);
        if (zero) return topo<Phasor>({ magnitude: 0, angleDeg: 0 }, 'A');
        return valued(phasor(IN.get(sp.key)!), 'A', symmetric ? 'F7' : 'F2', inputs, A, W);
      }
      if (!ps.includes(k)) return unavailable('A', 'F2', absentReason(sp), [sp.key]);
      if (zero) return topo<Phasor>({ magnitude: 0, angleDeg: 0 }, 'A');
      return valued(phasor(I.get(sp.key)![k]), 'A', 'F2', inputs, A, W);
    };
    const perSet = (k: Conductor): Quantity => {
      if (k === 'n') {
        if (!sp.system) return unavailable('A', 'F2', 'system-missing', [sp.key]);
        if (zero) return topo(0, 'A');
        const i = abs(IN.get(sp.key)!);
        if (i === 0) return valued(0, 'A', symmetric ? 'F7' : 'F2', inputs, A, W);
        return sp.nN ? valued(i / sp.nN, 'A', 'F2', inputs, [...A, 'A8'], W) : unavailable('A', 'F2', sp.zNeutral.reason ?? 'neutral-parallel-unknown', [sp.key]);
      }
      if (!ps.includes(k)) return unavailable('A', 'F2', absentReason(sp), [sp.key]);
      if (zero) return topo(0, 'A');
      return sp.np ? valued(abs(I.get(sp.key)![k]) / sp.np, 'A', 'F2', inputs, [...A, 'A8'], W) : unavailable('A', 'F2', sp.zPhase.reason ?? 'phase-parallel-unknown', [sp.key]);
    };
    const from = nodeOf.get(sp.fromBus)!, to = nodeOf.get(sp.toBus)!;
    const dropV = per(PHASES, (p) => {
      if (why) return blocked('V', 'F5', why);
      if (!ps.includes(p)) return unavailable('V', 'F5', absentReason(sp), [sp.key]);
      return valued(from.voltage[p].value!.magnitude - to.voltage[p].value!.magnitude, 'V', 'F5', inputs, A, W);
    });
    let pLossW: Quantity, qAbsorbedVar: Quantity;
    if (zero) { pLossW = topo(0, 'W'); qAbsorbedVar = topo(0, 'var'); }
    else if (why) { pLossW = blocked('W', 'F6', why); qAbsorbedVar = blocked('var', 'F6', why); }
    else {
      const l = spanLosses({ phase: ps.map((p) => ({ i: I.get(sp.key)![p], z: sp.zPhase.z! })), ...(needNeutral ? { neutral: { i: IN.get(sp.key)!, z: sp.zNeutral.z! } } : {}) });
      pLossW = valued(l.p, 'W', 'F6', inputs, A, W);
      qAbsorbedVar = valued(l.q, 'var', 'F6', inputs, A, W);
    }
    return { key: sp.key, current: per(CONDUCTORS, cur), perSetCurrentA: per(CONDUCTORS, perSet), arithmeticSumA: per(CONDUCTORS, (k) => bound(sp, k)), dropV, pLossW, qAbsorbedVar };
  });

  const loads: LoadResult[] = circuit.loads.map((l) => ({
    consumerId: l.consumerId,
    currentA: per(PHASES, (p) => {
      if (!l.perPhase || !l.perPhase[p]) return valued(0, 'A', model === 'constant-current' ? 'F1' : 'F1p', l.inputs, A, W);
      if (model === 'constant-current') return valued(l.perPhase[p], 'A', 'F1', l.inputs, A, W);
      return valued((s.Vph * l.perPhase[p]) / abs(vpn(l.bus, p)), 'A', 'F1p', l.inputs, A, W);
    }),
    ...(model === 'constant-power' ? { apparentPowerVA: per(PHASES, (p) => valued(s.Vph * (l.perPhase?.[p] ?? 0), 'VA', 'input', l.inputs, [], l.warnings)) } : {}),
  }));

  const total = (pick: (r: SpanResult) => Quantity, unit: 'W' | 'var'): Quantity => {
    const qs = spans.map(pick);
    // F6: a not-run part keeps the total not-run; a missing part makes it unavailable
    const bad = qs.find((q) => q.status === 'not-run') ?? qs.find((q) => q.value === undefined);
    if (bad) return (bad.status === 'not-run' ? notRun : unavailable)(unit, 'F6', bad.reason ?? 'upstream-unavailable', bad.blockedBy ?? []);
    return valued(qs.reduce((t, q) => t + q.value!, 0), unit, 'F6', [], A, W);
  };
  let worst: CircuitResult['worst'];
  for (const n of nodes) for (const p of PHASES) {
    const v = n.dropPercent[p].value;
    if (v !== undefined && (!worst || v > worst.percent)) worst = { bus: n.bus, phase: p, percent: v };
  }
  return {
    id: circuit.id,
    solve: { status: W.length ? 'provisional' : 'computed', model, converged: true, iterations },
    spans, nodes, loads,
    pLossW: total((r) => r.pLossW, 'W'),
    qAbsorbedVar: total((r) => r.qAbsorbedVar, 'var'),
    ...(worst ? { worst } : {}),
  };
};

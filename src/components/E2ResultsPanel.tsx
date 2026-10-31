import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { useLocale, useT } from '../store/localeStore';
import { directionOf, type Locale, type TKey, type TParams } from '../i18n';
import type { CableElement, DrawingElement } from '../types/drawing';
import { poleNamer } from '../utils/poleNames';
import { useE2Study } from '../utils/useE2Study';
import {
  circuitQuantities, circuitWarnings, inputUnit, issueViews, makeNamer, numText, phasorText, polesOf, reasonGroups, reasonLabel, sourcePoleOf, spanInputs, spanPlace, STATUSES,
  statusLabel, studyOverview, warningLabel,
  type CircuitResult, type Conductor, type E2Issue, type E2StudyResult, type Namer, type Phasor, type Quantity, type QuantityPlace, type QuantityStatus, type ReasonGroup, type SpanResult,
} from '../utils/e2Presentation';

// E2 study (preview): the results of the E2 engine, read only (decisions D-B, D-C).
// Nothing here calculates: every value is a Quantity of the result, shown with its status.
// A value that is not there is '—', never 0, and points to its reason: each reason of a circuit
// is shown once, with the values it affects. The user sees names (poles, cables, subscribers);
// the ids and codes of the result are kept in the technical details.

type Tr = (key: TKey, params?: TParams) => string;
const PHASES = ['a', 'b', 'c'] as const;
const CONDUCTORS: readonly Conductor[] = ['a', 'b', 'c', 'n'];
type AnyQ = Quantity<number> | Quantity<Phasor>;

/** what every part of a circuit needs: texts, names, and the reason group of a quantity */
interface Ctx { tr: Tr; names: Namer; groupOf: (q: Quantity<unknown>) => number | undefined; anchor: (n: number) => string }

const STATUS_STYLE: Record<QuantityStatus, string> = {
  computed: 'bg-green-50 text-green-800 ring-green-300',
  provisional: 'bg-amber-50 text-amber-900 ring-amber-400',
  unavailable: 'bg-ios-fill text-ios-secondary ring-ios-separator',
  'not-run': 'bg-red-50 text-ios-red ring-red-300',
};
const STATUS_MARK: Record<QuantityStatus, string> = { computed: '✓', provisional: '≈', unavailable: '—', 'not-run': '✕' };
const hasValue = (q: Quantity<unknown>) => q.status === 'computed' || q.status === 'provisional';

export const StatusBadge: React.FC<{ status: QuantityStatus; tr: Tr; what?: string }> = ({ status, tr, what }) => (
  <span data-e2-status={status} {...(what ? { 'data-e2-badge': what } : {})} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
    <span aria-hidden>{STATUS_MARK[status]}</span>{statusLabel(status, tr)}
  </span>
);

/** a link to a reason of the circuit ("Reason 2") */
const RefLink: React.FC<{ n: number; ctx: Ctx; see?: boolean }> = ({ n, ctx, see }) => (
  <a href={`#${ctx.anchor(n)}`} data-e2-ref={n} className="whitespace-nowrap text-[11px] text-ios-blue underline decoration-dotted underline-offset-2">{ctx.tr(see ? 'e2.group.see' : 'e2.group.ref', { n })}</a>
);

/** the technical details: the ids and codes of the result, as they are */
const Tech: React.FC<{ tr: Tr; rows: [string, string][] }> = ({ tr, rows }) => (
  <details data-e2-tech className="mt-1 text-[11px] text-ios-tertiary">
    <summary className="cursor-pointer select-none">{tr('e2.tech.title')}</summary>
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd><bdi dir="ltr" className="break-all font-mono">{v}</bdi></dd></React.Fragment>)}
    </dl>
  </details>
);

/** one quantity: its value; or '—' and a link to its reason; or 'phase not present' */
const QValue: React.FC<{ q: AnyQ; ctx: Ctx; phasor?: boolean; digits?: number; noRef?: boolean }> = ({ q, ctx, phasor, digits = 2, noRef }) => {
  const text = phasor ? phasorText(q as Quantity<Phasor>, digits) : numText(q as Quantity<number>, digits);
  const g = ctx.groupOf(q);
  return (
    <span data-e2-q={q.status} className={`inline-flex items-baseline gap-1 ${q.status === 'provisional' ? 'text-amber-900' : q.status === 'computed' ? 'text-ios-label' : q.status === 'not-run' ? 'text-ios-red' : 'text-ios-secondary'}`}>
      <bdi dir="ltr" className="tabular-nums">{text}</bdi>
      {!hasValue(q) && q.reason === 'phase-not-present' && <span className="text-[11px] text-ios-tertiary">{ctx.tr('e2.group.phaseAbsent')}</span>}
      {!hasValue(q) && g !== undefined && !noRef && <RefLink n={g} ctx={ctx} />}
      {q.method === 'topology' && <span className="text-[11px] leading-tight text-ios-tertiary">{ctx.tr('e2.method.topology')}</span>}
    </span>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode; note?: string }> = ({ label, children, note }) => (
  <div className="flex flex-col gap-0.5 border-t border-ios-separator py-1.5 first:border-t-0">
    <span className="text-[12px] text-ios-secondary">{label}</span>
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">{children}</div>
    {note && <span className="text-[11px] leading-snug text-ios-tertiary">{note}</span>}
  </div>
);
const Labelled: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className="inline-flex items-baseline gap-1"><span className="text-[11px] text-ios-tertiary">{label}</span>{children}</span>
);
/** a row of quantities; when none has a value for the same reason, one '—' and one link */
const QRow: React.FC<{ label: string; items: [string, AnyQ][]; ctx: Ctx; phasor?: boolean; digits?: number; note?: string }> = ({ label, items, ctx, phasor, digits, note }) => {
  const groups = new Set(items.map(([, q]) => ctx.groupOf(q)));
  const shared = items.every(([, q]) => !hasValue(q)) && groups.size === 1 ? [...groups][0] : undefined;
  return (
    <Row label={label} note={note}>
      {shared !== undefined
        ? <span data-e2-row-ref={shared} className="inline-flex items-baseline gap-2"><span data-e2-q={items[0][1].status} className="text-ios-secondary">—</span><RefLink n={shared} ctx={ctx} /></span>
        : items.map(([l, q]) => <Labelled key={l} label={l}><QValue q={q} ctx={ctx} phasor={phasor} digits={digits} /></Labelled>)}
    </Row>
  );
};
/** the single reason group every quantity of a place belongs to, if there is one */
const onlyGroup = (qs: Quantity<unknown>[], ctx: Ctx): number | undefined => {
  const gs = new Set(qs.map((q) => (hasValue(q) ? -1 : ctx.groupOf(q))));
  const [g] = [...gs];
  return gs.size === 1 && g !== undefined && g > 0 ? g : undefined;
};
const NoValues: React.FC<{ n: number; ctx: Ctx }> = ({ n, ctx }) => (
  <p data-e2-no-values={n} className="flex flex-wrap items-baseline gap-2 text-[12px] text-ios-secondary">
    <span>— {ctx.tr('e2.group.noValues')}</span><RefLink n={n} ctx={ctx} see />
  </p>
);

const placeName = (p: QuantityPlace, ctx: Ctx) =>
  p.kind === 'node' ? ctx.names.pole(p.poleId) : p.kind === 'span' ? ctx.names.span(p.id) : p.kind === 'load' ? ctx.names.consumer(p.id) : ctx.tr('e2.totals');

/** the reasons of a circuit, each once: status, reason, the input and the element it is about, and what it affects */
const ReasonGroups: React.FC<{ groups: ReasonGroup[]; ctx: Ctx }> = ({ groups, ctx }) => (
  <section aria-label={ctx.tr('e2.group.title')} data-e2-groups={groups.length}>
    <h4 className="mb-1 text-[13px] font-semibold text-ios-label">{ctx.tr('e2.group.title')}</h4>
    <ol className="flex flex-col gap-2">
      {groups.map((g) => (
        <li key={g.n} id={ctx.anchor(g.n)} data-e2-group={g.n} data-e2-group-status={g.status} data-e2-group-reason={g.reason}
          className={`scroll-mt-2 rounded-ctl p-2 text-[12px] ring-1 ring-inset ${g.status === 'not-run' ? 'bg-red-50 ring-red-200' : 'bg-ios-grouped ring-ios-separator'}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ios-label">{ctx.tr('e2.group.ref', { n: g.n })}</span>
            <StatusBadge status={g.status} tr={ctx.tr} />
          </div>
          <p className="mt-1 font-medium text-ios-label">{reasonLabel(g.reason, ctx.tr)}</p>
          <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-ios-secondary sm:grid-cols-[auto_1fr] sm:gap-y-1 [&>dt]:font-medium [&>dt]:text-ios-tertiary sm:[&>dt]:font-normal [&>dd]:mb-1 sm:[&>dd]:mb-0">
            {g.inputKey && <><dt>{ctx.tr('e2.group.input')}</dt><dd data-e2-group-input><span className="text-ios-label">{ctx.tr(g.inputKey)}</span> · {ctx.tr(g.status === 'not-run' ? 'e2.group.invalid' : 'e2.group.missing')}</dd></>}
            {g.entered !== undefined && <><dt>{ctx.tr('e2.group.entered')}</dt><dd data-e2-group-entered><bdi dir="ltr" className="tabular-nums text-ios-label">{g.entered}</bdi></dd></>}
            {g.blockedBy.length > 0 && <><dt>{ctx.tr('e2.group.element')}</dt><dd>{g.blockedBy.map((id) => ctx.names.element(id)).join(ctx.tr('common.listSep'))}</dd></>}
            <dt>{ctx.tr('e2.group.affected')}</dt>
            <dd>
              <ul className="flex flex-col gap-0.5">
                {g.affected.map((a, k) => <li key={k}><span className="text-ios-label">{placeName(a.place, ctx)}</span>: {a.kinds.map((kind) => ctx.tr(`e2.q.${kind}`)).join(ctx.tr('common.listSep'))}</li>)}
              </ul>
              <span className="text-ios-tertiary">{ctx.tr('e2.group.count', { n: g.count })}</span>
            </dd>
          </dl>
          <Tech tr={ctx.tr} rows={[[ctx.tr('e2.tech.reason'), g.reason], ...(g.blockedBy.length ? [[ctx.tr('e2.tech.blockedBy'), g.blockedBy.join(', ')] as [string, string]] : [])]} />
        </li>
      ))}
    </ol>
  </section>
);

const SpanView: React.FC<{ s: SpanResult; ctx: Ctx; cables: ReadonlyMap<string, CableElement>; groups: ReasonGroup[] }> = ({ s, ctx, cables, groups }) => {
  const { tr } = ctx;
  const place = spanPlace(s.key, cables);
  const inputs = spanInputs(s);
  const status = [s.pLossW, ...Object.values(s.dropV)].reduce<QuantityStatus>((w, q) => (STATUSES.indexOf(q.status) > STATUSES.indexOf(w) ? q.status : w), 'computed');
  const all: Quantity<unknown>[] = [...Object.values(s.current), ...Object.values(s.perSetCurrentA), ...Object.values(s.arithmeticSumA), ...Object.values(s.dropV), s.pLossW, s.qAbsorbedVar];
  const only = onlyGroup(all, ctx);
  // the reasons about an input of this span (the span is what blocks)
  const own = groups.filter((g) => g.inputKey && g.blockedBy.includes(s.key));
  const cond = (k: Conductor) => tr(`e2.conductor.${k}`);
  return (
    <details data-e2-span={s.key} className="rounded-ctl border border-ios-separator">
      <summary className="flex cursor-pointer items-start gap-2 px-3 py-2 text-[13px]">
        {place.cable && <span aria-hidden className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: place.cable.strokeColor }} />}
        <span className="min-w-0 flex-1 text-ios-label">{ctx.names.span(s.key)}</span>
        <StatusBadge status={status} tr={tr} what="span" />
      </summary>
      <div className="px-3 pb-3 text-[13px]">
        <Row label={tr('e2.input.title')}>
          {inputs.map((i) => (
            <Labelled key={i.name} label={tr(`e2.input.${i.name}`)}>
              <bdi dir="ltr" className="tabular-nums text-ios-label">{String(i.value ?? '—')}{inputUnit(i.name) ? ` ${inputUnit(i.name)}` : ''}</bdi>
              <span className="text-[11px] text-ios-tertiary">({tr(`e2.provenance.${i.provenance}`)}{i.ref ? ` · ${i.ref}` : ''})</span>
            </Labelled>
          ))}
          {own.map((g) => (
            <span key={g.n} data-e2-input-problem={g.reason} className={`inline-flex flex-wrap items-baseline gap-1 ${g.status === 'not-run' ? 'text-ios-red' : 'text-ios-secondary'}`}>
              <span className="text-ios-label">{tr(g.inputKey!)}</span>· {tr(g.status === 'not-run' ? 'e2.group.invalid' : 'e2.group.missing')}
              {g.entered !== undefined && <> · {tr('e2.group.entered')}: <bdi dir="ltr" className="tabular-nums">{g.entered}</bdi></>}
              <RefLink n={g.n} ctx={ctx} />
            </span>
          ))}
          {inputs.length === 0 && own.length === 0 && <span className="text-ios-secondary">{tr('e2.input.none')}</span>}
        </Row>
        {only !== undefined ? <NoValues n={only} ctx={ctx} /> : <>
          <QRow label={tr('e2.q.current')} items={CONDUCTORS.map((k) => [cond(k), s.current[k]])} ctx={ctx} phasor />
          <QRow label={tr('e2.q.perSet')} items={CONDUCTORS.map((k) => [cond(k), s.perSetCurrentA[k]])} ctx={ctx} />
          <QRow label={tr('e2.q.arithmeticSum')} note={tr('e2.q.arithmeticSumNote')} items={CONDUCTORS.map((k) => [cond(k), s.arithmeticSumA[k]])} ctx={ctx} />
          <QRow label={tr('e2.q.drop')} items={PHASES.map((p) => [cond(p), s.dropV[p]])} ctx={ctx} digits={3} />
          <QRow label={`${tr('e2.q.pLoss')} / ${tr('e2.q.qAbsorbed')}`} items={[[tr('e2.q.pLoss'), s.pLossW], [tr('e2.q.qAbsorbed'), s.qAbsorbedVar]]} ctx={ctx} />
        </>}
        <Tech tr={tr} rows={[[tr('e2.tech.spanKey'), s.key], ...(place.cable ? [[tr('e2.tech.cableId'), place.cable.id], [tr('e2.tech.colour'), place.cable.strokeColor]] as [string, string][] : [])]} />
      </div>
    </details>
  );
};

const CircuitView: React.FC<{ c: CircuitResult; n: number; tr: Tr; names: Namer; cables: ReadonlyMap<string, CableElement>; issues: readonly E2Issue[] }> = ({ c, n, tr, names, cables, issues }) => {
  const src = sourcePoleOf(c);
  const warnings = circuitWarnings(c);
  const { groups, groupOf } = useMemo(() => reasonGroups(c, issues), [c, issues]);
  const ctx: Ctx = { tr, names, groupOf, anchor: (g) => `e2-c${n}-r${g}` };
  const cond = (k: Conductor) => tr(`e2.conductor.${k}`);
  const solveText = c.solve.status === 'not-run' ? tr('e2.solveNotStarted')
    : c.solve.converged === false ? tr('e2.notConverged', { iterations: c.solve.iterations ?? '—' })
      : tr('e2.converged', { iterations: c.solve.iterations ?? '—' });
  // the reason of the circuit's completeness, as one of its groups (shown there, not repeated here)
  const completenessGroup = groups.find((g) => g.status === c.completeness.status && g.reason === c.completeness.reason);
  const byPlace = (p: QuantityPlace) => circuitQuantities(c).filter((x) => JSON.stringify(x.place) === JSON.stringify(p)).map((x) => x.q);
  return (
    <details data-e2-circuit={c.id} data-e2-completeness={c.completeness.status} data-e2-solve={c.solve.status} className="rounded-ctl border border-ios-separator bg-white">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5">
        <span className="font-semibold text-ios-label">{tr('e2.circuit', { n })}</span>
        <span className="min-w-0 flex-1 text-[13px] text-ios-secondary">{src ? tr('e2.source', { pole: names.pole(src) }) : tr('e2.noSource')}</span>
        <StatusBadge status={c.completeness.status} tr={tr} what="completeness" />
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3 text-[13px]">
        <div className="flex flex-col gap-1.5 rounded-ctl bg-ios-grouped p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ios-secondary">{tr('e2.completeness')}</span><StatusBadge status={c.completeness.status} tr={tr} />
            {completenessGroup && <RefLink n={completenessGroup.n} ctx={ctx} see />}
          </div>
          {!completenessGroup && c.completeness.reason && (c.completeness.status === 'unavailable' || c.completeness.status === 'not-run') && (
            <p className="text-[12px] text-ios-secondary" data-e2-reason={c.completeness.reason}>{tr('e2.reasonLine', { reason: reasonLabel(c.completeness.reason, tr) })}</p>
          )}
          <div className="flex flex-wrap items-center gap-2" data-e2-solve-line><span className="text-ios-secondary">{tr('e2.solve')}</span><StatusBadge status={c.solve.status} tr={tr} what="solve" /><span className="text-ios-secondary">{solveText}</span></div>
          {!src && <p className="text-[12px] text-ios-secondary">{tr('e2.poles', { list: polesOf(c).map(names.pole).join(tr('common.listSep')) })}</p>}
          {c.worst && <p className="text-[12px] text-ios-label">{tr('e2.worst', { percent: c.worst.percent.toFixed(2), pole: names.pole(c.nodes.find((x) => x.bus === c.worst!.bus)?.poleId ?? ''), phase: c.worst.phase })}</p>}
        </div>

        {groups.length > 0 && <ReasonGroups groups={groups} ctx={ctx} />}

        <section aria-label={tr('e2.warnings')} data-e2-warnings={warnings.join(' ')}>
          <h4 className="mb-1 text-[13px] font-semibold text-ios-label">{tr('e2.warnings')}</h4>
          {warnings.length === 0 ? <p className="text-[12px] text-ios-secondary">{tr('e2.noWarnings')}</p>
            : <ul className="flex flex-col gap-1">{warnings.map((w) => <li key={w} data-e2-warning={w} className="rounded-ctl bg-amber-50 px-2 py-1 text-[12px] text-amber-900">⚠ {warningLabel(w, tr)}</li>)}</ul>}
        </section>

        <section aria-label={tr('e2.totals')}>
          <h4 className="mb-1 text-[13px] font-semibold text-ios-label">{tr('e2.totals')}</h4>
          <QRow label={`${tr('e2.q.pLoss')} / ${tr('e2.q.qAbsorbed')}`} items={[[tr('e2.q.pLoss'), c.pLossW], [tr('e2.q.qAbsorbed'), c.qAbsorbedVar]]} ctx={ctx} />
        </section>

        <section aria-label={tr('e2.nodes')}>
          <h4 className="mb-1 text-[13px] font-semibold text-ios-label">{tr('e2.nodes')}</h4>
          <div className="flex flex-col gap-2">
            {c.nodes.map((node) => {
              const only = onlyGroup(byPlace({ kind: 'node', id: node.bus, poleId: node.poleId }), ctx);
              return (
                <div key={node.bus} data-e2-node={node.bus} className="rounded-ctl border border-ios-separator p-2">
                  <p className="mb-1 font-medium text-ios-label">{names.pole(node.poleId)}</p>
                  {only !== undefined ? <NoValues n={only} ctx={ctx} /> : <>
                    <QRow label={tr('e2.q.voltage')} items={PHASES.map((p) => [cond(p), node.voltage[p]])} ctx={ctx} phasor />
                    <QRow label={tr('e2.q.drop')} items={PHASES.map((p) => [cond(p), node.dropV[p]])} ctx={ctx} digits={3} />
                    <QRow label={tr('e2.q.dropPercent')} items={PHASES.map((p) => [cond(p), node.dropPercent[p]])} ctx={ctx} />
                    <QRow label={tr('e2.q.lineV')} items={(['ab', 'bc', 'ca'] as const).map((k) => [k, node.lineV[k]])} ctx={ctx} digits={1} />
                    <QRow label={tr('e2.q.neutralShift')} items={[[tr('e2.conductor.n'), node.neutralShiftV]]} ctx={ctx} phasor digits={3} />
                  </>}
                </div>
              );
            })}
          </div>
        </section>

        {c.spans.length > 0 && (
          <section aria-label={tr('e2.spans')}>
            <h4 className="mb-1 text-[13px] font-semibold text-ios-label">{tr('e2.spans')}</h4>
            <div className="flex flex-col gap-2">{c.spans.map((s) => <SpanView key={s.key} s={s} ctx={ctx} cables={cables} groups={groups} />)}</div>
          </section>
        )}

        {c.loads.length > 0 && (
          <section aria-label={tr('e2.loads')}>
            <h4 className="mb-1 text-[13px] font-semibold text-ios-label">{tr('e2.loads')}</h4>
            <div className="flex flex-col gap-1">
              {c.loads.map((l) => {
                const only = onlyGroup(byPlace({ kind: 'load', id: l.consumerId }), ctx);
                return (
                  <div key={l.consumerId} data-e2-load={l.consumerId} className="rounded-ctl border border-ios-separator px-2 py-1.5">
                    <p className="font-medium text-ios-label">{names.consumer(l.consumerId)}</p>
                    {only !== undefined ? <NoValues n={only} ctx={ctx} /> : <>
                      <QRow label={tr('e2.q.loadCurrent')} items={PHASES.map((p) => [cond(p), l.currentA[p]])} ctx={ctx} />
                      {l.apparentPowerVA && <QRow label={tr('e2.q.apparentPower')} items={PHASES.map((p) => [cond(p), l.apparentPowerVA![p]])} ctx={ctx} digits={0} />}
                    </>}
                    <Tech tr={tr} rows={[[tr('e2.tech.consumerId'), l.consumerId]]} />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <Tech tr={tr} rows={[
          [tr('e2.tech.circuitId'), c.id],
          [tr('e2.tech.spanKey'), c.spans.map((s) => s.key).join(', ') || '—'],
          [tr('e2.tech.warnings'), warnings.join(', ') || '—'],
          ...(c.completeness.reason ? [[tr('e2.tech.reason'), c.completeness.reason] as [string, string]] : []),
        ]} />
      </div>
    </details>
  );
};

/** The E2 results, from a result and the drawing's names (no store: rendered as given). */
export const E2ResultsView: React.FC<{ result: E2StudyResult; elements: readonly DrawingElement[]; locale: Locale; tr: Tr }> = ({ result, elements, locale, tr }) => {
  const names = useMemo(() => makeNamer(elements, result.circuits.map((c) => c.id), poleNamer(elements as DrawingElement[], tr), tr), [elements, result, tr]);
  const cables = useMemo(() => new Map(elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c])), [elements]);
  const counts = studyOverview(result);
  const issues = issueViews(result);
  const blocking = issues.filter((i) => i.severity === 'blocks').length;
  return (
    <div dir={directionOf(locale)} data-e2-view data-e2-locale={locale} className="flex flex-col gap-3 text-[14px]">
      <section className="flex flex-col gap-1 rounded-ctl bg-ios-fill px-3 py-2 text-[12px] leading-relaxed text-ios-secondary" data-e2-inputs={result.inputOrigin}>
        <p className="font-medium text-ios-label">{tr('e2.preview')}</p>
        <p>{tr('e2.inputs')}</p>
        <p>{tr('e2.inputsEffect')}</p>
      </section>

      <section aria-label={tr('e2.legend')} className="flex flex-col gap-1">
        <h3 className="text-[13px] font-semibold text-ios-label">{tr('e2.legend')}</h3>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {STATUSES.map((s) => <li key={s} className="flex items-start gap-2 text-[12px] leading-snug text-ios-secondary"><StatusBadge status={s} tr={tr} /><span>{tr(`e2.statusHelp.${s === 'not-run' ? 'notRun' : s}`)}</span></li>)}
        </ul>
      </section>

      <section aria-label={tr('e2.overview.title')} data-e2-overview className="rounded-ctl border border-ios-separator p-3">
        <h3 className="mb-2 text-[15px] font-semibold text-ios-label">{tr('e2.overview.title')}</h3>
        {counts.total === 0 ? <p className="text-ios-secondary">{tr('e2.overview.none')}</p> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-ctl bg-ios-grouped p-2" data-e2-count="total"><p className="text-[12px] text-ios-secondary">{tr('e2.overview.total')}</p><p className="text-[20px] font-semibold tabular-nums">{counts.total}</p></div>
            {STATUSES.map((s) => (
              <div key={s} className="rounded-ctl bg-ios-grouped p-2" data-e2-count={s}><StatusBadge status={s} tr={tr} /><p className="mt-1 text-[20px] font-semibold tabular-nums">{counts[s]}</p></div>
            ))}
          </div>
        )}
      </section>

      <details data-e2-issues={issues.length} className="rounded-ctl border border-ios-separator" open={blocking > 0}>
        <summary className="cursor-pointer px-3 py-2 font-semibold text-ios-label">
          {tr('e2.overview.issues')} <span className="tabular-nums font-normal text-ios-secondary">({issues.length}{blocking ? ` · ${blocking} ${tr('e2.overview.blocking')}` : ''})</span>
        </summary>
        <ul className="flex flex-col gap-2 px-3 pb-3">
          {issues.map((i, k) => {
            const entered = i.fields.find(([f]) => f === 'value');
            return (
              <li key={k} data-e2-issue={i.code} data-e2-severity={i.severity} className={`rounded-ctl p-2 text-[12px] ring-1 ring-inset ${i.severity === 'blocks' ? 'bg-red-50 ring-red-200' : i.severity === 'provisional' ? 'bg-amber-50 ring-amber-200' : 'bg-ios-grouped ring-ios-separator'}`}>
                <p className="font-medium text-ios-label">{i.textKey ? tr(i.textKey) : tr('e2.issueMeta.unknown')}</p>
                <p className="text-ios-secondary">{tr(`e2.severity.${i.severity}`)}</p>
                <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-ios-secondary sm:grid-cols-[auto_1fr] [&>dt]:font-medium [&>dt]:text-ios-tertiary sm:[&>dt]:font-normal [&>dd]:mb-1 sm:[&>dd]:mb-0">
                  <dt>{tr('e2.issueView.about')}</dt><dd className="text-ios-label">{names.target(i.target)}</dd>
                  {entered && <><dt>{tr('e2.group.entered')}</dt><dd><bdi dir="ltr" className="tabular-nums text-ios-label">{String(entered[1])}</bdi></dd></>}
                  {i.circuitIds.length > 0 && <><dt>{tr('e2.issueView.circuits')}</dt><dd>{i.circuitIds.map(names.circuit).join(tr('common.listSep'))}</dd></>}
                </dl>
                <Tech tr={tr} rows={[
                  [tr('e2.issueMeta.code'), i.code],
                  [tr('e2.issueMeta.target'), `${i.target.kind}: ${i.target.id}`],
                  ...(i.source ? [[tr('e2.issueMeta.source'), i.source] as [string, string]] : []),
                  ...(i.circuitIds.length ? [[tr('e2.issueMeta.circuits'), i.circuitIds.join(', ')] as [string, string]] : []),
                  ...(i.fields.length ? [[tr('e2.issueMeta.fields'), i.fields.map(([f, v]) => `${f}=${v}`).join('; ')] as [string, string]] : []),
                ]} />
              </li>
            );
          })}
        </ul>
      </details>

      <div className="flex flex-col gap-2">
        {result.circuits.map((c, k) => <CircuitView key={c.id} c={c} n={k + 1} tr={tr} names={names} cables={cables} issues={result.issues} />)}
      </div>
    </div>
  );
};

/** The E2 study panel of the current drawing; opened from the voltage-drop panel. */
export const E2ResultsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const elements = useDrawingStore((s) => s.elements);
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const result = useE2Study(true);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div dir={directionOf(locale)} role="dialog" aria-label={t('e2.title')} data-e2-panel className="flex w-full max-w-2xl max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex-col overflow-hidden rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-ios-separator px-4 py-3">
          <h2 className="text-[17px] font-semibold text-ios-label">{t('e2.title')}</h2>
          <button type="button" aria-label={t('common.close')} data-e2-action="close" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          {result && <E2ResultsView result={result} elements={elements} locale={locale} tr={t} />}
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { ChevronLeft, ChevronRight, History, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { CableConstruction, CableTypeRevision, ElectricalProperty, ElectricalValue, ValueSource, Verification, VerificationStatus } from '../../types/cableType';
import { directionOf, type Locale } from '../../i18n';
import type { CableLibraryState } from '../../store/cableLibraryStore';
import { cableTypeCompleteness } from '../../utils/cableTypeModel';
import {
  compareRevisions, CONSTRUCTIONS, filterTypes, revisionChanges, typeVerification, valueView, VERIFICATION_STATUSES,
  type CompareField, type CompareRow, type CompletenessFilter, type DiffStatus, type LibraryFilter, type ValueView,
} from '../../utils/cableLibraryView';
import { cableKindLabel, type Tr } from '../../utils/vdLabels';
import { ICON_MD, ICON_SM } from '../ui/icons';

// Stage C2: the cable library screens, for reading only. Every component here is pure (no store,
// no storage): the sheet (CableLibrarySheet.tsx) gives them the data and the actions.

export interface ViewCtx { tr: Tr; locale: Locale }

const SYMBOL: Record<ElectricalProperty, string> = { r: 'R', x: 'X', rn: 'Rn', xn: 'Xn' };
export const materialLabel = (m: string, tr: Tr) => (m === 'al' ? tr('span.aluminium') : m === 'cu' ? tr('span.copper') : m === 'alloy' ? tr('span.alloy') : m);
export const searchLabels = (tr: Tr) => ({ construction: (c: CableConstruction) => cableKindLabel(c, tr), material: (m: string) => materialLabel(m, tr) });
export const formatDate = (ms: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' }).format(new Date(ms));

// ---------- small pieces ----------

/** each part of a mixed Arabic / Latin text isolated (FSI … PDI), so the parts keep their order in RTL */
const iso = (x: string) => `\u2068${x}\u2069`;
const joinParts = (parts: (string | undefined)[]) => parts.filter((x): x is string => !!x).map(iso).join(' · ');

const VERIFY_STYLE: Record<VerificationStatus, string> = {
  // never green unless approved: an unverified value must not look approved
  unverified: 'bg-amber-50 text-amber-900 ring-amber-300',
  checked: 'bg-blue-50 text-blue-700 ring-blue-300',
  approved: 'bg-green-50 text-green-800 ring-green-300',
};
const VERIFY_MARK: Record<VerificationStatus, string> = { unverified: '?', checked: '✓', approved: '✓✓' };
const badge = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset';

export const VerificationBadge: React.FC<{ status: VerificationStatus; ctx: ViewCtx; what?: string }> = ({ status, ctx, what }) => (
  <span data-cl-verification={status} {...(what ? { 'data-cl-badge': what } : {})} className={`${badge} ${VERIFY_STYLE[status]}`}>
    <span aria-hidden>{VERIFY_MARK[status]}</span>{ctx.tr(`cableLibrary.verificationStatus.${status}`)}
  </span>
);
export const CompletenessBadge: React.FC<{ complete: boolean; ctx: ViewCtx }> = ({ complete, ctx }) => (
  <span data-cl-completeness={complete ? 'complete' : 'draft'} className={`${badge} ${complete ? 'bg-ios-fill text-ios-label ring-ios-separator' : 'bg-amber-50 text-amber-900 ring-amber-300'}`}>
    {ctx.tr(complete ? 'cableLibrary.cableStatus.complete' : 'cableLibrary.cableStatus.draft')}
  </span>
);

/** a value as stored: the number with its unit, or «not entered» — never 0 for a missing value */
export const ValueText: React.FC<{ v: Pick<ValueView, 'entered' | 'value'>; ctx: ViewCtx }> = ({ v, ctx }) =>
  v.entered
    ? <bdi dir="ltr" data-cl-value="entered" className="whitespace-nowrap font-medium text-ios-label">{String(v.value)} Ω/km</bdi>
    : <span data-cl-value="missing" className="text-ios-tertiary">{ctx.tr('cableLibrary.view.missing')}</span>;

/** the basis as stored: AC / DC / not stated, and the reference temperature only when stated */
export const basisText = (v: Pick<ElectricalValue, 'basis' | 'referenceTempC'>, ctx: ViewCtx): string => {
  const b = ctx.tr(`cableLibrary.basis.${v.basis}`);
  if (v.basis === 'ac-50hz') return iso(b);
  // the temperature itself is a left-to-right run inside the sentence (LRI … PDI)
  const t = typeof v.referenceTempC === 'number' ? ctx.tr('cableLibrary.basis.refTemp', { t: `\u2066${v.referenceTempC}°C\u2069` }) : ctx.tr('cableLibrary.basis.refTempUnspecified');
  return joinParts([b, t]);
};
export const SourceLine: React.FC<{ s: ValueSource | undefined; ctx: ViewCtx }> = ({ s, ctx }) => {
  if (!s) return null;
  const parts = [s.name?.trim(), s.reference?.trim(), s.page?.trim() ? ctx.tr('cableLibrary.view.page', { p: s.page.trim() }) : undefined, s.table?.trim() ? ctx.tr('cableLibrary.view.table', { t: s.table.trim() }) : undefined].filter((x): x is string => !!x);
  if (!parts.length) return null;
  return <>{parts.flatMap((p, i) => [...(i ? [' · '] : []), <bdi key={i}>{p}</bdi>])}</>;
};
export const sourceText = (s: ValueSource | undefined, ctx: ViewCtx): string | undefined => {
  if (!s) return undefined;
  const parts = [s.name?.trim(), s.reference?.trim(), s.page?.trim() ? ctx.tr('cableLibrary.view.page', { p: s.page.trim() }) : undefined, s.table?.trim() ? ctx.tr('cableLibrary.view.table', { t: s.table.trim() }) : undefined];
  return joinParts(parts) || undefined;
};
const verificationText = (v: Verification, ctx: ViewCtx) =>
  joinParts([ctx.tr(`cableLibrary.verificationStatus.${v.status}`), v.by?.trim(), v.on?.trim(), v.note?.trim()]);

/** «Phase: Al 70 mm² · Neutral: …» — each section isolated (LTR) so it reads correctly in Arabic */
export const conductorLine = (t: CableTypeRevision, ctx: ViewCtx): React.ReactNode => {
  const part = (label: string, m: string | undefined, s: number | undefined, k: string) =>
    !m && s === undefined ? null : (
      <span key={k} data-cl-conductor={k}>{label}: {m ? materialLabel(m, ctx.tr) : ''}{m && s !== undefined ? ' ' : ''}{s !== undefined && <bdi dir="ltr" className="whitespace-nowrap">{s} mm²</bdi>}</span>
    );
  const parts = [part(ctx.tr('cableLibrary.view.phase'), t.phase.material, t.phase.sectionMm2, 'phase'),
    t.neutralConductors > 0 ? part(ctx.tr('cableLibrary.view.neutral'), t.neutral?.material, t.neutral?.sectionMm2, 'neutral') : null].filter(Boolean);
  return parts.length ? parts.flatMap((p, i) => (i ? [' · ', p] : [p])) : null;
};

export const CableLibraryHeader: React.FC<{ title: string; sub?: React.ReactNode; ctx: ViewCtx; onBack?: () => void; onClose: () => void; action?: React.ReactNode }> = ({ title, sub, ctx, onBack, onClose, action }) => {
  const Back = directionOf(ctx.locale) === 'rtl' ? ChevronRight : ChevronLeft;
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-ios-separator bg-white px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1">
        {onBack && <button type="button" onClick={onBack} aria-label={ctx.tr('cableLibrary.view.back')} title={ctx.tr('cableLibrary.view.back')} data-cl-action="back" className="ui-icon-btn !h-9 !w-9"><Back {...ICON_MD} /></button>}
        <div className="min-w-0 px-1">
          <h2 className="truncate text-[17px] font-semibold text-ios-label">{title}</h2>
          {sub && <div className="truncate text-[12px] text-ios-secondary">{sub}</div>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        <button type="button" aria-label={ctx.tr('common.close')} title={ctx.tr('common.close')} data-cl-action="close" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
      </div>
    </div>
  );
};

// ---------- the list ----------

const toggle = <T,>(xs: readonly T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
const chip = (on: boolean) => `ui-segment-item !min-h-[36px] !px-2.5 whitespace-nowrap ${on ? 'is-active' : ''}`;
/** a filter: its label at the start, its options beside it */
const FilterRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
    <span className="min-w-[5.25rem] shrink-0 text-[12px] font-medium text-ios-secondary">{label}</span>
    {children}
  </div>
);

/** the basis of R / Rn in a few letters (Stage C4: shown in the span's cable picker) */
export const basisShort = (b: ElectricalValue['basis'], ctx: ViewCtx) => (b === 'ac-50hz' ? 'AC 50 Hz' : ctx.tr(`spanCable.basisShort.${b}`));

export interface CardOptions {
  /** C4: R / Rn show their basis (AC / DC / not stated) — X / Xn are AC 50 Hz always */
  showBasis?: boolean;
  /** C4: the type linked to the span being edited (marked on its card) */
  linkedId?: string;
  /** the app's default cable (its type is marked on its card, with the chosen revision) */
  defaultOf?: { typeId: string; revision: number };
}
export const CableTypeCard: React.FC<{ t: CableTypeRevision; ctx: ViewCtx; onOpen: (id: string) => void } & CardOptions> = ({ t, ctx, onOpen, showBasis, linkedId, defaultOf }) => {
  const complete = cableTypeCompleteness(t).complete;
  const line = conductorLine(t, ctx);
  const linked = linkedId === t.id;
  return (
    <li>
      <button type="button" onClick={() => onOpen(t.id)} data-cl-card={t.id} {...(linked ? { 'data-cl-linked': '' } : {})} className={`flex w-full flex-col gap-1.5 rounded-ctl border bg-white px-3 py-2.5 text-start active:bg-ios-fill ${linked ? 'border-ios-blue ring-1 ring-inset ring-ios-blue' : 'border-ios-separator'}`}>
        <div className="flex w-full items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[15px] font-semibold text-ios-label" data-cl-name>{t.name || ctx.tr('cableLibrary.view.notStated')}</span>
          <span className="shrink-0 text-[12px] text-ios-secondary" data-cl-revision={t.revision}>{ctx.tr('cableLibrary.view.revision', { n: t.revision })}</span>
        </div>
        <div className="text-[13px] text-ios-secondary">
          {cableKindLabel(t.construction, ctx.tr)} · {ctx.tr('cableLibrary.view.conductors', { p: t.phaseConductors, n: t.neutralConductors })}
          {line && <> · {line}</>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CompletenessBadge complete={complete} ctx={ctx} />
          <VerificationBadge status={typeVerification(t)} ctx={ctx} what="type" />
          {linked && <span className="text-[12px] font-medium text-ios-blue" data-cl-linked-mark>{ctx.tr('spanCable.current')}</span>}
          {defaultOf?.typeId === t.id && <span className="text-[12px] font-medium text-ios-blue" data-cl-default={defaultOf.revision}>{ctx.tr('defaultCable.badge', { n: defaultOf.revision })}</span>}
        </div>
        <dl className="grid w-full grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] sm:grid-cols-4" data-cl-summary>
          {(['r', 'x', 'rn', 'xn'] as const).map((p) => {
            const v = valueView(t, p);
            return (
              <div key={p} className="flex min-w-0 items-baseline gap-1" data-cl-prop={p}>
                <dt className="font-medium text-ios-secondary">{SYMBOL[p]}</dt>
                {showBasis
                  ? <dd className="min-w-0 break-words"><ValueText v={v} ctx={ctx} />{v.entered && (p === 'r' || p === 'rn') && <span className="ms-1 whitespace-nowrap text-ios-secondary" data-cl-basis={v.basis}>{basisShort(v.basis, ctx)}</span>}</dd>
                  : <dd className="min-w-0 truncate"><ValueText v={v} ctx={ctx} />{v.entered && v.basis === 'dc' && <span className="ms-1 text-ios-secondary" data-cl-basis="dc">DC</span>}</dd>}
              </div>
            );
          })}
        </dl>
      </button>
    </li>
  );
};

export interface LibraryListProps {
  state: CableLibraryState;
  filter: LibraryFilter;
  onFilter: (f: LibraryFilter) => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onClose: () => void;
  /** Stage C3: opens the form for a new cable type */
  onAdd?: () => void;
  ctx: ViewCtx;
  /** C4 (the span's cable picker): its own title, a back button, and the card options */
  title?: string;
  onBack?: () => void;
  card?: CardOptions;
}
export const LibraryListView: React.FC<LibraryListProps> = ({ state, filter, onFilter, onOpen, onRetry, onClose, onAdd, ctx, title, onBack, card }) => {
  const { tr } = ctx;
  const total = state.types.length;
  const shown = filterTypes(state.types, filter, searchLabels(tr));
  const loadingFirst = (state.status === 'loading' || state.status === 'idle') && total === 0;
  const failedFirst = state.status === 'error' && total === 0;
  const filtered = filter.query.trim() !== '' || filter.constructions.length > 0 || filter.completeness !== 'all' || filter.verification.length > 0;
  const sub = (
    <span className="inline-flex items-center gap-1.5">
      <span data-cl-count={total}>{tr('cableLibrary.count', { n: total })}</span>
      {state.status === 'loading' && total > 0 && <span data-cl-reloading className="inline-flex items-center gap-1 text-ios-tertiary"><RefreshCw {...ICON_SM} className="animate-spin" />{tr('cableLibrary.view.reloading')}</span>}
    </span>
  );
  return (
    <div data-cl-view="list" data-cl-state={state.status}>
      <CableLibraryHeader title={title ?? tr('cableLibrary.title')} sub={sub} ctx={ctx} onClose={onClose} {...(onBack ? { onBack } : {})}
        action={onAdd && !failedFirst && !loadingFirst ? <button type="button" onClick={onAdd} aria-label={tr('cableLibrary.add')} title={tr('cableLibrary.add')} data-cl-action="add" className="ui-icon-btn !h-9 !w-9 text-ios-blue"><Plus {...ICON_MD} /></button> : undefined} />
      <div className="flex flex-col gap-3 px-3 py-3">
        {loadingFirst && <p className="py-6 text-center text-[15px] text-ios-secondary" role="status" data-cl-loading>{tr('cableLibrary.loading')}</p>}
        {state.status === 'error' && (
          <div className="flex flex-col items-start gap-2 rounded-ctl bg-red-50 px-3 py-2.5 text-[13px] text-ios-red" role="alert" data-cl-error={state.error?.kind}>
            <p className="font-medium">{tr('cableLibrary.loadFailed')}</p>
            {state.error && <p>{tr(`cableLibrary.errors.${state.error.kind}`)}</p>}
            <button type="button" onClick={onRetry} data-cl-action="retry" className="ui-tinted-btn !w-auto">{tr('cableLibrary.retry')}</button>
          </div>
        )}
        {state.problems.length > 0 && <p className="rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-cl-problems={state.problems.length}>{tr('cableLibrary.unreadable', { n: state.problems.length })}</p>}
        {state.status === 'empty' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center" data-cl-empty>
            <p className="text-[15px] text-ios-secondary">{tr('cableLibrary.empty')}</p>
            {onAdd && <button type="button" onClick={onAdd} data-cl-action="add-first" className="ui-tinted-btn inline-flex !w-auto items-center gap-2"><Plus {...ICON_SM} />{tr('cableLibrary.add')}</button>}
          </div>
        )}

        {total > 0 && !failedFirst && (
          <>
            <label className="relative flex items-center">
              <Search {...ICON_SM} className="pointer-events-none absolute start-3 text-ios-tertiary" aria-hidden />
              <input type="search" className="ui-field h-11 w-full !ps-9" value={filter.query} placeholder={tr('cableLibrary.view.searchPlaceholder')} aria-label={tr('cableLibrary.view.search')} data-cl-field="search"
                onChange={(e) => onFilter({ ...filter, query: e.target.value })} />
            </label>
            {/* compact on a phone: each label beside its options (they wrap below it only when there is no room) */}
            <div className="flex flex-col gap-1.5" data-cl-filters>
              <FilterRow label={tr('cableLibrary.view.construction')}>
                <div className="ui-segment max-w-full flex-wrap" role="group" aria-label={tr('cableLibrary.view.construction')}>
                  {/* short names here (the full name is the button's title / accessible name, and on every card) */}
                  {CONSTRUCTIONS.map((c) => <button key={c} type="button" aria-pressed={filter.constructions.includes(c)} aria-label={cableKindLabel(c, tr)} title={cableKindLabel(c, tr)} data-cl-filter-construction={c} className={chip(filter.constructions.includes(c))} onClick={() => onFilter({ ...filter, constructions: toggle(filter.constructions, c) })}>{tr(`cableLibrary.view.constructionShort.${c}`)}</button>)}
                </div>
              </FilterRow>
              <FilterRow label={tr('cableLibrary.view.completeness')}>
                <div className="ui-segment max-w-full flex-wrap" role="radiogroup" aria-label={tr('cableLibrary.view.completeness')}>
                  {(['all', 'complete', 'draft'] as CompletenessFilter[]).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={filter.completeness === c} data-cl-filter-completeness={c} className={chip(filter.completeness === c)} onClick={() => onFilter({ ...filter, completeness: c })}>
                      {c === 'all' ? tr('cableLibrary.view.all') : tr(`cableLibrary.cableStatus.${c}`)}
                    </button>
                  ))}
                </div>
              </FilterRow>
              <FilterRow label={tr('cableLibrary.view.verification')}>
                <div className="ui-segment max-w-full flex-wrap" role="group" aria-label={tr('cableLibrary.view.verification')}>
                  {VERIFICATION_STATUSES.map((s) => <button key={s} type="button" aria-pressed={filter.verification.includes(s)} data-cl-filter-verification={s} className={chip(filter.verification.includes(s))} onClick={() => onFilter({ ...filter, verification: toggle(filter.verification, s) })}>{tr(`cableLibrary.verificationStatus.${s}`)}</button>)}
                </div>
              </FilterRow>
            </div>
            {filtered && <p className="text-[12px] text-ios-secondary" data-cl-showing>{tr('cableLibrary.view.showing', { shown: shown.length, total })}</p>}
            {shown.length > 0
              ? <ul className="flex flex-col gap-2" data-cl-list>{shown.map((t) => <CableTypeCard key={t.id} t={t} ctx={ctx} onOpen={onOpen} {...card} />)}</ul>
              : (
                <div className="flex flex-col items-center gap-2 py-6 text-center" data-cl-no-results>
                  <p className="text-[15px] text-ios-secondary">{tr('cableLibrary.view.noResults')}</p>
                  <button type="button" className="ui-tinted-btn !w-auto" data-cl-action="clear-filters" onClick={() => onFilter({ query: '', constructions: [], completeness: 'all', verification: [] })}>{tr('cableLibrary.view.clearFilters')}</button>
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
};

// ---------- details of one revision ----------

const Row: React.FC<{ label: string; children: React.ReactNode; k?: string }> = ({ label, children, k }) => (
  <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3" {...(k ? { 'data-cl-info': k } : {})}>
    <dt className="shrink-0 text-[13px] text-ios-secondary sm:w-40">{label}</dt>
    <dd className="min-w-0 text-[14px] text-ios-label">{children}</dd>
  </div>
);

export const ElectricalTable: React.FC<{ t: CableTypeRevision; ctx: ViewCtx }> = ({ t, ctx }) => {
  const { tr } = ctx;
  const heads = ['property', 'value', 'basis', 'source', 'verification'] as const;
  return (
    <div data-cl-electrical>
      {/* column heads on wide screens; each row stacks its cells on a phone */}
      <div className="hidden grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_auto] gap-2 border-b border-ios-separator pb-1 text-[12px] font-medium text-ios-secondary sm:grid">
        {heads.map((h) => <span key={h}>{h === 'verification' ? tr('cableLibrary.view.verification') : tr(`cableLibrary.view.${h}`)}</span>)}
      </div>
      {(['r', 'x', 'rn', 'xn'] as const).map((p) => {
        const v = valueView(t, p);
        const src = sourceText(v.source, ctx);
        return (
          <div key={p} data-cl-row={p} data-cl-entered={v.entered ? 'yes' : 'no'} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-b border-ios-separator py-2 text-[13px] sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_auto] sm:items-center">
            <span className="row-span-4 font-semibold text-ios-label sm:row-span-1">{SYMBOL[p]}</span>
            <span><ValueText v={v} ctx={ctx} /></span>
            <span className="text-ios-secondary" data-cl-basis={v.basis}>{basisText(v, ctx)}</span>
            <span className="min-w-0 break-words text-ios-secondary" data-cl-source={v.sourceFrom}>
              {src ? <SourceLine s={v.source} ctx={ctx} /> : tr('cableLibrary.view.sourceNone')}{v.sourceFrom === 'type' && <span className="text-ios-tertiary"> ({tr('cableLibrary.view.typeSource')})</span>}
            </span>
            <span><VerificationBadge status={v.verification.status} ctx={ctx} what={p} /></span>
            {v.conversionRequested && <span className="col-start-2 text-[12px] text-amber-900 sm:col-span-4 sm:col-start-2" data-cl-conversion>{tr('cableLibrary.view.conversionNotApplied')}</span>}
          </div>
        );
      })}
    </div>
  );
};

export interface DetailsProps {
  t: CableTypeRevision;
  /** the current revision number of this type */
  current: number;
  ctx: ViewCtx;
  onBack: () => void;
  onClose: () => void;
  onHistory?: () => void;
  /** Stage C3: edit — offered for the current revision only (an earlier revision is never edited) */
  onEdit?: () => void;
  /** the app's default cable, when it is this type (its chosen revision) */
  defaultRevision?: number;
  /** makes the revision shown the app's default cable */
  onSetDefault?: () => void;
}
export const CableTypeDetailsView: React.FC<DetailsProps> = ({ t, current, ctx, onBack, onClose, onHistory, onEdit, defaultRevision, onSetDefault }) => {
  const { tr } = ctx;
  const old = t.revision !== current;
  const complete = cableTypeCompleteness(t).complete;
  const mat = (m: string | undefined) => (m ? materialLabel(m, tr) : tr('cableLibrary.view.notStated'));
  const sec = (s: number | undefined) => (s !== undefined ? <bdi dir="ltr">{s} mm²</bdi> : tr('cableLibrary.view.notStated'));
  return (
    <div data-cl-view="details" data-cl-type={t.id} data-cl-revision={t.revision}>
      <CableLibraryHeader title={t.name || tr('cableLibrary.view.notStated')} sub={tr('cableLibrary.view.revision', { n: t.revision })} ctx={ctx} onBack={onBack} onClose={onClose}
        action={onEdit && !old ? <button type="button" onClick={onEdit} aria-label={tr('cableLibrary.edit')} title={tr('cableLibrary.edit')} data-cl-action="edit" className="ui-icon-btn !h-9 !w-9 text-ios-blue"><Pencil {...ICON_MD} /></button> : undefined} />
      <div className="flex flex-col gap-4 px-3 py-3">
        {old && <p className="rounded-ctl bg-ios-fill px-3 py-2 text-[13px] text-ios-label" data-cl-readonly>{tr('cableLibrary.view.readOnly')} · {tr('cableLibrary.view.currentRevision', { n: current })}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <CompletenessBadge complete={complete} ctx={ctx} />
          <VerificationBadge status={typeVerification(t)} ctx={ctx} what="type" />
        </div>
        {(defaultRevision !== undefined || onSetDefault) && (
          <div className="flex flex-wrap items-center gap-2 rounded-ctl bg-ios-fill px-3 py-2 text-[13px] text-ios-label" data-cl-default-box>
            {defaultRevision !== undefined && <span data-cl-default-is={defaultRevision}>{tr('defaultCable.badge', { n: defaultRevision })}</span>}
            {onSetDefault && defaultRevision !== t.revision && (
              <button type="button" className="ui-tinted-btn !w-auto !min-h-[34px] !px-3" data-cl-action="set-default" onClick={onSetDefault}>{tr('defaultCable.set', { n: t.revision })}</button>
            )}
          </div>
        )}
        <section>
          <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ios-secondary">{tr('cableLibrary.view.general')}</h3>
          <dl className="divide-y divide-ios-separator">
            <Row label={tr('cableLibrary.field.name')} k="name">{t.name || tr('cableLibrary.view.notStated')}</Row>
            <Row label={tr('cableLibrary.view.description')} k="description">{t.description?.trim() || <span className="text-ios-tertiary">{tr('cableLibrary.view.notStated')}</span>}</Row>
            <Row label={tr('cableLibrary.view.construction')} k="construction">{cableKindLabel(t.construction, tr)}</Row>
            <Row label={tr('cableLibrary.field.phaseConductors')} k="phaseConductors">{t.phaseConductors}</Row>
            <Row label={tr('cableLibrary.field.neutralConductors')} k="neutralConductors">{t.neutralConductors > 0 ? t.neutralConductors : tr('cableLibrary.view.noNeutral')}</Row>
            <Row label={tr('cableLibrary.field.phaseMaterial')} k="phase.material">{mat(t.phase.material)}</Row>
            <Row label={tr('cableLibrary.field.phaseSection')} k="phase.sectionMm2">{sec(t.phase.sectionMm2)}</Row>
            {t.neutralConductors > 0 && <Row label={tr('cableLibrary.field.neutralMaterial')} k="neutral.material">{mat(t.neutral?.material)}</Row>}
            {t.neutralConductors > 0 && <Row label={tr('cableLibrary.field.neutralSection')} k="neutral.sectionMm2">{sec(t.neutral?.sectionMm2)}</Row>}
            <Row label={tr('cableLibrary.field.maxCurrentA')} k="maxCurrentA">{t.maxCurrentA !== undefined ? iso(`${t.maxCurrentA} A`) : <span className="text-ios-tertiary">{tr('cableLibrary.view.notStated')}</span>}</Row>
            <Row label={tr('cableLibrary.field.source')} k="source">{sourceText(t.source, ctx) ? <SourceLine s={t.source} ctx={ctx} /> : <span className="text-ios-tertiary">{tr('cableLibrary.view.sourceNone')}</span>}</Row>
            <Row label={tr('cableLibrary.field.revision')} k="revision">{t.revision}</Row>
          </dl>
        </section>
        <section>
          <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-ios-secondary">{tr('cableLibrary.view.electrical')}</h3>
          <ElectricalTable t={t} ctx={ctx} />
        </section>
        {onHistory && (
          <button type="button" onClick={onHistory} data-cl-action="history" className="ui-tinted-btn inline-flex !w-auto items-center gap-2 self-start">
            <History {...ICON_SM} />{tr('cableLibrary.view.viewHistory')}
          </button>
        )}
      </div>
    </div>
  );
};

// ---------- the revision history ----------

const FIELD_KEY = {
  name: 'name', description: 'description', construction: 'construction', phaseConductors: 'phaseConductors', neutralConductors: 'neutralConductors',
  'phase.material': 'phaseMaterial', 'phase.sectionMm2': 'phaseSection', 'neutral.material': 'neutralMaterial', 'neutral.sectionMm2': 'neutralSection', source: 'source',
  maxCurrentA: 'maxCurrentA',
} as const;
const fieldLabel = (f: CompareField, tr: Tr): string => {
  if (f === 'r' || f === 'x' || f === 'rn' || f === 'xn') return SYMBOL[f];
  if (f.endsWith('.verification')) return tr('cableLibrary.field.verificationOf', { p: SYMBOL[f.split('.')[0] as ElectricalProperty] });
  return tr(`cableLibrary.field.${FIELD_KEY[f as keyof typeof FIELD_KEY]}`);
};

export interface HistoryProps {
  name: string;
  /** oldest first, as the library keeps them; undefined while loading */
  revisions?: readonly CableTypeRevision[];
  failed?: boolean;
  ctx: ViewCtx;
  onOpenRevision: (revision: number) => void;
  onCompare: () => void;
  onRetry: () => void;
  onBack: () => void;
  onClose: () => void;
}
export const RevisionHistoryView: React.FC<HistoryProps> = ({ name, revisions, failed, ctx, onOpenRevision, onCompare, onRetry, onBack, onClose }) => {
  const { tr } = ctx;
  const current = revisions?.length ? revisions[revisions.length - 1].revision : undefined;
  return (
    <div data-cl-view="history">
      <CableLibraryHeader title={tr('cableLibrary.revisionHistory')} sub={name} ctx={ctx} onBack={onBack} onClose={onClose} />
      <div className="flex flex-col gap-2 px-3 py-3">
        {!revisions && !failed && <p className="py-6 text-center text-[15px] text-ios-secondary" role="status" data-cl-history-loading>{tr('cableLibrary.view.historyLoading')}</p>}
        {failed && (
          <div className="flex flex-col items-start gap-2 rounded-ctl bg-red-50 px-3 py-2.5 text-[13px] text-ios-red" role="alert" data-cl-history-error>
            <p>{tr('cableLibrary.view.historyFailed')}</p>
            <button type="button" onClick={onRetry} data-cl-action="retry-history" className="ui-tinted-btn !w-auto">{tr('cableLibrary.retry')}</button>
          </div>
        )}
        {revisions && revisions.length > 1 && <button type="button" onClick={onCompare} data-cl-action="compare" className="ui-tinted-btn !w-auto self-start">{tr('cableLibrary.view.compare')}</button>}
        {revisions && (
          <ol className="flex flex-col gap-2" data-cl-revisions>
            {revisionChanges(revisions).map(({ revision: r, changed }) => (
              <li key={r.revision} data-cl-rev={r.revision} className="rounded-ctl border border-ios-separator px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-ios-label">
                      {tr('cableLibrary.view.revision', { n: r.revision })}
                      {r.revision === current && <span className="ms-2 text-[12px] font-normal text-ios-secondary">({tr('cableLibrary.view.currentRevision', { n: r.revision })})</span>}
                    </p>
                    <p className="truncate text-[13px] text-ios-label" data-cl-rev-name>{r.name}</p>
                    <p className="text-[12px] text-ios-secondary" data-cl-rev-date>{tr('cableLibrary.view.createdOn', { date: formatDate(r.revisionCreatedAt, ctx.locale) })}</p>
                    {r.createdBy && <p className="text-[12px] text-ios-secondary" data-cl-rev-by>{tr('cableLibrary.view.createdBy', { name: r.createdBy })}</p>}
                    {r.changeNote && <p className="text-[12px] text-ios-secondary" data-cl-rev-note>{tr('cableLibrary.view.note', { note: r.changeNote })}</p>}
                    <p className="mt-0.5 text-[12px] text-ios-label" data-cl-rev-changes>
                      {r.revision === 1 ? tr('cableLibrary.view.firstRevision') : changed.length ? tr('cableLibrary.view.changed', { list: changed.map((f) => fieldLabel(f, tr)).join(tr('common.listSep')) }) : tr('cableLibrary.view.noChanges')}
                    </p>
                  </div>
                  <button type="button" onClick={() => onOpenRevision(r.revision)} data-cl-action="open-revision" data-cl-open={r.revision} className="ui-tinted-btn !w-auto shrink-0">{tr('cableLibrary.view.open')}</button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1" data-cl-rev-verification>
                  {(['r', 'x', 'rn', 'xn'] as const).map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 text-[11px] text-ios-secondary">{SYMBOL[p]}<VerificationBadge status={r[p].verification.status} ctx={ctx} what={p} /></span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

// ---------- comparing two revisions ----------

const DIFF_STYLE: Record<DiffStatus, string> = {
  added: 'bg-blue-50 text-blue-700 ring-blue-300',
  changed: 'bg-amber-50 text-amber-900 ring-amber-300',
  removed: 'bg-red-50 text-ios-red ring-red-300',
  unchanged: 'bg-ios-fill text-ios-secondary ring-ios-separator',
};
const compareValueText = (row: CompareRow, side: unknown, ctx: ViewCtx): string => {
  const { tr } = ctx;
  if (side === undefined) return '—';
  const f = row.field;
  if (f === 'construction') return cableKindLabel(side as CableConstruction, tr);
  if (f === 'phase.material' || f === 'neutral.material') return materialLabel(String(side), tr);
  if (f === 'phase.sectionMm2' || f === 'neutral.sectionMm2') return iso(`${side} mm²`);
  if (f === 'source') return sourceText(side as ValueSource, ctx) ?? '—';
  if (f === 'maxCurrentA') return iso(`${side} A`);
  if (f.endsWith('.verification')) return verificationText(side as Verification, ctx);
  if (f === 'r' || f === 'x' || f === 'rn' || f === 'xn') {
    const v = side as ElectricalValue;
    return joinParts([`${v.value} Ω/km`, basisText(v, ctx), sourceText(v.source, ctx), v.conversion ? tr('cableLibrary.view.conversionNotApplied') : undefined]);
  }
  return String(side);
};

export interface CompareProps {
  revisions: readonly CableTypeRevision[];
  from: number;
  to: number;
  showUnchanged: boolean;
  ctx: ViewCtx;
  onChange: (from: number, to: number) => void;
  onShowUnchanged: (v: boolean) => void;
  onBack: () => void;
  onClose: () => void;
}
export const RevisionCompareView: React.FC<CompareProps> = ({ revisions, from, to, showUnchanged, ctx, onChange, onShowUnchanged, onBack, onClose }) => {
  const { tr } = ctx;
  const a = revisions.find((r) => r.revision === from);
  const b = revisions.find((r) => r.revision === to);
  const rows = a && b ? compareRevisions(a, b) : [];
  const visible = rows.filter((r) => showUnchanged || r.status !== 'unchanged');
  const select = (value: number, onPick: (n: number) => void, label: string, k: string) => (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[12px] font-medium text-ios-secondary">{label}</span>
      <select className="ui-field h-11" value={value} onChange={(e) => onPick(Number(e.target.value))} aria-label={label} data-cl-field={k}>
        {revisions.map((r) => <option key={r.revision} value={r.revision}>{tr('cableLibrary.view.revision', { n: r.revision })}</option>)}
      </select>
    </label>
  );
  return (
    <div data-cl-view="compare" data-cl-from={from} data-cl-to={to}>
      <CableLibraryHeader title={tr('cableLibrary.view.compare')} sub={a?.name ?? b?.name} ctx={ctx} onBack={onBack} onClose={onClose} />
      <div className="flex flex-col gap-3 px-3 py-3">
        <div className="flex gap-3">
          {select(from, (n) => onChange(n, to), tr('cableLibrary.view.compareFrom'), 'compare-from')}
          {select(to, (n) => onChange(from, n), tr('cableLibrary.view.compareTo'), 'compare-to')}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ios-label">
          <input type="checkbox" checked={showUnchanged} onChange={(e) => onShowUnchanged(e.target.checked)} data-cl-field="show-unchanged" />
          {tr('cableLibrary.view.showUnchanged')}
        </label>
        <ul className="flex flex-col divide-y divide-ios-separator" data-cl-compare>
          {visible.map((r) => (
            <li key={r.field} data-cl-diff={r.field} data-cl-diff-status={r.status} className="flex flex-col gap-1 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-ios-label">{fieldLabel(r.field, tr)}</span>
                <span className={`${badge} ${DIFF_STYLE[r.status]}`}>{tr(`cableLibrary.diff.${r.status}`)}</span>
              </div>
              {r.status !== 'unchanged'
                ? (
                  <div className="grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
                    <p className="min-w-0 break-words text-ios-secondary"><span className="text-ios-tertiary">{tr('cableLibrary.view.before')}: </span><bdi>{compareValueText(r, r.before, ctx)}</bdi></p>
                    <p className="min-w-0 break-words text-ios-label"><span className="text-ios-tertiary">{tr('cableLibrary.view.after')}: </span><bdi>{compareValueText(r, r.after, ctx)}</bdi></p>
                  </div>
                )
                : <p className="min-w-0 break-words text-[13px] text-ios-secondary"><bdi>{compareValueText(r, r.after ?? r.before, ctx)}</bdi></p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

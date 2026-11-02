import React, { useState } from 'react';
import { Link2, Link2Off, RefreshCw } from 'lucide-react';
import type { CableTypeRevision, ElectricalProperty, SpanCableType } from '../../types/cableType';
import type { CableLibraryState } from '../../store/cableLibraryStore';
import { cableTypeCompleteness } from '../../utils/cableTypeModel';
import { NO_FILTER, typeVerification, valueView, type LibraryFilter } from '../../utils/cableLibraryView';
import { dcResistances, linkedCableData, type LinkRecordState, type PickCheck } from '../../utils/spanCableLink';
import { cableKindLabel } from '../../utils/vdLabels';
import { ICON_SM } from '../ui/icons';
import { basisText, CableTypeDetailsView, CompletenessBadge, conductorLine, LibraryListView, ValueText, VerificationBadge, type ViewCtx } from './CableTypeViews';

// Stage C4: the library cable of one span, inside the span sheet — the linked cable (from the
// snapshot kept in the project, never from the library), the notices about it, and the picker
// (search, filters, a preview of the cable, then the link). Pure: the sheet gives the data and the
// actions (link / unlink are applied by the sheet as one undo step each).

const SYMBOL: Record<ElectricalProperty, string> = { r: 'R', x: 'X', rn: 'Rn', xn: 'Xn' };
const note = 'rounded-ctl px-3 py-2 text-[13px]';

export interface SpanCableSectionProps {
  link: SpanCableType | undefined;
  record: LinkRecordState;
  /** C0: an unresolved merge of spans with different cable types */
  conflict: boolean;
  ctx: ViewCtx;
  onChoose: () => void;
  onUnlink: () => void;
}

export const SpanCableSection: React.FC<SpanCableSectionProps> = ({ link, record, conflict, ctx, onChoose, onUnlink }) => {
  const { tr } = ctx;
  if (!link) {
    return (
      <section className="flex flex-col gap-2 rounded-ctl border border-dashed border-ios-separator px-3 py-2.5" data-span-cable="none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ios-label">{tr('spanCable.title')}</h3>
            <p className="text-[13px] text-ios-secondary">{tr('spanCable.notLinked')}</p>
          </div>
          <button type="button" className="ui-tinted-btn inline-flex !w-auto items-center gap-1.5" data-span-cable-action="choose" onClick={onChoose}><Link2 {...ICON_SM} />{tr('spanCable.choose')}</button>
        </div>
        {conflict && <p className={`${note} bg-amber-50 text-amber-900`} data-span-cable-note="conflict">⚠ {tr('spanCable.conflict')}</p>}
      </section>
    );
  }
  const { data, overridden } = linkedCableData(link);
  const complete = cableTypeCompleteness(data);
  const missing = (['r', 'x', 'rn', 'xn'] as const).filter((p) => valueView(data, p).entered === false && (p === 'r' || p === 'x' || data.neutralConductors > 0));
  const dc = dcResistances(data);
  const line = conductorLine(data, ctx);
  return (
    <section className="flex flex-col gap-2 rounded-ctl border border-ios-blue/60 bg-ios-blue/[0.04] px-3 py-2.5" data-span-cable="linked" data-span-cable-type={link.typeId} data-span-cable-revision={link.revision}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ios-blue">{tr('spanCable.title')} · {tr('spanCable.linked')}</p>
          <h3 className="break-words text-[15px] font-semibold text-ios-label" data-span-cable-name>{data.name || tr('cableLibrary.view.notStated')}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-ios-blue px-2 py-0.5 text-[12px] font-semibold text-white" data-span-cable-linked-revision={link.revision}>{tr('spanCable.linkedRevision', { n: link.revision })}</span>
      </div>
      <p className="text-[13px] text-ios-secondary">
        {cableKindLabel(data.construction, tr)} · {tr('cableLibrary.view.conductors', { p: data.phaseConductors, n: data.neutralConductors })}
        {line && <> · {line}</>}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CompletenessBadge complete={complete.complete} ctx={ctx} />
        <VerificationBadge status={typeVerification(data)} ctx={ctx} what="type" />
      </div>
      <dl className="flex flex-col gap-1 text-[13px]" data-span-cable-values>
        {(['r', 'x', 'rn', 'xn'] as const).map((p) => {
          const v = valueView(data, p);
          return (
            <div key={p} className="flex flex-wrap items-baseline gap-x-2" data-span-cable-prop={p} data-entered={v.entered ? 'yes' : 'no'}>
              <dt className="w-7 shrink-0 font-semibold text-ios-label">{SYMBOL[p]}</dt>
              <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <ValueText v={v} ctx={ctx} />
                {v.entered && <span className="text-ios-secondary" data-span-cable-basis={v.basis}>{basisText(v, ctx)}</span>}
                {overridden.includes(p) && <span className="text-[12px] text-ios-blue" data-span-cable-overridden>{tr('spanCable.overridden')}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {missing.length > 0 && <p className={`${note} bg-amber-50 text-amber-900`} data-span-cable-note="missing-values">{tr('spanCable.missingValues', { list: missing.map((p) => SYMBOL[p]).join(tr('common.listSep')) })}</p>}
      {dc.map((p) => <p key={p} className={`${note} bg-amber-50 text-amber-900`} data-span-cable-note="dc">{tr('spanCable.dc', { p: SYMBOL[p] })}</p>)}

      {record.kind === 'checking' && <p className="flex items-center gap-1.5 text-[12px] text-ios-tertiary" data-span-cable-record="checking"><RefreshCw {...ICON_SM} className="animate-spin" />{tr('spanCable.checking')}</p>}
      {record.kind === 'newer' && <p className={`${note} bg-blue-50 text-blue-800`} data-span-cable-record="newer">{tr('spanCable.newer', { n: record.latest, m: link.revision })}</p>}
      {record.kind === 'missing' && <p className={`${note} bg-amber-50 text-amber-900`} data-span-cable-record="missing">{tr('spanCable.missing')}</p>}
      {record.kind === 'ahead' && <p className={`${note} bg-amber-50 text-amber-900`} data-span-cable-record="ahead">{tr('spanCable.ahead', { n: link.revision, m: record.latest })}</p>}
      {record.kind === 'unknown' && <p className={`${note} bg-ios-fill text-ios-label`} data-span-cable-record="unknown">{tr('spanCable.unknown')}</p>}

      {/* the two engines read different data: stated, never hidden */}
      <div className={`${note} border border-amber-200 bg-white text-ios-label`} data-span-cable-note="engines" role="note">
        <p className="font-medium">{tr('spanCable.enginesTitle')}</p>
        <p>{tr('spanCable.engines')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-tinted-btn inline-flex !w-auto items-center gap-1.5" data-span-cable-action="change" onClick={onChoose}><Link2 {...ICON_SM} />{tr('spanCable.change')}</button>
        <button type="button" className="ui-tinted-btn inline-flex !w-auto items-center gap-1.5 !bg-ios-fill !text-ios-red" data-span-cable-action="unlink" onClick={onUnlink}><Link2Off {...ICON_SM} />{tr('spanCable.unlink')}</button>
      </div>
      <p className="text-[12px] text-ios-tertiary">{tr('spanCable.unlinkHint')} {tr('spanCable.appliedNow')}</p>
    </section>
  );
};

// ---------- the picker ----------

export interface SpanCablePickerProps {
  state: CableLibraryState;
  /** the span's current link (its card is marked; its revision cannot be linked again) */
  linked: SpanCableType | undefined;
  ctx: ViewCtx;
  /** reads the record again and gives the revision that may be linked (never a deleted record or a missing revision) */
  check: (shown: CableTypeRevision) => Promise<PickCheck>;
  onLink: (revision: CableTypeRevision) => void;
  onRetry: () => void;
  onBack: () => void;
  /** the first view (tests) */
  initial?: { filter?: LibraryFilter; preview?: CableTypeRevision };
}

type PickError = { reason: 'gone' | 'changed' | 'failed'; n?: number };

export const SpanCablePicker: React.FC<SpanCablePickerProps> = ({ state, linked, ctx, check, onLink, onRetry, onBack, initial }) => {
  const { tr } = ctx;
  const [filter, setFilter] = useState<LibraryFilter>(initial?.filter ?? NO_FILTER);
  const [preview, setPreview] = useState<CableTypeRevision | undefined>(initial?.preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PickError | undefined>();

  if (!preview) {
    return (
      <div data-span-cable-picker="list">
        <LibraryListView state={state} filter={filter} onFilter={setFilter} ctx={ctx} title={tr('spanCable.pickTitle')}
          onOpen={(id) => { const t = state.types.find((x) => x.id === id); if (t) { setError(undefined); setPreview(t); } }}
          onRetry={onRetry} onBack={onBack} onClose={onBack}
          card={{ showBasis: true, ...(linked ? { linkedId: linked.typeId } : {}) }} />
      </div>
    );
  }
  const same = linked?.typeId === preview.id && linked.revision === preview.revision;
  const link = async () => {
    if (busy || same) return;
    setBusy(true);
    setError(undefined);
    const r = await check(preview);
    setBusy(false);
    if (r.ok) { onLink(r.revision); return; }
    const f = r as Extract<PickCheck, { ok: false }>;
    if (f.reason === 'changed' && f.latest) setPreview(f.latest);
    setError({ reason: f.reason, ...(f.latest ? { n: f.latest.revision } : {}) });
  };
  return (
    <div data-span-cable-picker="preview" className="flex flex-col">
      <CableTypeDetailsView t={preview} current={preview.revision} ctx={ctx} onBack={() => { setError(undefined); setPreview(undefined); }} onClose={onBack} />
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-ios-separator bg-white px-3 py-3">
        {error && <p className={`${note} bg-red-50 text-ios-red`} role="alert" data-span-cable-error={error.reason}>{tr(`spanCable.errors.${error.reason}`, { n: error.n ?? '' })}</p>}
        {same
          ? <p className="text-[13px] text-ios-secondary" data-span-cable-same>{tr('spanCable.alreadyLinked')}</p>
          : <p className="text-[13px] text-ios-secondary">{tr('spanCable.linkRevision', { n: preview.revision })}</p>}
        <button type="button" disabled={busy || same || error?.reason === 'gone'} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-ctl bg-ios-blue px-3 text-[17px] font-semibold text-white active:bg-ios-blue-pressed disabled:opacity-40" data-span-cable-action="link" onClick={() => void link()}>
          <Link2 {...ICON_SM} />{busy ? tr('spanCable.linking') : tr('spanCable.link')}
        </button>
      </div>
    </div>
  );
};

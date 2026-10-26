import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import type { ConsumerElement, ConsumerProposal } from '../types/drawing';
import { poleNamer } from '../utils/poleNames';
import { effectiveSettings } from '../utils/electricalSettings';
import { consumerLoad, SINGLE_PHASE_AMPS, THREE_PHASE_DEFAULT_AMPS } from '../utils/loads';
import { compareConnections, connectionCandidates, connectionOf, proposalLoadText, sameConnection, type CandidateResult, type ConnectionCandidate } from '../utils/proposedConsumers';
import { fmt } from '../utils/vdLabels';
import { useBackdropClose } from './SpanPropertiesSheet';
import { useLocale, useT } from '../store/localeStore';
import { directionOf } from '../i18n';

// «اقتراح مشترك جديد» / «تعديل المشترك المقترح»: the proposed subscriber's load (the same
// fields and rules as any subscriber), the cable it is connected to at the pole (chosen
// explicitly, helped by a comparison of every connection point there), and its status.
// Saving, confirming, returning to «مقترح» and deleting are one undo step each.

const genId = () => Math.random().toString(36).slice(2, 11);
const candKey = (c: ConnectionCandidate) => `${c.cableId}#${c.occurrence}${c.side ? `~${c.side}` : ''}`;

export const ProposedConsumerSheet: React.FC<{ poleId: string; consumerId?: string; onClose: () => void }> = ({ poleId, consumerId, onClose }) => {
  const { elements, electrical, connectionDistances, distanceFlags, addElement, updateElement, deleteElement, saveHistory } = useDrawingStore();
  const existing = consumerId ? (elements.find((e) => e.id === consumerId) as ConsumerElement | undefined) : undefined;
  const t = useT();
  const locale = useLocale((st) => st.locale);
  const name = useMemo(() => poleNamer(elements, t), [elements, t]);
  const backdropClose = useBackdropClose(onClose);
  const [id] = useState(() => existing?.id ?? genId());
  const [variant, setVariant] = useState<'circle' | 'square'>(existing?.variant === 'circle' ? 'circle' : existing ? 'square' : 'circle');
  const [count, setCount] = useState(String(existing?.count ?? 1));
  const [amps, setAmps] = useState(existing?.variant !== 'circle' ? existing?.label ?? '' : '');
  const settings = useMemo(() => effectiveSettings(electrical), [electrical]);
  const candidates = useMemo(() => connectionCandidates(elements, poleId, settings), [elements, poleId, settings]);
  const [chosen, setChosen] = useState<string | null>(() => {
    const c = existing?.proposal?.connection;
    const found = c ? candidates.find((x) => sameConnection(c, x)) : undefined;
    if (found) return candKey(found);
    return !existing && candidates.length === 1 ? candKey(candidates[0]) : null; // one place only: nothing to choose
  });
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { if (!elements.some((e) => e.id === poleId) || (consumerId && !existing)) onClose(); }, [elements, poleId, consumerId, existing, onClose]);

  // validation: the same rules as the load report (a whole count ≥ 1; a three-phase current > 0, or none = 32 A)
  const n = Number(count);
  const countOk = /^\s*\d+\s*$/.test(count) && Number.isInteger(n) && n >= 1;
  const ampsTrim = amps.trim().replace(',', '.');
  const ampsOk = variant === 'circle' || ampsTrim === '' || (/^\d+(\.\d+)?$/.test(ampsTrim) && Number(ampsTrim) > 0);
  const label = variant === 'square' ? ampsTrim : '';
  const draft: ConsumerElement = useMemo(() => ({
    ...(existing ?? { x: 0, y: 0, strokeWidth: 2 }), id, type: 'consumer', poleId, variant, count: countOk ? n : 1, label,
    color: existing?.color ?? '#000000', strokeColor: existing?.strokeColor ?? '#000000', fillColor: existing?.fillColor ?? '#000000',
    proposal: existing?.proposal ?? { status: 'proposed' },
  }), [existing, id, poleId, variant, countOk, n, label]);
  const load = consumerLoad(draft);
  const comparison = useMemo(
    () => (countOk && ampsOk ? compareConnections(elements, connectionDistances, settings, distanceFlags, draft, candidates) : null),
    [countOk, ampsOk, elements, connectionDistances, settings, distanceFlags, draft, candidates],
  );
  const chosenCand = candidates.find((c) => candKey(c) === chosen);
  const valid = countOk && ampsOk && !!chosenCand;
  const status = existing?.proposal?.status ?? 'proposed';

  const write = (next: ConsumerProposal['status']) => {
    if (!valid || !chosenCand) return;
    const proposal: ConsumerProposal = { ...(existing?.proposal ?? {}), status: next, connection: connectionOf(chosenCand) };
    const el: ConsumerElement = { ...draft, color: chosenCand.color, strokeColor: chosenCand.color, fillColor: chosenCand.color, proposal };
    saveHistory();
    if (existing) updateElement(el.id, el); else addElement(el);
    saveHistory();
    onClose();
  };
  const setStatus = (next: ConsumerProposal['status']) => {
    if (!existing?.proposal) return;
    saveHistory(); updateElement(existing.id, { proposal: { ...existing.proposal, status: next } }); saveHistory();
  };
  const remove = () => { if (!existing) return; saveHistory(); deleteElement(existing.id); saveHistory(); onClose(); };
  const dirty = !existing || existing.variant !== variant || String(existing.count) !== count.trim() || (existing.label ?? '') !== label
    || !chosenCand || !sameConnection(existing.proposal?.connection, chosenCand);

  const resultLine = (r: CandidateResult | undefined) => {
    if (!r) return null;
    if (!r.computable) return (
      <span className="text-amber-900" data-candidate-incomplete={r.incompletePoleIds ? 'yes' : undefined}>
        {t('proposal.notComputable', { reason: r.reason ?? '' })}{r.incompletePoleIds?.length ? t('proposal.noResultAt', { list: r.incompletePoleIds.map(name).join(t('common.listSep')) }) : ''}
      </span>
    );
    const before = r.maxPercentBefore !== undefined ? t('proposal.before', { v: fmt(r.maxPercentBefore) }) : '';
    return (
      <span className="flex flex-col gap-0.5">
        <span>{t('proposal.worst')}<b>{fmt(r.maxPercent)}%</b>{before}{r.sourcePoleId ? t('proposal.source', { pole: name(r.sourcePoleId) }) : ''}</span>
        {r.atPole && <span>{t('proposal.atPole', { pole: name(poleId), percent: fmt(r.atPole.percent), v: fmt(r.atPole.phaseV, 1) })}</span>}
        {r.violations.length > 0
          ? <span className="font-semibold text-ios-red">{t('proposal.violations', { list: r.violations.map(name).join(t('common.listSep')) })}</span>
          : <span className="text-green-700">{t('proposal.noViolation')}</span>}
        <span className="text-ios-tertiary">{t('proposal.capacity')}</span>
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 sm:items-center" {...backdropClose}>
      <div dir={directionOf(locale)} role="dialog" aria-label={t('proposal.dialog')} data-proposed-sheet={existing ? existing.id : 'new'} className="flex w-full max-w-lg max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] flex-col overflow-hidden rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-ios-separator px-4 py-3">
          <h2 className="truncate text-[17px] font-semibold text-ios-label">{t(existing ? 'proposal.editTitle' : 'proposal.newTitle', { pole: name(poleId) })}</h2>
          <button type="button" aria-label={t('common.close')} data-proposal-action="close" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] text-[14px] flex flex-col gap-3">
          {existing && (
            <p className="text-[13px]" data-proposed-status={status}>{t('proposal.status')}<b>{status === 'confirmed' ? t('proposal.statusConfirmed') : electrical.studyProposedConsumers ? t('proposal.statusStudy') : t('proposal.statusProposed')}</b></p>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ios-secondary">{t('proposal.kind')}</span>
            <div className="ui-segment self-start" role="radiogroup" aria-label={t('proposal.kind')}>
              <button type="button" role="radio" aria-checked={variant === 'circle'} className={`ui-segment-item ${variant === 'circle' ? 'is-active' : ''}`} data-proposal-kind="circle" onClick={() => setVariant('circle')}>{t('proposal.single')}</button>
              <button type="button" role="radio" aria-checked={variant === 'square'} className={`ui-segment-item ${variant === 'square' ? 'is-active' : ''}`} data-proposal-kind="square" onClick={() => setVariant('square')}>{t('proposal.three')}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ios-secondary">{t('proposal.count')}</span>
              <input className="ui-field h-10" type="text" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-label={t('proposal.count')} data-proposal-field="count" />
            </label>
            {variant === 'square' && (
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-ios-secondary">{t('proposal.amps')}</span>
                <input className="ui-field h-10" type="text" inputMode="decimal" value={amps} placeholder={t('proposal.ampsPlaceholder', { n: THREE_PHASE_DEFAULT_AMPS })} onChange={(e) => setAmps(e.target.value)} aria-label={t('proposal.amps')} data-proposal-field="amps" />
              </label>
            )}
          </div>
          {!countOk && <p className="text-[13px] text-ios-red" data-proposal-error="count">{t('proposal.countInvalid')}</p>}
          {!ampsOk && <p className="text-[13px] text-ios-red" data-proposal-error="amps">{t('proposal.ampsInvalid')}</p>}
          <p className="text-[12px] text-ios-tertiary">{t('proposal.rules', { single: SINGLE_PHASE_AMPS, three: THREE_PHASE_DEFAULT_AMPS })}</p>
          {countOk && ampsOk && <p className="text-[13px]" data-proposed-load={load.amps}>{t('proposal.load')}<b>{proposalLoadText(draft)}</b>{load.kind === 'three' && load.source === 'three-phase-default' ? t('proposal.loadDefault') : ''}</p>}

          <section aria-label={t('proposal.cableSection')} className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ios-secondary">{t('proposal.chooseCable')}</span>
            {candidates.length === 0 && <p className="text-ios-red">{t('proposal.noCable')}</p>}
            {comparison?.recommended && <p className="text-[12px] text-ios-secondary">{t('proposal.bestExplain')}</p>}
            {comparison?.noRecommendation && candidates.length > 0 && <p className="text-[12px] text-amber-900">{t('proposal.noRecommendation', { reason: comparison.noRecommendation })}</p>}
            {candidates.map((c) => {
              const k = candKey(c);
              const r = comparison?.results.find((x) => candKey(x.candidate) === k);
              const on = chosen === k;
              const along = [c.prevPoleId && `${name(c.prevPoleId)}`, c.nextPoleId && `${name(c.nextPoleId)}`].filter(Boolean).join(' ↔ ');
              return (
                <button key={k} type="button" role="radio" aria-checked={on} data-proposed-candidate={k} data-recommended={r?.recommended ? 'yes' : 'no'} onClick={() => setChosen(k)}
                  className={`flex flex-col items-stretch gap-1 rounded-ctl border p-2 text-start text-[13px] ${on ? 'border-ios-blue bg-blue-50 ring-1 ring-ios-blue' : 'border-ios-separator'}`}>
                  <span className="flex flex-wrap items-center gap-2 text-ios-label">
                    <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: c.color }} />
                    <b>{t('proposal.candidate', { along: along || '—' })}</b>
                    {c.side && <span className="text-ios-secondary">{t('proposal.side', { pole: name((c.side === 'prev' ? c.prevPoleId : c.nextPoleId) ?? '') })}{c.keptSide ? t('proposal.keptSide') : t('proposal.openSide')}</span>}
                    {r?.recommended && <span className="rounded-full bg-green-600 px-2 text-[11px] font-semibold text-white">{t('proposal.best')}</span>}
                  </span>
                  {resultLine(r)}
                </button>
              );
            })}
          </section>

          {!existing && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!valid} onClick={() => write('proposed')} data-proposal-action="save-proposed" className="min-h-[44px] flex-1 rounded-ctl bg-ios-blue px-4 text-[16px] font-semibold text-white disabled:opacity-40">{t('proposal.saveProposed')}</button>
              <button type="button" onClick={onClose} data-proposal-action="cancel" className="min-h-[44px] flex-1 rounded-ctl bg-ios-fill px-4 text-[16px] text-ios-blue">{t('common.cancel')}</button>
            </div>
          )}
          {existing && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!valid || !dirty} onClick={() => write(status)} data-proposal-action="save-changes" className="min-h-[44px] flex-1 rounded-ctl bg-ios-blue px-4 text-[16px] font-semibold text-white disabled:opacity-40">{t('proposal.saveChanges')}</button>
                <button type="button" onClick={onClose} data-proposal-action="cancel" className="min-h-[44px] flex-1 rounded-ctl bg-ios-fill px-4 text-[16px] text-ios-blue">{t('common.cancel')}</button>
              </div>
              {status === 'proposed' && !confirming && (
                <button type="button" disabled={!valid || dirty} onClick={() => setConfirming(true)} data-proposal-action="confirm" className="min-h-[44px] rounded-ctl bg-green-600 px-4 text-[16px] font-semibold text-white disabled:opacity-40">{t('proposal.confirm')}</button>
              )}
              {status === 'proposed' && dirty && <p className="text-[12px] text-ios-secondary">{t('proposal.saveFirst')}</p>}
              {status === 'proposed' && confirming && (
                <div className="flex flex-col gap-2 rounded-ctl border border-green-600/40 bg-green-50 p-2 text-[13px]">
                  <span>{t('proposal.confirmExplain')}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setStatus('confirmed'); setConfirming(false); }} data-proposal-action="confirm-yes" className="min-h-[40px] flex-1 rounded-ctl bg-green-600 px-3 font-semibold text-white">{t('proposal.confirmYes')}</button>
                    <button type="button" onClick={() => setConfirming(false)} data-proposal-action="confirm-back" className="min-h-[40px] flex-1 rounded-ctl bg-ios-fill px-3 text-ios-blue">{t('proposal.confirmBack')}</button>
                  </div>
                </div>
              )}
              {status === 'confirmed' && (
                <button type="button" onClick={() => setStatus('proposed')} data-proposal-action="back-to-proposed" className="min-h-[44px] rounded-ctl bg-ios-fill px-4 text-[16px] text-ios-label">{t('proposal.backToProposed')}</button>
              )}
              <button type="button" onClick={remove} data-proposal-action="remove" className="min-h-[44px] rounded-ctl bg-ios-fill px-4 text-[16px] text-ios-red">{t('proposal.remove')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

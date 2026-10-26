import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import type { CableElement, CableEndLink } from '../types/drawing';
import { buildNetwork } from '../utils/network';
import { poleNamer } from '../utils/poleNames';
import { endLinkHint, endLinkLabel } from '../utils/vdLabels';
import { useLocale, useT } from '../store/localeStore';
import { directionOf } from '../i18n';
import { useBackdropClose } from './SpanPropertiesSheet';

// How the cable ends at one pole connect (Stage 7.9): auto (the drawing's rule),
// connected (confirmed) or isolated (not connected there). Each change is one
// undo step and is saved with the cable.

type Choice = 'auto' | CableEndLink;

export const cableEndsAt = (elements: { type: string }[], poleId: string) => {
  const out: { cable: CableElement; end: 'start' | 'end'; toward: string | undefined }[] = [];
  const through: CableElement[] = [];
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    const n = c.poleIds.length;
    if (n === 0) continue;
    let isEnd = false;
    if (c.poleIds[0] === poleId) { out.push({ cable: c, end: 'start', toward: c.poleIds[1] }); isEnd = true; }
    if (n > 1 && c.poleIds[n - 1] === poleId) { out.push({ cable: c, end: 'end', toward: c.poleIds[n - 2] }); isEnd = true; }
    if (!isEnd && c.poleIds.includes(poleId)) through.push(c);
  }
  return { ends: out, through };
};

export const CableEndsDialog: React.FC<{ poleId: string; onClose: () => void }> = ({ poleId, onClose }) => {
  const { elements, updateElement, saveHistory } = useDrawingStore();
  const t = useT();
  const locale = useLocale((st) => st.locale);
  const name = useMemo(() => poleNamer(elements, t), [elements, t]);
  const { ends, through } = useMemo(() => cableEndsAt(elements, poleId), [elements, poleId]);
  const inferred = useMemo(() => buildNetwork(elements).inferredJunctions.filter((j) => j.poleId === poleId), [elements, poleId]);
  const backdropClose = useBackdropClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { if (!elements.some((e) => e.id === poleId)) onClose(); }, [elements, poleId, onClose]);

  const setLink = (cable: CableElement, end: 'start' | 'end', choice: Choice) => {
    const links = { ...(cable.endLinks ?? {}) };
    if (choice === 'auto') delete links[end]; else links[end] = choice;
    saveHistory();
    updateElement(cable.id, { endLinks: links.start || links.end ? links : undefined });
    saveHistory();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 sm:items-center" {...backdropClose}>
      <div dir={directionOf(locale)} role="dialog" aria-label={t('ends.dialog')} data-cable-ends={poleId} className="w-full max-w-lg max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] overflow-y-auto rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-ios-separator bg-white px-4 py-3">
          <h2 className="truncate text-[17px] font-semibold text-ios-label">{t('ends.title', { pole: name(poleId) })}</h2>
          <button type="button" aria-label={t('common.close')} data-ends-action="close" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3 text-[14px]">
          <p className="text-[12px] text-ios-secondary">{t('ends.help')}</p>
          {ends.length === 0 && <p className="text-ios-secondary">{t('ends.none')}</p>}
          {ends.map(({ cable, end, toward }) => {
            const current: Choice = cable.endLinks?.[end] ?? 'auto';
            const inf = inferred.find((j) => j.cableId === cable.id && j.end === end);
            return (
              <div key={`${cable.id}:${end}`} className="rounded-ctl border border-ios-separator px-3 py-2" data-cable-end={`${cable.id}:${end}`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: cable.strokeColor }} />
                  <span className="text-ios-label">{t('ends.endToward', { pole: toward ? name(toward) : '—' })}</span>
                </div>
                <div className="ui-segment" role="radiogroup" aria-label={t('ends.stateGroup', { pole: toward ? name(toward) : '' })}>
                  {(['auto', 'connected', 'isolated'] as Choice[]).map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={current === c} className={`ui-segment-item ${current === c ? 'is-active' : ''}`} data-end-link={c} onClick={() => setLink(cable, end, c)}>{endLinkLabel(c, t)}</button>
                  ))}
                </div>
                <p className="mt-1 text-[12px] text-ios-secondary">{endLinkHint(current, t)}{current === 'auto' && inf ? t('ends.inferred', { n: inf.withCableIds.length }) : ''}</p>
              </div>
            );
          })}
          {through.length > 0 && (
            <p className="text-[12px] text-ios-secondary">{t('ends.through', { n: through.length })}</p>
          )}
          <button type="button" className="min-h-[44px] rounded-ctl bg-ios-fill text-[17px] text-ios-blue active:bg-ios-fill-strong" data-ends-action="done" onClick={onClose}>{t('ends.done')}</button>
        </div>
      </div>
    </div>
  );
};

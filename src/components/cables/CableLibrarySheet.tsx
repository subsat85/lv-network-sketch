import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CableTypeRevision } from '../../types/cableType';
import { directionOf } from '../../i18n';
import { useLocale, useT } from '../../store/localeStore';
import { useCableLibrary, type CableLibraryController } from '../../store/cableLibraryStore';
import { NO_FILTER, type LibraryFilter } from '../../utils/cableLibraryView';
import { useBackdropClose } from '../SpanPropertiesSheet';
import { CableTypeDetailsView, LibraryListView, RevisionCompareView, RevisionHistoryView, type ViewCtx } from './CableTypeViews';
import { CableTypeEditor } from './CableTypeEditor';

// Stage C2: the cable library sheet — browse, search, filter, open a cable type, read its revision
// history and compare two revisions. Reading only: nothing here creates, edits, verifies or deletes
// a cable type, and nothing touches a project or a span. The list comes from the library store
// (loaded once, kept while reloading); search and filters run on that list (no new read per key).

export type LibraryRoute =
  | { view: 'list' }
  | { view: 'details'; id: string; revision?: number }
  | { view: 'history'; id: string }
  | { view: 'compare'; id: string; from: number; to: number }
  // Stage C3: a new cable type, or an edit of the revision that was shown (its expected revision)
  | { view: 'create' }
  | { view: 'edit'; id: string; from: CableTypeRevision };

type History = { id: string; revisions?: CableTypeRevision[]; failed?: boolean };

export const CableLibrarySheet: React.FC<{ onClose: () => void; controller?: CableLibraryController }> = ({ onClose, controller }) => {
  const tr = useT();
  const locale = useLocale((s) => s.locale);
  const ctx: ViewCtx = useMemo(() => ({ tr, locale }), [tr, locale]);
  const lib = useCableLibrary({ ...(controller ? { controller } : {}) });
  const [route, setRoute] = useState<LibraryRoute>({ view: 'list' });
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [history, setHistory] = useState<History | undefined>();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const backdropClose = useBackdropClose(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // the history of the type shown, read from the library when needed (dropped if the sheet is gone)
  const needHistory = route.view === 'history' || route.view === 'compare' || (route.view === 'details' && route.revision !== undefined) ? route.id : undefined;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needHistory) return;
    let alive = true;
    setHistory({ id: needHistory });
    lib.controller.history(needHistory)
      .then((h) => { if (alive) setHistory({ id: needHistory, revisions: h.revisions }); })
      .catch(() => { if (alive) setHistory({ id: needHistory, failed: true }); });
    return () => { alive = false; };
  }, [needHistory, attempt, lib.controller]);
  const retryHistory = useCallback(() => setAttempt((n) => n + 1), []);

  const current = (id: string) => lib.types.find((t) => t.id === id);
  // the app's default cable (a stored record — shown here even when it is not usable, so it can be changed)
  const def = lib.defaultCable.kind === 'ok' || lib.defaultCable.kind === 'newer' || lib.defaultCable.kind === 'missing' ? lib.defaultCable.cable : undefined;
  const card = def ? { defaultOf: { typeId: def.typeId, revision: def.revision } } : undefined;
  const [defaultFailed, setDefaultFailed] = useState(false);
  const setDefault = (id: string, revision: number) => { setDefaultFailed(false); lib.controller.setDefault(id, revision).catch(() => setDefaultFailed(true)); };
  const revisions = history && 'id' in route && history.id === route.id ? history.revisions : undefined;

  let body: React.ReactNode;
  if (route.view === 'create' || route.view === 'edit') {
    const editing = route.view === 'edit' ? route : undefined;
    body = (
      <CableTypeEditor key={editing ? `${editing.id}@${editing.from.revision}` : 'new'} {...(editing ? { prev: editing.from } : {})} controller={lib.controller} ctx={ctx} onClose={onClose}
        onCancel={() => setRoute(editing ? { view: 'details', id: editing.id } : { view: 'list' })}
        // saved: the list was read again by the library store; show the type's current revision
        onSaved={(id) => setRoute({ view: 'details', id })}
        onReloadLatest={(id) => { void lib.controller.reload().then(() => setRoute({ view: 'details', id })); }} />
    );
  } else if (route.view === 'list') {
    body = <LibraryListView state={lib} filter={filter} onFilter={setFilter} onOpen={(id) => setRoute({ view: 'details', id })} onRetry={() => void lib.controller.reload()} onClose={onClose} onAdd={() => setRoute({ view: 'create' })} ctx={ctx} {...(card ? { card } : {})} />;
  } else if (route.view === 'details' && route.revision === undefined && !current(route.id)) {
    // the type is no longer in the list (it can only be read again from the list)
    body = <LibraryListView state={lib} filter={filter} onFilter={setFilter} onOpen={(id) => setRoute({ view: 'details', id })} onRetry={() => void lib.controller.reload()} onClose={onClose} onAdd={() => setRoute({ view: 'create' })} ctx={ctx} {...(card ? { card } : {})} />;
  } else if (route.view === 'details') {
    const now = current(route.id);
    const shown = route.revision === undefined ? now : revisions?.find((r) => r.revision === route.revision);
    const latest = now?.revision ?? revisions?.[revisions.length - 1]?.revision ?? shown?.revision ?? 1;
    body = shown
      ? <CableTypeDetailsView t={shown} current={latest} ctx={ctx} onClose={onClose}
          onBack={() => setRoute(route.revision === undefined ? { view: 'list' } : { view: 'history', id: route.id })}
          onHistory={() => setRoute({ view: 'history', id: route.id })}
          {...(route.revision === undefined || route.revision === latest ? { onEdit: () => setRoute({ view: 'edit', id: route.id, from: shown }) } : {})}
          {...(def?.typeId === shown.id ? { defaultRevision: def.revision } : {})}
          onSetDefault={() => setDefault(shown.id, shown.revision)} />
      : <RevisionHistoryView name="" revisions={undefined} failed={history?.failed} ctx={ctx} onOpenRevision={() => undefined} onCompare={() => undefined} onRetry={retryHistory} onBack={() => setRoute({ view: 'list' })} onClose={onClose} />;
  } else if (route.view === 'history') {
    body = (
      <RevisionHistoryView name={current(route.id)?.name ?? revisions?.[revisions.length - 1]?.name ?? ''} revisions={revisions} failed={history?.failed} ctx={ctx}
        onOpenRevision={(n) => setRoute({ view: 'details', id: route.id, revision: n })}
        onCompare={() => { const r = revisions!; setRoute({ view: 'compare', id: route.id, from: r[r.length - 2].revision, to: r[r.length - 1].revision }); }}
        onRetry={retryHistory} onBack={() => setRoute({ view: 'details', id: route.id })} onClose={onClose} />
    );
  } else {
    body = revisions
      ? <RevisionCompareView revisions={revisions} from={route.from} to={route.to} showUnchanged={showUnchanged} ctx={ctx}
          onChange={(from, to) => setRoute({ ...route, from, to })} onShowUnchanged={setShowUnchanged}
          onBack={() => setRoute({ view: 'history', id: route.id })} onClose={onClose} />
      : <RevisionHistoryView name="" revisions={undefined} failed={history?.failed} ctx={ctx} onOpenRevision={() => undefined} onCompare={() => undefined} onRetry={retryHistory} onBack={() => setRoute({ view: 'history', id: route.id })} onClose={onClose} />;
  }

  return (
    // z-[60]: like the other dialogs opened from the toolbar (VoltageDropPanel, LoadReportModal)
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" {...backdropClose}>
      <div dir={directionOf(locale)} role="dialog" aria-label={tr('cableLibrary.title')} data-cable-library className="flex w-full max-w-2xl max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex-col overflow-y-auto rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
        {body}
        {defaultFailed && <p className="mx-3 mb-3 rounded-ctl bg-red-50 px-3 py-2 text-[13px] text-ios-red" role="alert" data-cl-default-failed>{tr('defaultCable.setFailed')}</p>}
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { X, ChevronDown, FileDown, MapPin, ArrowLeftRight } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { useAnalysisFocus } from '../store/analysisFocusStore';
import { useLocale, useT } from '../store/localeStore';
import { directionOf, type Locale } from '../i18n';
import { useVoltageView } from '../utils/useE2Study';
import { cardItems, filterAnalysis, networkAnalysis, type AnalysisCard, type NetworkAnalysis } from '../utils/networkAnalysis';
import { buildReportPdf, type ReportContext, type ReportText } from '../utils/networkReport';
import { reasonLabel } from '../utils/e2Presentation';
import type { Tr } from '../utils/vdLabels';
import { pdfFilename } from '../utils/pdfFilename';

// «Network analysis» (تحليل الشبكة): the E2 results per cable, in their own space (not on the
// drawing). Read only: nothing of the project or of the calculation is changed here. A pole or a load
// shows its place on the drawing (analysisFocusStore); «Back to the analysis» comes back here.

/** the report's texts, in the language of the interface */
export const reportText = (t: Tr, a: NetworkAnalysis): ReportText => ({
  title: t('analysis.reportTitle'), subtitle: t('analysis.reportSubtitle'), project: t('analysis.project'), projectUnnamed: t('analysis.projectUnnamed'),
  exported: t('analysis.exported'), page: (i, n) => t('analysis.page', { i, n }),
  summary: t('analysis.summary'), cables: t('analysis.cables'), cablesOverLoad: t('analysis.cablesOverLoad'), cablesOverDrop: t('analysis.cablesOverDrop'),
  maxDrop: t('analysis.maxDrop'), atPole: t('analysis.atPole'), method: t('analysis.method'), methodName: t(`vd.methodName.${a.method}`),
  cablesList: t('analysis.cablesList'), cable: t('analysis.cable'), type: t('analysis.type'), load: t('analysis.load'), limit: t('analysis.limit'),
  loadStatus: t('analysis.loadStatus'), worstDrop: t('analysis.worstDrop'), continued: t('analysis.continued'),
  unitsTitle: t('analysis.unitsTitle'),
  units: [t('analysis.unitLoad'), t('analysis.unitLimit'), t('analysis.unitDrop', { vph: a.phaseVoltage }),
    t('analysis.unitLimits', { limit: a.limitPercent, near: +(a.limitPercent * a.nearLimitFraction).toFixed(2), vll: a.lineVoltage }), t('analysis.unitNa')],
  source: t('analysis.source'), section: t('analysis.section'), noLibrary: t('analysis.noLibrary'),
  perCable: (x, n) => t('analysis.perCable', { a: x, n }), severalFeeders: t('analysis.severalFeeders'),
  limitNotStated: t('analysis.limitNotStated'), limitVaries: t('analysis.limitVaries'), spansNoLimit: (n) => t('analysis.spansNoLimit', { n }),
  mainRun: (p) => t('analysis.mainRun', { p }), branchHead: (p) => t('analysis.branchHead', { p }), spansTitle: t('analysis.spansTitle'), span: t('analysis.span'), spanCurrent: t('analysis.spanCurrent'),
  status: { ok: t('analysis.status.ok'), over: t('analysis.status.over'), 'no-limit': t('analysis.status.no-limit'), na: t('analysis.status.na') },
  overSpans: t('analysis.overSpans'), overSpan: (from, to, i, lim) => t('analysis.overSpan', { from, to, i, lim }),
  pole: t('analysis.pole'), drop: t('analysis.drop'), state: t('analysis.state'),
  poleStatus: { ok: t('analysis.poleStatus.ok'), near: t('analysis.poleStatus.near'), over: t('analysis.poleStatus.over'), na: t('analysis.poleStatus.na') },
  branchFrom: (p) => t('analysis.branchFrom', { p }), notComputed: (r) => t('analysis.notComputed', { reason: r }),
  reason: (r) => (r ? reasonLabel(r as never, t) : ''), noPoles: t('analysis.noPoles'), provisional: t('analysis.provisional'), empty: t('analysis.empty'),
});

/** the date of an export, local time, «2026-11-07 12:50» (digits only: it reads the same in both languages) */
export const exportDate = (_locale: Locale, d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const reportContext = (a: NetworkAnalysis, projectName: string | undefined, locale: Locale, t: Tr): ReportContext =>
  ({ analysis: a, projectName, dateText: exportDate(locale), locale, text: reportText(t, a) });


const tone = { over: 'text-[#b91c1c] border-[#b91c1c]', near: 'text-[#b45309] border-[#b45309]', ok: 'text-[#15803d] border-[#15803d]', na: 'text-ios-secondary border-ios-separator' } as const;
const Chip: React.FC<{ kind: keyof typeof tone; children: React.ReactNode }> = ({ kind, children }) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-[1px] text-[12px] font-semibold ${tone[kind]}`}>{children}</span>
);
/** a sentence with its values (\u0001…\u0004) kept left to right: «المقطع 12 ← 13: 140.0 A / 120 A» */
const ltrParts = (text: string, values: string[]) =>
  text.split(/([\u0001-\u0004])/).map((part, i) => {
    const k = part.length === 1 ? part.charCodeAt(0) - 1 : -1;
    return k >= 0 && k < values.length ? <bdi key={i} dir="ltr">{values[k]}</bdi> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
const n1 = (v: number | undefined, d = 1) => (v === undefined ? '—' : v.toFixed(d));

export const CardView: React.FC<{ card: AnalysisCard; index: number; open: boolean; onToggle: () => void; t: Tr }> = ({ card: c, index, open, onToggle, t }) => {
  const show = useAnalysisFocus((s) => s.show);
  const spanKeys = (keys?: string[]) => keys ?? c.rows.map((r) => r.feedKey).filter((k): k is string => !!k);
  const loadKind = c.loadStatus === 'over' ? 'over' : c.loadStatus === 'ok' ? 'ok' : 'na';
  const overRows = c.rows.filter((r) => r.status === 'over').length;
  return (
    <section data-analysis-card={c.id} className="overflow-hidden rounded-ctl border border-ios-separator bg-white" style={{ borderInlineStartWidth: 6, borderInlineStartColor: c.color }}>
      <button type="button" onClick={onToggle} aria-expanded={open} data-analysis-toggle={c.id} className="flex w-full items-center gap-2 px-3 py-2.5 text-start">
        <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] border border-black/15" style={{ background: c.color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ios-label">{t('analysis.cable')} {index + 1} — {c.types.length ? c.types.map((x) => x.size ?? x.name).join('، ') : t('analysis.noLibrary')}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ios-secondary">
            <span>{t('analysis.load')}: <bdi dir="ltr" className="font-semibold text-ios-label">{c.loadA !== undefined ? `${n1(c.loadA)} A` : '—'}</bdi></span>
            <span>{t('analysis.maxDrop')}: <bdi dir="ltr" className={`font-semibold ${c.rows.some((r) => r.status === 'over') ? 'text-[#b91c1c]' : 'text-ios-label'}`}>{c.maxPercent !== undefined ? `${c.maxPercent.toFixed(2)} %` : '—'}</bdi>{c.worstTag ? <> ({<bdi dir="ltr">{c.worstTag}</bdi>})</> : null}</span>
          </span>
        </span>
        <Chip kind={loadKind}>{t(`analysis.status.${c.loadStatus}`)}</Chip>
        <ChevronDown size={18} className={`shrink-0 text-ios-tertiary transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-ios-separator px-3 pb-3 pt-2" data-analysis-details={c.id}>
          <button type="button" data-analysis-load={c.id} onClick={() => show({ spanKeys: spanKeys(), color: c.color })}
            className="mb-2 w-full rounded-ctl bg-ios-fill/60 px-3 py-2 text-start active:bg-ios-fill">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-ios-secondary">{t('analysis.type')}</dt><dd className="min-w-0 break-words text-ios-label">{c.types.length ? c.types.map((x) => x.name).join('، ') : t('analysis.noLibrary')}</dd>
              <dt className="text-ios-secondary">{t('analysis.section')}</dt><dd className="text-ios-label">{c.types.map((x) => x.size).filter(Boolean).join('، ') || '—'}</dd>
              <dt className="text-ios-secondary">{t('analysis.load')}</dt>
              <dd className="text-ios-label" data-analysis-load-value>{c.loadA !== undefined ? <bdi dir="ltr" className="font-semibold">{n1(c.loadA)} A</bdi> : c.severalFeeders ? t('analysis.severalFeeders') : '—'}{c.parallel ? <span className="text-ios-secondary"> ({t('analysis.perCable', { a: `${n1(c.loadPerCableA)} A`, n: c.parallel })})</span> : null}</dd>
              <dt className="text-ios-secondary">{t('analysis.limit')}</dt>
              <dd className="text-ios-label" data-analysis-limit>{c.limitA !== undefined ? <bdi dir="ltr">{c.limitA} A</bdi> : <span className="text-ios-secondary">{c.limitVaries ? t('analysis.limitVaries') : t('analysis.limitNotStated')}</span>}{c.limitVaries && c.spansWithoutLimit > 0 ? <span className="text-ios-secondary"> · {t('analysis.spansNoLimit', { n: c.spansWithoutLimit })}</span> : null}</dd>
              <dt className="text-ios-secondary">{t('analysis.loadStatus')}</dt><dd><Chip kind={loadKind}>{t(`analysis.status.${c.loadStatus}`)}</Chip></dd>
            </dl>
            <span className="mt-1.5 flex items-center gap-1 text-[12px] text-ios-blue"><MapPin size={13} aria-hidden />{t('analysis.showCable')}</span>
          </button>
          {c.over.length > 0 && (
            <ul className="mb-2 rounded-ctl border border-[#b91c1c]/40 px-3 py-1.5 text-[12.5px] text-[#b91c1c]" data-analysis-over>
              <li className="font-semibold">{t('analysis.overSpans')}</li>
              {c.over.map((o) => (
                <li key={o.key}><button type="button" className="text-start underline-offset-2 active:underline" onClick={() => show({ spanKeys: [o.key], color: c.color })}>⚠ {ltrParts(t('analysis.overSpan', { from: '\u0001', to: '\u0002', i: '\u0003', lim: '\u0004' }), [o.fromTag, o.toTag, `${n1(o.currentA)} A`, `${o.limitA} A`])}</button></li>
              ))}
            </ul>
          )}
          {c.limitVaries && c.spans.length > 0 && (
            <div className="mb-2 rounded-ctl border border-ios-separator px-2.5 py-1.5 text-[12.5px]" data-analysis-spans={c.id}>
              <div className="mb-1 font-semibold text-ios-secondary">{t('analysis.spansTitle')}</div>
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-x-2.5 gap-y-1">
                <span className="text-[11.5px] text-ios-tertiary">{t('analysis.span')}</span><span className="text-[11.5px] text-ios-tertiary">{t('analysis.type')}</span>
                <span className="text-end text-[11.5px] text-ios-tertiary">{t('analysis.spanCurrent')}</span><span className="text-end text-[11.5px] text-ios-tertiary">{t('analysis.limit')}</span><span />
                {c.spans.map((sp) => (
                  <React.Fragment key={sp.key}>
                    <button type="button" data-analysis-span={sp.key} data-analysis-span-status={sp.status} onClick={() => show({ spanKeys: [sp.key], color: c.color })} className="text-start font-semibold text-ios-blue"><bdi dir="ltr">{sp.fromTag}–{sp.toTag}</bdi></button>
                    <span className="min-w-0 truncate text-ios-label">{sp.size ?? sp.type ?? t('analysis.noLibrary')}</span>
                    <span className={`text-end ${sp.status === 'over' ? 'font-semibold text-[#b91c1c]' : 'text-ios-label'}`}><bdi dir="ltr">{sp.currentA !== undefined ? `${sp.provisional ? '≈' : ''}${n1(sp.currentA)} A` : '—'}</bdi></span>
                    <span className="text-end text-ios-label"><bdi dir="ltr">{sp.limitA !== undefined ? `${sp.limitA} A` : '—'}</bdi></span>
                    <Chip kind={sp.status === 'over' ? 'over' : sp.status === 'ok' ? 'ok' : 'na'}>{t(`analysis.status.${sp.status}`)}</Chip>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
          {c.status !== 'ok' && c.reason && <p className="mb-2 text-[12.5px] text-ios-secondary">{t('analysis.notComputed', { reason: reasonLabel(c.reason, t) })}</p>}
          {c.rows.length === 0 ? <p className="text-[12.5px] text-ios-secondary">{overRows ? '' : t('analysis.noPoles')}</p> : (
            <div role="table" aria-label={t('analysis.drop')} className="text-[13px]">
              <div role="row" className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-ios-separator pb-1 text-[12px] font-semibold text-ios-secondary">
                <span role="columnheader">{t('analysis.pole')}</span><span role="columnheader" className="w-[84px] text-end">{t('analysis.drop')}</span><span role="columnheader" className="w-[96px] text-end">{t('analysis.state')}</span>
              </div>
              {cardItems(c).map((it) => it.kind === 'run' ? (
                <div role="row" key={`run-${it.run}`} data-analysis-run={it.run} data-analysis-branch-from={it.branchFrom ?? ''}
                  className="mt-1.5 flex items-center gap-1.5 border-b border-ios-separator/60 pb-1 pt-1 text-[12px] font-semibold text-ios-secondary" style={{ paddingInlineStart: Math.max(0, it.depth - 1) * 14 }}>
                  <span role="cell">{it.branchFrom ? <>↳ {t('analysis.branchHead', { p: it.branchFrom })}</> : t('analysis.mainRun', { p: c.sourceTag ?? '' })}</span>
                </div>
              ) : ((r) => (
                <button type="button" role="row" key={`${r.bus}`} data-analysis-row={r.poleId} data-analysis-status={r.status}
                  aria-label={t('analysis.showPole', { p: r.tag })}
                  onClick={() => show({ poleId: r.poleId, ...(r.feedKey ? { spanKeys: [r.feedKey] } : {}), color: c.color })}
                  className={`grid min-h-[38px] w-full grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-ios-separator/60 text-start active:bg-ios-fill ${r.status === 'over' ? 'bg-[#fef2f2]' : ''}`}>
                  <span role="cell" className="flex min-w-0 items-center gap-1" style={{ paddingInlineStart: r.depth * 14 }}>
                    {r.depth > 0 && <span className="text-ios-tertiary" aria-hidden>·</span>}
                    <bdi dir="ltr" className="font-semibold text-ios-blue">{r.tag}</bdi>
                  </span>
                  <span role="cell" className={`w-[84px] text-end ${r.status === 'over' ? 'font-semibold text-[#b91c1c]' : 'text-ios-label'}`}><bdi dir="ltr">{r.percent !== undefined ? `${r.percent.toFixed(2)} %` : '—'}</bdi>{r.provisional ? ' ⚑' : ''}</span>
                  <span role="cell" className="w-[96px] text-end"><Chip kind={r.status}>{t(`analysis.poleStatus.${r.status}`)}</Chip></span>
                </button>
              ))(it.row))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export const NetworkAnalysisPanel: React.FC = () => {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const { open, setOpen, hideOk, setHideOk, openCard, setOpenCard } = useAnalysisFocus();
  const elements = useDrawingStore((s) => s.elements);
  const projectName = useDrawingStore((s) => s.currentProjectName);
  // the same E2 calculation the drawing shows (computed while the panel is open)
  const view = useVoltageView(open);
  const analysis = useMemo(() => (view ? networkAnalysis(elements, view) : null), [elements, view]);
  const shown = useMemo(() => (analysis ? filterAnalysis(analysis, hideOk) : null), [analysis, hideOk]);
  const [exporting, setExporting] = useState(false);
  if (!open) return null;
  const close = () => setOpen(false);
  const exportReport = async () => {
    if (!analysis || exporting) return;
    setExporting(true);
    try {
      const pdf = await buildReportPdf(reportContext(analysis, projectName ?? undefined, locale, t));
      pdf.save(pdfFilename(projectName, 'report', t));
    } catch (e) {
      alert(t('dialogs.exportFailed', { error: e instanceof Error ? e.message : t('dialogs.unknownError') }));
    } finally { setExporting(false); }
  };
  const index = new Map(analysis?.cards.map((c, i) => [c.id, i]) ?? []);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={close}>
      <div dir={directionOf(locale)} role="dialog" aria-label={t('analysis.title')} data-analysis-panel className="flex w-full max-w-2xl max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex-col overflow-hidden rounded-t-[16px] sm:rounded-[16px] bg-ios-grouped shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-ios-separator bg-white px-4 py-3">
          <h2 className="text-[17px] font-semibold text-ios-label">{t('analysis.title')}</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={exportReport} disabled={!analysis?.cards.length || exporting} data-analysis-action="export"
              className="inline-flex h-9 items-center gap-1 rounded-ctl px-2.5 text-[14px] font-semibold text-ios-blue disabled:opacity-40">
              <FileDown size={18} aria-hidden />{exporting ? t('analysis.exporting') : t('analysis.exportReport')}
            </button>
            <button type="button" aria-label={t('common.close')} data-analysis-action="close" onClick={close} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
          </div>
        </div>
        <div className="border-b border-ios-separator bg-white px-4 py-2.5">
          <label className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium text-ios-label">{t('analysis.hideOk')}</span>
              <span className="block text-[12px] text-ios-tertiary">{t('analysis.hideOkHelp')}</span>
            </span>
            <button type="button" role="switch" aria-checked={hideOk} aria-label={t('analysis.hideOk')} data-analysis-action="hide-ok" className="ui-switch shrink-0" onClick={() => setHideOk(!hideOk)}><span className="ui-switch-knob" /></button>
          </label>
          {analysis && analysis.cards.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ios-secondary" data-analysis-summary>
              <span>{t('analysis.cables')}: <b className="text-ios-label">{analysis.cards.length}</b></span>
              <span>{t('analysis.cablesOverLoad')}: <b className={analysis.overLoad ? 'text-[#b91c1c]' : 'text-ios-label'}>{analysis.overLoad}</b></span>
              <span>{t('analysis.cablesOverDrop')}: <b className={analysis.overDrop ? 'text-[#b91c1c]' : 'text-ios-label'}>{analysis.overDrop}</b></span>
            </div>
          )}
        </div>
        <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          {!analysis || !analysis.cards.length ? <p className="py-6 text-center text-[14px] text-ios-secondary">{t('analysis.empty')}</p> : (
            <>
              {shown!.cards.length === 0 && <p className="py-4 text-center text-[14px] text-ios-secondary" data-analysis-all-ok>{t('analysis.allHidden')}</p>}
              {shown!.cards.map((c) => (
                <CardView key={c.id} card={c} index={index.get(c.id) ?? 0} open={openCard === c.id} onToggle={() => setOpenCard(openCard === c.id ? undefined : c.id)} t={t} />
              ))}
              {shown!.hidden > 0 && <p className="text-center text-[12.5px] text-ios-tertiary" data-analysis-hidden>{t('analysis.hiddenCards', { n: shown!.hidden })}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** the way back to the analysis after showing something on the drawing */
export const AnalysisReturnButton: React.FC = () => {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const { canReturn, back, dismissReturn, open } = useAnalysisFocus();
  if (!canReturn || open) return null;
  return (
    <div dir={directionOf(locale)} className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom))] z-[55] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ios-label/90 py-1 pe-1 ps-3 text-white shadow-float">
        <button type="button" onClick={back} data-analysis-action="back" className="inline-flex h-9 items-center gap-1.5 text-[14px] font-semibold"><ArrowLeftRight size={16} aria-hidden />{t('analysis.back')}</button>
        <button type="button" onClick={dismissReturn} aria-label={t('analysis.dismiss')} data-analysis-action="dismiss-back" className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"><X size={16} /></button>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import type { CableElement, ElectricalSettings, SymbolElement } from '../types/drawing';
import { useVoltageDrop } from '../utils/useVoltageDrop';
import type { CircuitResult, VoltageDropResult } from '../utils/voltageDrop';
import { AR_TR, circuitStatusLabel, fmt, issueText, loadModelLabel, missingLabel, POLE_STATUS_MARK, poleStatusLabel, provisionalLabel, reviewLabel, settingMissingLabel, type Tr } from '../utils/vdLabels';
import { useLocale, useT } from '../store/localeStore';
import { directionOf } from '../i18n';
import type { PoleResult } from '../utils/voltageDrop';

/** status text of a pole result; a provisional value is never shown as a plain "within the limit" */
export const poleStatusText = (p: PoleResult, tr: Tr = AR_TR) => {
  if (p.status === 'na') return `${tr('vd.naMark')} ${poleStatusLabel('na', tr)}${p.reason ? tr(`vd.naReason.${p.reason}`) : ''}`;
  if (p.provisional.length) return tr('vd.provisionalValue', { mark: '⚑', status: tr('vd.provisionalStatus'), value: poleStatusLabel(p.status, tr), reasons: p.provisional.map((r) => provisionalLabel(r, tr)).join(tr('common.reasonSep')) });
  return `${POLE_STATUS_MARK[p.status]} ${poleStatusLabel(p.status, tr)}`;
};
import { poleNamer } from '../utils/poleNames';
import { spanAt } from '../utils/spanModel';
import { SpanPropertiesSheet, spanSummary } from './SpanPropertiesSheet';
import { CableEndsDialog } from './CableEndsDialog';
import { DEFAULT_POWER_FACTOR, isPowerFactorDefault } from '../utils/electricalSettings';
import { planMissingDefaults } from '../utils/spanDefaults';
import { ALPHA_SOURCE, CONDUCTOR_TABLE_SOURCE } from '../data/conductors';
import { ProposedConsumerSheet } from './ProposedConsumerSheet';
import { E2ResultsPanel } from './E2ResultsPanel';
import { proposalLoadText, proposedConsumers } from '../utils/proposedConsumers';
import { allStudySplitPoints, endSplitPoints, setSplitConsumerSide, type SplitSide } from '../utils/splitStudy';

// Voltage-drop settings, results and report (Stages 7.6 / 7.7).

type SettingsForm = Record<'pf' | 'temp' | 'limit' | 'near' | 'minPh' | 'minLL' | 'vph' | 'vll', string> & { mode: ElectricalSettings['singlePhaseMode']; loadModel: NonNullable<ElectricalSettings['loadModel']> };
const toForm = (s: ElectricalSettings): SettingsForm => ({
  pf: s.powerFactor?.toString() ?? '', temp: s.conductorTempC?.toString() ?? '', limit: String(s.limitPercent),
  near: String(Math.round(s.nearLimitFraction * 100)), minPh: String(s.minPhaseVoltage), minLL: String(s.minLineVoltage),
  vph: String(s.phaseVoltage), vll: String(s.lineVoltage), mode: s.singlePhaseMode, loadModel: s.loadModel ?? 'constant-current',
});
const n = (s: string) => (s.trim() === '' ? undefined : Number(s.trim().replace(',', '.')));

const fromForm = (f: SettingsForm, tr: Tr): { changes: Partial<ElectricalSettings>; errors: string[] } => {
  const errors: string[] = [];
  const req = (label: string, s: string, ok: (v: number) => boolean) => { const v = n(s); if (v === undefined || !Number.isFinite(v) || !ok(v)) { errors.push(label); return undefined; } return v; };
  const opt = (label: string, s: string, ok: (v: number) => boolean) => { const v = n(s); if (v === undefined) return undefined; if (!Number.isFinite(v) || !ok(v)) { errors.push(label); return undefined; } return v; };
  const changes: Partial<ElectricalSettings> = {
    powerFactor: opt(tr('vd.field.pf'), f.pf, (v) => v > 0 && v <= 1),
    conductorTempC: opt(tr('vd.field.temp'), f.temp, (v) => v >= -40 && v <= 250),
    limitPercent: req(tr('vd.field.limit'), f.limit, (v) => v > 0 && v < 100),
    nearLimitFraction: (req(tr('vd.field.near'), f.near, (v) => v > 0 && v <= 100) ?? 80) / 100,
    minPhaseVoltage: req(tr('vd.field.minPh'), f.minPh, (v) => v > 0),
    minLineVoltage: req(tr('vd.field.minLL'), f.minLL, (v) => v > 0),
    phaseVoltage: req(tr('vd.field.vph'), f.vph, (v) => v > 0),
    lineVoltage: req(tr('vd.field.vll'), f.vll, (v) => v > 0),
    singlePhaseMode: f.mode,
    loadModel: f.loadModel,
  };
  return { changes, errors };
};

const NumField: React.FC<{ field: string; label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }> = ({ field, label, value, onChange, hint, placeholder }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[13px] font-medium text-ios-secondary">{label}{hint && <span className="font-normal text-ios-tertiary"> — {hint}</span>}</span>
    <input className="ui-field h-10" type="text" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label} data-vd-field={field} />
  </label>
);

/** Plain-text report (for copying into a message / document), in the language of `tr` (Arabic by default). */
export const voltageDropReportText = (r: VoltageDropResult, name: (id: string) => string, cables: Map<string, CableElement>, powerFactorDefault = false, tr: Tr = AR_TR): string => {
  const s = r.settings;
  const lines: string[] = [];
  const model = s.loadModel ?? 'constant-current';
  lines.push(tr('vd.report.title'));
  lines.push(tr('vd.report.nominal', { vph: s.phaseVoltage, vll: s.lineVoltage, limit: s.limitPercent, minPh: s.minPhaseVoltage, minLL: s.minLineVoltage }));
  lines.push(tr('vd.report.pfLine', { pf: s.powerFactor ?? tr('vd.report.pfNotEntered'), pfDefault: powerFactorDefault ? tr('vd.report.pfDefault') : '', temp: s.conductorTempC ?? tr('vd.report.tempNotEntered'), mode: s.singlePhaseMode === 'worst' ? tr('vd.report.modeWorst') : tr('vd.report.modeBalanced') }));
  lines.push(tr('vd.report.loadModel', { model: loadModelLabel(model, tr), note: model === 'constant-power' ? tr('vd.report.constantPowerNote') : '' }));
  if (s.studyProposedConsumers) lines.push(tr('vd.report.studyProposed'));
  if (s.studySuggestedSplits) lines.push(tr('vd.report.studySplits'));
  for (const m of r.settingsMissing) lines.push(tr('vd.report.missing', { item: settingMissingLabel(m, tr) }));
  r.circuits.forEach((c, i) => {
    lines.push('');
    if (c.converged === false) lines.push(tr('vd.report.notConverged', { n: i + 1, iterations: c.iterations ?? '' }));
    lines.push(tr('vd.report.circuit', { n: i + 1, status: circuitStatusLabel(c.status, tr), source: c.circuit.sourcePoleId ? tr('vd.report.source', { pole: name(c.circuit.sourcePoleId), kind: c.circuit.sourceKind === 'manual' ? tr('vd.report.sourceManual') : tr('vd.report.sourceTransformer') }) : '' }));
    if (c.maxPercent !== undefined) lines.push(tr('vd.report.worst', { mark: c.worstProvisional ? '≈' : '', percent: c.maxPercent.toFixed(2), pole: name(c.worstPoleId!), provisional: c.worstProvisional ? tr('vd.report.worstProvisional') : '' }));
    for (const p of c.poles) {
      lines.push(p.status === 'na'
        ? tr('vd.report.poleNa', { pole: name(p.poleId) })
        : tr('vd.report.pole', { pole: name(p.poleId), mark: p.provisional.length ? '≈' : '', drop: fmt(p.dropV), percent: fmt(p.percent), phaseV: fmt(p.phaseV, 1), lineV: p.lineV !== undefined ? ` / ${fmt(p.lineV, 1)} V` : '', status: poleStatusText(p, tr) }));
    }
    for (const sp of c.spans) {
      const cab = cables.get(sp.cableId);
      const props = cab ? spanAt(cab, sp.index).props : undefined;
      lines.push(tr('vd.report.span', { from: name(sp.fromPole), to: name(sp.toPole), length: sp.lengthM ?? '?', summary: spanSummary(props, tr), current: fmt(sp.phaseCurrentA, 1), drop: sp.computable ? `${fmt(sp.dropV)} V` : tr('vd.report.spanNotComputed', { list: sp.missing.map((m) => missingLabel(m, tr)).join(tr('common.reasonSep')) }) }));
    }
    if (c.circuit.inferredJunctions.length) lines.push(tr('vd.report.inferred', { list: [...new Set(c.circuit.inferredJunctions.map((j) => name(j.poleId)))].join(tr('common.listSep')) }));
  });
  if (r.issues.length) {
    lines.push('');
    lines.push(tr('vd.report.warnings'));
    for (const i of r.issues) lines.push(`- ${issueText(i, name, tr)}`);
  }
  lines.push('');
  lines.push(tr('vd.report.resistance', { table: CONDUCTOR_TABLE_SOURCE, alpha: ALPHA_SOURCE }));
  lines.push(tr('vd.report.loads'));
  lines.push(tr('vd.report.thermal'));
  return lines.join('\n');
};

export const VoltageDropPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { elements, electrical, updateElectricalSettings, saveHistory, showVoltageDrop, setShowVoltageDrop, updateSymbolModifiers, updateElements, updateElement } = useDrawingStore();
  const t = useT();
  const locale = useLocale((st) => st.locale);
  const pfDefault = isPowerFactorDefault(electrical);
  // spans with missing properties (old drawings): filled only on request, in one undo step (Stage 7.13)
  const defaultsPlan = useMemo(() => planMissingDefaults(elements), [elements]);
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  const applyDefaults = () => {
    if (!defaultsPlan.updates.length) return;
    saveHistory();
    updateElements(defaultsPlan.updates);
    saveHistory();
    setConfirmDefaults(false);
  };
  const result = useVoltageDrop(true)!;
  const name = useMemo(() => poleNamer(elements, t), [elements, t]);
  const cables = useMemo(() => new Map(elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c])), [elements]);
  const [form, setForm] = useState<SettingsForm>(() => toForm(electrical));
  const [editing, setEditing] = useState<{ cableId: string; index: number } | null>(null);
  const [endsPole, setEndsPole] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // E2 study (preview), read only: a separate panel (decision D-C)
  const [showE2, setShowE2] = useState(false);
  const parsed = fromForm(form, t);
  const dirty = JSON.stringify(toForm(electrical)) !== JSON.stringify(form);
  const setF = (k: keyof SettingsForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const applySettings = () => {
    if (parsed.errors.length) return;
    saveHistory();
    updateElectricalSettings(parsed.changes);
    saveHistory();
  };
  const setSource = (poleId: string, on: boolean) => { saveHistory(); updateSymbolModifiers(poleId, { vdSource: on }); saveHistory(); };
  // voltage-drop study with the suggested split points: each change is one undo step
  const study = electrical.studySuggestedSplits === true;
  const splitPoints = useMemo(() => allStudySplitPoints(elements), [elements]);
  const endSplits = useMemo(() => elements.filter((e): e is CableElement => e.type === 'cable').flatMap(endSplitPoints), [elements]);
  const proposals = useMemo(() => proposedConsumers(elements), [elements]);
  const studyProposed = electrical.studyProposedConsumers === true;
  const setStudyProposed = (on: boolean) => { saveHistory(); updateElectricalSettings({ studyProposedConsumers: on }); saveHistory(); };
  const [proposalEdit, setProposalEdit] = useState<{ poleId: string; consumerId: string } | null>(null);
  const setStudy = (on: boolean) => { saveHistory(); updateElectricalSettings({ studySuggestedSplits: on }); saveHistory(); };
  const setSplitSide = (cableId: string, poleId: string, occurrence: number, side: SplitSide) => {
    const c = cables.get(cableId);
    if (!c) return;
    saveHistory(); updateElement(cableId, setSplitConsumerSide(c, poleId, occurrence, side)); saveHistory();
  };
  const copyReport = async () => {
    const text = voltageDropReportText(result, name, cables, pfDefault, t);
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt(t('vd.copyPrompt'), text); }
  };

  const transformersIn = (c: CircuitResult) => [...c.circuit.poleIds].filter((id) => (elements.find((e) => e.id === id) as SymbolElement | undefined)?.symbolId === 'transformer');
  const manualIn = (c: CircuitResult) => [...c.circuit.poleIds].filter((id) => (elements.find((e) => e.id === id) as SymbolElement | undefined)?.modifiers?.vdSource);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div dir={directionOf(locale)} role="dialog" aria-label={t('vd.title')} data-vd-panel className="flex w-full max-w-2xl max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex-col overflow-hidden rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-ios-separator px-4 py-3">
          <h2 className="text-[17px] font-semibold text-ios-label">{t('vd.title')}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ios-secondary">{t('vd.showOnDrawing')}</span>
            <button type="button" role="switch" aria-checked={showVoltageDrop} aria-label={t('vd.showOnDrawingName')} data-vd-action="show-on-drawing" className="ui-switch" onClick={() => setShowVoltageDrop(!showVoltageDrop)}><span className="ui-switch-knob" /></button>
            <button type="button" aria-label={t('common.close')} data-vd-action="close" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] text-[14px]">
          {/* settings */}
          <section aria-label={t('vd.settings.title')} className="mb-4 rounded-ctl border border-ios-separator p-3">
            <h3 className="mb-2 text-[15px] font-semibold text-ios-label">{t('vd.settings.title')}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumField field="pf" label={t('vd.settings.pf')} value={form.pf} onChange={(v) => setF('pf', v)} hint={pfDefault ? t('vd.settings.pfDefaultHint', { pf: DEFAULT_POWER_FACTOR }) : undefined} placeholder={t('vd.settings.pfPlaceholder', { pf: DEFAULT_POWER_FACTOR })} />
              <NumField field="temp" label={t('vd.settings.temp')} value={form.temp} onChange={(v) => setF('temp', v)} hint={t('vd.settings.tempHint')} />
              <NumField field="limit" label={t('vd.settings.limit')} value={form.limit} onChange={(v) => setF('limit', v)} />
              <NumField field="near" label={t('vd.settings.near')} value={form.near} onChange={(v) => setF('near', v)} />
              <NumField field="minPh" label={t('vd.settings.minPh')} value={form.minPh} onChange={(v) => setF('minPh', v)} />
              <NumField field="minLL" label={t('vd.settings.minLL')} value={form.minLL} onChange={(v) => setF('minLL', v)} />
              <NumField field="vph" label={t('vd.settings.vph')} value={form.vph} onChange={(v) => setF('vph', v)} />
              <NumField field="vll" label={t('vd.settings.vll')} value={form.vll} onChange={(v) => setF('vll', v)} />
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ios-secondary">{t('vd.settings.singlePhase')}</span>
              <div className="ui-segment self-start" role="radiogroup" aria-label={t('vd.settings.singlePhaseGroup')}>
                <button type="button" role="radio" aria-checked={form.mode === 'worst'} className={`ui-segment-item ${form.mode === 'worst' ? 'is-active' : ''}`} data-vd-mode="worst" onClick={() => setForm((f) => ({ ...f, mode: 'worst' }))}>{t('vd.settings.worst')}</button>
                <button type="button" role="radio" aria-checked={form.mode === 'balanced'} className={`ui-segment-item ${form.mode === 'balanced' ? 'is-active' : ''}`} data-vd-mode="balanced" onClick={() => setForm((f) => ({ ...f, mode: 'balanced' }))}>{t('vd.settings.balanced')}</button>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ios-secondary">{t('vd.settings.loadModel')}</span>
              <div className="ui-segment self-start" role="radiogroup" aria-label={t('vd.settings.loadModel')}>
                {(['constant-current', 'constant-power'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={form.loadModel === m} className={`ui-segment-item ${form.loadModel === m ? 'is-active' : ''}`} data-vd-load-model-option={m} onClick={() => setForm((f) => ({ ...f, loadModel: m }))}>{loadModelLabel(m, t)}{m === 'constant-current' ? t('vd.settings.loadModelDefault') : ''}</button>
                ))}
              </div>
              <span className="text-[12px] text-ios-tertiary">{t('vd.settings.loadModelHelp')}</span>
            </div>
            {parsed.errors.length > 0 && <p className="mt-2 text-[13px] text-ios-red">{t('vd.settings.invalid', { list: parsed.errors.join(t('common.listSep')) })}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button type="button" disabled={!dirty || parsed.errors.length > 0} onClick={applySettings} data-vd-action="save-settings" className="min-h-[36px] rounded-ctl bg-ios-blue px-4 text-[15px] font-semibold text-white disabled:opacity-40">{t('vd.settings.save')}</button>
              {dirty && <span className="text-[12px] text-ios-secondary">{t('vd.settings.unsaved')}</span>}
            </div>
            <p className="mt-2 text-[12px] text-ios-tertiary">{t('vd.settings.reference', { limit: electrical.limitPercent, minPh: electrical.minPhaseVoltage, minLL: electrical.minLineVoltage })}</p>
          </section>

          <p className="mb-2 text-[13px] text-ios-label" data-vd-load-model={electrical.loadModel ?? 'constant-current'}>{t('vd.usedLoadModel')}<b>{loadModelLabel(electrical.loadModel ?? 'constant-current', t)}</b></p>
          <p className="mb-2 text-[13px] text-ios-label" data-vd-power-factor={pfDefault ? 'default' : 'saved'}>{t('vd.usedPf')}<b>{pfDefault ? DEFAULT_POWER_FACTOR : electrical.powerFactor}</b>{pfDefault && <span className="text-ios-secondary">{t('vd.usedPfDefault')}</span>}</p>

          {/* proposed subscribers: confirmed ones are always calculated; the others only in this study */}
          {proposals.length > 0 && (
            <section aria-label={t('vd.proposed.section')} data-vd-proposed-study={studyProposed ? 'on' : 'off'} className={`mb-3 rounded-ctl border p-3 text-[13px] ${studyProposed ? 'border-ios-red/40 bg-red-50' : 'border-ios-separator'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ios-label">{t('vd.proposed.study')}</span>
                <button type="button" role="switch" aria-checked={studyProposed} aria-label={t('vd.proposed.study')} data-vd-action="study-proposed" className="ui-switch shrink-0" onClick={() => setStudyProposed(!studyProposed)}><span className="ui-switch-knob" /></button>
              </div>
              <p className="mt-1 text-[12px] text-ios-secondary">{studyProposed
                ? t('vd.proposed.on')
                : t('vd.proposed.off')}</p>
              <ul className="mt-2 flex flex-col gap-2">
                {proposals.map((pc) => {
                  const conn = pc.proposal!.connection;
                  const cab = conn ? cables.get(conn.cableId) : undefined;
                  const included = pc.proposal!.status === 'confirmed' || studyProposed;
                  return (
                    <li key={pc.id} data-vd-proposal={pc.id} data-vd-proposal-status={pc.proposal!.status} className="flex flex-wrap items-center gap-2 rounded-ctl bg-white/70 p-2 ring-1 ring-inset ring-black/5">
                      <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: cab?.strokeColor ?? '#999' }} />
                      <b>{name(pc.poleId)}</b>
                      <span>{proposalLoadText(pc)}</span>
                      <span className={pc.proposal!.status === 'confirmed' ? 'font-semibold text-green-700' : 'text-ios-secondary'}>{pc.proposal!.status === 'confirmed' ? t('vd.proposed.confirmed') : t('vd.proposed.proposed')}{included ? t('vd.proposed.included') : t('vd.proposed.excluded')}</span>
                      {!cab && <span className="font-semibold text-amber-900">{t('vd.proposed.noCable')}</span>}
                      <button type="button" className="ui-tinted-btn ms-auto !w-auto !min-h-[30px] !px-3" data-vd-action="edit-proposal" onClick={() => setProposalEdit({ poleId: pc.poleId, consumerId: pc.id })}>{t('vd.proposed.edit')}</button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* study: suggested split points calculated as open points (off = drawing marks only) */}
          <section aria-label={t('vd.split.section')} data-vd-split-study={study ? 'on' : 'off'} className={`mb-3 rounded-ctl border p-3 text-[13px] ${study ? 'border-ios-red/40 bg-red-50' : 'border-ios-separator'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ios-label">{t('vd.split.study')}</span>
              <button type="button" role="switch" aria-checked={study} aria-label={t('vd.split.study')} data-vd-action="study-splits" className="ui-switch shrink-0" onClick={() => setStudy(!study)}><span className="ui-switch-knob" /></button>
            </div>
            <p className="mt-1 text-[12px] text-ios-secondary">{study
              ? t('vd.split.on')
              : t('vd.split.off')}</p>
            {splitPoints.length === 0 && <p className="mt-2 text-ios-tertiary">{t('vd.split.none')}</p>}
            {splitPoints.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">
                {splitPoints.map((p) => {
                  const col = cables.get(p.cableId)?.strokeColor ?? '#000';
                  return (
                    <li key={`${p.cableId}|${p.poleId}#${p.occurrence}`} data-vd-split-point={`${p.cableId}|${p.poleId}#${p.occurrence}`} data-vd-split-side={p.consumerSide ?? 'none'} className="flex flex-col gap-1 rounded-ctl bg-white/70 p-2 ring-1 ring-inset ring-black/5">
                      <span className="flex flex-wrap items-center gap-2 text-ios-label">
                        <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: col }} />
                        <b>{name(p.poleId)}</b>
                        <span className="text-ios-secondary">{t('vd.split.between', { a: name(p.prevPoleId), b: name(p.nextPoleId) })}</span>
                        {!p.consumerSide && <span className="font-semibold text-amber-900">{t('vd.split.chooseSide')}</span>}
                      </span>
                      <span className="text-[12px] text-ios-secondary">{t('vd.split.staysWith')}</span>
                      <div className="ui-segment self-start max-w-full flex-wrap" role="radiogroup" aria-label={t('vd.split.sideGroup', { pole: name(p.poleId) })}>
                        {(['prev', 'next'] as const).map((side) => (
                          <button key={side} type="button" role="radio" aria-checked={p.consumerSide === side} className={`ui-segment-item ${p.consumerSide === side ? 'is-active' : ''}`} data-vd-split-side-option={side} onClick={() => setSplitSide(p.cableId, p.poleId, p.occurrence, side)}>{t('vd.split.towards', { pole: name(side === 'prev' ? p.prevPoleId : p.nextPoleId) })}</button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {endSplits.length > 0 && <p className="mt-2 text-[12px] text-ios-tertiary">{t('vd.split.endPoints', { list: [...new Set(endSplits.map((e) => name(e.poleId)))].join(t('common.listSep')) })}</p>}
          </section>

          {/* old drawings: spans with missing properties, filled only on request (Stage 7.13) */}
          {(defaultsPlan.empty > 0 || defaultsPlan.partial > 0) && (
            <section aria-label={t('vd.defaults.section')} className="mb-3 rounded-ctl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" data-vd-missing-defaults={`${defaultsPlan.empty}/${defaultsPlan.partial}`}>
              <p>{defaultsPlan.empty > 0 && t('vd.defaults.empty', { n: defaultsPlan.empty })}{defaultsPlan.empty > 0 && defaultsPlan.partial > 0 && t('common.listSep')}{defaultsPlan.partial > 0 && t('vd.defaults.partial', { n: defaultsPlan.partial })}.</p>
              <p className="mt-1">{t('vd.defaults.explain', { mark: t('vd.defaultsReviewShort') })}</p>
              {!confirmDefaults ? (
                <button type="button" className="ui-tinted-btn mt-2 !w-auto !px-3" data-vd-action="fill-defaults" onClick={() => setConfirmDefaults(true)}>{t('vd.defaults.fill', { n: defaultsPlan.empty + defaultsPlan.partial })}</button>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span>{t('vd.defaults.willFill', { n: defaultsPlan.empty + defaultsPlan.partial })}</span>
                  <button type="button" className="min-h-[36px] rounded-ctl bg-ios-blue px-4 text-[15px] font-semibold text-white" data-vd-action="confirm-defaults" onClick={applyDefaults}>{t('vd.defaults.confirm')}</button>
                  <button type="button" className="min-h-[36px] rounded-ctl bg-ios-fill px-4 text-[15px] text-ios-blue" data-vd-action="cancel-defaults" onClick={() => setConfirmDefaults(false)}>{t('common.cancel')}</button>
                </div>
              )}
            </section>
          )}
          {result.settingsMissing.map((m) => <p key={m} className="mb-2 rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{t('vd.missingSetting', { item: settingMissingLabel(m, t) })}</p>)}

          {result.circuits.length === 0 && <p className="py-6 text-center text-ios-secondary">{t('vd.noCircuits')}</p>}

          {result.circuits.map((c, ci) => (
            <section key={c.circuit.id} aria-label={t('vd.circuit', { n: ci + 1 })} data-vd-circuit={c.status} className="mb-4 rounded-ctl border border-ios-separator">
              <div className="flex flex-wrap items-center gap-2 border-b border-ios-separator px-3 py-2">
                <span className="font-semibold text-ios-label">{t('vd.circuit', { n: ci + 1 })}</span>
                <span className="flex gap-1">{[...new Set(c.spans.map((s) => s.color))].map((col) => <span key={col} className="h-3 w-3 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: col }} />)}</span>
                {c.converged === false && <span className="text-[13px] font-semibold text-amber-900" data-vd-not-converged>{t('vd.notConverged', { n: c.iterations ?? '' })}</span>}
                <span className={`text-[13px] ${c.status === 'ok' ? 'text-ios-secondary' : 'text-amber-900'}`}>{c.status === 'ok' ? t('vd.source', { pole: name(c.circuit.sourcePoleId!), kind: c.circuit.sourceKind === 'manual' ? t('vd.sourceManual') : t('vd.sourceTransformer') }) : `⚠ ${circuitStatusLabel(c.status, t)}`}</span>
                {c.maxPercent !== undefined && <span className="ms-auto text-[13px] font-semibold text-ios-label">{t('vd.worst', { mark: c.worstProvisional ? '≈' : '', percent: c.maxPercent.toFixed(2), pole: name(c.worstPoleId!), provisional: c.worstProvisional ? t('vd.worstProvisional') : '' })}</span>}
              </div>
              {/* choose / clear the source */}
              {(c.status === 'multiple-transformers' || c.status === 'no-source' || c.status === 'multiple-sources' || manualIn(c).length > 0) && (
                <div className="flex flex-wrap gap-2 px-3 py-2">
                  {c.status === 'multiple-transformers' && transformersIn(c).map((tf) => (
                    <button key={tf} type="button" className="ui-tinted-btn !w-auto !min-h-[30px]" data-vd-action="choose-source" onClick={() => setSource(tf, true)}>{t('vd.chooseSource', { pole: name(tf) })}</button>
                  ))}
                  {manualIn(c).map((p) => (
                    <button key={p} type="button" className="ui-tinted-btn !w-auto !min-h-[30px] !bg-ios-fill !text-ios-label" data-vd-action="clear-source" onClick={() => setSource(p, false)}>{t('vd.clearSource', { pole: name(p) })}</button>
                  ))}
                  {c.status === 'no-source' && <span className="text-[12px] text-ios-secondary">{t('vd.howToSource')}</span>}
                </div>
              )}

              {c.poles.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead className="text-ios-secondary"><tr className="text-start">
                      <th className="px-3 py-1 font-medium">{t('vd.table.pole')}</th><th className="px-2 py-1 font-medium">{t('vd.table.drop')}</th><th className="px-2 py-1 font-medium">{t('vd.table.percent')}</th><th className="px-2 py-1 font-medium">{t('vd.table.phaseV')}</th><th className="px-2 py-1 font-medium">{t('vd.table.lineV')}</th><th className="px-2 py-1 font-medium">{t('vd.table.status')}</th>
                    </tr></thead>
                    <tbody>
                      {c.poles.map((p) => (
                        <tr key={p.bus} className="border-t border-ios-separator" data-vd-pole={p.poleId} data-vd-status={p.status} data-vd-provisional={p.provisional.length ? '1' : undefined}>
                          <td className="px-3 py-1"><span className="me-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />{name(p.poleId)}{p.consumerIds.length ? t('vd.poleConsumers', { n: p.consumerIds.length }) : ''}</td>
                          <td className="px-2 py-1 tabular-nums">{fmt(p.dropV)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmt(p.percent)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmt(p.phaseV, 1)}</td>
                          <td className="px-2 py-1 tabular-nums">{p.lineV === undefined ? '—' : fmt(p.lineV, 1)}</td>
                          <td className={`px-2 py-1 ${p.provisional.length && p.status !== 'na' ? 'text-amber-900' : ''}`}>{poleStatusText(p, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {c.spans.length > 0 && (
                <details className="border-t border-ios-separator" open={c.spans.some((s) => s.missing.length > 0)}>
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ios-label">{t('vd.spans', { n: c.spans.length, m: c.spans.filter((s) => s.missing.length > 0).length })}</summary>
                  <ul className="flex flex-col">
                    {c.spans.map((sp) => {
                      const cab = cables.get(sp.cableId);
                      const props = cab ? spanAt(cab, sp.index).props : undefined;
                      return (
                        <li key={sp.key} className="flex items-start gap-2 border-t border-ios-separator px-3 py-2 text-[13px]" data-vd-span={sp.key}>
                          <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: sp.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-ios-label">{name(sp.fromPole)} ← {name(sp.toPole)}: {sp.lengthM !== undefined ? t('vd.spanLength', { n: sp.lengthM }) : t('vd.spanLengthUnknown')} · {spanSummary(props, t)}</div>
                            <div className="text-ios-secondary">{t('vd.spanCurrent', { i: fmt(sp.phaseCurrentA, 1), i3: fmt(sp.threePhaseA, 1), i1: fmt(sp.singlePhaseA, 1), drop: sp.computable ? `${fmt(sp.dropV)} V` : '—' })}{sp.cumulativeDropV !== undefined ? t('vd.spanCumulative', { v: fmt(sp.cumulativeDropV) }) : ''}</div>
                            {sp.missing.length > 0 && <div className="text-amber-900">{t('vd.missing', { list: sp.missing.map((m) => missingLabel(m, t)).join(t('common.reasonSep')) })}</div>}
                            {sp.review.map((r) => <div key={r} className="text-amber-900">⚠ {reviewLabel(r, t)}</div>)}
                            {sp.inherited && <div className="text-ios-secondary">{t('vd.inherited')}</div>}
                          </div>
                          <button type="button" className="ui-tinted-btn !w-auto !min-h-[30px] flex-shrink-0 !px-3" data-vd-action="edit-span" onClick={() => setEditing({ cableId: sp.cableId, index: sp.index })}>{t('common.edit')}</button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {c.circuit.inferredJunctions.length > 0 && (
                <details className="border-t border-ios-separator" data-vd-inferred={c.circuit.inferredJunctions.length}>
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ios-label">{t('vd.inferred', { n: c.circuit.inferredJunctions.length })}</summary>
                  <ul className="flex flex-col">
                    {c.circuit.inferredJunctions.map((j) => {
                      const cab = cables.get(j.cableId);
                      return (
                        <li key={`${j.cableId}:${j.end}`} className="flex items-center gap-2 border-t border-ios-separator px-3 py-2 text-[13px]">
                          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: cab?.strokeColor }} />
                          <span className="min-w-0 flex-1 text-ios-label">{t('vd.inferredItem', { pole: name(j.poleId), n: j.withCableIds.length })}</span>
                          <button type="button" className="ui-tinted-btn !w-auto !min-h-[30px] flex-shrink-0 !px-3" data-vd-action="review-junction" onClick={() => setEndsPole(j.poleId)}>{t('common.review')}</button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {c.circuit.issues.length > 0 && (
                <ul className="border-t border-ios-separator px-3 py-2 text-[13px] text-amber-900">{c.circuit.issues.map((i, k) => <li key={k}>⚠ {issueText(i, name, t)}</li>)}</ul>
              )}
            </section>
          ))}

          {result.network.issues.length > 0 && (
            <section className="mb-4 rounded-ctl border border-ios-separator px-3 py-2 text-[13px] text-amber-900">
              {result.network.issues.map((i, k) => <p key={k}>⚠ {issueText(i, name, t)}</p>)}
            </section>
          )}

          <section aria-label={t('vd.method.section')} className="mb-3 rounded-ctl bg-ios-fill px-3 py-2 text-[12px] leading-relaxed text-ios-secondary">
            <p className="font-medium text-ios-label">{t('vd.method.title')}</p>
            <p>{t('vd.method.p1')}</p>
            <p>{t('vd.method.p2')}</p>
            <p>{t('vd.method.p3', { table: CONDUCTOR_TABLE_SOURCE, alpha: ALPHA_SOURCE })}</p>
            <p>{t('vd.method.p4')}</p>
          </section>
          <div className="flex gap-2">
            <button type="button" className="ui-tinted-btn !w-auto" data-vd-action="copy-report" onClick={copyReport}>{copied ? t('vd.copied') : t('vd.copy')}</button>
            <button type="button" className="ui-tinted-btn !w-auto" data-vd-action="open-e2" onClick={() => setShowE2(true)}>{t('e2.open')}</button>
          </div>
        </div>
      </div>
      {editing && <div onClick={(e) => e.stopPropagation()}><SpanPropertiesSheet cableId={editing.cableId} index={editing.index} onClose={() => setEditing(null)} /></div>}
      {endsPole && <div onClick={(e) => e.stopPropagation()}><CableEndsDialog poleId={endsPole} onClose={() => setEndsPole(null)} /></div>}
      {showE2 && <div onClick={(e) => e.stopPropagation()}><E2ResultsPanel onClose={() => setShowE2(false)} /></div>}
      {proposalEdit && <div onClick={(e) => e.stopPropagation()}><ProposedConsumerSheet poleId={proposalEdit.poleId} consumerId={proposalEdit.consumerId} onClose={() => setProposalEdit(null)} /></div>}
    </div>
  );
};

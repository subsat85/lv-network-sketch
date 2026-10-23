import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import type { CableElement, ElectricalSettings, SymbolElement } from '../types/drawing';
import { useVoltageDrop } from '../utils/useVoltageDrop';
import type { CircuitResult, VoltageDropResult } from '../utils/voltageDrop';
import { CIRCUIT_STATUS_LABEL, fmt, issueText, LOAD_MODEL_LABEL, MISSING_LABEL, POLE_STATUS_LABEL, POLE_STATUS_MARK, PROVISIONAL_LABEL, PROVISIONAL_STATUS, REVIEW_LABEL, SETTING_MISSING_LABEL } from '../utils/vdLabels';
import type { PoleResult } from '../utils/voltageDrop';

/** status text of a pole result; a provisional value is never shown as a plain "within the limit" */
export const poleStatusText = (p: PoleResult) => {
  if (p.status === 'na') return `${POLE_STATUS_MARK.na} ${POLE_STATUS_LABEL.na}${p.reason === 'missing-data' ? ' (بيانات ناقصة)' : p.reason === 'settings' ? ' (الإعدادات)' : p.reason === 'network' ? ' (الشبكة)' : p.reason === 'not-converged' ? ': لم يتقارب' : ''}`;
  if (p.provisional.length) return `⚑ ${PROVISIONAL_STATUS} (القيمة التقديرية: ${POLE_STATUS_LABEL[p.status]}) — ${p.provisional.map((r) => PROVISIONAL_LABEL[r]).join('؛ ')}`;
  return `${POLE_STATUS_MARK[p.status]} ${POLE_STATUS_LABEL[p.status]}`;
};
import { poleNamer } from '../utils/poleNames';
import { spanAt } from '../utils/spanModel';
import { SpanPropertiesSheet, spanSummary } from './SpanPropertiesSheet';
import { CableEndsDialog } from './CableEndsDialog';
import { DEFAULT_POWER_FACTOR, isPowerFactorDefault } from '../utils/electricalSettings';
import { planMissingDefaults } from '../utils/spanDefaults';
import { DEFAULTS_REVIEW_SHORT } from '../utils/vdLabels';
import { ALPHA_SOURCE, CONDUCTOR_TABLE_SOURCE } from '../data/conductors';
import { allStudySplitPoints, endSplitPoints, setSplitConsumerSide, type SplitSide } from '../utils/splitStudy';

// Voltage-drop settings, results and report (Stages 7.6 / 7.7).

type SettingsForm = Record<'pf' | 'temp' | 'limit' | 'near' | 'minPh' | 'minLL' | 'vph' | 'vll', string> & { mode: ElectricalSettings['singlePhaseMode']; loadModel: NonNullable<ElectricalSettings['loadModel']> };
const toForm = (s: ElectricalSettings): SettingsForm => ({
  pf: s.powerFactor?.toString() ?? '', temp: s.conductorTempC?.toString() ?? '', limit: String(s.limitPercent),
  near: String(Math.round(s.nearLimitFraction * 100)), minPh: String(s.minPhaseVoltage), minLL: String(s.minLineVoltage),
  vph: String(s.phaseVoltage), vll: String(s.lineVoltage), mode: s.singlePhaseMode, loadModel: s.loadModel ?? 'constant-current',
});
const n = (s: string) => (s.trim() === '' ? undefined : Number(s.trim().replace(',', '.')));

const fromForm = (f: SettingsForm): { changes: Partial<ElectricalSettings>; errors: string[] } => {
  const errors: string[] = [];
  const req = (label: string, s: string, ok: (v: number) => boolean) => { const v = n(s); if (v === undefined || !Number.isFinite(v) || !ok(v)) { errors.push(label); return undefined; } return v; };
  const opt = (label: string, s: string, ok: (v: number) => boolean) => { const v = n(s); if (v === undefined) return undefined; if (!Number.isFinite(v) || !ok(v)) { errors.push(label); return undefined; } return v; };
  const changes: Partial<ElectricalSettings> = {
    powerFactor: opt('cos φ (بين 0 و1)', f.pf, (v) => v > 0 && v <= 1),
    conductorTempC: opt('حرارة الموصل', f.temp, (v) => v >= -40 && v <= 250),
    limitPercent: req('حد الهبوط %', f.limit, (v) => v > 0 && v < 100),
    nearLimitFraction: (req('عتبة التحذير %', f.near, (v) => v > 0 && v <= 100) ?? 80) / 100,
    minPhaseVoltage: req('أدنى فولتية طور', f.minPh, (v) => v > 0),
    minLineVoltage: req('أدنى فولتية بين الأطوار', f.minLL, (v) => v > 0),
    phaseVoltage: req('الفولتية الاسمية للطور', f.vph, (v) => v > 0),
    lineVoltage: req('الفولتية الاسمية بين الأطوار', f.vll, (v) => v > 0),
    singlePhaseMode: f.mode,
    loadModel: f.loadModel,
  };
  return { changes, errors };
};

const NumField: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }> = ({ label, value, onChange, hint, placeholder }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[13px] font-medium text-ios-secondary">{label}{hint && <span className="font-normal text-ios-tertiary"> — {hint}</span>}</span>
    <input className="ui-field h-10" type="text" inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={label} />
  </label>
);

/** Plain-text report (for copying into a message / document). */
export const voltageDropReportText = (r: VoltageDropResult, name: (id: string) => string, cables: Map<string, CableElement>, powerFactorDefault = false): string => {
  const s = r.settings;
  const lines: string[] = [];
  lines.push('تقرير هبوط الفولتية');
  lines.push(`الفولتية الاسمية ${s.phaseVoltage}/${s.lineVoltage} V — الحد ${s.limitPercent}% (مرجعي، يُطابق مع معيار المشروع) — أدنى فولتية ${s.minPhaseVoltage} V طور / ${s.minLineVoltage} V بين الأطوار`);
  lines.push(`cos φ = ${s.powerFactor ?? 'غير مُدخل'}${powerFactorDefault ? ' (افتراضي)' : ''} — حرارة الموصل ${s.conductorTempC ?? 'غير مُدخلة'} °C — أحمال الطور الواحد: ${s.singlePhaseMode === 'worst' ? 'أسوأ حالة (على الطور المفحوص)' : 'موزعة بالتساوي (افتراض)'}`);
  lines.push(`نموذج الحمل: ${LOAD_MODEL_LABEL[s.loadModel ?? 'constant-current']}${(s.loadModel ?? 'constant-current') === 'constant-power' ? ' (التيار يتغير مع الفولتية عند كل عمود، حساب بالتكرار)' : ''}`);
  if (s.studySuggestedSplits) lines.push('دراسة: نقاط الفصل المقترحة (في نص الكيبل) محسوبة كنقاط فتح كهربائية');
  for (const m of r.settingsMissing) lines.push(`ناقص: ${SETTING_MISSING_LABEL[m]}`);
  r.circuits.forEach((c, i) => {
    lines.push('');
    if (c.converged === false) lines.push(`الشبكة ${i + 1}: غير قابل للحساب: لم يتقارب حساب القدرة الثابتة خلال ${c.iterations} دورة`);
    lines.push(`الشبكة ${i + 1}: ${CIRCUIT_STATUS_LABEL[c.status]}${c.circuit.sourcePoleId ? ` — المصدر ${name(c.circuit.sourcePoleId)} (${c.circuit.sourceKind === 'manual' ? 'مختار' : 'محولة'})` : ''}`);
    if (c.maxPercent !== undefined) lines.push(`أعلى هبوط ${c.worstProvisional ? '≈' : ''}${c.maxPercent.toFixed(2)}% عند ${name(c.worstPoleId!)}${c.worstProvisional ? ' (تقديري — يحتاج مراجعة)' : ''}`);
    for (const p of c.poles) {
      lines.push(`  ${name(p.poleId)}: ${p.status === 'na' ? 'غير قابل للحساب' : `${p.provisional.length ? '≈' : ''}${fmt(p.dropV)} V (${fmt(p.percent)}%) → ${fmt(p.phaseV, 1)} V${p.lineV !== undefined ? ` / ${fmt(p.lineV, 1)} V` : ''} — ${poleStatusText(p)}`}`);
    }
    for (const sp of c.spans) {
      const cab = cables.get(sp.cableId);
      const props = cab ? spanAt(cab, sp.index).props : undefined;
      lines.push(`  مقطع ${name(sp.fromPole)}→${name(sp.toPole)}: ${sp.lengthM ?? '?'} م، ${spanSummary(props)}، تيار ${fmt(sp.phaseCurrentA, 1)} A، هبوط ${sp.computable ? `${fmt(sp.dropV)} V` : `غير محسوب (${sp.missing.map((m) => MISSING_LABEL[m]).join('؛ ')})`}`);
    }
    if (c.circuit.inferredJunctions.length) lines.push(`  نقاط ربط مستنتجة تلقائيًا (للمراجعة): ${[...new Set(c.circuit.inferredJunctions.map((j) => name(j.poleId)))].join('، ')}`);
  });
  if (r.issues.length) {
    lines.push('');
    lines.push('تحذيرات:');
    for (const i of r.issues) lines.push(`- ${issueText(i, name)}`);
  }
  lines.push('');
  lines.push(`المقاومة: ${CONDUCTOR_TABLE_SOURCE}، مصححة للحرارة (α من ${ALPHA_SOURCE})، بدون زيادة التيار المتردد؛ أو R/X المُدخلة لكل مقطع.`);
  lines.push('الأحمال تيار ثابت حسب قواعد تقرير الأحمال (طور واحد 4 A، ثلاثي = الرقم أو 32 A)، بدون معامل تنوع. ΔV = I(R cosφ + X sinφ)L. هبوط كيبل الخدمة غير مشمول.');
  lines.push('هبوط ضمن الحد لا يعني أن الكيبل آمن حراريًا: سعة التحميل تحتاج تحققًا مستقلًا.');
  return lines.join('\n');
};

export const VoltageDropPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { elements, electrical, updateElectricalSettings, saveHistory, showVoltageDrop, setShowVoltageDrop, updateSymbolModifiers, updateElements, updateElement } = useDrawingStore();
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
  const name = useMemo(() => poleNamer(elements), [elements]);
  const cables = useMemo(() => new Map(elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c])), [elements]);
  const [form, setForm] = useState<SettingsForm>(() => toForm(electrical));
  const [editing, setEditing] = useState<{ cableId: string; index: number } | null>(null);
  const [endsPole, setEndsPole] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const parsed = fromForm(form);
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
  const setStudy = (on: boolean) => { saveHistory(); updateElectricalSettings({ studySuggestedSplits: on }); saveHistory(); };
  const setSplitSide = (cableId: string, poleId: string, occurrence: number, side: SplitSide) => {
    const c = cables.get(cableId);
    if (!c) return;
    saveHistory(); updateElement(cableId, setSplitConsumerSide(c, poleId, occurrence, side)); saveHistory();
  };
  const copyReport = async () => {
    const text = voltageDropReportText(result, name, cables, pfDefault);
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt('انسخ التقرير:', text); }
  };

  const transformersIn = (c: CircuitResult) => [...c.circuit.poleIds].filter((id) => (elements.find((e) => e.id === id) as SymbolElement | undefined)?.symbolId === 'transformer');
  const manualIn = (c: CircuitResult) => [...c.circuit.poleIds].filter((id) => (elements.find((e) => e.id === id) as SymbolElement | undefined)?.modifiers?.vdSource);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div dir="rtl" role="dialog" aria-label="هبوط الفولتية" className="flex w-full max-w-2xl max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex-col overflow-hidden rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-ios-separator px-4 py-3">
          <h2 className="text-[17px] font-semibold text-ios-label">هبوط الفولتية</h2>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ios-secondary">إظهار على الرسم</span>
            <button type="button" role="switch" aria-checked={showVoltageDrop} aria-label="إظهار هبوط الفولتية على الرسم" className="ui-switch" onClick={() => setShowVoltageDrop(!showVoltageDrop)}><span className="ui-switch-knob" /></button>
            <button type="button" aria-label="إغلاق" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] text-[14px]">
          {/* settings */}
          <section aria-label="إعدادات الحساب" className="mb-4 rounded-ctl border border-ios-separator p-3">
            <h3 className="mb-2 text-[15px] font-semibold text-ios-label">إعدادات الحساب</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumField label="cos φ" value={form.pf} onChange={(v) => setF('pf', v)} hint={pfDefault ? `افتراضي ${DEFAULT_POWER_FACTOR}` : undefined} placeholder={`${DEFAULT_POWER_FACTOR} (افتراضي)`} />
              <NumField label="حرارة الموصل °C" value={form.temp} onChange={(v) => setF('temp', v)} hint="للجدول" />
              <NumField label="حد الهبوط %" value={form.limit} onChange={(v) => setF('limit', v)} />
              <NumField label="تحذير من % من الحد" value={form.near} onChange={(v) => setF('near', v)} />
              <NumField label="أدنى V طور" value={form.minPh} onChange={(v) => setF('minPh', v)} />
              <NumField label="أدنى V بين الأطوار" value={form.minLL} onChange={(v) => setF('minLL', v)} />
              <NumField label="V اسمي طور" value={form.vph} onChange={(v) => setF('vph', v)} />
              <NumField label="V اسمي بين الأطوار" value={form.vll} onChange={(v) => setF('vll', v)} />
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ios-secondary">أحمال الطور الواحد (الطور غير معروف في الرسم)</span>
              <div className="ui-segment self-start" role="radiogroup" aria-label="أحمال الطور الواحد">
                <button type="button" role="radio" aria-checked={form.mode === 'worst'} className={`ui-segment-item ${form.mode === 'worst' ? 'is-active' : ''}`} onClick={() => setForm((f) => ({ ...f, mode: 'worst' }))}>أسوأ حالة (حد أعلى)</button>
                <button type="button" role="radio" aria-checked={form.mode === 'balanced'} className={`ui-segment-item ${form.mode === 'balanced' ? 'is-active' : ''}`} onClick={() => setForm((f) => ({ ...f, mode: 'balanced' }))}>توزيع متساوٍ (افتراض)</button>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-1">
              <span className="text-[13px] font-medium text-ios-secondary">نموذج الحمل</span>
              <div className="ui-segment self-start" role="radiogroup" aria-label="نموذج الحمل">
                {(['constant-current', 'constant-power'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={form.loadModel === m} className={`ui-segment-item ${form.loadModel === m ? 'is-active' : ''}`} onClick={() => setForm((f) => ({ ...f, loadModel: m }))}>{LOAD_MODEL_LABEL[m]}{m === 'constant-current' ? ' (الافتراضي)' : ''}</button>
                ))}
              </div>
              <span className="text-[12px] text-ios-tertiary">تيار ثابت: تيارات القواعد كما هي. قدرة ثابتة: كل مشترك يسحب قدرة تياره عند 230 V، فيزيد تياره كلما انخفضت الفولتية (هبوط أكبر قليلًا). الاختيار هندسي حسب طبيعة الأحمال.</span>
            </div>
            {parsed.errors.length > 0 && <p className="mt-2 text-[13px] text-ios-red">قيم غير صالحة: {parsed.errors.join('، ')}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button type="button" disabled={!dirty || parsed.errors.length > 0} onClick={applySettings} className="min-h-[36px] rounded-ctl bg-ios-blue px-4 text-[15px] font-semibold text-white disabled:opacity-40">حفظ الإعدادات</button>
              {dirty && <span className="text-[12px] text-ios-secondary">لم تُحفظ التغييرات بعد</span>}
            </div>
            <p className="mt-2 text-[12px] text-ios-tertiary">الحد {electrical.limitPercent}% و{electrical.minPhaseVoltage}/{electrical.minLineVoltage} V قيم مرجعية ابتدائية قابلة للتعديل، وليست حكمًا نهائيًا: طابقها مع المعيار المعتمد للمشروع. هبوط ضمن الحد لا يعني أن الكيبل آمن حراريًا.</p>
          </section>

          <p className="mb-2 text-[13px] text-ios-label" data-vd-load-model={electrical.loadModel ?? 'constant-current'}>نموذج الحمل المستعمل في النتائج: <b>{LOAD_MODEL_LABEL[electrical.loadModel ?? 'constant-current']}</b></p>
          <p className="mb-2 text-[13px] text-ios-label" data-vd-power-factor={pfDefault ? 'default' : 'saved'}>cos φ المستعمل: <b>{pfDefault ? DEFAULT_POWER_FACTOR : electrical.powerFactor}</b>{pfDefault && <span className="text-ios-secondary"> (افتراضي — غير محفوظ في المشروع؛ أدخله واحفظ الإعدادات لاعتماد قيمة أخرى)</span>}</p>

          {/* study: suggested split points calculated as open points (off = drawing marks only) */}
          <section aria-label="دراسة نقاط الفصل المقترحة" data-vd-split-study={study ? 'on' : 'off'} className={`mb-3 rounded-ctl border p-3 text-[13px] ${study ? 'border-ios-red/40 bg-red-50' : 'border-ios-separator'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ios-label">احسب مع نقاط الفصل المقترحة (دراسة)</span>
              <button type="button" role="switch" aria-checked={study} aria-label="احسب مع نقاط الفصل المقترحة (دراسة)" className="ui-switch shrink-0" onClick={() => setStudy(!study)}><span className="ui-switch-knob" /></button>
            </div>
            <p className="mt-1 text-[12px] text-ios-secondary">{study
              ? 'مفعّلة: كل نقطة فصل مقترحة في نص كيبل تُحسب كنقطة فتح — الجهتان منفصلتان كهربائيًا. الجهة المختارة تبقى على العمود (مشتركوه وربطه)، والجهة الأخرى طرف مفتوح لا يتصل إلا بجمبر يحددها.'
              : 'غير مفعّلة: نقاط الفصل المقترحة علامات على الرسم فقط ولا تغيّر الحساب.'}</p>
            {splitPoints.length === 0 && <p className="mt-2 text-ios-tertiary">لا توجد نقاط فصل مقترحة في نص كيبل.</p>}
            {splitPoints.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">
                {splitPoints.map((p) => {
                  const col = cables.get(p.cableId)?.strokeColor ?? '#000';
                  return (
                    <li key={`${p.cableId}|${p.poleId}#${p.occurrence}`} data-vd-split-point={`${p.cableId}|${p.poleId}#${p.occurrence}`} data-vd-split-side={p.consumerSide ?? 'none'} className="flex flex-col gap-1 rounded-ctl bg-white/70 p-2 ring-1 ring-inset ring-black/5">
                      <span className="flex flex-wrap items-center gap-2 text-ios-label">
                        <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: col }} />
                        <b>{name(p.poleId)}</b>
                        <span className="text-ios-secondary">بين {name(p.prevPoleId)} و{name(p.nextPoleId)}</span>
                        {!p.consumerSide && <span className="font-semibold text-amber-900">⚠ اختر الجهة</span>}
                      </span>
                      <span className="text-[12px] text-ios-secondary">المشتركون واتصالات العمود يبقون مع:</span>
                      <div className="ui-segment self-start max-w-full flex-wrap" role="radiogroup" aria-label={`جهة المشتركين عند ${name(p.poleId)}`}>
                        {(['prev', 'next'] as const).map((side) => (
                          <button key={side} type="button" role="radio" aria-checked={p.consumerSide === side} className={`ui-segment-item ${p.consumerSide === side ? 'is-active' : ''}`} onClick={() => setSplitSide(p.cableId, p.poleId, p.occurrence, side)}>باتجاه {name(side === 'prev' ? p.prevPoleId : p.nextPoleId)}</button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {endSplits.length > 0 && <p className="mt-2 text-[12px] text-ios-tertiary">نقاط مقترحة عند طرف كيبل ({[...new Set(endSplits.map((e) => name(e.poleId)))].join('، ')}) لا تدخل الدراسة: لفصل طرف كيبل استعمل «منفصل» في «ربط الكوابل».</p>}
          </section>

          {/* old drawings: spans with missing properties, filled only on request (Stage 7.13) */}
          {(defaultsPlan.empty > 0 || defaultsPlan.partial > 0) && (
            <section aria-label="المقاطع الناقصة" className="mb-3 rounded-ctl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" data-vd-missing-defaults={`${defaultsPlan.empty}/${defaultsPlan.partial}`}>
              <p>{defaultsPlan.empty > 0 && <>{defaultsPlan.empty} مقطع بلا خصائص</>}{defaultsPlan.empty > 0 && defaultsPlan.partial > 0 && '، '}{defaultsPlan.partial > 0 && <>{defaultsPlan.partial} مقطع خصائصه ناقصة</>}.</p>
              <p className="mt-1">يمكن تعبئة الناقص فقط بالقيم الافتراضية (ABC، 3 أطوار + N، Al 120 / محايد Al 70، R و X و Rn من جدول الشركة حيث يتوفر). لا تتغير أي قيمة موجودة، وتُعلَّم المقاطع «{DEFAULTS_REVIEW_SHORT}» حتى تراجعها وتحفظها.</p>
              {!confirmDefaults ? (
                <button type="button" className="ui-tinted-btn mt-2 !w-auto !px-3" onClick={() => setConfirmDefaults(true)}>تعبئة القيم الافتراضية ({defaultsPlan.empty + defaultsPlan.partial})</button>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span>ستُعبّأ {defaultsPlan.empty + defaultsPlan.partial} مقطعًا (خطوة تراجع واحدة).</span>
                  <button type="button" className="min-h-[36px] rounded-ctl bg-ios-blue px-4 text-[15px] font-semibold text-white" onClick={applyDefaults}>تأكيد التعبئة</button>
                  <button type="button" className="min-h-[36px] rounded-ctl bg-ios-fill px-4 text-[15px] text-ios-blue" onClick={() => setConfirmDefaults(false)}>إلغاء</button>
                </div>
              )}
            </section>
          )}
          {result.settingsMissing.map((m) => <p key={m} className="mb-2 rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">⚠ ناقص: {SETTING_MISSING_LABEL[m]}</p>)}

          {result.circuits.length === 0 && <p className="py-6 text-center text-ios-secondary">لا توجد كوابل متصلة في الرسم.</p>}

          {result.circuits.map((c, ci) => (
            <section key={c.circuit.id} aria-label={`الشبكة ${ci + 1}`} data-vd-circuit={c.status} className="mb-4 rounded-ctl border border-ios-separator">
              <div className="flex flex-wrap items-center gap-2 border-b border-ios-separator px-3 py-2">
                <span className="font-semibold text-ios-label">الشبكة {ci + 1}</span>
                <span className="flex gap-1">{[...new Set(c.spans.map((s) => s.color))].map((col) => <span key={col} className="h-3 w-3 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: col }} />)}</span>
                {c.converged === false && <span className="text-[13px] font-semibold text-amber-900" data-vd-not-converged>⚠ غير قابل للحساب: لم يتقارب (قدرة ثابتة، {c.iterations} دورة)</span>}
                <span className={`text-[13px] ${c.status === 'ok' ? 'text-ios-secondary' : 'text-amber-900'}`}>{c.status === 'ok' ? `المصدر: ${name(c.circuit.sourcePoleId!)} (${c.circuit.sourceKind === 'manual' ? 'مختار يدويًا' : 'محولة — مقترح تلقائيًا'})` : `⚠ ${CIRCUIT_STATUS_LABEL[c.status]}`}</span>
                {c.maxPercent !== undefined && <span className="mr-auto text-[13px] font-semibold text-ios-label">أعلى هبوط {c.worstProvisional ? '≈' : ''}{c.maxPercent.toFixed(2)}% ({name(c.worstPoleId!)}){c.worstProvisional ? ' — تقديري' : ''}</span>}
              </div>
              {/* choose / clear the source */}
              {(c.status === 'multiple-transformers' || c.status === 'no-source' || c.status === 'multiple-sources' || manualIn(c).length > 0) && (
                <div className="flex flex-wrap gap-2 px-3 py-2">
                  {c.status === 'multiple-transformers' && transformersIn(c).map((t) => (
                    <button key={t} type="button" className="ui-tinted-btn !w-auto !min-h-[30px]" onClick={() => setSource(t, true)}>اختيار {name(t)} مصدرًا</button>
                  ))}
                  {manualIn(c).map((p) => (
                    <button key={p} type="button" className="ui-tinted-btn !w-auto !min-h-[30px] !bg-ios-fill !text-ios-label" onClick={() => setSource(p, false)}>إلغاء اختيار {name(p)} مصدرًا</button>
                  ))}
                  {c.status === 'no-source' && <span className="text-[12px] text-ios-secondary">لاختيار عمود مصدر: حدّد العمود ثم اضغط عليه مرة أخرى ← «مصدر التغذية (هبوط الفولتية)».</span>}
                </div>
              )}

              {c.poles.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[13px]">
                    <thead className="text-ios-secondary"><tr className="text-right">
                      <th className="px-3 py-1 font-medium">العمود</th><th className="px-2 py-1 font-medium">الهبوط V</th><th className="px-2 py-1 font-medium">%</th><th className="px-2 py-1 font-medium">V طور</th><th className="px-2 py-1 font-medium">V بين الأطوار</th><th className="px-2 py-1 font-medium">الحالة</th>
                    </tr></thead>
                    <tbody>
                      {c.poles.map((p) => (
                        <tr key={p.bus} className="border-t border-ios-separator" data-vd-pole={p.poleId} data-vd-status={p.status} data-vd-provisional={p.provisional.length ? '1' : undefined}>
                          <td className="px-3 py-1"><span className="ml-1 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />{name(p.poleId)}{p.consumerIds.length ? ` (${p.consumerIds.length} مشترك)` : ''}</td>
                          <td className="px-2 py-1 tabular-nums">{fmt(p.dropV)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmt(p.percent)}</td>
                          <td className="px-2 py-1 tabular-nums">{fmt(p.phaseV, 1)}</td>
                          <td className="px-2 py-1 tabular-nums">{p.lineV === undefined ? '—' : fmt(p.lineV, 1)}</td>
                          <td className={`px-2 py-1 ${p.provisional.length && p.status !== 'na' ? 'text-amber-900' : ''}`}>{poleStatusText(p)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {c.spans.length > 0 && (
                <details className="border-t border-ios-separator" open={c.spans.some((s) => s.missing.length > 0)}>
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ios-label">المقاطع ({c.spans.length}) — {c.spans.filter((s) => s.missing.length > 0).length} ناقصة البيانات</summary>
                  <ul className="flex flex-col">
                    {c.spans.map((sp) => {
                      const cab = cables.get(sp.cableId);
                      const props = cab ? spanAt(cab, sp.index).props : undefined;
                      return (
                        <li key={sp.key} className="flex items-start gap-2 border-t border-ios-separator px-3 py-2 text-[13px]" data-vd-span={sp.key}>
                          <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: sp.color }} />
                          <div className="min-w-0 flex-1">
                            <div className="text-ios-label">{name(sp.fromPole)} ← {name(sp.toPole)}: {sp.lengthM !== undefined ? `${sp.lengthM} م` : 'الطول ؟'} · {spanSummary(props)}</div>
                            <div className="text-ios-secondary">تيار الطور {fmt(sp.phaseCurrentA, 1)} A (ثلاثي {fmt(sp.threePhaseA, 1)}، أحادي {fmt(sp.singlePhaseA, 1)}) · هبوط المقطع {sp.computable ? `${fmt(sp.dropV)} V` : '—'}{sp.cumulativeDropV !== undefined ? ` · التراكمي ${fmt(sp.cumulativeDropV)} V` : ''}</div>
                            {sp.missing.length > 0 && <div className="text-amber-900">ناقص: {sp.missing.map((m) => MISSING_LABEL[m]).join('؛ ')}</div>}
                            {sp.review.map((r) => <div key={r} className="text-amber-900">⚠ {REVIEW_LABEL[r]}</div>)}
                            {sp.inherited && <div className="text-ios-secondary">منسوخة من المقطع السابق</div>}
                          </div>
                          <button type="button" className="ui-tinted-btn !w-auto !min-h-[30px] flex-shrink-0 !px-3" onClick={() => setEditing({ cableId: sp.cableId, index: sp.index })}>تعديل</button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {c.circuit.inferredJunctions.length > 0 && (
                <details className="border-t border-ios-separator" data-vd-inferred={c.circuit.inferredJunctions.length}>
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ios-label">نقاط ربط مستنتجة تلقائيًا ({c.circuit.inferredJunctions.length}) — راجعها إن كان أحد الكوابل منفصلًا</summary>
                  <ul className="flex flex-col">
                    {c.circuit.inferredJunctions.map((j) => {
                      const cab = cables.get(j.cableId);
                      return (
                        <li key={`${j.cableId}:${j.end}`} className="flex items-center gap-2 border-t border-ios-separator px-3 py-2 text-[13px]">
                          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: cab?.strokeColor }} />
                          <span className="min-w-0 flex-1 text-ios-label">{name(j.poleId)}: طرف كيبل مربوط تلقائيًا بـ {j.withCableIds.length} كيبل بلونه</span>
                          <button type="button" className="ui-tinted-btn !w-auto !min-h-[30px] flex-shrink-0 !px-3" onClick={() => setEndsPole(j.poleId)}>مراجعة</button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {c.circuit.issues.length > 0 && (
                <ul className="border-t border-ios-separator px-3 py-2 text-[13px] text-amber-900">{c.circuit.issues.map((i, k) => <li key={k}>⚠ {issueText(i, name)}</li>)}</ul>
              )}
            </section>
          ))}

          {result.network.issues.length > 0 && (
            <section className="mb-4 rounded-ctl border border-ios-separator px-3 py-2 text-[13px] text-amber-900">
              {result.network.issues.map((i, k) => <p key={k}>⚠ {issueText(i, name)}</p>)}
            </section>
          )}

          <section aria-label="طريقة الحساب" className="mb-3 rounded-ctl bg-ios-fill px-3 py-2 text-[12px] leading-relaxed text-ios-secondary">
            <p className="font-medium text-ios-label">طريقة الحساب والافتراضات</p>
            <p>شبكة شعاعية من المصدر بفولتية اسمية. الأحمال تيار ثابت حسب قواعد تقرير الأحمال (طور واحد 4 A، ثلاثي = الرقم المكتوب أو 32 A لكل طور)، بدون معامل تنوع، بمعامل قدرة واحد لكل الأحمال.</p>
            <p>هبوط الموصل ≈ I·(R cosφ + X sinφ)·L، وR وX مقسومة على عدد الموصلات المتوازية. أسوأ حالة: أحمال الطور الواحد كلها على الطور المفحوص وتعود في المحايد. التوزيع المتساوي افتراض يختاره المستخدم. مفاعلة المحايد = مفاعلة الطور.</p>
            <p>المقاومة من {CONDUCTOR_TABLE_SOURCE} مصححة لحرارة التشغيل (α من {ALPHA_SOURCE})، بدون زيادة التيار المتردد؛ أو R المُدخلة. المفاعلة تُدخل لكل مقطع.</p>
            <p>الفولتية عند نقطة ربط المشترك على العمود (هبوط كيبل الخدمة غير مشمول). الفولتية بين الأطوار تظهر فقط حيث لا يمر تيار في المحايد.</p>
          </section>
          <div className="flex gap-2">
            <button type="button" className="ui-tinted-btn !w-auto" onClick={copyReport}>{copied ? 'تم النسخ' : 'نسخ التقرير كنص'}</button>
          </div>
        </div>
      </div>
      {editing && <div onClick={(e) => e.stopPropagation()}><SpanPropertiesSheet cableId={editing.cableId} index={editing.index} onClose={() => setEditing(null)} /></div>}
      {endsPole && <div onClick={(e) => e.stopPropagation()}><CableEndsDialog poleId={endsPole} onClose={() => setEndsPole(null)} /></div>}
    </div>
  );
};

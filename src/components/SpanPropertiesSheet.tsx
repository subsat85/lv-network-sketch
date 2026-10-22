import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import type { CableElement, CableKind, ConductorMaterial, DrawingElement, SpanProps, SupplySystem } from '../types/drawing';
import { hasElectrical, spanAt, withSpanProps } from '../utils/spanModel';
import { pairKey } from '../utils/cableSegments';
import { computeVoltageDrop, spanKey } from '../utils/voltageDrop';
import { tableSections, companySections, CONDUCTOR_TABLE_SOURCE, COMPANY_TABLE_SOURCE } from '../data/conductors';
import { DEFAULT_DATA_SOURCE, fillMissingSpanDefaults, followNeutralTable, followPhaseTable, neutralTableState, phaseTableState } from '../utils/spanDefaults';
import { effectiveSettings } from '../utils/electricalSettings';
import { CABLE_KIND_LABEL, fmt, INHERITED_LABEL, MISSING_LABEL, PROVISIONAL_LABEL, REVIEW_LABEL, SETTING_MISSING_LABEL } from '../utils/vdLabels';
import { isPlainDistance } from '../utils/distances';
import { poleNamer } from '../utils/poleNames';

// Editing the electrical properties of one span of one cable (Stage 7.2).
// Nothing is written until "حفظ"; the save is one undo step. The length is the
// span distance of the drawing (shared by cables on the same two poles).

interface Props {
  cableId: string;
  index: number;
  onClose: () => void;
}

type Form = {
  length: string; system: '' | SupplySystem; cableKind: '' | CableKind; material: '' | ConductorMaterial;
  section: string; neutral: string; neutralMaterial: '' | ConductorMaterial | 'alloy'; parallel: string; r: string; x: string; rn: string; source: string;
};

const toForm = (p: SpanProps | undefined, length: string): Form => ({
  length,
  system: p?.system ?? '', cableKind: p?.cableKind ?? '', material: p?.material ?? '',
  section: p?.crossSectionMm2?.toString() ?? '', neutral: p?.neutralCrossSectionMm2?.toString() ?? '', neutralMaterial: p?.neutralMaterial ?? '',
  parallel: p?.parallel?.toString() ?? '', r: p?.rOhmPerKm?.toString() ?? '', x: p?.xOhmPerKm?.toString() ?? '',
  rn: p?.rNeutralOhmPerKm?.toString() ?? '', source: p?.dataSource ?? '',
});

const num = (s: string) => { const v = Number(s.trim().replace(',', '.')); return s.trim() === '' ? undefined : v; };
const posOrUndef = (s: string) => { const v = num(s); return v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined; };

/** Form → properties (only valid values are kept); returns field errors too. */
const fromForm = (f: Form, poles: [string, string], keep: SpanProps | undefined): { props: SpanProps; errors: string[] } => {
  const errors: string[] = [];
  const check = (label: string, s: string, allowZero = false) => {
    const v = num(s);
    if (v === undefined) return undefined;
    if (!Number.isFinite(v) || v < 0 || (!allowZero && v === 0)) { errors.push(label); return undefined; }
    return v;
  };
  const parallel = check('الموصلات المتوازية', f.parallel);
  if (parallel !== undefined && !Number.isInteger(parallel)) errors.push('الموصلات المتوازية (عدد صحيح)');
  const props: SpanProps = { poles };
  if (f.system) props.system = f.system;
  if (f.cableKind) props.cableKind = f.cableKind;
  if (f.material) props.material = f.material;
  const sec = check('مقطع الطور', f.section); if (sec !== undefined) props.crossSectionMm2 = sec;
  const neu = check('مقطع المحايد', f.neutral); if (neu !== undefined) props.neutralCrossSectionMm2 = neu;
  if (f.neutralMaterial) props.neutralMaterial = f.neutralMaterial;
  if (parallel !== undefined && Number.isInteger(parallel)) props.parallel = parallel;
  const r = check('R', f.r); if (r !== undefined) props.rOhmPerKm = r;
  const x = check('X', f.x, true); if (x !== undefined) props.xOhmPerKm = x;
  const rn = check('Rn', f.rn); if (rn !== undefined) props.rNeutralOhmPerKm = rn;
  if (f.source.trim()) props.dataSource = f.source.trim();
  if (keep?.legacyV2 !== undefined) props.legacyV2 = keep.legacyV2;
  return { props, errors };
};

/**
 * Backdrop that closes only when the press both started and ended on it. The
 * sheet opens on pointer-down on the canvas; on touch screens the click that
 * follows that tap lands on the freshly shown backdrop and must not close it.
 */
export const useBackdropClose = (onClose: () => void) => {
  const down = useRef(false);      // the press started on the backdrop itself
  const inside = useRef(false);    // a press started anywhere inside since the sheet opened
  // Mouse / click events that follow a touch that began before the sheet existed
  // (the tap that opened it) are swallowed, so they cannot press a button or
  // focus a field that happens to be under the finger.
  const guard = (e: React.SyntheticEvent) => { if (!inside.current) { e.preventDefault(); e.stopPropagation(); } };
  return {
    onPointerDownCapture: () => { inside.current = true; },
    onMouseDownCapture: guard,
    onMouseUpCapture: guard,
    onClickCapture: guard,
    onPointerDown: (e: React.PointerEvent) => { down.current = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => { if (down.current && e.target === e.currentTarget) onClose(); down.current = false; },
  };
};

// `group`: the content is a set of buttons — a <label> would hand its clicks to the first one
const Field: React.FC<{ label: string; hint?: string; group?: boolean; children: React.ReactNode }> = ({ label, hint, group, children }) => {
  const caption = <span className="text-[13px] font-medium text-ios-secondary">{label}{hint && <span className="font-normal text-ios-tertiary"> — {hint}</span>}</span>;
  return group
    ? <div className="flex flex-col gap-1">{caption}{children}</div>
    : <label className="flex flex-col gap-1">{caption}{children}</label>;
};

export const SpanPropertiesSheet: React.FC<Props> = ({ cableId, index, onClose }) => {
  const { elements, connectionDistances, electrical, distanceFlags, updateElement, updateConnectionDistance, saveHistory } = useDrawingStore();
  const cable = elements.find((e) => e.id === cableId && e.type === 'cable') as CableElement | undefined;
  const a = cable?.poleIds[index], b = cable?.poleIds[index + 1];
  const { id: spanId, props: stored } = cable ? spanAt(cable, index) : { id: undefined, props: undefined };
  const distKey = a && b ? pairKey(a, b) : '';
  const [form, setForm] = useState<Form>(() => toForm(stored, connectionDistances[distKey] ?? ''));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  // phase / neutral material or section changed: R, X (and Rn) follow the company table
  // only while they hold its values or are empty; typed values are kept (Stage 7.12)
  const setPhase = (k: 'material' | 'section', v: string) => setForm((f) => {
    const next = { ...f, [k]: v };
    const t = followPhaseTable(f, next);
    return { ...next, r: t.r, x: t.x, source: !f.source.trim() && (t.r !== f.r || t.x !== f.x) && t.r ? DEFAULT_DATA_SOURCE : f.source };
  });
  const setNeutral = (k: 'neutralMaterial' | 'neutral', v: string) => setForm((f) => {
    const next = { ...f, [k]: v };
    const t = followNeutralTable(f, next);
    return { ...next, rn: t.rn, source: !f.source.trim() && t.rn !== f.rn && t.rn ? DEFAULT_DATA_SOURCE : f.source };
  });
  const useCompanyPhase = () => setForm((f) => { const t = phaseTableState(f).table; return t ? { ...f, r: String(t.r), x: String(t.x), source: f.source.trim() || DEFAULT_DATA_SOURCE } : f; });
  const useCompanyNeutral = () => setForm((f) => { const t = neutralTableState(f).table; return t ? { ...f, rn: String(t.r), source: f.source.trim() || DEFAULT_DATA_SOURCE } : f; });
  const lengthFlag = distanceFlags[distKey];
  const lengthEstimated = !!lengthFlag?.estimated;
  // an estimated length becomes a measured one only when it is changed or explicitly confirmed
  const [confirmMeasured, setConfirmMeasured] = useState(false);
  const name = useMemo(() => poleNamer(elements), [elements]);
  const backdropClose = useBackdropClose(onClose);

  // the span disappeared (undo, delete…): close
  useEffect(() => { if (!cable || !a || !b || !spanId) onClose(); }, [cable, a, b, spanId, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const draft = useMemo(() => (a && b ? fromForm(form, [a, b], stored) : null), [form, a, b, stored]);
  // live check of this span with the values in the form (nothing saved)
  const preview = useMemo(() => {
    if (!cable || !draft || !spanId) return null;
    const els = elements.map((e) => (e.id === cable.id ? withSpanProps(cable, spanId, draft.props) : e));
    const d = { ...connectionDistances };
    if (form.length.trim()) d[distKey] = form.length.trim(); else delete d[distKey];
    const flags = { ...distanceFlags };
    if (form.length.trim() !== (connectionDistances[distKey] ?? '') || confirmMeasured) delete flags[distKey];
    const r = computeVoltageDrop(els, d, effectiveSettings(electrical), flags);
    const circuit = r.circuits.find((c) => c.spans.some((s) => s.cableId === cable.id && s.index === index));
    return { span: r.bySpan.get(spanKey(cable.id, index)), circuit, settingsMissing: r.settingsMissing };
  }, [elements, connectionDistances, electrical, distanceFlags, confirmMeasured, cable, spanId, index, form, distKey, draft]);

  if (!cable || !a || !b || !spanId || !draft) return null;

  const prevSpan = index > 0 ? spanAt(cable, index - 1).props : undefined;
  const sections = form.material ? [...new Set([...companySections(form.material), ...tableSections(form.material)])].sort((p, q) => p - q) : [];
  const phaseTable = phaseTableState(form);
  const neutralTable = neutralTableState(form);
  const rxTyped = !phaseTable.matches && (form.r.trim() !== '' || form.x.trim() !== '');
  const rnTyped = !neutralTable.matches && form.rn.trim() !== '';
  // missing fields of this span can be filled with the defaults on request (Stage 7.13):
  // the form is filled, nothing is saved until «حفظ»; existing values are never changed
  const filledDraft = fillMissingSpanDefaults(hasElectrical(draft.props) ? draft.props : undefined, [a, b]);
  const fillFormDefaults = () => { if (filledDraft) setForm((f) => ({ ...toForm(filledDraft, f.length) })); };
  const lengthBad = form.length.trim() !== '' && !(isPlainDistance(form.length) && posOrUndef(form.length) !== undefined);
  const canSave = !draft.errors.length && !lengthBad;
  const parallelCables = elements.filter((e): e is CableElement => e.type === 'cable' && e.id !== cable.id && e.poleIds.some((p, i) => i < e.poleIds.length - 1 && pairKey(p, e.poleIds[i + 1]) === distKey)).length;

  const save = () => {
    if (!canSave) return;
    saveHistory();
    // review / inherited marks are cleared: the user has looked at the values and saved them.
    // A record without any electrical value is not kept (editing only the length leaves the cable as it was).
    const next = hasElectrical(draft.props) || draft.props.legacyV2 !== undefined ? draft.props : undefined;
    if (next || stored) updateElement(cable.id, withSpanProps(cable, spanId, next));
    const len = form.length.trim();
    if (len && (len !== connectionDistances[distKey] || (lengthEstimated && confirmMeasured))) updateConnectionDistance(distKey, len);
    saveHistory();
    onClose();
  };
  const clearProps = () => {
    saveHistory();
    updateElement(cable.id, withSpanProps(cable, spanId, undefined));
    saveHistory();
    onClose();
  };

  const s = preview?.span;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 sm:items-center" {...backdropClose}>
      <div dir="rtl" role="dialog" aria-label="خصائص المقطع" data-span={`${cable.id}#${index}`} className="w-full max-w-lg max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] overflow-y-auto rounded-t-[16px] sm:rounded-[16px] bg-white shadow-float pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-ios-separator bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: cable.strokeColor }} />
            <h2 className="truncate text-[17px] font-semibold text-ios-label">خصائص المقطع {name(a)} ← {name(b)}</h2>
          </div>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="ui-icon-btn !h-9 !w-9"><X size={20} /></button>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3">
          {stored?.inherited && <p className="rounded-ctl bg-ios-blue/[0.08] px-3 py-2 text-[13px] text-ios-label">{INHERITED_LABEL}</p>}
          {(stored?.review ?? []).map((r) => <p key={r} className="rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">⚠ {REVIEW_LABEL[r]}</p>)}
          {stored?.mergedFrom && (
            <div className="rounded-ctl border border-amber-200 px-3 py-2 text-[13px] text-amber-900" data-merged-from>
              <p className="font-medium">القيم الأصلية للمقاطع المدموجة (تُحذف هذه القائمة عند الحفظ):</p>
              <ol className="list-decimal pr-5">{stored.mergedFrom.map((m, i) => <li key={i}>{m ? spanSummary({ ...m, poles: ['', ''] }) + (m.xOhmPerKm !== undefined ? ` · X ${m.xOhmPerKm}` : '') + (m.dataSource ? ` · ${m.dataSource}` : '') : 'بدون خصائص'}</li>)}</ol>
            </div>
          )}

          <Field label="طول المقطع (م)" hint={parallelCables ? `مشترك مع ${parallelCables} كيبل على نفس العمودين` : 'رقم المسافة على الرسم'}>
            <input className="ui-field h-11" type="text" inputMode="decimal" value={form.length} onChange={(e) => set('length', e.target.value)} aria-label="طول المقطع" />
          </Field>
          {lengthEstimated && form.length.trim() === (connectionDistances[distKey] ?? '') && (
            <div className="rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900" data-length-estimated>
              ⚠ هذا الطول تقديري: نصف طول المقطع قبل إضافة العمود ({lengthFlag?.splitFrom?.value} م)، وليس قياسًا. أدخل الطول المقاس، أو أكّده:
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={confirmMeasured} onChange={(e) => setConfirmMeasured(e.target.checked)} aria-label="الطول مقاس فعليًا" />
                <span>الطول مقاس فعليًا</span>
              </label>
            </div>
          )}
          {!connectionDistances[distKey] && lengthFlag?.splitFrom && (
            <p className="rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">⚠ قُسم هذا المقطع من مقطع مسافته «{lengthFlag.splitFrom.value}» (ليست رقمًا)، فلم يُقدَّر طوله — أدخله.</p>
          )}

          <Field label="نظام التغذية" group>
            <div className="ui-segment self-start" role="radiogroup" aria-label="نظام التغذية">
              {([['3ph4w', '3 أطوار + N (400/230 V)'], ['1ph2w', 'طور + N (230 V)']] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={form.system === v} className={`ui-segment-item ${form.system === v ? 'is-active' : ''}`} onClick={() => set('system', form.system === v ? '' : v)}>{l}</button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="نوع الكيبل">
              <select className="ui-field h-11" value={form.cableKind} onChange={(e) => set('cableKind', e.target.value as Form['cableKind'])} aria-label="نوع الكيبل">
                <option value="">—</option>
                {(Object.keys(CABLE_KIND_LABEL) as CableKind[]).map((k) => <option key={k} value={k}>{CABLE_KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="مادة الموصل">
              <select className="ui-field h-11" value={form.material} onChange={(e) => setPhase('material', e.target.value)} aria-label="مادة الموصل">
                <option value="">—</option>
                <option value="al">ألمنيوم</option>
                <option value="cu">نحاس</option>
              </select>
            </Field>
            <Field label="مقطع الطور (mm²)">
              <input className="ui-field h-11" type="text" inputMode="decimal" list="vd-sections" value={form.section} onChange={(e) => setPhase('section', e.target.value)} aria-label="مقطع الطور" />
            </Field>
            <Field label="مقطع المحايد (mm²)">
              <input className="ui-field h-11" type="text" inputMode="decimal" list="vd-sections" value={form.neutral} onChange={(e) => setNeutral('neutral', e.target.value)} aria-label="مقطع المحايد" />
            </Field>
            <Field label="مادة المحايد" hint="لا تُفترض مثل الطور">
              <select className="ui-field h-11" value={form.neutralMaterial} onChange={(e) => setNeutral('neutralMaterial', e.target.value)} aria-label="مادة المحايد">
                <option value="">—</option>
                <option value="al">ألمنيوم</option>
                <option value="cu">نحاس</option>
                <option value="alloy">سبيكة ألمنيوم (حامل ABC)</option>
              </select>
            </Field>
            <datalist id="vd-sections">{sections.map((v) => <option key={v} value={v} />)}</datalist>
            <Field label="الموصلات المتوازية" hint="لكل طور">
              <input className="ui-field h-11" type="text" inputMode="numeric" placeholder="1" value={form.parallel} onChange={(e) => set('parallel', e.target.value)} aria-label="الموصلات المتوازية" />
            </Field>
            <Field label="X (Ω/km)" hint="من بيانات الكيبل">
              <input className="ui-field h-11" type="text" inputMode="decimal" value={form.x} onChange={(e) => set('x', e.target.value)} aria-label="المفاعلة X" />
            </Field>
            <Field label="R طور (Ω/km)" hint="اختياري، يحل محل الجدول">
              <input className="ui-field h-11" type="text" inputMode="decimal" value={form.r} onChange={(e) => set('r', e.target.value)} aria-label="مقاومة الطور R" />
            </Field>
            <Field label="Rn محايد (Ω/km)" hint="اختياري">
              <input className="ui-field h-11" type="text" inputMode="decimal" value={form.rn} onChange={(e) => set('rn', e.target.value)} aria-label="مقاومة المحايد Rn" />
            </Field>
          </div>
          {/* how R / X / Rn relate to the company table for the chosen material and section (Stage 7.12) */}
          <div className="flex flex-col gap-1 rounded-ctl bg-ios-fill px-3 py-2 text-[13px] text-ios-label" data-company-table>
            {phaseTable.table ? (
              <p data-company-phase={phaseTable.matches ? 'table' : rxTyped ? 'typed' : 'empty'}>
                {COMPANY_TABLE_SOURCE} ({form.material === 'cu' ? 'Cu' : 'Al'} {form.section} mm²): R {phaseTable.table.r} · X {phaseTable.table.x} Ω/km —{' '}
                {phaseTable.matches ? '✓ R و X منه' : rxTyped ? 'R / X الحالية مُدخلة يدويًا ولم تُستبدل' : 'غير مستعملة'}
                {!phaseTable.matches && <button type="button" className="ui-tinted-btn !mr-2 !inline-flex !w-auto !min-h-[30px] !px-3" onClick={useCompanyPhase}>استخدام قيم جدول الشركة</button>}
              </p>
            ) : (
              form.material && form.section.trim() && <p data-company-phase="none">المقطع {form.section} mm² غير موجود في {COMPANY_TABLE_SOURCE}: أدخل R و X من مصدر موثق{form.r.trim() ? '' : ' (بدون R تُؤخذ المقاومة من IEC 60228 إن انطبق)'}.</p>
            )}
            {neutralTable.table ? (
              <p data-company-neutral={neutralTable.matches ? 'table' : rnTyped ? 'typed' : 'empty'}>
                المحايد ({form.neutralMaterial === 'cu' ? 'Cu' : 'Al'} {form.neutral} mm²): Rn {neutralTable.table.r} Ω/km من {COMPANY_TABLE_SOURCE} —{' '}
                {neutralTable.matches ? '✓ مستعملة' : rnTyped ? 'Rn الحالية مُدخلة يدويًا ولم تُستبدل' : 'غير مستعملة'}
                {!neutralTable.matches && <button type="button" className="ui-tinted-btn !mr-2 !inline-flex !w-auto !min-h-[30px] !px-3" onClick={useCompanyNeutral}>استخدام Rn من الجدول</button>}
              </p>
            ) : (
              form.neutral.trim() && form.neutralMaterial && <p data-company-neutral="none">المحايد {form.neutralMaterial === 'alloy' ? 'من سبيكة ألمنيوم' : `${form.neutral} mm²`} غير موجود في {COMPANY_TABLE_SOURCE}: أدخل Rn من كتالوج الكيبل.</p>
            )}
          </div>
          <Field label="مصدر البيانات" hint="كتالوج / تقرير / قياس">
            <input className="ui-field h-11" type="text" value={form.source} onChange={(e) => set('source', e.target.value)} aria-label="مصدر البيانات" />
          </Field>
          <p className="text-[12px] text-ios-tertiary">عند تغيير المادة أو المقطع تتبع R و X (و Rn للمحايد) {COMPANY_TABLE_SOURCE} ما دامت قيمه أو فارغة؛ القيمة المُدخلة يدويًا لا تُستبدل إلا بزر «استخدام قيم جدول الشركة». بدون R تُؤخذ المقاومة من {CONDUCTOR_TABLE_SOURCE} مصححة لحرارة التشغيل — للكوابل المعزولة فقط (ABC أو أرضي)، ولموصلات الألمنيوم أو النحاس العادي. الموصلات العارية والمحايد من سبيكة: أدخل R / Rn من مصدر موثق. المفاعلة لا تُستنتج من المقطع، واذكر مصدر كل قيمة تُدخلها.</p>

          {/* live check */}
          <div className="rounded-ctl border border-ios-separator px-3 py-2 text-[13px]" aria-live="polite" data-span-check>
            {draft.errors.length > 0 && <p className="text-ios-red">قيم غير صالحة: {draft.errors.join('، ')}</p>}
            {lengthBad && <p className="text-ios-red">الطول غير صالح</p>}
            {preview?.circuit && preview.circuit.status !== 'ok' && <p className="text-amber-900">⚠ الشبكة غير قابلة للحساب (راجع لوحة هبوط الفولتية)</p>}
            {s && s.missing.length === 0 && preview?.settingsMissing.length === 0 && s.computable && (
              <p className="text-ios-label">✓ البيانات مكتملة: هبوط هذا المقطع {fmt(s.dropV, 2)} V عند تيار طور {fmt(s.phaseCurrentA, 1)} A{s.cumulativeDropV !== undefined ? ` — التراكمي عند نهايته ${fmt(s.cumulativeDropV, 2)} V` : ''}</p>
            )}
            {s && s.computable && s.provisional.length > 0 && (
              <ul className="list-disc pr-5 text-amber-900" data-span-provisional>{s.provisional.map((r) => <li key={r}>تقديري: {PROVISIONAL_LABEL[r]}</li>)}</ul>
            )}
            {s && s.missing.length > 0 && (
              <div>
                <p className="font-medium text-ios-label">البيانات الناقصة للحساب:</p>
                <ul className="list-disc pr-5 text-ios-secondary">{s.missing.map((m) => <li key={m}>{MISSING_LABEL[m]}</li>)}</ul>
              </div>
            )}
            {preview && preview.settingsMissing.length > 0 && (
              <ul className="list-disc pr-5 text-ios-secondary">{preview.settingsMissing.map((m) => <li key={m}>{SETTING_MISSING_LABEL[m]}</li>)}</ul>
            )}
            {!s && <p className="text-ios-secondary">هذا المقطع ليس ضمن شبكة متصلة.</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {filledDraft && draft.props.legacyV2 === undefined && (
              <button type="button" className="ui-tinted-btn !w-auto" onClick={fillFormDefaults} data-fill-defaults>تعبئة الحقول الناقصة بالقيم الافتراضية</button>
            )}
            {prevSpan && (
              <button type="button" className="ui-tinted-btn !w-auto" onClick={() => setForm((f) => ({ ...toForm(prevSpan, f.length) }))}>نسخ من المقطع السابق</button>
            )}
            {stored && <button type="button" className="ui-tinted-btn !w-auto !bg-ios-fill !text-ios-red" onClick={clearProps}>مسح الخصائص</button>}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" className="min-h-[44px] rounded-ctl bg-ios-fill text-[17px] text-ios-blue active:bg-ios-fill-strong" onClick={onClose}>إلغاء</button>
            <button type="button" disabled={!canSave} className="min-h-[44px] rounded-ctl bg-ios-blue text-[17px] font-semibold text-white active:bg-ios-blue-pressed disabled:opacity-40" onClick={save}>حفظ</button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** One-line summary of a span's properties, e.g. "Al 95 mm² ×2 · 3φ+N". */
export const spanSummary = (p: SpanProps | undefined): string => {
  if (!p) return 'بدون خصائص كهربائية';
  const parts: string[] = [];
  if (p.material || p.crossSectionMm2) parts.push(`${p.material === 'cu' ? 'Cu' : p.material === 'al' ? 'Al' : ''} ${p.crossSectionMm2 ?? '?'} mm²`.trim());
  if (p.parallel && p.parallel > 1) parts.push(`×${p.parallel}`);
  if (p.system) parts.push(p.system === '3ph4w' ? '3φ+N' : '1φ+N');
  if (p.rOhmPerKm) parts.push(`R ${p.rOhmPerKm}`);
  return parts.length ? parts.join(' · ') : 'خصائص غير مكتملة';
};

/** Small hint shown while drawing: the span just added and its (suggested) properties. At the top of
 *  the canvas, and only its two buttons take taps, so it does not get in the way of tapping poles. */
export const DrawnSpanHint: React.FC<{ elements: DrawingElement[]; span: { cableId: string; index: number }; onEdit: () => void; onDismiss: () => void }> = ({ elements, span, onEdit, onDismiss }) => {
  const cable = elements.find((e) => e.id === span.cableId && e.type === 'cable') as CableElement | undefined;
  if (!cable || span.index >= cable.poleIds.length - 1) return null;
  const { props } = spanAt(cable, span.index);
  return (
    <div dir="rtl" role="status" aria-label="المقطع الجديد" data-drawn-span className="ui-float pointer-events-none absolute left-1/2 top-2 z-30 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-2 whitespace-nowrap px-3 py-1 text-[13px] opacity-95">
      <span className="h-3 w-3 flex-shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: cable.strokeColor }} />
      <span className="min-w-0 truncate text-ios-label">
        المقطع الجديد: {spanSummary(props)}{props?.inherited ? ' (منسوخة من السابق)' : ''}
      </span>
      <button type="button" onClick={onEdit} className="ui-tinted-btn pointer-events-auto !w-auto !min-h-[30px] flex-shrink-0 !px-3">{props ? 'تعديل' : 'إدخال الخصائص'}</button>
      <button type="button" aria-label="إخفاء" onClick={onDismiss} className="pointer-events-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-ios-secondary active:bg-ios-fill"><X size={16} /></button>
    </div>
  );
};

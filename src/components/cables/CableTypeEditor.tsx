import React, { useMemo, useState } from 'react';
import type { CableConstruction, CableTypeData, CableTypeRevision, ElectricalProperty, VerificationStatus } from '../../types/cableType';
import { CableLibraryError } from '../../utils/cableLibraryStorage';
import type { CableLibraryController } from '../../store/cableLibraryStore';
import {
  cableFormFrom, emptyCableForm, formCompleteness, planEdit, readCableForm, RESISTANCE, RESISTANCE_BASES,
  type CableForm, type FormError, type ValueForm,
} from '../../utils/cableTypeForm';
import { compareRevisions, CONSTRUCTIONS, VERIFICATION_STATUSES } from '../../utils/cableLibraryView';
import { cableKindLabel, type Tr } from '../../utils/vdLabels';
import { CableLibraryHeader, type ViewCtx } from './CableTypeViews';

// Stage C3: adding and editing a cable type. Every write goes through the library (cableLibraryStore →
// cableLibraryStorage): a new type is revision 1; an edit is a new revision on the revision it was made
// from (expectedRevision), so a newer one is never written over; nothing is ever deleted.

const SYMBOL: Record<ElectricalProperty, string> = { r: 'R', x: 'X', rn: 'Rn', xn: 'Xn' };
const PROPS: readonly ElectricalProperty[] = ['r', 'x', 'rn', 'xn'];

export type SaveOutcome =
  | { ok: true; id: string; revision: number }
  | { ok: false; kind: 'conflict'; savedRevision?: number }
  | { ok: false; kind: 'failed'; savedRevision?: number; failed: string[] };

/**
 * A save, through the library only. Create → revision 1. Edit → one revision for the data (if it
 * changed), then one per verification the person changed; each on the revision before it.
 */
export const saveCableForm = async (
  controller: CableLibraryController, prev: CableTypeRevision | undefined, data: CableTypeData, note: string,
): Promise<SaveOutcome> => {
  const meta = note.trim() ? { note: note.trim() } : {};
  if (!prev) {
    try { const r = await controller.create(data, meta); return { ok: true, id: r.id, revision: r.revision }; }
    catch { return { ok: false, kind: 'failed', failed: ['create'] }; }
  }
  const plan = planEdit(prev, data);
  let revision = prev.revision;
  let saved: number | undefined;
  const steps: { label: string; run: (expected: number) => Promise<{ revision: CableTypeRevision }> }[] = [
    ...(plan.edit ? [{ label: 'data', run: (e: number) => controller.edit(prev.id, e, plan.edit!, meta) }] : []),
    ...plan.verify.map((v) => ({ label: SYMBOL[v.property], run: (e: number) => controller.setVerification(prev.id, e, v.property, v.verification, meta) })),
  ];
  for (let i = 0; i < steps.length; i++) {
    try {
      const r = await steps[i].run(revision);
      revision = r.revision.revision;
      saved = revision;
    } catch (e) {
      if (e instanceof CableLibraryError && e.kind === 'conflict') return { ok: false, kind: 'conflict', ...(saved ? { savedRevision: saved } : {}) };
      return { ok: false, kind: 'failed', ...(saved ? { savedRevision: saved } : {}), failed: steps.slice(i).map((s) => s.label) };
    }
  }
  return { ok: true, id: prev.id, revision };
};

// ---------- fields ----------

const Field: React.FC<{ label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode; k: string }> = ({ label, hint, error, required, children, k }) => (
  <label className="flex min-w-0 flex-col gap-1" data-ce-field={k} {...(error ? { 'data-ce-invalid': true } : {})}>
    <span className="text-[13px] font-medium text-ios-secondary">{label}{required && <span className="text-ios-red" aria-hidden> *</span>}</span>
    {children}
    {hint && !error && <span className="text-[12px] text-ios-tertiary">{hint}</span>}
    {error && <span className="text-[12px] text-ios-red" role="alert" data-ce-error={k}>{error}</span>}
  </label>
);
/** a number with its unit beside it (the unit stays left-to-right) */
const UnitInput: React.FC<{ value: string; onChange: (v: string) => void; unit: string; k: string; label: string; invalid?: boolean }> = ({ value, onChange, unit, k, label, invalid }) => (
  <div className="flex items-center gap-2">
    <input className="ui-field h-11 min-w-0 flex-1" type="text" inputMode="decimal" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} aria-invalid={invalid || undefined} data-ce-input={k} />
    <bdi dir="ltr" className="shrink-0 whitespace-nowrap text-[13px] text-ios-secondary">{unit}</bdi>
  </div>
);
const Section: React.FC<{ title: string; children: React.ReactNode; k: string }> = ({ title, children, k }) => (
  <section className="flex flex-col gap-3 rounded-ctl border border-ios-separator px-3 py-3" data-ce-section={k}>
    <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ios-secondary">{title}</h3>
    {children}
  </section>
);

const errText = (errors: FormError[], field: string, tr: Tr) => {
  const e = errors.find((x) => x.field === field);
  return e ? tr(`cableLibrary.editor.errors.${e.code}`) : undefined;
};

// ---------- the editor ----------

export interface EditorProps {
  /** undefined: a new cable type; else the current revision being edited */
  prev?: CableTypeRevision;
  controller: CableLibraryController;
  ctx: ViewCtx;
  onCancel: () => void;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** after a conflict: read the library again and show the current revision */
  onReloadLatest: (id: string) => void;
  /** start values (tests) */
  initial?: CableForm;
}

export const CableTypeEditor: React.FC<EditorProps> = ({ prev, controller, ctx, onCancel, onClose, onSaved, onReloadLatest, initial }) => {
  const { tr } = ctx;
  const [form, setForm] = useState<CableForm>(() => initial ?? (prev ? cableFormFrom(prev) : emptyCableForm()));
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | undefined>();
  const read = useMemo(() => readCableForm(form), [form]);
  const errors = tried ? read.errors : [];
  const plan = useMemo(() => (prev && read.data ? planEdit(prev, read.data) : undefined), [prev, read.data]);
  const set = <K extends keyof CableForm>(k: K, v: CableForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setValue = (p: ElectricalProperty, patch: Partial<ValueForm>) => setForm((f) => ({ ...f, [p]: { ...f[p], ...patch } }));
  const neutralCount = Number(form.neutralConductors.trim().replace(',', '.'));
  const hasNeutral = form.neutralConductors.trim() !== '' && Number.isFinite(neutralCount) && neutralCount > 0;
  const changedValue = (p: ElectricalProperty) => !!plan?.reset.includes(p);

  const review = () => { setTried(true); setOutcome(undefined); if (!read.errors.length) setConfirming(true); };
  const save = async () => {
    if (!read.data) return;
    setSaving(true);
    const out = await saveCableForm(controller, prev, read.data, form.note);
    setSaving(false);
    setOutcome(out);
    if (out.ok) onSaved(out.id);
  };

  const select = (k: string, label: string, value: string, options: [string, string][], onPick: (v: string) => void, required?: boolean) => (
    <Field label={label} k={k} error={errText(errors, k, tr)} required={required}>
      <select className="ui-field h-11" value={value} onChange={(e) => onPick(e.target.value)} aria-label={label} aria-invalid={!!errText(errors, k, tr) || undefined} data-ce-input={k}>
        <option value="">{tr('cableLibrary.editor.choose')}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
  const text = (k: string, label: string, value: string, onChange: (v: string) => void, o: { hint?: string; required?: boolean; numeric?: boolean } = {}) => (
    <Field label={label} k={k} hint={o.hint} error={errText(errors, k, tr)} required={o.required}>
      <input className="ui-field h-11" type="text" {...(o.numeric ? { inputMode: 'numeric' as const, dir: 'ltr' } : {})} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} aria-invalid={!!errText(errors, k, tr) || undefined} data-ce-input={k} />
    </Field>
  );
  const sourceFields = (prefix: string, v: { name: string; reference: string; page: string; table: string }, on: (k: 'name' | 'reference' | 'page' | 'table', s: string) => void) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {text(`${prefix}.name`, tr('cableLibrary.editor.sourceName'), v.name, (s) => on('name', s))}
      {text(`${prefix}.reference`, tr('cableLibrary.editor.sourceReference'), v.reference, (s) => on('reference', s))}
      {text(`${prefix}.page`, tr('cableLibrary.editor.sourcePage'), v.page, (s) => on('page', s))}
      {text(`${prefix}.table`, tr('cableLibrary.editor.sourceTable'), v.table, (s) => on('table', s))}
    </div>
  );

  const valueSection = (p: ElectricalProperty) => {
    const v = form[p];
    const res = RESISTANCE.has(p);
    const neutralProp = p === 'rn' || p === 'xn';
    return (
      <Section key={p} title={tr('cableLibrary.editor.valueTitle', { p: SYMBOL[p] })} k={p}>
        {neutralProp && !hasNeutral && <p className="text-[12px] text-ios-secondary" data-ce-no-neutral={p}>{tr('cableLibrary.editor.noNeutralHint')}</p>}
        <Field label={tr('cableLibrary.editor.value')} k={`${p}.value`} hint={p === 'x' ? tr('cableLibrary.editor.xZeroHint') : tr('cableLibrary.editor.emptyHint')} error={errText(errors, `${p}.value`, tr)}>
          <UnitInput value={v.value} onChange={(s) => setValue(p, { value: s })} unit="Ω/km" k={`${p}.value`} label={`${SYMBOL[p]} — ${tr('cableLibrary.editor.value')}`} invalid={!!errText(errors, `${p}.value`, tr)} />
        </Field>
        {changedValue(p) && <p className="rounded-ctl bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900" data-ce-reset={p}>{tr('cableLibrary.editor.changedReset')}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {res
            ? (
              <Field label={tr('cableLibrary.editor.basis')} k={`${p}.basis`}>
                <select className="ui-field h-11" value={v.basis} onChange={(e) => setValue(p, { basis: e.target.value as ValueForm['basis'] })} aria-label={`${SYMBOL[p]} — ${tr('cableLibrary.editor.basis')}`} data-ce-input={`${p}.basis`}>
                  {RESISTANCE_BASES.map((b) => <option key={b} value={b}>{tr(`cableLibrary.basis.${b}`)}</option>)}
                </select>
              </Field>
            )
            : <Field label={tr('cableLibrary.editor.basis')} k={`${p}.basis`}><span className="text-[14px] text-ios-label" data-ce-fixed-basis={p}>{tr('cableLibrary.editor.reactanceBasis')}</span></Field>}
          {res && (
            <Field label={tr('cableLibrary.editor.referenceTemp')} k={`${p}.referenceTempC`} hint={tr('cableLibrary.editor.referenceTempHint')} error={errText(errors, `${p}.referenceTempC`, tr)}>
              <UnitInput value={v.referenceTempC} onChange={(s) => setValue(p, { referenceTempC: s })} unit="°C" k={`${p}.referenceTempC`} label={`${SYMBOL[p]} — ${tr('cableLibrary.editor.referenceTemp')}`} invalid={!!errText(errors, `${p}.referenceTempC`, tr)} />
            </Field>
          )}
        </div>
        {v.conversion && <p className="text-[12px] text-amber-900" data-ce-conversion={p}>{tr('cableLibrary.editor.conversionKept')}</p>}
        <label className="flex min-h-[36px] items-center gap-2 text-[14px] text-ios-label">
          <input type="checkbox" checked={v.ownSource} onChange={(e) => setValue(p, { ownSource: e.target.checked })} data-ce-input={`${p}.ownSource`} />
          {tr('cableLibrary.editor.ownSource')}
        </label>
        {v.ownSource && sourceFields(`${p}.source`, { name: v.sourceName, reference: v.sourceReference, page: v.sourcePage, table: v.sourceTable },
          (k, s) => setValue(p, { [k === 'name' ? 'sourceName' : k === 'reference' ? 'sourceReference' : k === 'page' ? 'sourcePage' : 'sourceTable']: s }))}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={tr('cableLibrary.editor.status')} k={`${p}.status`} hint={tr('cableLibrary.editor.statusHint')} error={errText(errors, `${p}.status`, tr)}>
            <select className="ui-field h-11" value={v.status} onChange={(e) => setValue(p, { status: e.target.value as VerificationStatus })} aria-label={`${SYMBOL[p]} — ${tr('cableLibrary.editor.status')}`} aria-invalid={!!errText(errors, `${p}.status`, tr) || undefined} data-ce-input={`${p}.status`}>
              {VERIFICATION_STATUSES.map((s) => <option key={s} value={s}>{tr(`cableLibrary.verificationStatus.${s}`)}</option>)}
            </select>
          </Field>
          {text(`${p}.verifiedBy`, tr('cableLibrary.editor.verifiedBy'), v.verifiedBy, (s) => setValue(p, { verifiedBy: s }))}
          {text(`${p}.verifiedOn`, tr('cableLibrary.editor.verifiedOn'), v.verifiedOn, (s) => setValue(p, { verifiedOn: s }))}
        </div>
      </Section>
    );
  };

  const completeness = read.data ? formCompleteness(read.data) : undefined;
  const changeRows = prev && read.data ? compareRevisions(prev, read.data).filter((r) => r.status !== 'unchanged' && !r.field.endsWith('.verification')) : [];
  const fieldName = (f: string) => (f in SYMBOL ? SYMBOL[f as ElectricalProperty] : tr(`cableLibrary.field.${({ 'phase.material': 'phaseMaterial', 'phase.sectionMm2': 'phaseSection', 'neutral.material': 'neutralMaterial', 'neutral.sectionMm2': 'neutralSection' } as Record<string, string>)[f] ?? f}` as never));
  const nothing = !!prev && plan?.revisions === 0;
  type Failure = Extract<SaveOutcome, { ok: false }>;
  const failure: Failure | undefined = outcome && outcome.ok === false ? (outcome as Failure) : undefined;
  const conflict = failure?.kind === 'conflict' ? failure : undefined;
  const failed = failure && failure.kind === 'failed' ? (failure as Extract<Failure, { kind: 'failed' }>) : undefined;

  return (
    <div data-cl-view={prev ? 'edit' : 'create'} {...(prev ? { 'data-ce-type': prev.id, 'data-ce-expected': prev.revision } : {})}>
      <CableLibraryHeader title={tr(prev ? 'cableLibrary.edit' : 'cableLibrary.add')} sub={prev ? `\u2068${prev.name}\u2069 · \u2068${tr('cableLibrary.view.revision', { n: prev.revision })}\u2069` : undefined} ctx={ctx} onBack={onCancel} onClose={onClose} />
      <div className="flex flex-col gap-3 px-3 py-3">
        <Section title={tr('cableLibrary.view.general')} k="general">
          {text('name', tr('cableLibrary.field.name'), form.name, (s) => set('name', s), { hint: tr('cableLibrary.editor.nameHint'), required: true })}
          <Field label={tr('cableLibrary.field.description')} k="description" hint={tr('cableLibrary.editor.descriptionHint')}>
            <textarea className="ui-field min-h-[64px] py-2" value={form.description} onChange={(e) => set('description', e.target.value)} aria-label={tr('cableLibrary.field.description')} data-ce-input="description" />
          </Field>
          {select('construction', tr('cableLibrary.field.construction'), form.construction, CONSTRUCTIONS.map((c) => [c, cableKindLabel(c as CableConstruction, tr)]), (v) => set('construction', v as CableForm['construction']), true)}
        </Section>
        <Section title={tr('cableLibrary.editor.conductors')} k="conductors">
          <div className="grid grid-cols-2 gap-3">
            {text('phaseConductors', tr('cableLibrary.field.phaseConductors'), form.phaseConductors, (s) => set('phaseConductors', s), { required: true, numeric: true })}
            {text('neutralConductors', tr('cableLibrary.field.neutralConductors'), form.neutralConductors, (s) => set('neutralConductors', s), { required: true, numeric: true })}
            {select('phaseMaterial', tr('cableLibrary.field.phaseMaterial'), form.phaseMaterial, [['al', tr('span.aluminium')], ['cu', tr('span.copper')]], (v) => set('phaseMaterial', v as CableForm['phaseMaterial']))}
            <Field label={tr('cableLibrary.field.phaseSection')} k="phaseSection" error={errText(errors, 'phaseSection', tr)}>
              <UnitInput value={form.phaseSection} onChange={(s) => set('phaseSection', s)} unit="mm²" k="phaseSection" label={tr('cableLibrary.field.phaseSection')} invalid={!!errText(errors, 'phaseSection', tr)} />
            </Field>
            {hasNeutral && <div className="col-span-2">{select('neutralMaterial', tr('cableLibrary.field.neutralMaterial'), form.neutralMaterial, [['al', tr('span.aluminium')], ['cu', tr('span.copper')], ['alloy', tr('span.alloy')]], (v) => set('neutralMaterial', v as CableForm['neutralMaterial']))}</div>}
            {hasNeutral && (
              <Field label={tr('cableLibrary.field.neutralSection')} k="neutralSection" error={errText(errors, 'neutralSection', tr)}>
                <UnitInput value={form.neutralSection} onChange={(s) => set('neutralSection', s)} unit="mm²" k="neutralSection" label={tr('cableLibrary.field.neutralSection')} invalid={!!errText(errors, 'neutralSection', tr)} />
              </Field>
            )}
          </div>
        </Section>
        <Section title={tr('cableLibrary.editor.typeSource')} k="source">
          <p className="text-[12px] text-ios-tertiary">{tr('cableLibrary.editor.typeSourceHint')}</p>
          {sourceFields('source', { name: form.sourceName, reference: form.sourceReference, page: form.sourcePage, table: form.sourceTable },
            (k, s) => set(k === 'name' ? 'sourceName' : k === 'reference' ? 'sourceReference' : k === 'page' ? 'sourcePage' : 'sourceTable', s))}
        </Section>
        {PROPS.map(valueSection)}
        <Section title={tr('cableLibrary.editor.note')} k="note">
          <textarea className="ui-field min-h-[56px] py-2" value={form.note} onChange={(e) => set('note', e.target.value)} aria-label={tr('cableLibrary.editor.note')} data-ce-input="note" />
        </Section>

        {/* the footer: errors, the confirmation, the result */}
        <div className="sticky bottom-0 -mx-3 flex flex-col gap-2 border-t border-ios-separator bg-white px-3 pb-3 pt-2" data-ce-footer>
          {errors.length > 0 && (
            <div className="rounded-ctl bg-red-50 px-3 py-2 text-[13px] text-ios-red" role="alert" data-ce-errors={errors.length}>
              <p className="font-medium">{tr('cableLibrary.editor.errorsTitle')}</p>
              <ul className="list-disc ps-5">{errors.map((e) => <li key={e.field}>{fieldLabel(e.field, tr)}: {tr(`cableLibrary.editor.errors.${e.code}`)}</li>)}</ul>
            </div>
          )}
          {conflict && (
            <div className="flex flex-col items-start gap-2 rounded-ctl bg-amber-50 px-3 py-2 text-[13px] text-amber-900" role="alert" data-ce-conflict>
              <p>{tr('cableLibrary.editor.conflict')}</p>
              {conflict.savedRevision && <p>{tr('cableLibrary.editor.partial', { n: conflict.savedRevision, list: '—' })}</p>}
              <button type="button" className="ui-tinted-btn !w-auto" data-ce-action="reload-latest" onClick={() => onReloadLatest(prev!.id)}>{tr('cableLibrary.editor.reloadLatest')}</button>
            </div>
          )}
          {failed && (
            <div className="rounded-ctl bg-red-50 px-3 py-2 text-[13px] text-ios-red" role="alert" data-ce-failed>
              <p>{tr('cableLibrary.saveFailed')}</p>
              {failed.savedRevision && <p>{tr('cableLibrary.editor.partial', { n: failed.savedRevision, list: failed.failed.join(tr('common.listSep')) })}</p>}
            </div>
          )}
          {confirming && read.data && !conflict ? (
            <div className="flex flex-col gap-2 rounded-ctl border border-ios-separator px-3 py-2 text-[13px]" data-ce-confirm>
              <p className="text-[15px] font-semibold text-ios-label">{tr('cableLibrary.editor.confirmTitle')}</p>
              {!prev && <p data-ce-will-create>{tr('cableLibrary.editor.willCreate')}</p>}
              {prev && (nothing ? <p data-ce-nothing>{tr('cableLibrary.editor.noChange')}</p> : <p data-ce-revisions={plan!.revisions}>{tr('cableLibrary.editor.willRevisions', { n: plan!.revisions })}</p>)}
              {changeRows.length > 0 && <p data-ce-changes>{tr('cableLibrary.view.changed', { list: changeRows.map((r) => fieldName(r.field)).join(tr('common.listSep')) })}</p>}
              {plan && plan.reset.length > 0 && <p className="text-amber-900" data-ce-reset-list>{tr('cableLibrary.editor.resetList', { list: plan.reset.map((p) => SYMBOL[p]).join(tr('common.listSep')) })}</p>}
              {plan && plan.verify.length > 0 && <p data-ce-verify-list>{tr('cableLibrary.editor.verifyList', { list: plan.verify.map((v) => `${SYMBOL[v.property]} → ${tr(`cableLibrary.verificationStatus.${v.verification.status}`)}`).join(tr('common.listSep')) })}</p>}
              {completeness && (completeness.complete
                ? <p data-ce-complete>{tr('cableLibrary.editor.complete')}</p>
                : <p className="text-amber-900" data-ce-draft>{tr('cableLibrary.editor.draft', { list: completeness.missing.map((m) => tr(`cableLibrary.editor.missing.${m}`)).join(tr('common.listSep')) })}</p>)}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button type="button" className="min-h-[44px] rounded-ctl bg-ios-fill text-[15px] text-ios-blue" data-ce-action="back" onClick={() => setConfirming(false)} disabled={saving}>{tr('cableLibrary.editor.back')}</button>
                <button type="button" className="min-h-[44px] rounded-ctl bg-ios-blue text-[15px] font-semibold text-white disabled:opacity-40" data-ce-action="save" onClick={() => void save()} disabled={saving || nothing}>{saving ? tr('cableLibrary.editor.saving') : tr('cableLibrary.editor.save')}</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-[44px] rounded-ctl bg-ios-fill text-[15px] text-ios-blue" data-ce-action="cancel" onClick={onCancel}>{tr('common.cancel')}</button>
              {/* after a conflict the edit cannot be saved on its old revision: reload first */}
              <button type="button" className="min-h-[44px] rounded-ctl bg-ios-blue text-[15px] font-semibold text-white disabled:opacity-40" data-ce-action="review" onClick={review} disabled={saving || !!conflict}>{tr('cableLibrary.editor.review')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** the name of a field in the error list */
const fieldLabel = (field: string, tr: Tr): string => {
  const [head, tail] = field.split('.');
  if (head in SYMBOL) {
    const what = tail === 'referenceTempC' ? tr('cableLibrary.editor.referenceTemp') : tail === 'status' ? tr('cableLibrary.editor.status') : tr('cableLibrary.editor.value');
    return `${SYMBOL[head as ElectricalProperty]} — ${what}`;
  }
  const map: Record<string, string> = { name: 'name', construction: 'construction', phaseConductors: 'phaseConductors', neutralConductors: 'neutralConductors', phaseSection: 'phaseSection', neutralSection: 'neutralSection' };
  return map[head] ? tr(`cableLibrary.field.${map[head]}` as never) : field;
};

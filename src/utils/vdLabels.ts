import type { CableKind, SpanReview } from '../types/drawing';
import type { MissingItem, PoleStatus, ProvisionalReason, SettingMissing } from './voltageDrop';
import type { CircuitStatus, NetworkIssue } from './network';
import { ar } from '../i18n/ar';
import { translate, type TKey, type TParams } from '../i18n';

// The wording of the voltage-drop data, statuses and warnings. The texts live in the dictionaries
// (i18n/ar.ts, i18n/en.ts, section `vd`); a translator `tr` picks the language. Without one, the
// Arabic text is used (as before), so code that is not translated yet reads the same.

/** a translator: the text of a key in one language */
export type Tr = (key: TKey, params?: TParams) => string;
export const AR_TR: Tr = (key, params) => translate('ar', key, params);

export const missingLabel = (m: MissingItem, tr: Tr = AR_TR) => tr(`vd.missingItem.${m}`);
export const provisionalLabel = (r: ProvisionalReason, tr: Tr = AR_TR) => tr(`vd.provisional.${r}`);
export const settingMissingLabel = (m: SettingMissing, tr: Tr = AR_TR) => tr(`vd.settingMissing.${m}`);
export const reviewLabel = (r: SpanReview, tr: Tr = AR_TR) => tr(`vd.review.${r}`);
export const cableKindLabel = (k: CableKind, tr: Tr = AR_TR) => tr(`vd.cableKind.${k}`);
export const poleStatusLabel = (s: PoleStatus, tr: Tr = AR_TR) => tr(`vd.status.${s}`);
export const circuitStatusLabel = (s: CircuitStatus, tr: Tr = AR_TR) => tr(`vd.circuitStatus.${s}`);
export const loadModelLabel = (m: keyof typeof ar.vd.loadModelName, tr: Tr = AR_TR) => tr(`vd.loadModelName.${m}`);
export const endLinkLabel = (k: keyof typeof ar.vd.endLink, tr: Tr = AR_TR) => tr(`vd.endLink.${k}`);
export const endLinkHint = (k: keyof typeof ar.vd.endLinkHint, tr: Tr = AR_TR) => tr(`vd.endLinkHint.${k}`);

// The Arabic tables, for the screens not translated yet. Typed by the data unions: a missing
// dictionary entry is a TypeScript error.
export const MISSING_LABEL: Record<MissingItem, string> = ar.vd.missingItem;
export const PROVISIONAL_LABEL: Record<ProvisionalReason, string> = ar.vd.provisional;
export const SETTING_MISSING_LABEL: Record<SettingMissing, string> = ar.vd.settingMissing;
export const REVIEW_LABEL: Record<SpanReview, string> = ar.vd.review;
export const CABLE_KIND_LABEL: Record<CableKind, string> = ar.vd.cableKind;
export const POLE_STATUS_LABEL: Record<PoleStatus, string> = ar.vd.status;
export const CIRCUIT_STATUS_LABEL: Record<CircuitStatus, string> = ar.vd.circuitStatus;
/** shown instead of the plain status when the value is provisional */
export const PROVISIONAL_STATUS = ar.vd.provisionalStatus;
export const DEFAULTS_REVIEW_SHORT = ar.vd.defaultsReviewShort;
export const INHERITED_LABEL = ar.vd.inheritedLabel;
export const END_LINK_LABEL = ar.vd.endLink;
export const END_LINK_HINT = ar.vd.endLinkHint;
/** the load model names (also used by the exported legend, which stays as it is) */
export const LOAD_MODEL_LABEL = { 'constant-current': 'تيار ثابت', 'constant-power': 'قدرة ثابتة' } as const;

export const PROVISIONAL_MARK = '≈';
/** status symbol shown next to the value (colour is never used for status) */
export const POLE_STATUS_MARK: Record<PoleStatus, string> = { ok: '✓', near: '⚠', over: '‼', na: '؟' };

export const issueText = (i: NetworkIssue, poleName: (id: string) => string, tr: Tr = AR_TR): string => {
  switch (i.kind) {
    case 'parallel-spans': return tr('vd.issue.parallel-spans', { a: poleName(i.poles[0]), b: poleName(i.poles[1]), n: i.cableIds.length });
    case 'loop': return tr('vd.issue.loop');
    case 'transformer-not-source': return tr('vd.issue.transformer-not-source', { pole: poleName(i.poleId) });
    case 'orphan-consumer': return tr('vd.issue.orphan-consumer', { pole: poleName(i.poleId) });
    case 'legacy-jumper': return tr('vd.issue.legacy-jumper');
    case 'missing-pole': return tr('vd.issue.missing-pole');
    case 'three-phase-on-single-phase': return tr('vd.issue.three-phase-on-single-phase');
    case 'passes-source-pole': return tr('vd.issue.passes-source-pole', { pole: poleName(i.poleId) });
    case 'same-colour-crossing': return tr('vd.issue.same-colour-crossing', { pole: poleName(i.poleId) });
    case 'ambiguous-junction': return tr('vd.issue.ambiguous-junction', { pole: poleName(i.poleId) });
    case 'isolated-end-jumpered': return tr('vd.issue.isolated-end-jumpered', { pole: poleName(i.poleId) });
    case 'connected-end-alone': return tr('vd.issue.connected-end-alone', { pole: poleName(i.poleId) });
    case 'invalid-load': return tr('vd.issue.invalid-load', { pole: poleName(i.poleId), label: i.label });
    case 'proposed-consumer-unconnected': return tr('vd.issue.proposed-consumer-unconnected', { pole: poleName(i.poleId) });
    case 'split-side-unassigned': return tr('vd.issue.split-side-unassigned', { pole: poleName(i.poleId) });
  }
};

export const fmt = (v: number | undefined, digits = 2) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));

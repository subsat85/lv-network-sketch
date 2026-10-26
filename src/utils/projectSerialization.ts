import { DistanceFlag, DrawingElement, DrawingStyle, ElectricalSettings } from '../types/drawing';
import { readDistanceFlags } from './distances';
import { isArcValid } from './cableArcs';
import { DEFAULT_ELECTRICAL, readElectricalSettings } from './electricalSettings';
import { prepareDocument, unplacedV2Records } from './projectMigration';
import { t } from '../store/localeStore';

export interface ProjectExportData {
  version: number;
  elements: DrawingElement[];
  style: DrawingStyle;
  poleSizeScale: number;
  distanceTextScale?: number;
  consumerSizeScale?: number;
  consumerVariant: 'circle' | 'square';
  connectionDistances: Record<string, string>;
  connectionLabelOffsets?: Record<string, { x: number, y: number }>;
  /** voltage-drop settings (Stage 7; absent in older files → defaults) */
  electrical?: ElectricalSettings;
  /** estimated / split markers of distances (Stage 7.8; absent → none) */
  distanceFlags?: Record<string, DistanceFlag>;
  metadata?: {
    id: string | null;
    name: string | null;
    exportedAt: number;
  };
}

export const serializeProject = (
  elements: DrawingElement[],
  style: DrawingStyle,
  poleSizeScale: number,
  consumerVariant: 'circle' | 'square',
  connectionDistances: Record<string, string>,
  connectionLabelOffsets: Record<string, { x: number, y: number }>,
  id: string | null,
  name: string | null,
  distanceTextScale?: number,
  consumerSizeScale?: number,
  electrical?: ElectricalSettings,
  distanceFlags?: Record<string, DistanceFlag>
): string => {
  // Create a deep copy of elements to ensure no reference to live state
  // JSON.parse(JSON.stringify()) is a simple way to deep copy for this data structure
  const elementsCopy = JSON.parse(JSON.stringify(elements));
  
  const data: ProjectExportData = {
    version: 1,
    elements: elementsCopy,
    style: { ...style },
    poleSizeScale,
    distanceTextScale,
    consumerSizeScale,
    consumerVariant,
    connectionDistances: { ...connectionDistances },
    connectionLabelOffsets: { ...connectionLabelOffsets },
    electrical: { ...(electrical ?? DEFAULT_ELECTRICAL) },
    distanceFlags: JSON.parse(JSON.stringify(distanceFlags ?? {})),
    metadata: {
      id,
      name,
      exportedAt: Date.now(),
    },
  };
  return JSON.stringify(data, null, 2);
};

// ---------------------------------------------------------------------------
// Import validation: the whole file is checked before anything is applied.
// Optional top-level fields that older exports may not have (version, style,
// scales, consumerVariant, distances, label offsets, metadata) get defaults;
// anything that is present must have the right shape. Elements must carry the
// fields the canvas needs to draw them, and cables / consumers must point to
// poles that exist in the file.
// ---------------------------------------------------------------------------

// Files are still written as version 1: Stage 7 only adds optional fields
// (cable.spanIds / cable.spanProps, symbol modifiers.vdSource, top-level
// `electrical`), which older readers of version 1 keep or ignore.
// Version 2 files from branch feature/vd are read and converted (projectMigration.ts).
export const PROJECT_FILE_VERSION = 1;
export const MAX_READABLE_VERSION = 2;
export const DEFAULT_STYLE: DrawingStyle = { strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
const SHAPE_TYPES = new Set(['rectangle', 'circle', 'triangle', 'arrow', 'compass', 'curved_arrow']);
const MAX_LISTED = 5;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isPoint = (p: unknown) => isObj(p) && isNum(p.x) && isNum(p.y);

const SPAN_NUM_FIELDS = ['crossSectionMm2', 'neutralCrossSectionMm2', 'parallel', 'rOhmPerKm', 'xOhmPerKm', 'rNeutralOhmPerKm'] as const;
const spanPropsProblem = (sp: unknown): string | null => {
  if (!isObj(sp)) return t('dialogs.file.notObject');
  if (sp.poles !== undefined && (!Array.isArray(sp.poles) || sp.poles.length !== 2 || !sp.poles.every(isStr))) return 'poles';
  for (const k of SPAN_NUM_FIELDS) if (sp[k] !== undefined && !(isNum(sp[k]) && (sp[k] as number) > 0)) return k;
  if (sp.material !== undefined && sp.material !== 'al' && sp.material !== 'cu') return 'material';
  if (sp.neutralMaterial !== undefined && !['al', 'cu', 'alloy'].includes(sp.neutralMaterial as string)) return 'neutralMaterial';
  if (sp.system !== undefined && sp.system !== '3ph4w' && sp.system !== '1ph2w') return 'system';
  if (sp.cableKind !== undefined && !['abc', 'bare', 'underground', 'other'].includes(sp.cableKind as string)) return 'cableKind';
  if (sp.dataSource !== undefined && !isStr(sp.dataSource)) return 'dataSource';
  if (sp.mergedFrom !== undefined && (!Array.isArray(sp.mergedFrom) || sp.mergedFrom.some((m) => m !== null && (!isObj(m) || spanPropsProblem({ ...m, poles: undefined }))))) return 'mergedFrom';
  return null;
};

export type ValidateProjectResult = { ok: true; data: ProjectExportData } | { ok: false; errors: string[] };

export const validateProjectFile = (raw: unknown): ValidateProjectResult => {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < MAX_LISTED) errors.push(m); else if (errors.length === MAX_LISTED) errors.push('…'); };

  if (!isObj(raw)) return { ok: false, errors: [t('dialogs.file.notProject')] };
  if (raw.version !== undefined && (!isNum(raw.version) || raw.version > MAX_READABLE_VERSION))
    return { ok: false, errors: [t('dialogs.file.version', { version: String(raw.version) })] };
  if (!Array.isArray(raw.elements)) return { ok: false, errors: [t('dialogs.file.noElements')] };

  const elements = raw.elements as unknown[];
  const byId = new Map<string, Record<string, unknown>>();
  elements.forEach((el, i) => {
    if (!isObj(el)) { err(t('dialogs.file.elementBroken', { n: i + 1 })); return; }
    const id = el.id;
    const label = isStr(id) && id ? `${String(el.type)} "${id}"` : t('dialogs.file.element', { n: i + 1 });
    if (!isStr(id) || !id) { err(t('dialogs.file.noId', { label })); return; }
    if (!isNum(el.x) || !isNum(el.y)) err(t('dialogs.file.badXY', { label }));
    switch (el.type) {
      case 'symbol':
        if (!isStr(el.symbolId) || !isNum(el.width) || !isNum(el.height)) err(t('dialogs.file.symbol', { label }));
        break;
      case 'cable':
        if (!Array.isArray(el.poleIds) || el.poleIds.some((p) => !isStr(p))) err(t('dialogs.file.poleIds', { label }));
        if (el.offset !== undefined && !isNum(el.offset)) err(t('dialogs.file.offset', { label }));
        if (el.spanIds !== undefined && (!Array.isArray(el.spanIds) || el.spanIds.some((p) => !isStr(p)))) err(t('dialogs.file.spanIds', { label }));
        if (el.spanProps !== undefined) {
          if (!isObj(el.spanProps)) err(t('dialogs.file.spanPropsAll', { label }));
          else for (const [sid, sp] of Object.entries(el.spanProps)) {
            const bad = spanPropsProblem(sp);
            if (bad) err(t('dialogs.file.spanProps', { label, sid, bad }));
          }
        }
        if (el.endLinks !== undefined) {
          const ok = (v: unknown) => v === undefined || v === 'connected' || v === 'isolated';
          if (!isObj(el.endLinks) || !ok(el.endLinks.start) || !ok(el.endLinks.end) || Object.keys(el.endLinks).some((k) => k !== 'start' && k !== 'end'))
            err(t('dialogs.file.endLinks', { label }));
        }
        // suggested split marks: pole ids (a pole that is not on the cable is shown nothing)
        if (el.suggestedSplits !== undefined && (!Array.isArray(el.suggestedSplits) || el.suggestedSplits.some((p) => !isStr(p))))
          err(t('dialogs.file.splits', { label }));
        // study split sides: { "poleId#occurrence": "prev" | "next" } (stale entries are dropped on the first edit)
        if (el.splitConsumerSides !== undefined && (!isObj(el.splitConsumerSides) || Object.entries(el.splitConsumerSides).some(([k, v]) => !/#\d+$/.test(k) || (v !== 'prev' && v !== 'next'))))
          err(t('dialogs.file.splitSides', { label }));
        break;
      case 'jumper':
        if (!isStr(el.fromPoleId) || !isStr(el.toPoleId)) err(t('dialogs.file.v2Link', { id: String(el.id) }));
        break;
      case 'consumer':
        if (!isStr(el.poleId)) err(t('dialogs.file.noPoleId', { label }));
        if (el.proposal !== undefined) {
          const pr = el.proposal, cn = isObj(pr) ? pr.connection : undefined, bo = isObj(pr) ? pr.boxOffset : undefined;
          const okConn = cn === undefined || (isObj(cn) && isStr(cn.cableId) && Number.isInteger(cn.occurrence) && (cn.occurrence as number) >= 0 && (cn.side === undefined || cn.side === 'prev' || cn.side === 'next'));
          const okBox = bo === undefined || (isObj(bo) && isNum(bo.x) && isNum(bo.y));
          if (!isObj(pr) || (pr.status !== 'proposed' && pr.status !== 'confirmed') || !okConn || !okBox) err(t('dialogs.file.proposal', { label }));
        }
        break;
      case 'path':
        if (!Array.isArray(el.points) || !el.points.every(isPoint)) err(t('dialogs.file.points', { label }));
        break;
      case 'text':
        if (!isStr(el.text)) err(t('dialogs.file.noText', { label }));
        break;
      case 'arc':
        if (![el.x2, el.y2, el.controlX, el.controlY].every(isNum)) err(t('dialogs.file.arc', { label }));
        break;
      case 'shape':
        if (!SHAPE_TYPES.has(el.shapeType as string) || !isNum(el.width) || !isNum(el.height)) err(t('dialogs.file.shape', { label }));
        break;
      case 'transformer_table':
        if (!isObj(el.transformerInfo)) err(t('dialogs.file.transformerInfo', { label }));
        break;
      case 'cable_arc': {
        const isEnd = (v: unknown) => isObj(v) && isStr(v.cableId) && (v.side === 'prev' || v.side === 'next') && Number.isInteger(v.occurrence) && (v.occurrence as number) >= 0;
        if (!isStr(el.poleId) || !isEnd(el.from) || !isEnd(el.to)) err(t('dialogs.file.jumper', { id: String(el.id) }));
        break;
      }
      default:
        err(t('dialogs.file.unknownType', { label }));
        return;
    }
    byId.set(id, el);
  });

  // references: every cable pole and every consumer's pole must be a pole in this file
  for (const el of byId.values()) {
    const refs = el.type === 'cable' && Array.isArray(el.poleIds) ? (el.poleIds as unknown[]) : el.type === 'consumer' ? [el.poleId] : el.type === 'jumper' ? [el.fromPoleId, el.toPoleId] : [];
    for (const ref of refs) {
      if (!isStr(ref)) continue;
      const target = byId.get(ref);
      const what = el.type === 'cable' ? t('dialogs.file.whatCable') : el.type === 'jumper' ? t('dialogs.file.whatV2Link') : t('dialogs.file.whatConsumer');
      if (!target) err(t('dialogs.file.refMissing', { what, id: String(el.id), ref }));
      else if (target.type !== 'symbol') err(t('dialogs.file.refNotPole', { what, id: String(el.id), ref }));
    }
  }

  // jumpers (cable_arc): both ends must still be real connection points of that pole (never guessed)
  if (!errors.length) {
    const els = elements as DrawingElement[];
    for (const el of els) {
      if (el.type !== 'cable_arc') continue;
      if (!isArcValid(els, el)) err(t('dialogs.file.jumperPoint', { id: String(el.id), pole: String(el.poleId) }));
    }
  }

  if (raw.style !== undefined && !isObj(raw.style)) err(t('dialogs.file.style'));
  for (const k of ['poleSizeScale', 'distanceTextScale', 'consumerSizeScale'] as const)
    if (raw[k] !== undefined && raw[k] !== null && !isNum(raw[k])) err(t('dialogs.file.number', { key: k }));
  if (raw.consumerVariant !== undefined && raw.consumerVariant !== 'circle' && raw.consumerVariant !== 'square') err(t('dialogs.file.consumerVariant'));

  const distances: Record<string, string> = {};
  if (raw.connectionDistances !== undefined && raw.connectionDistances !== null) {
    if (!isObj(raw.connectionDistances)) err(t('dialogs.file.distances'));
    else for (const [k, v] of Object.entries(raw.connectionDistances)) {
      if (isStr(v)) distances[k] = v; else if (isNum(v)) distances[k] = String(v); else err(t('dialogs.file.distance', { key: k }));
    }
  }
  const offsets: Record<string, { x: number; y: number }> = {};
  if (raw.connectionLabelOffsets !== undefined && raw.connectionLabelOffsets !== null) {
    if (!isObj(raw.connectionLabelOffsets)) err(t('dialogs.file.offsets'));
    else for (const [k, v] of Object.entries(raw.connectionLabelOffsets)) {
      if (isPoint(v)) offsets[k] = { x: (v as { x: number }).x, y: (v as { y: number }).y }; else err(t('dialogs.file.offsetItem', { key: k }));
    }
  }

  const electrical = readElectricalSettings(raw.electrical);
  const distanceFlags = readDistanceFlags(raw.distanceFlags);
  if (distanceFlags.invalid.length) err(t('dialogs.file.flags', { list: distanceFlags.invalid.slice(0, 3).join(t('common.listSep')) }));
  if (electrical.invalid.length) err(t('dialogs.file.electrical', { list: electrical.invalid.join(t('common.listSep')) }));

  // version 2 (feature/vd): every span-property record must belong to a span of a cable
  if (raw.spanProps !== undefined && raw.spanProps !== null) {
    if (!isObj(raw.spanProps)) err(t('dialogs.file.v2Spans'));
    else if (!errors.length) {
      const unplaced = unplacedV2Records(elements as DrawingElement[], raw.spanProps);
      if (unplaced.length) err(t('dialogs.file.v2Unplaced', { n: unplaced.length, list: unplaced.slice(0, 3).join(t('common.listSep')) }));
    }
  }

  let metadata: ProjectExportData['metadata'];
  if (raw.metadata !== undefined && raw.metadata !== null) {
    const m = raw.metadata;
    if (!isObj(m) || (m.id != null && !isStr(m.id)) || (m.name != null && !isStr(m.name))) err(t('dialogs.file.metadata'));
    else metadata = { id: (m.id as string) ?? null, name: (m.name as string) ?? null, exportedAt: isNum(m.exportedAt) ? m.exportedAt : 0 };
  }

  if (errors.length) return { ok: false, errors };
  const doc = prepareDocument({ elements: elements as DrawingElement[], connectionDistances: distances }, raw.spanProps);
  return {
    ok: true,
    data: {
      version: PROJECT_FILE_VERSION,
      elements: doc.elements,
      style: { ...DEFAULT_STYLE, ...((raw.style as Partial<DrawingStyle>) || {}) },
      poleSizeScale: isNum(raw.poleSizeScale) ? raw.poleSizeScale : 1,
      distanceTextScale: isNum(raw.distanceTextScale) ? raw.distanceTextScale : 1,
      consumerSizeScale: isNum(raw.consumerSizeScale) ? raw.consumerSizeScale : 1,
      consumerVariant: raw.consumerVariant === 'square' ? 'square' : 'circle',
      connectionDistances: doc.connectionDistances,
      connectionLabelOffsets: offsets,
      electrical: electrical.settings,
      distanceFlags: distanceFlags.flags,
      metadata,
    },
  };
};

export type ParseProjectResult = ValidateProjectResult;

// Never throws: returns either validated data or the reasons the file was rejected.
export const parseProjectFile = (json: string): ParseProjectResult => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, errors: [t('dialogs.file.notJson')] };
  }
  return validateProjectFile(raw);
};

export const deserializeProject = (json: string): ProjectExportData => {
  const res = parseProjectFile(json);
  if (!res.ok) throw new Error((res as { errors: string[] }).errors.join(' '));
  return res.data;
};

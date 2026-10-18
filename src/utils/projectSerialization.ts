import { DrawingElement, DrawingStyle } from '../types/drawing';
import { isArcValid } from './cableArcs';

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
  consumerSizeScale?: number
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

export const PROJECT_FILE_VERSION = 1;
export const DEFAULT_STYLE: DrawingStyle = { strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
const SHAPE_TYPES = new Set(['rectangle', 'circle', 'triangle', 'arrow', 'compass', 'curved_arrow']);
const MAX_LISTED = 5;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isPoint = (p: unknown) => isObj(p) && isNum(p.x) && isNum(p.y);

export type ValidateProjectResult = { ok: true; data: ProjectExportData } | { ok: false; errors: string[] };

export const validateProjectFile = (raw: unknown): ValidateProjectResult => {
  const errors: string[] = [];
  const err = (m: string) => { if (errors.length < MAX_LISTED) errors.push(m); else if (errors.length === MAX_LISTED) errors.push('…'); };

  if (!isObj(raw)) return { ok: false, errors: ['الملف لا يحتوي على مشروع (ليس كائن JSON).'] };
  if (raw.version !== undefined && (!isNum(raw.version) || raw.version > PROJECT_FILE_VERSION))
    return { ok: false, errors: [`إصدار الملف (${String(raw.version)}) غير مدعوم في هذه النسخة من التطبيق.`] };
  if (!Array.isArray(raw.elements)) return { ok: false, errors: ['الملف لا يحتوي على قائمة elements.'] };

  const elements = raw.elements as unknown[];
  const byId = new Map<string, Record<string, unknown>>();
  elements.forEach((el, i) => {
    if (!isObj(el)) { err(`العنصر رقم ${i + 1} تالف.`); return; }
    const id = el.id;
    const label = isStr(id) && id ? `${String(el.type)} "${id}"` : `العنصر رقم ${i + 1}`;
    if (!isStr(id) || !id) { err(`${label}: بدون id.`); return; }
    if (!isNum(el.x) || !isNum(el.y)) err(`${label}: إحداثيات x/y غير صالحة.`);
    switch (el.type) {
      case 'symbol':
        if (!isStr(el.symbolId) || !isNum(el.width) || !isNum(el.height)) err(`${label}: بيانات الرمز ناقصة (symbolId/width/height).`);
        break;
      case 'cable':
        if (!Array.isArray(el.poleIds) || el.poleIds.some((p) => !isStr(p))) err(`${label}: قائمة poleIds غير صالحة.`);
        if (el.offset !== undefined && !isNum(el.offset)) err(`${label}: offset غير صالح.`);
        break;
      case 'consumer':
        if (!isStr(el.poleId)) err(`${label}: بدون poleId.`);
        break;
      case 'path':
        if (!Array.isArray(el.points) || !el.points.every(isPoint)) err(`${label}: نقاط الخط غير صالحة.`);
        break;
      case 'text':
        if (!isStr(el.text)) err(`${label}: بدون نص.`);
        break;
      case 'arc':
        if (![el.x2, el.y2, el.controlX, el.controlY].every(isNum)) err(`${label}: نقاط القوس ناقصة.`);
        break;
      case 'shape':
        if (!SHAPE_TYPES.has(el.shapeType as string) || !isNum(el.width) || !isNum(el.height)) err(`${label}: بيانات الشكل غير صالحة.`);
        break;
      case 'transformer_table':
        if (!isObj(el.transformerInfo)) err(`${label}: بدون بيانات المحوّل.`);
        break;
      case 'cable_arc': {
        const isEnd = (v: unknown) => isObj(v) && isStr(v.cableId) && (v.side === 'prev' || v.side === 'next') && Number.isInteger(v.occurrence) && (v.occurrence as number) >= 0;
        if (!isStr(el.poleId) || !isEnd(el.from) || !isEnd(el.to)) err(`${label}: بيانات القوس ناقصة.`);
        break;
      }
      default:
        err(`${label}: نوع عنصر غير معروف.`);
        return;
    }
    byId.set(id, el);
  });

  // references: every cable pole and every consumer's pole must be a pole in this file
  for (const el of byId.values()) {
    const refs = el.type === 'cable' && Array.isArray(el.poleIds) ? (el.poleIds as unknown[]) : el.type === 'consumer' ? [el.poleId] : [];
    for (const ref of refs) {
      if (!isStr(ref)) continue;
      const target = byId.get(ref);
      if (!target) err(`${el.type === 'cable' ? 'الكيبل' : 'المشترك'} "${String(el.id)}" يشير إلى عمود غير موجود "${ref}".`);
      else if (target.type !== 'symbol') err(`${el.type === 'cable' ? 'الكيبل' : 'المشترك'} "${String(el.id)}" يشير إلى "${ref}" وهو ليس عمودًا.`);
    }
  }

  // cable arcs: both ends must still be real connection points of that pole (never guessed)
  if (!errors.length) {
    const els = elements as DrawingElement[];
    for (const el of els) {
      if (el.type !== 'cable_arc') continue;
      if (!isArcValid(els, el)) err(`القوس "${el.id}" يشير إلى نقطة اتصال غير موجودة عند العمود "${el.poleId}".`);
    }
  }

  if (raw.style !== undefined && !isObj(raw.style)) err('style غير صالح.');
  for (const k of ['poleSizeScale', 'distanceTextScale', 'consumerSizeScale'] as const)
    if (raw[k] !== undefined && raw[k] !== null && !isNum(raw[k])) err(`${k} غير صالح.`);
  if (raw.consumerVariant !== undefined && raw.consumerVariant !== 'circle' && raw.consumerVariant !== 'square') err('consumerVariant غير صالح.');

  const distances: Record<string, string> = {};
  if (raw.connectionDistances !== undefined && raw.connectionDistances !== null) {
    if (!isObj(raw.connectionDistances)) err('connectionDistances غير صالح.');
    else for (const [k, v] of Object.entries(raw.connectionDistances)) {
      if (isStr(v)) distances[k] = v; else if (isNum(v)) distances[k] = String(v); else err(`المسافة "${k}" غير صالحة.`);
    }
  }
  const offsets: Record<string, { x: number; y: number }> = {};
  if (raw.connectionLabelOffsets !== undefined && raw.connectionLabelOffsets !== null) {
    if (!isObj(raw.connectionLabelOffsets)) err('connectionLabelOffsets غير صالح.');
    else for (const [k, v] of Object.entries(raw.connectionLabelOffsets)) {
      if (isPoint(v)) offsets[k] = { x: (v as { x: number }).x, y: (v as { y: number }).y }; else err(`موضع رقم المسافة "${k}" غير صالح.`);
    }
  }

  let metadata: ProjectExportData['metadata'];
  if (raw.metadata !== undefined && raw.metadata !== null) {
    const m = raw.metadata;
    if (!isObj(m) || (m.id != null && !isStr(m.id)) || (m.name != null && !isStr(m.name))) err('metadata غير صالح.');
    else metadata = { id: (m.id as string) ?? null, name: (m.name as string) ?? null, exportedAt: isNum(m.exportedAt) ? m.exportedAt : 0 };
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      version: PROJECT_FILE_VERSION,
      elements: elements as DrawingElement[],
      style: { ...DEFAULT_STYLE, ...((raw.style as Partial<DrawingStyle>) || {}) },
      poleSizeScale: isNum(raw.poleSizeScale) ? raw.poleSizeScale : 1,
      distanceTextScale: isNum(raw.distanceTextScale) ? raw.distanceTextScale : 1,
      consumerSizeScale: isNum(raw.consumerSizeScale) ? raw.consumerSizeScale : 1,
      consumerVariant: raw.consumerVariant === 'square' ? 'square' : 'circle',
      connectionDistances: distances,
      connectionLabelOffsets: offsets,
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
    return { ok: false, errors: ['الملف ليس JSON صالحًا (قد يكون تالفًا أو غير مكتمل).'] };
  }
  return validateProjectFile(raw);
};

export const deserializeProject = (json: string): ProjectExportData => {
  const res = parseProjectFile(json);
  if (!res.ok) throw new Error((res as { errors: string[] }).errors.join(' '));
  return res.data;
};

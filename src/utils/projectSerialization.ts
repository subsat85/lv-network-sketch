import { DrawingElement, DrawingStyle, CableElement, SpanProps } from '../types/drawing';
import { ensureSpanIds } from '../store/drawingStore';

// ─── Project file versions ────────────────────────────────────────────────────
// v1: original format — no spanProps, connectionDistances may contain "1" as a
//     never-confirmed placeholder (treated as unknown on load).
// v2: adds spanProps; connectionDistances uses "?" as the explicit unknown marker.

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
  /** Per-segment electrical properties added in v2 */
  spanProps?: Record<string, SpanProps>;
  metadata?: {
    id: string | null;
    name: string | null;
    exportedAt: number;
  };
}

/** Result of deserializing a project, including migration side-effects. */
export interface DeserializedProject extends ProjectExportData {
  /** Keys in connectionDistances that held the value "1" in a v1 project and
   *  were never explicitly entered by the user.  Must be passed to the store via
   *  setSuspectDistanceKeys so they are treated as 'unknown' during calculations. */
  suspectDistanceKeys: string[];
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
  spanProps?: Record<string, SpanProps>
): string => {
  const elementsCopy: DrawingElement[] = JSON.parse(JSON.stringify(elements));

  const data: ProjectExportData = {
    version: 2,
    elements: elementsCopy,
    style: { ...style },
    poleSizeScale,
    distanceTextScale,
    consumerSizeScale,
    consumerVariant,
    connectionDistances: { ...connectionDistances },
    connectionLabelOffsets: { ...connectionLabelOffsets },
    spanProps: spanProps ? { ...spanProps } : {},
    metadata: {
      id,
      name,
      exportedAt: Date.now(),
    },
  };
  return JSON.stringify(data, null, 2);
};

export const deserializeProject = (json: string): DeserializedProject => {
  try {
    const raw = JSON.parse(json);

    if (!raw.elements || !Array.isArray(raw.elements)) {
      throw new Error('Invalid project file: missing elements');
    }

    const data = raw as ProjectExportData;
    const suspectDistanceKeys: string[] = [];

    // ── v1 migration ──────────────────────────────────────────────────────────
    if (!data.version || data.version < 2) {
      // Any "1" value in connectionDistances was the old never-entered fallback.
      // Flag them so the store treats them as unknown during calculations.
      const cd = data.connectionDistances ?? {};
      for (const [key, val] of Object.entries(cd)) {
        if (val === '1') {
          suspectDistanceKeys.push(key);
        }
      }
    }

    // ── Ensure all cables have spanIds ────────────────────────────────────────
    data.elements = data.elements.map(el => {
      if (el.type !== 'cable') return el;
      const cable = el as CableElement;
      const spanIds = ensureSpanIds(cable);
      if (spanIds === cable.spanIds) return cable; // already complete, no change
      return { ...cable, spanIds };
    });

    return {
      ...data,
      spanProps: data.spanProps ?? {},
      suspectDistanceKeys,
    };
  } catch (e) {
    console.error('Deserialization error:', e);
    throw new Error('Failed to parse project file');
  }
};

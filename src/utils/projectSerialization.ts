import { DrawingElement, DrawingStyle } from '../types/drawing';

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

export const deserializeProject = (json: string): ProjectExportData => {
  try {
    const data = JSON.parse(json);
    // Basic validation
    if (!data.elements || !Array.isArray(data.elements)) {
      throw new Error('Invalid project file: missing elements');
    }
    return data as ProjectExportData;
  } catch (e) {
    console.error('Deserialization error:', e);
    throw new Error('Failed to parse project file');
  }
};

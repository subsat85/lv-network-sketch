import { get, set, del, keys, many } from 'idb-keyval';
import { DrawingElement, DrawingStyle } from '../types/drawing';

export interface ProjectData {
  elements: DrawingElement[];
  style: DrawingStyle;
  poleSizeScale: number;
  distanceTextScale?: number;
  consumerSizeScale?: number;
  consumerVariant: 'circle' | 'square';
  connectionDistances?: Record<string, string>;
  connectionLabelOffsets?: Record<string, { x: number, y: number }>;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: ProjectData;
  thumbnail?: string;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
}

const PROJECTS_STORE_KEY = 'yw_projects';

// We'll store projects individually by ID to avoid loading all data at once
// But we need a list of projects.
// Strategy:
// - 'projects_meta': Array of ProjectMetadata
// - 'project_{id}': ProjectData

export const META_KEY = 'projects_meta';

export const getProjectsMeta = async (): Promise<ProjectMetadata[]> => {
  return (await get<ProjectMetadata[]>(META_KEY)) || [];
};

export const saveProject = async (project: Project): Promise<void> => {
  const meta: ProjectMetadata = {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    thumbnail: project.thumbnail,
  };

  const currentMeta = await getProjectsMeta();
  const index = currentMeta.findIndex((p) => p.id === project.id);
  
  let newMeta = [...currentMeta];
  if (index >= 0) {
    newMeta[index] = meta;
  } else {
    newMeta.push(meta);
  }

  // Sort by updatedAt desc
  newMeta.sort((a, b) => b.updatedAt - a.updatedAt);

  await set(META_KEY, newMeta);
  await set(`project_${project.id}`, project.data);
};

export const loadProject = async (id: string): Promise<Project | null> => {
  const metaList = await getProjectsMeta();
  const meta = metaList.find((p) => p.id === id);
  if (!meta) return null;

  const data = await get<ProjectData>(`project_${id}`);
  if (!data) return null;

  return {
    ...meta,
    data,
  };
};

export const deleteProject = async (id: string): Promise<void> => {
  const currentMeta = await getProjectsMeta();
  const newMeta = currentMeta.filter((p) => p.id !== id);
  
  await set(META_KEY, newMeta);
  await del(`project_${id}`);
};

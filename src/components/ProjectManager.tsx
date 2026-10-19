import React, { useState, useEffect } from 'react';
import { FolderOpen, Save, Plus, Trash2, X, FileText, Upload, Download } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { 
  getProjectsMeta, 
  saveProject, 
  loadProject, 
  deleteProject, 
  ProjectMetadata, 
  Project 
} from '../utils/projectStorage';
import { serializeProject, deserializeProject } from '../utils/projectSerialization';
import { saveFile, openFile } from '../utils/filePickers';

interface ProjectManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectManager: React.FC<ProjectManagerProps> = ({ isOpen, onClose }) => {
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [view, setView] = useState<'list' | 'save'>('list');
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const {
    elements,
    style,
    poleSizeScale,
    distanceTextScale,
    consumerSizeScale,
    consumerVariant,
    currentProjectId,
    currentProjectName,
    connectionDistances,
    connectionLabelOffsets,
    spanProps,
    loadProject: loadProjectToStore,
    setSuspectDistanceKeys,
    setProjectInfo,
    clearCanvas
  } = useDrawingStore();

  useEffect(() => {
    if (isOpen) {
      refreshProjects();
      if (currentProjectName) {
        setProjectName(currentProjectName);
      } else {
        setProjectName(`Project ${new Date().toLocaleDateString()}`);
      }
    }
  }, [isOpen, currentProjectName]);

  const refreshProjects = async () => {
    setIsLoading(true);
    try {
      const metas = await getProjectsMeta();
      setProjects(metas);
    } catch (error) {
      console.error('Failed to load projects', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewProject = () => {
    if (elements.length > 0 && !confirm('Start a new project? Current canvas will be cleared.')) {
      return;
    }
    clearCanvas();
    setProjectInfo(null, null);
    setProjectName('');
    onClose();
  };

  const handleSaveProject = async () => {
    if (!projectName.trim()) return;
    
    setIsLoading(true);
    try {
      const id = currentProjectId || crypto.randomUUID();
      const now = Date.now();
      
      const project: Project = {
        id,
        name: projectName.trim().normalize('NFC'),
        createdAt: currentProjectId ? (projects.find(p => p.id === id)?.createdAt || now) : now,
        updatedAt: now,
        data: {
          elements,
          style,
          poleSizeScale,
          distanceTextScale,
          consumerSizeScale,
          consumerVariant,
          connectionDistances,
          connectionLabelOffsets
        }
      };

      await saveProject(project);
      setProjectInfo(id, projectName);
      await refreshProjects();
      setView('list');
    } catch (error) {
      console.error('Failed to save project', error);
      alert('Failed to save project');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadProject = async (id: string) => {
    if (elements.length > 0 && !confirm('Load project? Unsaved changes will be lost.')) {
      return;
    }

    setIsLoading(true);
    try {
      const project = await loadProject(id);
      if (project) {
        // project.data may be a raw v1 payload — run through deserializeProject for migration
        const migratedLoad = (() => {
          try {
            const { deserializeProject: ds } = require('../utils/projectSerialization');
            // Re-serialize to string then deserialize to trigger v1 migration
            return ds(JSON.stringify(project.data));
          } catch {
            return { ...project.data, suspectDistanceKeys: [], spanProps: {} };
          }
        })();
        loadProjectToStore({
          elements: migratedLoad.elements,
          style: migratedLoad.style,
          poleSizeScale: migratedLoad.poleSizeScale,
          consumerVariant: migratedLoad.consumerVariant,
          connectionDistances: migratedLoad.connectionDistances,
          connectionLabelOffsets: migratedLoad.connectionLabelOffsets,
          distanceTextScale: (migratedLoad as any).distanceTextScale,
          consumerSizeScale: (migratedLoad as any).consumerSizeScale,
          spanProps: migratedLoad.spanProps,
          suspectDistanceKeys: migratedLoad.suspectDistanceKeys,
        });
        setSuspectDistanceKeys(migratedLoad.suspectDistanceKeys ?? []);
        setProjectInfo(project.id, project.name);
        onClose();
      }
    } catch (error) {
      console.error('Failed to load project', error);
      alert('Failed to load project');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;

    setIsLoading(true);
    try {
      await deleteProject(id);
      if (currentProjectId === id) {
        setProjectInfo(null, null);
      }
      await refreshProjects();
    } catch (error) {
      console.error('Failed to delete project', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const json = serializeProject(
        elements,
        style,
        poleSizeScale,
        consumerVariant,
        connectionDistances,
        connectionLabelOffsets,
        currentProjectId,
        currentProjectName,
        distanceTextScale,
        consumerSizeScale,
        spanProps
      );
      const safeName = (currentProjectName || 'Project').trim();
      // Replace only invalid filesystem characters, preserving Unicode (Arabic, etc.)
      const filename = `${safeName.replace(/[\/\\:*?"<>|]/g, '_')}.json`;
      await saveFile(filename, json);
    } catch (error) {
      console.error('Export failed', error);
      alert('Failed to export project');
    }
  };

  const handleImport = async () => {
    try {
      const json = await openFile('.json,application/json');
      if (!json) return; // Cancelled

      const data = deserializeProject(json);
      
      if (elements.length > 0 && !confirm('Importing will replace the current project. Continue?')) {
        return;
      }

      // Atomic replace
      loadProjectToStore({
        elements: data.elements,
        style: data.style,
        poleSizeScale: data.poleSizeScale,
        consumerVariant: data.consumerVariant,
        connectionDistances: data.connectionDistances,
        connectionLabelOffsets: data.connectionLabelOffsets,
        distanceTextScale: (data as any).distanceTextScale,
        consumerSizeScale: (data as any).consumerSizeScale,
        spanProps: data.spanProps,
        suspectDistanceKeys: data.suspectDistanceKeys,
      });
      setSuspectDistanceKeys(data.suspectDistanceKeys ?? []);

      // Update metadata if present
      if (data.metadata) {
        setProjectInfo(data.metadata.id, data.metadata.name);
        setProjectName(data.metadata.name || '');
      } else {
        setProjectInfo(null, 'Imported Project');
        setProjectName('Imported Project');
      }
      
      onClose();
    } catch (error) {
      console.error('Import failed', error);
      alert('Failed to import project: ' + (error as Error).message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold">Projects</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {view === 'list' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleNewProject}
                  className="flex items-center justify-center gap-2 p-3 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Plus size={20} />
                  <span>New Project</span>
                </button>
                <button
                  onClick={() => setView('save')}
                  className="flex items-center justify-center gap-2 p-3 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                >
                  <Save size={20} />
                  <span>Save Current</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t pt-4">
                <button
                  onClick={handleImport}
                  className="flex items-center justify-center gap-2 p-3 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Upload size={20} />
                  <span>Import JSON</span>
                </button>
                <button
                  onClick={handleExport}
                  disabled={elements.length === 0}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg transition-colors ${
                    elements.length === 0 
                      ? 'bg-gray-50 text-gray-400 cursor-not-allowed' 
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Download size={20} />
                  <span>Export JSON</span>
                </button>
              </div>

              <div className="space-y-2 mt-4">
                <h3 className="font-medium text-gray-500 text-sm">Saved Projects</h3>
                {isLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : projects.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed">
                    No saved projects
                  </div>
                ) : (
                  projects.map((project) => (
                    <div
                      key={project.id}
                      onClick={() => handleLoadProject(project.id)}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        currentProjectId === project.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <FileText size={20} className="text-gray-400" />
                        <div>
                          <div className="font-medium" dir="auto">{project.name}</div>
                          <div className="text-xs text-gray-500">
                            {new Date(project.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteProject(project.id, e)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  dir="auto"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name"
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setView('list')}
                  className="flex-1 p-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProject}
                  disabled={!projectName.trim() || isLoading}
                  className="flex-1 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

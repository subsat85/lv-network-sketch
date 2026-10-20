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
import { serializeProject } from '../utils/projectSerialization';
import { planImport, applyImport, ImportPlan, ImportChoice, copyName } from '../utils/projectImport';
import { ProjectDataError } from '../utils/projectMigration';
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
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<ImportPlan | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

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
    electrical,
    distanceFlags,
    loadProject: loadProjectToStore,
    setProjectInfo,
    clearCanvas
  } = useDrawingStore();

  useEffect(() => {
    if (isOpen) {
      setImportError(null);
      setPendingImport(null);
      setConfirmReplace(false);
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
          connectionLabelOffsets,
          electrical,
          distanceFlags
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
        loadProjectToStore({
          elements: project.data.elements,
          style: project.data.style,
          poleSizeScale: project.data.poleSizeScale,
          consumerVariant: project.data.consumerVariant,
          connectionDistances: project.data.connectionDistances,
          connectionLabelOffsets: project.data.connectionLabelOffsets,
          distanceTextScale: project.data.distanceTextScale,
          consumerSizeScale: project.data.consumerSizeScale,
          electrical: project.data.electrical,
          distanceFlags: project.data.distanceFlags,
          spanProps: project.data.spanProps
        } as any);
        setProjectInfo(project.id, project.name);
        onClose();
      }
    } catch (error) {
      console.error('Failed to load project', error);
      // e.g. incompatible version-2 data: nothing was loaded and the saved project is untouched
      alert(error instanceof ProjectDataError ? error.message : 'Failed to load project');
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
        electrical,
        distanceFlags
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

  const finishImport = async (plan: ImportPlan, choice: ImportChoice) => {
    setIsLoading(true);
    try {
      const res = await applyImport(plan, choice);
      if (!res.ok) { setImportError((res as { message: string }).message); return; }
      setPendingImport(null);
      setConfirmReplace(false);
      if (res.status === 'cancelled') return;
      setImportError(null);
      setProjectName(res.projectName);
      await refreshProjects();
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    setImportError(null);
    let json: string | null;
    try {
      json = await openFile('.json,application/json');
    } catch (error) {
      console.error('Import failed', error);
      setImportError('تعذّر قراءة الملف. لم يتغيّر أي شيء.');
      return;
    }
    if (!json) return; // Cancelled

    // Validate the whole file before touching the canvas or storage.
    const planned = await planImport(json);
    if (!planned.ok) { setImportError((planned as { message: string }).message); return; }
    const plan = planned.plan;

    if (plan.conflict) {
      // A saved project has the same id: let the user choose (replace / copy / cancel).
      setConfirmReplace(false);
      setPendingImport(plan);
      return;
    }
    if (elements.length > 0 && !confirm('Importing will replace the current drawing on the canvas. Continue?')) {
      return;
    }
    await finishImport(plan, 'open');
  };

  const fmt = (t?: number) => (t ? new Date(t).toLocaleString() : '—');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold">Projects</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {importError && (
            <div role="alert" dir="rtl" className="mb-3 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {importError}
            </div>
          )}
          {pendingImport && pendingImport.conflict ? (
            <div className="space-y-3" dir="rtl" data-testid="import-conflict">
              <h3 className="font-semibold text-gray-900">يوجد مشروع محفوظ بنفس المعرّف</h3>
              <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
                <div>المشروع المحفوظ: <bdi className="font-medium">{pendingImport.conflict.name}</bdi> — آخر حفظ {fmt(pendingImport.conflict.updatedAt)}</div>
                <div>الملف المستورد: <bdi className="font-medium">{pendingImport.name}</bdi> — تاريخ التصدير {fmt(pendingImport.data.metadata?.exportedAt)}</div>
                {pendingImport.conflict.updatedAt > (pendingImport.data.metadata?.exportedAt || 0) && (
                  <div className="font-medium text-red-600">تنبيه: المشروع المحفوظ أحدث من الملف.</div>
                )}
                <div className="text-gray-500">أي خيار غير الإلغاء سيستبدل الرسم الحالي على الشاشة.</div>
              </div>
              {confirmReplace ? (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-700">سيُحذف محتوى المشروع المحفوظ «<bdi>{pendingImport.conflict.name}</bdi>» ويُستبدل بمحتوى الملف. لا يمكن التراجع عن ذلك.</p>
                  <div className="flex gap-2">
                    <button onClick={() => finishImport(pendingImport, 'replace')} disabled={isLoading} className="flex-1 p-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">تأكيد الاستبدال</button>
                    <button onClick={() => setConfirmReplace(false)} disabled={isLoading} className="flex-1 p-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">رجوع</button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  <button onClick={() => setConfirmReplace(true)} disabled={isLoading} className="p-3 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">استبدال المشروع المحفوظ…</button>
                  <button onClick={() => finishImport(pendingImport, 'copy')} disabled={isLoading} className="p-3 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100">حفظ كنسخة جديدة: <bdi>{copyName(pendingImport.name)}</bdi></button>
                  <button onClick={() => finishImport(pendingImport, 'cancel')} disabled={isLoading} className="p-3 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">إلغاء</button>
                </div>
              )}
            </div>
          ) : view === 'list' ? (
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

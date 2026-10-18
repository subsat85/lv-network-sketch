import React, { useState } from 'react';
import { MousePointer2, Trash2, Activity, Check, ArrowRight, Folder, Share, Minus, Zap, BarChart3 } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ToolType, CableElement } from '../types/drawing';
import { LoadReportModal } from './LoadReportModal';

interface ToolbarProps {
  onOpenProjects?: () => void;
  onOpenShare?: () => void;
  onOpenTransformerInfo?: () => void;
}

interface ConsumerElement {
  type: 'consumer';
  poleId: string;
  color: string;
  count: number;
  hasManualPosition?: boolean;
  variant?: 'circle' | 'square';
  label?: string;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenProjects, onOpenShare, onOpenTransformerInfo }) => {
  const [showLoadReport, setShowLoadReport] = useState(false);
  
  const { 
    tool, setTool, clearCanvas, activeCableId, setActiveCableId, history, selectedId, deleteElement, cableVariant, setCableVariant, elements, updateElement,
    currentProjectName, setProjectInfo, currentProjectId
  } = useDrawingStore();

  // Filter consumers from elements
  const consumers = elements.filter((el): el is ConsumerElement => el.type === 'consumer');

  const tools: { id: string; icon: React.ReactNode; label: string; onClick: () => void; isActive: boolean }[] = [
    { 
      id: 'projects', 
      icon: <Folder size={24} />, 
      label: 'Projects',
      onClick: () => onOpenProjects?.(),
      isActive: false
    },
    { 
      id: 'share', 
      icon: <Share size={24} />, 
      label: 'Share',
      onClick: () => onOpenShare?.(),
      isActive: false
    },
    { 
      id: 'select', 
      icon: <MousePointer2 size={24} />, 
      label: 'Select',
      onClick: () => setTool('select'),
      isActive: tool === 'select'
    },

    { 
      id: 'cable', 
      icon: <Activity size={24} />, 
      label: 'Cable',
      onClick: () => setTool('cable'),
      isActive: tool === 'cable'
    },
    { 
      id: 'cable_straight', 
      icon: <Minus size={24} />, 
      label: 'Straight Cable',
      onClick: () => setTool('cable_straight'),
      isActive: tool === 'cable_straight'
    },
    { 
      id: 'transformer', 
      icon: <Zap size={24} />, 
      label: 'معلومات المحول',
      onClick: () => onOpenTransformerInfo?.(),
      isActive: false
    },
    { 
      id: 'loadReport', 
      icon: <BarChart3 size={24} />, 
      label: 'تقرير الاحمال',
      onClick: () => setShowLoadReport(true),
      isActive: false
    },
  ];

  return (
    <>
      <div className="w-full bg-white border-b border-gray-200 shadow-sm z-10 overflow-x-auto no-scrollbar touch-pan-x">
        <div className="flex items-center justify-between px-4 py-2 min-w-max gap-4">
          <div className="flex space-x-2">
            {tools.map((t) => (
              <React.Fragment key={t.id}>
                <button
                  onClick={t.onClick}
                  className={`p-3 rounded-xl flex flex-col items-center justify-center transition-colors min-h-[44px] min-w-[44px] flex-shrink-0 ${
                    t.isActive
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-transparent text-gray-600 hover:bg-gray-50'
                  }`}
                  aria-label={t.label}
                >
                  {t.icon}
                </button>
                {t.id === tool && activeCableId && (t.id === 'cable' || t.id === 'cable_straight') && (
                  <button
                    onClick={() => setActiveCableId(null)}
                    className="p-3 rounded-xl bg-green-100 text-green-600 hover:bg-green-200 min-h-[44px] min-w-[44px] flex-shrink-0"
                    aria-label="Finish Cable"
                  >
                    <Check size={24} />
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="flex items-center px-2">
            <input
              type="text"
              value={currentProjectName || ''}
              onChange={(e) => setProjectInfo(currentProjectId, e.target.value)}
              placeholder="Project Name"
              className="px-2 py-1 border border-gray-300 rounded-md text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="flex space-x-2">
            <button
              onClick={() => {
                if (selectedId) {
                  deleteElement(selectedId);
                }
              }}
              disabled={!selectedId}
              className={`p-3 rounded-xl min-h-[44px] min-w-[44px] flex-shrink-0 ${
                selectedId ? 'text-red-500 hover:bg-red-50' : 'text-gray-300'
              }`}
              aria-label="Delete Selected"
            >
              <Trash2 size={24} />
            </button>
          </div>
        </div>
      </div>
      <LoadReportModal 
        isOpen={showLoadReport} 
        onClose={() => setShowLoadReport(false)} 
        consumers={consumers}
      />
    </>
  );
};

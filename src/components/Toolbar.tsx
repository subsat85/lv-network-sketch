import React, { useState } from 'react';
import { MousePointer2, Trash2, Activity, Check, ArrowRight, Folder, Share, Minus, Zap, BarChart3, Gauge, Maximize } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ToolType, CableElement } from '../types/drawing';
import { LoadReportModal } from './LoadReportModal';
import { VoltageDropPanel } from './VoltageDropPanel';
import { ICON_LG } from './ui/icons';

interface ToolbarProps {
  onOpenProjects?: () => void;
  onOpenShare?: () => void;
  onOpenTransformerInfo?: () => void;
  /** Full Screen Drawing Mode: hides the bars and panels around the canvas */
  onEnterFullScreen?: () => void;
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

export const Toolbar: React.FC<ToolbarProps> = ({ onOpenProjects, onOpenShare, onOpenTransformerInfo, onEnterFullScreen }) => {
  const [showLoadReport, setShowLoadReport] = useState(false);
  const [showVoltageDrop, setShowVoltageDropPanel] = useState(false);
  
  const { 
    tool, setTool, clearCanvas, activeCableId, setActiveCableId, history, selectedId, deleteElement, cableVariant, setCableVariant, elements, updateElement,
    currentProjectName, setProjectInfo, currentProjectId
  } = useDrawingStore();

  // Filter consumers from elements
  const consumers = elements.filter((el): el is ConsumerElement => el.type === 'consumer');

  const tools: { id: string; icon: React.ReactNode; label: string; onClick: () => void; isActive: boolean; group: 'file' | 'draw' | 'info' }[] = [
    { 
      id: 'projects', 
      group: 'file',
      icon: <Folder {...ICON_LG} />, 
      label: 'Projects',
      onClick: () => onOpenProjects?.(),
      isActive: false
    },
    { 
      id: 'share', 
      group: 'file',
      icon: <Share {...ICON_LG} />, 
      label: 'Share',
      onClick: () => onOpenShare?.(),
      isActive: false
    },
    {
      // first group, so it is visible without scrolling the bar on a phone
      id: 'fullScreen',
      group: 'file',
      icon: <Maximize {...ICON_LG} />,
      label: 'وضع الرسم الكامل',
      onClick: () => onEnterFullScreen?.(),
      isActive: false
    },
    { 
      id: 'select', 
      group: 'draw',
      icon: <MousePointer2 {...ICON_LG} />, 
      label: 'Select',
      onClick: () => setTool('select'),
      isActive: tool === 'select'
    },

    { 
      id: 'cable', 
      group: 'draw',
      icon: <Activity {...ICON_LG} />, 
      label: 'Cable',
      onClick: () => setTool('cable'),
      isActive: tool === 'cable'
    },
    { 
      id: 'cable_straight', 
      group: 'draw',
      icon: <Minus {...ICON_LG} />, 
      label: 'Straight Cable',
      onClick: () => setTool('cable_straight'),
      isActive: tool === 'cable_straight'
    },
    { 
      id: 'transformer', 
      group: 'info',
      icon: <Zap {...ICON_LG} />, 
      label: 'معلومات المحول',
      onClick: () => onOpenTransformerInfo?.(),
      isActive: false
    },
    { 
      id: 'loadReport', 
      group: 'info',
      icon: <BarChart3 {...ICON_LG} />, 
      label: 'تقرير الاحمال',
      onClick: () => setShowLoadReport(true),
      isActive: false
    },
    { 
      id: 'voltageDrop', 
      group: 'info',
      icon: <Gauge {...ICON_LG} />, 
      label: 'هبوط الفولتية',
      onClick: () => setShowVoltageDropPanel(true),
      isActive: false
    },
  ];

  const renderTool = (t: typeof tools[number]) => (
    <React.Fragment key={t.id}>
      <button
        onClick={t.onClick}
        className={`ui-icon-btn ${t.isActive ? 'is-active' : ''}`}
        aria-label={t.label}
        aria-pressed={t.group === 'draw' ? t.isActive : undefined}
        title={t.label}
      >
        {t.icon}
      </button>
      {t.id === tool && activeCableId && (t.id === 'cable' || t.id === 'cable_straight') && (
        <button
          onClick={() => setActiveCableId(null)}
          className="ui-icon-btn is-confirm"
          aria-label="Finish Cable"
          title="Finish Cable"
        >
          <Check {...ICON_LG} strokeWidth={2.25} />
        </button>
      )}
    </React.Fragment>
  );

  const group = (g: 'file' | 'draw' | 'info') => tools.filter(t => t.group === g).map(renderTool);

  return (
    <>
      <div className="w-full bg-white/95 border-b border-ios-separator z-10 overflow-x-auto no-scrollbar touch-pan-x">
        <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 min-w-max gap-2">
          <div className="flex items-center gap-0.5">
            {group('file')}
            <div className="ui-sep-v" aria-hidden="true" />
            {group('draw')}
            <div className="ui-sep-v" aria-hidden="true" />
            {group('info')}
          </div>

          <div className="flex items-center px-1">
            <input
              type="text"
              value={currentProjectName || ''}
              onChange={(e) => setProjectInfo(currentProjectId, e.target.value)}
              placeholder="Project Name"
              aria-label="Project Name"
              className="ui-field w-36"
            />
          </div>
          
          <div className="flex items-center">
            <button
              onClick={() => {
                if (selectedId) {
                  const res = deleteElement(selectedId);
                  if (!res.ok && res.reason) alert(res.reason);
                }
              }}
              disabled={!selectedId}
              className="ui-icon-btn is-destructive"
              aria-label="Delete Selected"
              title="Delete Selected"
            >
              <Trash2 {...ICON_LG} />
            </button>
          </div>
        </div>
      </div>
      <LoadReportModal 
        isOpen={showLoadReport} 
        onClose={() => setShowLoadReport(false)} 
        consumers={consumers}
      />
      {showVoltageDrop && <VoltageDropPanel onClose={() => setShowVoltageDropPanel(false)} />}
    </>
  );
};

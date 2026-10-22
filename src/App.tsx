import React, { useRef, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { SketchCanvas } from './components/SketchCanvas';
import { StylePanel } from './components/StylePanel';
import { SymbolsPanel } from './components/SymbolsPanel';
import { ProjectManager } from './components/ProjectManager';
import { FloatingHistoryControls } from './components/FloatingHistoryControls';
import { SharePreview } from './components/SharePreview';
import { PreviewErrorBoundary } from './components/PreviewErrorBoundary';
import { TransformerInfoModal } from './components/TransformerInfoModal';
import { AutosaveNotice } from './components/AutosaveNotice';
import { useDrawingStore } from './store/drawingStore';
import { TransformerTableElement } from './types/drawing';
import { Check, Minimize } from 'lucide-react';
import { ICON_LG } from './components/ui/icons';

function App() {
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [showTransformerInfo, setShowTransformerInfo] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const fullScreenButtonsRef = useRef<HTMLDivElement>(null);
  const { addElement, activeCableId, setActiveCableId, tool } = useDrawingStore();
  const finishCableInFullScreen = fullScreen && !!activeCableId && (tool === 'cable' || tool === 'cable_straight');

  const handleAddTransformerTableToCanvas = (info: any) => {
    const newElement: TransformerTableElement = {
      id: `transformer_${Date.now()}`,
      type: 'transformer_table',
      x: 100,
      y: 100,
      strokeColor: '#2563eb',
      fillColor: 'white',
      strokeWidth: 2,
      transformerInfo: info,
      scale: 1,
    };
    addElement(newElement);
  };

  return (
    <div className="fixed inset-0 w-full bg-ios-grouped flex flex-col overflow-hidden touch-manipulation no-select">
      <main className="w-full h-full relative flex flex-col"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {/* Full Screen Drawing Mode: the bars and panels are only hidden (kept mounted, so their
            own state — collapsed panel, open menus — is kept); the canvas then takes the whole
            area inside the safe area. The drawing, tool and selection are not touched. */}
        <div className={fullScreen ? 'hidden' : 'contents'} data-ui-chrome="toolbar">
          <Toolbar
            onOpenProjects={() => setShowProjectManager(true)}
            onOpenShare={() => setShowSharePreview(true)}
            onOpenTransformerInfo={() => setShowTransformerInfo(true)}
            onEnterFullScreen={() => setFullScreen(true)}
          />
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          <div className={fullScreen ? 'hidden' : 'contents'} data-ui-chrome="symbols">
            <SymbolsPanel />
          </div>
          <SketchCanvas fullScreen={fullScreen} />
          {/* Rendered before the floating panel: React attaches this ref before the panel's layout
              effect runs, so the panel is placed clear of these buttons in the same commit (no frame
              with an overlap). z-[51] keeps them above the panel, as before the reorder. */}
          {fullScreen && (
            <div ref={fullScreenButtonsRef} className="absolute z-[51] flex flex-col gap-2" style={{ top: 8, left: 8 }} data-fullscreen-buttons>
              <button
                type="button"
                onClick={() => setFullScreen(false)}
                className="ui-float ui-icon-btn text-ios-blue"
                aria-label="استعادة الواجهة"
                title="استعادة الواجهة"
                data-exit-fullscreen
              >
                <Minimize {...ICON_LG} />
              </button>
              {/* the toolbar's «Finish Cable» is hidden in this mode; the same action while a cable is drawn */}
              {finishCableInFullScreen && (
                <button
                  type="button"
                  onClick={() => setActiveCableId(null)}
                  className="ui-float ui-icon-btn is-confirm"
                  aria-label="إنهاء الكابل"
                  title="Finish Cable"
                  data-fullscreen-finish-cable
                >
                  <Check {...ICON_LG} strokeWidth={2.25} />
                </button>
              )}
            </div>
          )}
          {/* the floating undo / redo panel keeps clear of the full-screen buttons; avoidLayoutKey
              changes when those buttons change size, so it re-checks in that same commit */}
          <FloatingHistoryControls fullScreen={fullScreen} avoidRef={fullScreenButtonsRef} avoidLayoutKey={finishCableInFullScreen ? 2 : 1} />
        </div>

        <div className={fullScreen ? 'hidden' : 'contents'} data-ui-chrome="style">
          <StylePanel />
        </div>

        <AutosaveNotice />

        <ProjectManager 
          isOpen={showProjectManager} 
          onClose={() => setShowProjectManager(false)} 
        />
        
        {showSharePreview && (
          <PreviewErrorBoundary onClose={() => setShowSharePreview(false)}>
            <SharePreview onClose={() => setShowSharePreview(false)} />
          </PreviewErrorBoundary>
        )}

        <TransformerInfoModal
          isOpen={showTransformerInfo}
          onClose={() => setShowTransformerInfo(false)}
          onSave={(info) => {
            console.log('Transformer Info:', info);
          }}
          onAddToCanvas={handleAddTransformerTableToCanvas}
        />
      </main>
    </div>
  );
}

export default App;

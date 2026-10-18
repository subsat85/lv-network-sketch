import React, { useState } from 'react';
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

function App() {
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [showTransformerInfo, setShowTransformerInfo] = useState(false);
  const { addElement } = useDrawingStore();

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
        <Toolbar 
          onOpenProjects={() => setShowProjectManager(true)}
          onOpenShare={() => setShowSharePreview(true)}
          onOpenTransformerInfo={() => setShowTransformerInfo(true)}
        />
        
        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          <SymbolsPanel />
          <SketchCanvas />
          <FloatingHistoryControls />
        </div>

        <StylePanel />

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

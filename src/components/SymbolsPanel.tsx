import React from 'react';
import { Home, Square, Type, Spline } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ICON_LG } from './ui/icons';

export const SymbolsPanel: React.FC = () => {
  const { activeSymbolId, setActiveSymbolId, tool, setTool, consumerVariant, setConsumerVariant } = useDrawingStore();

  const isSymbolActive = (id: string) => tool === 'symbol' && activeSymbolId === id;

  return (
    <div className="flex flex-col w-14 md:w-16 bg-white/95 border-r border-b border-ios-separator items-center py-2 gap-1 z-10 flex-shrink-0 overflow-y-auto no-scrollbar self-start max-h-[calc(100%-80px)] rounded-br-panel shadow-float touch-manipulation">
      <div className="text-[10px] font-semibold text-ios-secondary uppercase tracking-wide pt-1 hidden md:block">Tools</div>

      {/* Text Tool */}
      <button 
        onClick={() => setTool('text')}
        className={`ui-icon-btn ${tool === 'text' ? 'is-active' : ''}`}
        title="Text"
        aria-label="Text"
      >
        <Type {...ICON_LG} />
      </button>

      {/* Arc Tool */}
      <button 
        onClick={() => setTool('arc')}
        className={`ui-icon-btn ${tool === 'arc' ? 'is-active' : ''}`}
        title="Arc"
        aria-label="Arc"
      >
        <Spline {...ICON_LG} />
      </button>

      <div className="ui-sep-h" aria-hidden="true" />

      <div className="text-[10px] font-semibold text-ios-secondary uppercase tracking-wide pt-1 hidden md:block">Sym</div>
      
      {/* Consumer (Circle) */}
      <button 
        onClick={() => { setTool('consumer'); setConsumerVariant('circle'); }}
        className={`ui-icon-btn is-symbol ${tool === 'consumer' && consumerVariant === 'circle' ? 'is-active' : ''}`}
        title="Consumer (Circle)"
        aria-label="Consumer (Circle)"
      >
        <Home {...ICON_LG} />
      </button>

      {/* Consumer (Square) */}
      <button 
        onClick={() => { setTool('consumer'); setConsumerVariant('square'); }}
        className={`ui-icon-btn is-symbol ${tool === 'consumer' && consumerVariant === 'square' ? 'is-active' : ''}`}
        title="Consumer (Square)"
        aria-label="Consumer (Square)"
      >
        <Square {...ICON_LG} />
      </button>

      <div className="ui-sep-h" aria-hidden="true" />

      {/* LV Pole: Hollow Circle */}
      <button 
        onClick={() => setActiveSymbolId('lv-pole')}
        className={`ui-icon-btn is-symbol ${isSymbolActive('lv-pole') ? 'is-active' : ''}`}
        title="LV Pole"
        aria-label="LV Pole"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" stroke="black" strokeWidth="2" fill="white" />
        </svg>
      </button>

      {/* MV Pole: Filled Circle */}
      <button 
        onClick={() => setActiveSymbolId('mv-pole')}
        className={`ui-icon-btn is-symbol ${isSymbolActive('mv-pole') ? 'is-active' : ''}`}
        title="MV Pole"
        aria-label="MV Pole"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" fill="black" />
        </svg>
      </button>

      {/* Transformer: Two Circles + Rectangle */}
      <button 
        onClick={() => setActiveSymbolId('transformer')}
        className={`ui-icon-btn is-symbol ${isSymbolActive('transformer') ? 'is-active' : ''}`}
        title="Transformer"
        aria-label="Transformer"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="9" r="5" stroke="black" strokeWidth="1.5" />
          <circle cx="8" cy="15" r="5" stroke="black" strokeWidth="1.5" />
          <rect x="15" y="6" width="5" height="12" stroke="black" strokeWidth="1.5" />
        </svg>
      </button>

      {/* Lattice Iron Pole: Square with X */}
      <button 
        onClick={() => setActiveSymbolId('lattice-iron-pole')}
        className={`ui-icon-btn is-symbol ${isSymbolActive('lattice-iron-pole') ? 'is-active' : ''}`}
        title="Lattice Iron Pole"
        aria-label="Lattice Iron Pole"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="4" width="16" height="16" stroke="black" strokeWidth="2" fill="white" />
          <line x1="4" y1="4" x2="20" y2="20" stroke="black" strokeWidth="2" />
          <line x1="20" y1="4" x2="4" y2="20" stroke="black" strokeWidth="2" />
        </svg>
      </button>

      {/* Distribution Box: Rectangle 3:1 */}
      <button 
        onClick={() => setActiveSymbolId('distribution-box')}
        className={`ui-icon-btn is-symbol ${isSymbolActive('distribution-box') ? 'is-active' : ''}`}
        title="Distribution Box"
        aria-label="Distribution Box"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="8" width="20" height="8" rx="1" stroke="#2563eb" strokeWidth="2" fill="white" />
        </svg>
      </button>

      {/* Small Dot Pole: Small dot with full touch area */}
      <button 
        onClick={() => setActiveSymbolId('small-dot-pole')}
        className={`ui-icon-btn is-symbol ${isSymbolActive('small-dot-pole') ? 'is-active' : ''}`}
        title="Small Dot Pole"
        aria-label="Small Dot Pole"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Invisible touch area circle */}
          <circle cx="12" cy="12" r="10" fill="transparent" />
          {/* Small dot in center */}
          <circle cx="12" cy="12" r="2" fill="black" />
        </svg>
      </button>
    </div>
  );
};

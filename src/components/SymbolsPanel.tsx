import React from 'react';
import { Home, Square, Type, Spline } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';

export const SymbolsPanel: React.FC = () => {
  const { activeSymbolId, setActiveSymbolId, tool, setTool, consumerVariant, setConsumerVariant } = useDrawingStore();

  const isSymbolActive = (id: string) => tool === 'symbol' && activeSymbolId === id;

  return (
    <div className="flex flex-col w-12 tablet-lg:w-16 md:w-16 bg-white border-r border-b border-gray-200 items-center py-4 space-y-4 z-10 flex-shrink-0 overflow-y-auto self-start max-h-[calc(100%-80px)] rounded-br-xl shadow-sm touch-manipulation">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 hidden md:block">Tools</div>

      {/* Text Tool */}
      <button 
        onClick={() => setTool('text')}
        className={`p-2 rounded-lg transition-colors ${
          tool === 'text' ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Text"
      >
        <Type size={24} className="text-gray-700" />
      </button>

      {/* Arc Tool */}
      <button 
        onClick={() => setTool('arc')}
        className={`p-2 rounded-lg transition-colors ${
          tool === 'arc' ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Arc"
      >
        <Spline size={24} className="text-gray-700" />
      </button>

      <div className="w-8 h-px bg-gray-200 my-2" />

      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 hidden md:block">Sym</div>
      
      {/* Consumer (Circle) */}
      <button 
        onClick={() => { setTool('consumer'); setConsumerVariant('circle'); }}
        className={`p-2 rounded-lg transition-colors ${
          tool === 'consumer' && consumerVariant === 'circle' ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Consumer (Circle)"
      >
        <Home size={24} className="text-gray-700" />
      </button>

      {/* Consumer (Square) */}
      <button 
        onClick={() => { setTool('consumer'); setConsumerVariant('square'); }}
        className={`p-2 rounded-lg transition-colors ${
          tool === 'consumer' && consumerVariant === 'square' ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Consumer (Square)"
      >
        <Square size={24} className="text-gray-700" />
      </button>

      <div className="w-8 h-px bg-gray-200 my-2" />

      {/* LV Pole: Hollow Circle */}
      <button 
        onClick={() => setActiveSymbolId('lv-pole')}
        className={`p-2 rounded-lg transition-colors ${
          isSymbolActive('lv-pole') ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="LV Pole"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" stroke="black" strokeWidth="2" fill="white" />
        </svg>
      </button>

      {/* MV Pole: Filled Circle */}
      <button 
        onClick={() => setActiveSymbolId('mv-pole')}
        className={`p-2 rounded-lg transition-colors ${
          isSymbolActive('mv-pole') ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="MV Pole"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" fill="black" />
        </svg>
      </button>

      {/* Transformer: Two Circles + Rectangle */}
      <button 
        onClick={() => setActiveSymbolId('transformer')}
        className={`p-2 rounded-lg transition-colors ${
          isSymbolActive('transformer') ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Transformer"
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
        className={`p-2 rounded-lg transition-colors ${
          isSymbolActive('lattice-iron-pole') ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Lattice Iron Pole"
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
        className={`p-2 rounded-lg transition-colors ${
          isSymbolActive('distribution-box') ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Distribution Box"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="8" width="20" height="8" rx="1" stroke="#2563eb" strokeWidth="2" fill="white" />
        </svg>
      </button>

      {/* Small Dot Pole: Small dot with full touch area */}
      <button 
        onClick={() => setActiveSymbolId('small-dot-pole')}
        className={`p-2 rounded-lg transition-colors ${
          isSymbolActive('small-dot-pole') ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-gray-100'
        }`}
        title="Small Dot Pole"
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

import React, { useState } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import { Minus, Plus, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';

const COLORS = [
  '#000000', // Black
  '#EF4444', // Red
  '#3B82F6', // Blue
  '#38BDF8', // Light Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#6B7280', // Gray
  '#F97316', // Orange
  '#8B5CF6', // Purple
  '#78350F', // Brown
];

export const StylePanel: React.FC = () => {
  const { style, setStyle, selectedId, elements, updateElement, updateElements, poleSizeScale, setPoleSizeScale, distanceTextScale, setDistanceTextScale, consumerSizeScale, setConsumerSizeScale, showDistanceLabels, setShowDistanceLabels, updateSymbolModifiers } = useDrawingStore();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const selectedElement = selectedId ? elements.find(e => e.id === selectedId) : null;

  const handleColorChange = (color: string) => {
    setStyle({ strokeColor: color });
    if (selectedId) {
      const updates: any = { strokeColor: color };
      if (selectedElement?.type === 'text') {
        updates.fillColor = color;
      }
      // For shapes, also update fillColor if it's not transparent
      if (selectedElement?.type === 'shape') {
        updates.fillColor = color;
      }
      updateElement(selectedId, updates);
    }
  };

  const handleWidthChange = (width: number) => {
    setStyle({ strokeWidth: width });
    if (selectedId) {
      updateElement(selectedId, { strokeWidth: width });
    }
  };

  const handleTextSizeChange = (delta: number) => {
    if (selectedId && selectedElement?.type === 'text') {
      const currentSize = (selectedElement as any).fontSize || 16;
      const newSize = Math.max(8, Math.min(72, currentSize + delta));
      updateElement(selectedId, { fontSize: newSize });
    }
  };

  const handleArrowModeChange = (mode: 'none' | 'start' | 'end') => {
    if (selectedId && selectedElement?.type === 'cable') {
      updateElement(selectedId, { arrowMode: mode });
    }
  };

  const handleCableTypeChange = (type: 'overhead' | 'ground') => {
    if (selectedId && selectedElement?.type === 'cable') {
      updateElement(selectedId, { cableType: type });
    }
  };

  const handleScaleChange = (delta: number) => {
    const newScale = Math.max(0.5, Math.min(3, poleSizeScale + delta));
    setPoleSizeScale(newScale);
  };

  const handleDistanceScaleChange = (delta: number) => {
    const newScale = Math.max(0.5, Math.min(3, distanceTextScale + delta));
    setDistanceTextScale(newScale);
  };

  const handleConsumerScaleChange = (delta: number) => {
    const newScale = Math.max(0.5, Math.min(3, consumerSizeScale + delta));
    setConsumerSizeScale(newScale);
  };

  const handleNoteColorChange = (color: string) => {
    if (selectedId && selectedElement?.type === 'symbol') {
      const symbol = selectedElement as any;
      if (symbol.modifiers?.note) {
        updateSymbolModifiers(selectedId, {
          note: { ...symbol.modifiers.note, color }
        });
      }
    }
  };

  const handleNoteFontSizeChange = (delta: number) => {
    if (selectedId && selectedElement?.type === 'symbol') {
      const symbol = selectedElement as any;
      if (symbol.modifiers?.note) {
        const currentSize = symbol.modifiers.note.fontSize || 12;
        const newSize = Math.max(8, Math.min(32, currentSize + delta));
        updateSymbolModifiers(selectedId, {
          note: { ...symbol.modifiers.note, fontSize: newSize }
        });
      }
    }
  };

  return (
    <div className={`bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-10 transition-all duration-300 ease-in-out ${isCollapsed ? 'pb-2' : 'pb-safe-bottom'}`}>
      {/* Drag Handle / Toggle */}
      <div 
        className="flex items-center justify-center py-2 cursor-pointer hover:bg-gray-50 active:bg-gray-100"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="w-12 h-1.5 bg-gray-300 rounded-full mb-1" />
      </div>

      {!isCollapsed && (
        <div className="px-4 pb-4 flex flex-col space-y-4 max-w-mobile mx-auto">
        
        {/* Pole Size Control */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase">Pole Size</span>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => handleScaleChange(-0.1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              aria-label="Decrease pole size"
            >
              <Minus size={16} />
            </button>
            <span className="text-sm font-medium w-8 text-center">{Math.round(poleSizeScale * 100)}%</span>
            <button
              onClick={() => handleScaleChange(0.1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              aria-label="Increase pole size"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Consumer Size Control */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase">Consumer Size</span>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => handleConsumerScaleChange(-0.1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              aria-label="Decrease consumer size"
            >
              <Minus size={16} />
            </button>
            <span className="text-sm font-medium w-8 text-center">{Math.round(consumerSizeScale * 100)}%</span>
            <button
              onClick={() => handleConsumerScaleChange(0.1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              aria-label="Increase consumer size"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Distance Text Size Control */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase">Distance Text</span>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => handleDistanceScaleChange(-0.1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              aria-label="Decrease text size"
            >
              <Minus size={16} />
            </button>
            <span className="text-sm font-medium w-8 text-center">
              {Math.round(distanceTextScale * 100)}%
            </span>
            <button
              onClick={() => handleDistanceScaleChange(0.1)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
              aria-label="Increase text size"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Show/Hide Distance Labels */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase">Show Distances</span>
          <button
            onClick={() => setShowDistanceLabels(!showDistanceLabels)}
            className={`p-2 rounded-lg transition-colors ${
              showDistanceLabels 
                ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' 
                : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
            }`}
            aria-label={showDistanceLabels ? 'Hide distance labels' : 'Show distance labels'}
          >
            {showDistanceLabels ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>

        {/* Text Size Control */}
        {selectedElement?.type === 'text' && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 uppercase">Text Size</span>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => handleTextSizeChange(-2)}
                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                aria-label="Decrease text size"
              >
                <Minus size={16} />
              </button>
              <span className="text-sm font-medium w-8 text-center">
                {(selectedElement as any).fontSize || 16}
              </span>
              <button
                onClick={() => handleTextSizeChange(2)}
                className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                aria-label="Increase text size"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Note Controls */}
        {selectedElement?.type === 'symbol' && (selectedElement as any).modifiers?.note && (
          <div className="flex flex-col space-y-3">
            {/* Note Font Size (Zoom) */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase">Note Size</span>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => handleNoteFontSizeChange(-2)}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                  aria-label="Decrease note size"
                >
                  <Minus size={16} />
                </button>
                <span className="text-sm font-medium w-8 text-center">{(selectedElement as any).modifiers?.note?.fontSize || 12}px</span>
                <button
                  onClick={() => handleNoteFontSizeChange(2)}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                  aria-label="Increase note size"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {/* Note Color */}
            <div className="flex flex-col space-y-2">
              <span className="text-xs font-medium text-gray-500 uppercase">Note Color</span>
              <div className="flex space-x-2 flex-wrap gap-2">
                {['white', '#E0F2FE', '#DCFCE7', '#FEF3C7', '#FEE2E2', '#F3E8FF', '#E0E7FF'].map(color => (
                  <button
                    key={color}
                    onClick={() => handleNoteColorChange(color)}
                    className={`w-8 h-8 rounded-full border border-gray-200 ${
                      ((selectedElement as any).modifiers?.note?.color === color || (!((selectedElement as any).modifiers?.note?.color) && color === 'white'))
                        ? 'ring-2 ring-blue-500 ring-offset-2' 
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={color}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Colors */}
        <div className="flex items-center space-x-4 overflow-x-auto pb-2 no-scrollbar">
          <span className="text-xs font-medium text-gray-500 uppercase">Color</span>
          <div className="flex space-x-3">
            {COLORS.map((color) => {
              const activeColor = selectedElement 
                ? (selectedElement.type === 'text' ? selectedElement.fillColor : selectedElement.strokeColor)
                : style.strokeColor;
                
              return (
                <button
                  key={color}
                  onClick={() => handleColorChange(color)}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${
                    activeColor === color ? 'border-blue-500 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Select color ${color}`}
                />
              );
            })}
          </div>
        </div>

        {/* Fill Color for Shapes */}
        {selectedElement?.type === 'shape' && (
          <div className="flex items-center space-x-4 overflow-x-auto pb-2 no-scrollbar">
            <span className="text-xs font-medium text-gray-500 uppercase">Fill</span>
            <div className="flex space-x-3">
              {/* Transparent option */}
              <button
                onClick={() => {
                  if (selectedId) {
                    updateElement(selectedId, { fillColor: 'transparent' });
                  }
                }}
                className={`w-8 h-8 rounded-full border-2 transition-transform flex items-center justify-center ${
                  (selectedElement as any).fillColor === 'transparent' ? 'border-blue-500 scale-110' : 'border-gray-300'
                }`}
                style={{ backgroundColor: 'white' }}
                aria-label="Transparent fill"
              >
                <Minus size={16} className="text-gray-400" />
              </button>
              {COLORS.map((color) => {
                const fillColor = (selectedElement as any).fillColor;
                return (
                  <button
                    key={`fill-${color}`}
                    onClick={() => {
                      if (selectedId) {
                        updateElement(selectedId, { fillColor: color });
                      }
                    }}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      fillColor === color ? 'border-blue-500 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Fill color ${color}`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Widths */}
        {selectedElement?.type !== 'text' && (
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase">Line Width</span>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => handleWidthChange(Math.max(0.5, (selectedElement ? selectedElement.strokeWidth : style.strokeWidth) - 0.5))}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                  aria-label="Decrease line width"
                >
                  <Minus size={16} />
                </button>
                <span className="text-sm font-medium w-8 text-center">
                  {selectedElement ? selectedElement.strokeWidth : style.strokeWidth}
                </span>
                <button
                  onClick={() => handleWidthChange(Math.min(20, (selectedElement ? selectedElement.strokeWidth : style.strokeWidth) + 0.5))}
                  className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200"
                  aria-label="Increase line width"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            
            {selectedElement?.type === 'cable' && (
              <button
                onClick={() => {
                  const updates = elements
                    .filter(el => el.type === 'cable')
                    .map(el => ({ id: el.id, changes: { strokeWidth: selectedElement.strokeWidth } }));
                  updateElements(updates);
                }}
                className="w-full py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-100"
              >
                Apply Width to All Cables
              </button>
            )}
          </div>
        )}

        {/* Cable Controls */}
        {selectedElement?.type === 'cable' && (
          <div className="space-y-4 border-t border-gray-100 pt-4">
            {/* Cable Type */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase">Type</span>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => handleCableTypeChange('overhead')}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    (selectedElement as any).cableType !== 'ground'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Overhead
                </button>
                <button
                  onClick={() => handleCableTypeChange('ground')}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    (selectedElement as any).cableType === 'ground'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Ground
                </button>
              </div>
            </div>

            {/* Arrow Mode */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase">Arrow</span>
            <div className="flex items-center space-x-2">
              {(['none', 'start', 'end'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleArrowModeChange(mode)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    ((selectedElement as any).arrowMode === mode || (!(selectedElement as any).arrowMode && mode === 'none'))
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
          </div>
        )}

        </div>
      )}
    </div>
  );
};
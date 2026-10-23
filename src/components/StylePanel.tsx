import React, { useEffect, useRef, useState } from 'react';
import { normColor } from '../utils/network';
import { isSmallScreen } from '../utils/smallScreen';
import { useDrawingStore } from '../store/drawingStore';
import { Minus, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { ICON_SM } from './ui/icons';

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
  // more, each easy to tell apart from the ones above
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#84CC16', // Lime
  '#1E3A8A', // Navy
  '#7F1D1D', // Maroon
  '#166534', // Dark Green
  '#C026D3', // Magenta
  '#A16207', // Gold
];

const sameColour = (a: string | undefined, b: string | undefined) => normColor(a) === normColor(b);
/** a colour as the colour input needs it (#rrggbb), or black */
const toHex = (c: string | undefined) => { const v = (c || '').trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((x) => x + x).join('')}`.toLowerCase() : '#000000'; };

/** Choose any colour: applied once, when the picker is closed (not on every move of it). */
const CustomColour: React.FC<{ value: string; active: boolean; onPick: (c: string) => void }> = ({ value, active, onPick }) => {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick); pick.current = onPick;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onChange = () => pick.current(el.value.toUpperCase());
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return (
    <label className={`ui-swatch relative flex cursor-pointer items-center justify-center overflow-hidden ${active ? 'is-active' : ''}`}
      style={{ background: 'conic-gradient(#ef4444, #f59e0b, #84cc16, #14b8a6, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }} aria-label="Custom colour">
      <span className="h-3 w-3 rounded-full bg-white ring-1 ring-black/20" />
      <input ref={ref} type="color" defaultValue={toHex(value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Choose a custom colour" />
    </label>
  );
};

/** event that unfolds the properties panel (the look of the selected element) */
export const OPEN_STYLE_PANEL_EVENT = 'lv:open-style-panel';

export const StylePanel: React.FC = () => {
  const { style, setStyle, selectedId, elements, updateElement, updateElements, poleSizeScale, setPoleSizeScale, distanceTextScale, setDistanceTextScale, consumerSizeScale, setConsumerSizeScale, showDistanceLabels, setShowDistanceLabels, updateSymbolModifiers } = useDrawingStore();
  // starts folded on a phone (the drawing keeps its room), open on a desktop as before; the user's
  // choice is kept from then on (also through full-screen mode, where the panel stays mounted)
  const [isCollapsed, setIsCollapsed] = useState(isSmallScreen);
  // «تنسيق الكيبل» of the cable chooser (SketchCanvas) unfolds this panel; nothing else changes
  useEffect(() => { const open = () => setIsCollapsed(false); window.addEventListener(OPEN_STYLE_PANEL_EVENT, open); return () => window.removeEventListener(OPEN_STYLE_PANEL_EVENT, open); }, []);

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
    <div className={`bg-white rounded-t-panel shadow-sheet z-10 transition-all duration-300 ease-in-out ${isCollapsed ? 'pb-2' : ''}`}>
      {/* Drag Handle / Toggle */}
      <div 
        className="flex items-center justify-center h-6 cursor-pointer rounded-t-panel active:bg-ios-fill"
        onClick={() => setIsCollapsed(!isCollapsed)}
        role="button"
        aria-label={isCollapsed ? 'Show properties' : 'Hide properties'}
        aria-expanded={!isCollapsed}
      >
        <div className="w-9 h-[5px] bg-ios-fill-strong rounded-full" />
      </div>

      {!isCollapsed && (
        <div className="px-4 pb-3 flex flex-col divide-y divide-ios-separator max-w-mobile mx-auto max-h-[45vh] [@media(max-height:500px)]:max-h-[30vh] overflow-y-auto overscroll-contain">
        
        {/* Pole Size Control */}
        <div className="ui-row">
          <span className="ui-row-label">Pole Size</span>
          <div className="flex items-center gap-3">
              <span className="ui-row-value">{Math.round(poleSizeScale * 100)}%</span>
              <div className="ui-stepper">
                <button onClick={() => handleScaleChange(-0.1)} className="ui-stepper-btn" aria-label="Decrease pole size">
                  <Minus {...ICON_SM} />
                </button>
                <div className="ui-stepper-div" aria-hidden="true" />
                <button onClick={() => handleScaleChange(0.1)} className="ui-stepper-btn" aria-label="Increase pole size">
                  <Plus {...ICON_SM} />
                </button>
              </div>
            </div>
        </div>

        {/* Consumer Size Control */}
        <div className="ui-row">
          <span className="ui-row-label">Consumer Size</span>
          <div className="flex items-center gap-3">
              <span className="ui-row-value">{Math.round(consumerSizeScale * 100)}%</span>
              <div className="ui-stepper">
                <button onClick={() => handleConsumerScaleChange(-0.1)} className="ui-stepper-btn" aria-label="Decrease consumer size">
                  <Minus {...ICON_SM} />
                </button>
                <div className="ui-stepper-div" aria-hidden="true" />
                <button onClick={() => handleConsumerScaleChange(0.1)} className="ui-stepper-btn" aria-label="Increase consumer size">
                  <Plus {...ICON_SM} />
                </button>
              </div>
            </div>
        </div>

        {/* Distance Text Size Control */}
        <div className="ui-row">
          <span className="ui-row-label">Distance Text</span>
          <div className="flex items-center gap-3">
              <span className="ui-row-value">{Math.round(distanceTextScale * 100)}%</span>
              <div className="ui-stepper">
                <button onClick={() => handleDistanceScaleChange(-0.1)} className="ui-stepper-btn" aria-label="Decrease text size">
                  <Minus {...ICON_SM} />
                </button>
                <div className="ui-stepper-div" aria-hidden="true" />
                <button onClick={() => handleDistanceScaleChange(0.1)} className="ui-stepper-btn" aria-label="Increase text size">
                  <Plus {...ICON_SM} />
                </button>
              </div>
            </div>
        </div>

        {/* Show/Hide Distance Labels */}
        <div className="ui-row">
          <span className="ui-row-label">Show Distances</span>
          <button
            onClick={() => setShowDistanceLabels(!showDistanceLabels)}
            className="ui-switch"
            role="switch"
            aria-checked={showDistanceLabels}
            aria-label={showDistanceLabels ? 'Hide distance labels' : 'Show distance labels'}
          >
            <span className="ui-switch-knob" />
          </button>
        </div>

        {/* Text Size Control */}
        {selectedElement?.type === 'text' && (
          <div className="ui-row">
            <span className="ui-row-label">Text Size</span>
            <div className="flex items-center gap-3">
              <span className="ui-row-value">{(selectedElement as any).fontSize || 16}</span>
              <div className="ui-stepper">
                <button onClick={() => handleTextSizeChange(-2)} className="ui-stepper-btn" aria-label="Decrease text size">
                  <Minus {...ICON_SM} />
                </button>
                <div className="ui-stepper-div" aria-hidden="true" />
                <button onClick={() => handleTextSizeChange(2)} className="ui-stepper-btn" aria-label="Increase text size">
                  <Plus {...ICON_SM} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Note Controls */}
        {selectedElement?.type === 'symbol' && (selectedElement as any).modifiers?.note && (
          <div className="flex flex-col">
            {/* Note Font Size (Zoom) */}
            <div className="ui-row">
              <span className="ui-row-label">Note Size</span>
              <div className="flex items-center gap-3">
              <span className="ui-row-value">{(selectedElement as any).modifiers?.note?.fontSize || 12}px</span>
              <div className="ui-stepper">
                <button onClick={() => handleNoteFontSizeChange(-2)} className="ui-stepper-btn" aria-label="Decrease note size">
                  <Minus {...ICON_SM} />
                </button>
                <div className="ui-stepper-div" aria-hidden="true" />
                <button onClick={() => handleNoteFontSizeChange(2)} className="ui-stepper-btn" aria-label="Increase note size">
                  <Plus {...ICON_SM} />
                </button>
              </div>
            </div>
            </div>

            {/* Note Color */}
            <div className="flex flex-col gap-1 py-2">
              <span className="ui-row-label">Note Color</span>
              <div className="flex flex-wrap gap-3 p-1">
                {['white', '#E0F2FE', '#DCFCE7', '#FEF3C7', '#FEE2E2', '#F3E8FF', '#E0E7FF'].map(color => (
                  <button
                    key={color}
                    onClick={() => handleNoteColorChange(color)}
                    className={`ui-swatch ${
                      ((selectedElement as any).modifiers?.note?.color === color || (!((selectedElement as any).modifiers?.note?.color) && color === 'white'))
                        ? 'is-active' 
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

        {/* Colors: the set ones, then the other colours used in the drawing (once each), then any colour */}
        <div className="ui-row overflow-x-auto no-scrollbar">
          <span className="ui-row-label">Color</span>
          <div className="flex gap-3 p-1">
            {(() => {
              const activeColor = selectedElement
                ? (selectedElement.type === 'text' ? selectedElement.fillColor : selectedElement.strokeColor)
                : style.strokeColor;
              const used: string[] = [];
              for (const e of elements) if (e.type === 'cable' && e.strokeColor && !COLORS.some((c) => sameColour(c, e.strokeColor)) && !used.some((c) => sameColour(c, e.strokeColor))) used.push(e.strokeColor);
              const known = [...COLORS, ...used].some((c) => sameColour(c, activeColor));
              return (
                <>
                  {[...COLORS, ...used].map((color) => (
                    <button
                      key={normColor(color)}
                      onClick={() => handleColorChange(color)}
                      className={`ui-swatch ${sameColour(activeColor, color) ? 'is-active' : ''}`}
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                  <CustomColour key={toHex(activeColor)} value={activeColor} active={!known} onPick={handleColorChange} />
                </>
              );
            })()}
          </div>
        </div>

        {/* Fill Color for Shapes */}
        {selectedElement?.type === 'shape' && (
          <div className="ui-row overflow-x-auto no-scrollbar">
            <span className="ui-row-label">Fill</span>
            <div className="flex gap-3 p-1">
              {/* Transparent option */}
              <button
                onClick={() => {
                  if (selectedId) {
                    updateElement(selectedId, { fillColor: 'transparent' });
                  }
                }}
                className={`ui-swatch flex items-center justify-center ${(selectedElement as any).fillColor === 'transparent' ? 'is-active' : ''}`}
                style={{ backgroundColor: 'white' }}
                aria-label="Transparent fill"
              >
                <Minus {...ICON_SM} className="text-ios-tertiary" />
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
                    className={`ui-swatch ${fillColor === color ? 'is-active' : ''}`}
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
          <div className="flex flex-col">
            <div className="ui-row">
              <span className="ui-row-label">Line Width</span>
              <div className="flex items-center gap-3">
              <span className="ui-row-value">{selectedElement ? selectedElement.strokeWidth : style.strokeWidth}</span>
              <div className="ui-stepper">
                <button onClick={() => handleWidthChange(Math.max(0.5, (selectedElement ? selectedElement.strokeWidth : style.strokeWidth) - 0.5))} className="ui-stepper-btn" aria-label="Decrease line width">
                  <Minus {...ICON_SM} />
                </button>
                <div className="ui-stepper-div" aria-hidden="true" />
                <button onClick={() => handleWidthChange(Math.min(20, (selectedElement ? selectedElement.strokeWidth : style.strokeWidth) + 0.5))} className="ui-stepper-btn" aria-label="Increase line width">
                  <Plus {...ICON_SM} />
                </button>
              </div>
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
                className="ui-tinted-btn mb-2"
              >
                Apply Width to All Cables
              </button>
            )}
          </div>
        )}

        {/* Cable Controls */}
        {selectedElement?.type === 'cable' && (
          <div className="flex flex-col divide-y divide-ios-separator">
            {/* Cable Type */}
            <div className="ui-row">
              <span className="ui-row-label">Type</span>
              <div className="ui-segment">
                <button
                  onClick={() => handleCableTypeChange('overhead')}
                  className={`ui-segment-item ${(selectedElement as any).cableType !== 'ground' ? 'is-active' : ''}`}
                >
                  Overhead
                </button>
                <button
                  onClick={() => handleCableTypeChange('ground')}
                  className={`ui-segment-item ${(selectedElement as any).cableType === 'ground' ? 'is-active' : ''}`}
                >
                  Ground
                </button>
              </div>
            </div>

            {/* Arrow Mode */}
            <div className="ui-row">
              <span className="ui-row-label">Arrow</span>
            <div className="ui-segment">
              {(['none', 'start', 'end'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleArrowModeChange(mode)}
                  className={`ui-segment-item ${((selectedElement as any).arrowMode === mode || (!(selectedElement as any).arrowMode && mode === 'none')) ? 'is-active' : ''}`}
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
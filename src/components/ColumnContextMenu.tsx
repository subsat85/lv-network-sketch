import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import { SymbolElement, CableElement, TextElement } from '../types/drawing';
import { Check } from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 9);

interface ColumnContextMenuProps {
  elementId: string;
  position: { x: number; y: number };
  onClose: () => void;
  onStartArc?: (poleId: string) => void;
  onOpenCableEnds?: (poleId: string) => void;
}

export const ColumnContextMenu: React.FC<ColumnContextMenuProps> = ({ elementId, position, onClose, onStartArc, onOpenCableEnds }) => {
  const { elements, updateSymbolModifiers, updateElement, addElement, saveHistory } = useDrawingStore();
  const element = elements.find(el => el.id === elementId) as SymbolElement;
  const menuRef = useRef<HTMLDivElement>(null);
  const [showCableNumberMenu, setShowCableNumberMenu] = useState(false);
  
  // Find all cables connected to this pole
  const connectedCables = elements.filter(el => 
    el.type === 'cable' && (el as CableElement).poleIds.includes(elementId)
  ) as CableElement[];
  // connection points = each side of each visit of this pole by a cable
  const connectionPointCount = connectedCables.reduce((n, c) =>
    n + c.poleIds.reduce((m, id, i) => m + (id === elementId ? (i > 0 ? 1 : 0) + (i < c.poleIds.length - 1 ? 1 : 0) : 0), 0), 0);
  
  // Get unique cable colors
  const cableColors = [...new Set(connectedCables.map(c => c.strokeColor))];
  // cable ends here that meet another cable of their colour (or already have a setting)
  const endingHere = connectedCables.filter(c => c.poleIds[0] === elementId || c.poleIds[c.poleIds.length - 1] === elementId);
  const showCableEnds = endingHere.some(c => !!c.endLinks || connectedCables.some(o => o.id !== c.id && o.strokeColor.toLowerCase() === c.strokeColor.toLowerCase()));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Screen position after keeping the menu inside the visible viewport.
  // Default: centred above the tap point; flips below / slides sideways near edges.
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const margin = 8;
    const gap = 10;
    let top = position.y - h - gap;
    if (top < margin) top = position.y + gap;
    top = Math.max(margin, Math.min(top, vh - h - margin));
    const left = Math.max(margin, Math.min(position.x - w / 2, vw - w - margin));
    setPlaced(prev => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [position.x, position.y, showCableNumberMenu, element?.type]);

  if (!element || element.type !== 'symbol') return null;

  const modifiers = element.modifiers || {};

  const toggleTilted = () => {
    updateSymbolModifiers(elementId, { isTilted: !modifiers.isTilted });
  };

  const toggleRusted = () => {
    updateSymbolModifiers(elementId, { isRusted: !modifiers.isRusted });
  };

  const toggleProposed = () => {
    updateElement(elementId, { isProposed: !element.isProposed });
  };

  const toggleProposedReplacement = () => {
    updateSymbolModifiers(elementId, { isProposedReplacement: !modifiers.isProposedReplacement });
  };

  const toggleNote = () => {
    if (modifiers.note) {
      // Remove note
      updateSymbolModifiers(elementId, { note: undefined } as any);
    } else {
      // Add note
      updateSymbolModifiers(elementId, { 
        note: { 
          text: 'Note', 
          x: element.x + 40, 
          y: element.y - 40,
          fontSize: 12,
          color: 'white'
        } 
      });
    }
  };

  const handleAddCableNumber = (color: string) => {
    const cableNumber = prompt('أدخل رقم الكابل (ترتيب الكوابل من الأعلى):');
    if (cableNumber && cableNumber.trim() !== '') {
      saveHistory();
      const numberText = cableNumber.trim();
      
      // Find existing cable numbers near this pole (same x position, stacked vertically)
      const existingCableNumbers = elements.filter(el => 
        el.type === 'text' && 
        Math.abs(el.x - (element.x + 35)) < 10 &&
        el.y > element.y - 100 &&
        el.y < element.y
      );
      
      // Calculate position - each new number is 18px below the previous
      const cableNumberIndex = existingCableNumbers.length;
      const yOffset = element.y - 30 - (cableNumberIndex * 18);
      
      // Create text element for cable number
      const textElement: TextElement = {
        id: generateId(),
        type: 'text',
        x: element.x + 35,
        y: yOffset,
        text: numberText,
        fontSize: 14,
        strokeColor: color,
        fillColor: color,
        strokeWidth: 1,
        rotation: 0
      };
      
      addElement(textElement);
      setShowCableNumberMenu(false);
      onClose();
    }
  };

  return (
    <div 
      ref={menuRef}
      className="fixed z-[51] ui-float !rounded-[14px] py-1 flex flex-col min-w-[220px] divide-y divide-ios-separator"
      role="menu"
      style={placed ? { left: placed.left, top: placed.top } : {
        left: position.x, 
        top: position.y,
        transform: 'translate(-50%, -100%) translateY(-10px)' 
      }}
    >
      <button 
        className={`ui-menu-item ${element.isProposed ? 'text-ios-red font-medium' : ''}`}
        role="menuitemcheckbox"
        aria-checked={!!(element.isProposed)}
        onClick={toggleProposed}
      >
        <span>Proposed Pole</span>
        {(element.isProposed) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
      </button>
      <button 
        className={`ui-menu-item ${modifiers.isProposedReplacement ? 'text-ios-red font-medium' : ''}`}
        role="menuitemcheckbox"
        aria-checked={!!(modifiers.isProposedReplacement)}
        onClick={toggleProposedReplacement}
      >
        <span>Proposed Replacement</span>
        {(modifiers.isProposedReplacement) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
      </button>
      <button 
        className={`ui-menu-item ${modifiers.isTilted ? 'text-ios-red font-medium' : ''}`}
        role="menuitemcheckbox"
        aria-checked={!!(modifiers.isTilted)}
        onClick={toggleTilted}
      >
        <span>Tilted</span>
        {(modifiers.isTilted) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
      </button>
      <button 
        className={`ui-menu-item ${modifiers.isRusted ? 'text-ios-red font-medium' : ''}`}
        role="menuitemcheckbox"
        aria-checked={!!(modifiers.isRusted)}
        onClick={toggleRusted}
      >
        <span>Rusted</span>
        {(modifiers.isRusted) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
      </button>
      {element.symbolId !== 'transformer' && (
        <button 
          className={`ui-menu-item ${modifiers.note ? 'text-ios-blue font-medium' : ''}`}
          role="menuitemcheckbox"
          aria-checked={!!(modifiers.note)}
          onClick={toggleNote}
        >
          <span>{modifiers.note ? 'Remove Note' : 'Add Note'}</span>
          {(modifiers.note) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
        </button>
      )}
      
      {/* Supply point of the voltage-drop calculation (Stage 7) */}
      {connectedCables.length > 0 && (
        <button
          className={`ui-menu-item ${modifiers.vdSource ? 'text-ios-blue font-medium' : ''}`}
          role="menuitemcheckbox"
          aria-checked={!!modifiers.vdSource}
          onClick={() => updateSymbolModifiers(elementId, { vdSource: !modifiers.vdSource })}
        >
          <span>مصدر التغذية (هبوط الفولتية)</span>
          {modifiers.vdSource && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
        </button>
      )}

      {/* How the cable ends here connect: auto / connected / isolated (Stage 7.9) */}
      {onOpenCableEnds && showCableEnds && (
        <button
          className="ui-menu-item"
          role="menuitem"
          onClick={() => { onOpenCableEnds(elementId); onClose(); }}
        >
          ربط الكوابل عند هذا العمود
        </button>
      )}

      {/* Jumper (cable_arc): link two cable connection points at this pole */}
      {onStartArc && connectionPointCount >= 2 && (
        <button
          className="ui-menu-item"
          role="menuitem"
          onClick={() => { onStartArc(elementId); onClose(); }}
        >
          Jumper — وصلة ربط
        </button>
      )}

      {/* Cable Numbering Button */}
      {connectedCables.length > 0 && (
        <div className="relative">
          <button 
            className="ui-menu-item"
            role="menuitem"
            aria-expanded={showCableNumberMenu}
            onClick={() => setShowCableNumberMenu(!showCableNumberMenu)}
          >
            ترقيم الكوابل
          </button>
          
          {showCableNumberMenu && (
            <div className="absolute left-0 top-full mt-1 ui-float !rounded-[14px] py-1 flex flex-col z-50 min-w-[180px]">
              <div className="text-[13px] text-ios-secondary px-4 py-2 border-b border-ios-separator">
                اختر لون الكابل:
              </div>
              {cableColors.map((color, index) => (
                <button
                  key={index}
                  className="ui-menu-item !justify-start"
                  onClick={() => handleAddCableNumber(color)}
                >
                  <span 
                    className="w-4 h-4 rounded-full ring-1 ring-inset ring-black/10" 
                    style={{ backgroundColor: color }}
                  />
                  <span>لون الكابل</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

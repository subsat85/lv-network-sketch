import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import { SymbolElement, CableElement, TextElement } from '../types/drawing';
import { Check } from 'lucide-react';
import { toggleSuggestedSplit } from '../utils/cableArrows';
import { poleNamer } from '../utils/poleNames';
import { proposalLoadText } from '../utils/proposedConsumers';
import type { ConsumerElement } from '../types/drawing';

const generateId = () => Math.random().toString(36).substr(2, 9);

interface ColumnContextMenuProps {
  elementId: string;
  position: { x: number; y: number };
  onClose: () => void;
  onStartArc?: (poleId: string) => void;
  onOpenCableEnds?: (poleId: string) => void;
  /** «اقتراح مشترك جديد» (no id) / «تعديل المشترك المقترح» (its id) */
  onProposeConsumer?: (poleId: string, consumerId?: string) => void;
}

export const ColumnContextMenu: React.FC<ColumnContextMenuProps> = ({ elementId, position, onClose, onStartArc, onOpenCableEnds, onProposeConsumer }) => {
  const { elements, updateSymbolModifiers, updateElement, addElement, saveHistory } = useDrawingStore();
  const element = elements.find(el => el.id === elementId) as SymbolElement;
  const menuRef = useRef<HTMLDivElement>(null);
  const [showCableNumberMenu, setShowCableNumberMenu] = useState(false);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  
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
  // A menu taller than the room above and below the tap point goes on the side with more
  // room and scrolls inside, so it never covers the tapped pole (it can then still be dragged).
  const [placed, setPlaced] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.scrollHeight; // full content height, also while the menu is height-limited
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const margin = 8;
    const gap = 10;
    const spaceAbove = position.y - gap - margin, spaceBelow = vh - position.y - gap - margin;
    let top: number; let maxHeight: number | undefined;
    if (h <= spaceAbove || h <= spaceBelow) {
      // fits on one side: as before
      top = position.y - h - gap;
      if (top < margin) top = position.y + gap;
      top = Math.max(margin, Math.min(top, vh - h - margin));
    } else if (spaceBelow >= spaceAbove) { top = position.y + gap; maxHeight = Math.max(0, spaceBelow); }
    else { top = margin; maxHeight = Math.max(0, spaceAbove); }
    const left = Math.max(margin, Math.min(position.x - w / 2, vw - w - margin));
    setPlaced(prev => (prev && prev.left === left && prev.top === top && prev.maxHeight === maxHeight ? prev : { left, top, maxHeight }));
  }, [position.x, position.y, showCableNumberMenu, showSplitMenu, element?.type]);

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

  // «نقطة فصل مقترحة» on one cable at this pole (one undo step; the cable itself is not changed otherwise)
  const isSplitHere = (c: CableElement) => !!c.suggestedSplits?.includes(elementId);
  const toggleSplit = (c: CableElement) => {
    const patch = toggleSuggestedSplit(c, elementId);
    if (!patch) return;
    saveHistory();
    updateElement(c.id, patch);
    saveHistory();
  };
  const poleName = poleNamer(elements);
  const cableLabel = (c: CableElement) => `من ${poleName(c.poleIds[0])} إلى ${poleName(c.poleIds[c.poleIds.length - 1])}`;

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
      style={placed ? { left: placed.left, top: placed.top, ...(placed.maxHeight !== undefined ? { maxHeight: placed.maxHeight, overflowY: 'auto', overscrollBehavior: 'contain' } : {}) } : {
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

      {/* Suggested split point: the cable start / end arrow in red, on one chosen cable at this pole.
          Not offered on a transformer: cables start at its edge, so the start / end arrow is never drawn there. */}
      {element.symbolId !== 'transformer' && connectedCables.length === 1 && (
        <button
          className={`ui-menu-item ${isSplitHere(connectedCables[0]) ? 'text-ios-red font-medium' : ''}`}
          role="menuitemcheckbox"
          aria-checked={isSplitHere(connectedCables[0])}
          data-suggested-split-item={connectedCables[0].id}
          onClick={() => toggleSplit(connectedCables[0])}
        >
          <span>نقطة فصل مقترحة</span>
          {isSplitHere(connectedCables[0]) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
        </button>
      )}
      {element.symbolId !== 'transformer' && connectedCables.length > 1 && (
        <div>
          <button
            className={`ui-menu-item ${connectedCables.some(isSplitHere) ? 'text-ios-red font-medium' : ''}`}
            role="menuitem"
            aria-expanded={showSplitMenu}
            onClick={() => setShowSplitMenu(!showSplitMenu)}
          >
            <span>نقطة فصل مقترحة…</span>
            <span className="text-[13px] text-ios-secondary">{connectedCables.filter(isSplitHere).length || ''}</span>
          </button>
          {showSplitMenu && (
            <div className="flex flex-col border-t border-ios-separator" role="group" aria-label="اختر الكيبل لنقطة الفصل المقترحة">
              <div className="px-4 py-1.5 text-[12px] text-ios-secondary">اختر الكيبل:</div>
              {connectedCables.map((c) => (
                <button
                  key={c.id}
                  className={`ui-menu-item !justify-start gap-2 ${isSplitHere(c) ? 'text-ios-red font-medium' : ''}`}
                  role="menuitemcheckbox"
                  aria-checked={isSplitHere(c)}
                  data-suggested-split-item={c.id}
                  onClick={() => toggleSplit(c)}
                >
                  <span className="h-4 w-4 flex-shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: c.strokeColor }} />
                  <span className="flex-1 truncate">كيبل {cableLabel(c)}</span>
                  {isSplitHere(c) && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* «مشترك مقترح»: propose a new subscriber here / edit the ones proposed here */}
      {onProposeConsumer && connectedCables.length > 0 && (
        <button className="ui-menu-item" role="menuitem" data-propose-consumer="new" onClick={() => { onProposeConsumer(elementId); onClose(); }}>
          اقتراح مشترك جديد
        </button>
      )}
      {onProposeConsumer && elements.filter((e): e is ConsumerElement => e.type === 'consumer' && e.poleId === elementId && !!e.proposal).map((pc) => (
        <button key={pc.id} className="ui-menu-item" role="menuitem" data-propose-consumer={pc.id} onClick={() => { onProposeConsumer(elementId, pc.id); onClose(); }}>
          <span>تعديل المشترك المقترح</span>
          <span className="text-[13px] text-ios-secondary">{proposalLoadText(pc)}{pc.proposal!.status === 'confirmed' ? ' · معتمد' : ''}</span>
        </button>
      ))}

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

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ICON_SM } from './ui/icons';
import type { CableChoice } from '../utils/cableHits';

// Choosing among cables that lie under one touch (cableHits.ts), and then reaching the
// two separate pages of the chosen cable: its look (the properties panel: colour, width,
// type, arrow) and its electrical span data (the span sheet used by the voltage drop).
// Nothing here changes a cable; choosing only selects, as a tap on a single cable does.

/** keep panels off the tool columns at the sides of the screen (they float over the canvas on a phone) */
const SIDE = 58;
/** the free band between the side tool columns, within the canvas */
const band = (bounds: { left: number; right: number }) => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : bounds.right;
  // the right toolbar floats over the canvas and is a little wider than the left column
  const left = Math.max(bounds.left + 8, SIDE), right = Math.min(bounds.right, vw) - (SIDE + 6);
  return { left, right: Math.max(left + 120, right) };
};

/**
 * Closing on a touch elsewhere, Escape, or a change of the window size (a turned phone: the
 * panel's place would be wrong). `keepTouch`: a touch on the drawing that closes the panel
 * goes no further (it only closes: no selection, no menu, no drawing); a touch on the rest
 * of the interface (a button…) goes on as usual. Otherwise every touch goes on.
 */
const useOutside = (active: boolean, ref: React.RefObject<HTMLElement>, onOutside: () => void, keepTouch = false) => {
  const cb = useRef(onOutside); cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Element | null;
      if (!ref.current || ref.current.contains(t as Node)) return;
      if (keepTouch && t?.closest?.('[data-drawing-canvas]') && !t.closest('button, a, input, select, textarea')) {
        ev.stopPropagation(); ev.preventDefault();
        // and the click of that same touch (the proposal box opens on a click)
        const eat = (c: MouseEvent) => { if ((c.target as Element | null)?.closest?.('[data-drawing-canvas]')) { c.stopPropagation(); c.preventDefault(); } };
        document.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 600);
      }
      cb.current();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cb.current(); };
    const onResize = () => cb.current();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [active, ref, keepTouch]);
};

interface PickerProps {
  /** where the touch was (client coordinates) */
  at: { x: number; y: number };
  /** the canvas on screen (client coordinates) */
  bounds: { left: number; top: number; right: number; bottom: number };
  choices: CableChoice[];
  selectedId: string | null;
  onPick: (c: CableChoice) => void;
  onClose: () => void;
}

export const CablePicker: React.FC<PickerProps> = ({ at, bounds, choices, selectedId, onPick, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  // the touch that closes the list on the drawing only closes it
  useOutside(true, ref, onClose, true);
  const B = band(bounds);
  const w = Math.min(300, B.right - B.left);
  const left = Math.max(B.left, Math.min(at.x - w / 2, B.right - w));
  // the free height: the canvas down to the colour bar at its bottom (that bar stays usable)
  const bar = typeof document !== 'undefined' ? document.querySelector('[data-cable-colour-bar] .ui-float') : null;
  const floor = Math.min(bounds.bottom, bar ? bar.getBoundingClientRect().top : bounds.bottom) - 8, ceil = bounds.top + 8;
  const want = Math.min(32 + choices.length * 56, Math.max(140, (bounds.bottom - bounds.top) * 0.45));
  // above the finger when it fits (the finger hides what is under it), else below; if neither
  // fits, the side with more room, scrolling inside — never under the finger, never over the bar
  const roomAbove = at.y - 18 - ceil, roomBelow = floor - (at.y + 18);
  const above = roomAbove >= want || roomAbove >= roomBelow;
  const h = Math.max(96, Math.min(want, above ? roomAbove : roomBelow));
  const top = above ? at.y - 18 - h : at.y + 18;
  return (
    <div ref={ref} dir="rtl" role="listbox" aria-label="اختر الكيبل" data-cable-picker
      className="ui-float fixed z-40 overflow-y-auto overscroll-contain py-1"
      style={{ left, top: Math.max(ceil, top), width: w, maxHeight: h }}>
      <div className="px-3 py-1.5 text-[12px] text-ios-secondary">{choices.length} كوابل هنا — اختر واحداً</div>
      {choices.map((c) => {
        const isSel = c.cableId === selectedId;
        return (
          <button key={c.cableId} type="button" role="option" aria-selected={isSel} data-pick-cable={c.cableId}
            aria-label={`اختيار الكيبل ${c.ends}${c.extra ? ` (${c.extra})` : ''}`}
            onClick={() => onPick(c)}
            className={`flex min-h-[52px] w-full items-center gap-2.5 px-3 text-right active:bg-ios-fill ${isSel ? 'bg-ios-blue/[0.10]' : ''}`}>
            {/* a cable that would read the same as another one carries its number in its colour square */}
            <span className="relative h-7 w-7 flex-shrink-0 rounded-[7px] ring-1 ring-inset ring-black/10" style={{ backgroundColor: c.color }}>
              {c.extra && <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white [text-shadow:0_0_2px_rgba(0,0,0,0.9)]">{c.extra.replace(/\D+/g, '')}</span>}
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
              <span className={`max-w-full truncate text-[14px] text-ios-label ${isSel ? 'font-semibold' : ''}`}>{c.ends}</span>
              <span className="max-w-full whitespace-normal break-words text-[12px] text-ios-secondary">
                {c.spans}{c.spanHere ? ` · هنا: ${c.spanHere}` : ''}{c.extra ? ` · ${c.extra}` : ''}
              </span>
            </span>
            {isSel && <span className="flex-shrink-0 text-[12px] font-semibold text-ios-blue">محدَّد</span>}
          </button>
        );
      })}
    </div>
  );
};

interface ActionsProps {
  bounds: { left: number; top: number; right: number; bottom: number };
  choice: CableChoice;
  /** whether the look panel can be shown (it is hidden in full-screen drawing mode) */
  styleAvailable: boolean;
  onStyle: () => void;
  onDrop: () => void;
  onClose: () => void;
}

/** The chosen cable and its two pages, kept apart: «تنسيق الكيبل» and «خصائص الهبوط». */
export const CableActions: React.FC<ActionsProps> = ({ bounds, choice, styleAvailable, onStyle, onDrop, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(true, ref, onClose);
  const B = band(bounds);
  const w = Math.min(320, B.right - B.left);
  const left = (B.left + B.right) / 2 - w / 2;
  return (
    <div ref={ref} dir="rtl" role="toolbar" aria-label="الكيبل المحدد" data-cable-actions={choice.cableId}
      className="ui-float fixed z-40 px-3 py-2" style={{ left, top: bounds.top + 8, width: w }}>
      <div className="flex items-center gap-2">
        <span className="h-4 w-4 flex-shrink-0 rounded-[5px] ring-1 ring-inset ring-black/10" style={{ backgroundColor: choice.color }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ios-label">{choice.ends}{choice.extra ? ` · ${choice.extra}` : ''}</span>
        <button type="button" onClick={onClose} aria-label="إغلاق" className="ui-icon-btn h-7 w-7 flex-shrink-0"><X {...ICON_SM} /></button>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onStyle} disabled={!styleAvailable} data-open-style className="ui-tinted-btn !min-h-[40px] flex-1 !px-2 text-[14px] disabled:opacity-40">
          <span className="flex flex-col items-center leading-tight">
            <span>تنسيق الكيبل</span>
            {!styleAvailable ? <span className="text-[11px] font-normal">غير متاح بوضع الرسم الكامل</span> : null}
          </span>
        </button>
        <button type="button" onClick={onDrop} disabled={!choice.span} data-open-drop
          className="ui-tinted-btn !min-h-[40px] flex-1 !px-2 text-[14px] disabled:opacity-40">
          <span className="flex flex-col items-center leading-tight">
            <span>خصائص الهبوط</span>
            {choice.spanHere ? <span className="text-[11px] font-normal">{choice.spanHere}</span> : null}
          </span>
        </button>
      </div>
    </div>
  );
};

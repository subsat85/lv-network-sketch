import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Undo2, Redo2, History, GripHorizontal, Minimize2, Pencil, Square, Circle, Triangle, ArrowRight, Compass, Spline, Shapes } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ShapeType } from '../types/drawing';
import { ICON_MD } from './ui/icons';
import { useT } from '../store/localeStore';

const SHAPES: { id: ShapeType; icon: React.ReactNode }[] = [
  { id: 'rectangle', icon: <Square {...ICON_MD} /> },
  { id: 'circle', icon: <Circle {...ICON_MD} /> },
  { id: 'triangle', icon: <Triangle {...ICON_MD} /> },
  { id: 'arrow', icon: <ArrowRight {...ICON_MD} /> },
  { id: 'compass', icon: <Compass {...ICON_MD} /> },
  { id: 'curved_arrow', icon: <Spline {...ICON_MD} /> },
];

interface FloatingHistoryControlsProps {
  /** Full Screen Drawing Mode is on (App) */
  fullScreen?: boolean;
  /** buttons the panel must not cover (the full-screen «استعادة الواجهة» buttons) */
  avoidRef?: React.RefObject<HTMLElement>;
  /** changes when those buttons change size (e.g. «إنهاء الكابل» shown), to re-check in the same commit */
  avoidLayoutKey?: string | number;
}

const AVOID_GAP = 8;
const overlaps = (x: number, y: number, w: number, h: number, a: DOMRect) =>
  x < a.right + AVOID_GAP && x + w > a.left - AVOID_GAP && y < a.bottom + AVOID_GAP && y + h > a.top - AVOID_GAP;

export const FloatingHistoryControls: React.FC<FloatingHistoryControlsProps> = ({ fullScreen = false, avoidRef, avoidLayoutKey }) => {
  const t = useT();
  const { undo, redo, history, redoStack, tool, setTool, activeShapeType, setActiveShapeType } = useDrawingStore();
  const [position, setPosition] = useState({ x: window.innerWidth - 60, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(true);
  const [showShapesMenu, setShowShapesMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const shapesMenuRef = useRef<HTMLDivElement>(null);
  const [shapesMenuPos, setShapesMenuPos] = useState<{ left: number; top: number } | null>(null);

  // read through a ref: the resize listeners below are registered once
  const fullScreenRef = useRef(fullScreen);
  fullScreenRef.current = fullScreen;
  /** the area to keep clear (only while the full-screen buttons are shown) */
  const avoidRect = () => {
    const r = fullScreenRef.current ? avoidRef?.current?.getBoundingClientRect() : undefined;
    return r && r.width > 0 && r.height > 0 ? r : null;
  };

  // Keep the whole widget inside the visible viewport (iOS Safari bars,
  // orientation changes, expand/collapse) using its real rendered size.
  const clampToViewport = () => {
    const w = containerRef.current?.offsetWidth || 0;
    const h = containerRef.current?.offsetHeight || 0;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const margin = 4;
    const a = avoidRect();
    setPosition(prev => {
      let x = Math.max(margin, Math.min(prev.x, vw - w - margin));
      let y = Math.max(margin, Math.min(prev.y, vh - h - margin));
      // Full Screen Drawing Mode: never cover the restore button — move below it when there
      // is room, otherwise beside it (both measured, so safe areas / orientation are included)
      if (a && overlaps(x, y, w, h, a)) {
        if (a.bottom + AVOID_GAP + h <= vh - margin) y = a.bottom + AVOID_GAP;
        else x = Math.min(Math.max(x, a.right + AVOID_GAP), vw - w - margin);
      }
      return x === prev.x && y === prev.y ? prev : { x, y };
    });
  };

  // runs in the same commit as the full-screen buttons (App renders them first, so their ref is
  // set): the panel is moved before the browser paints — no frame with an overlap
  useLayoutEffect(() => {
    clampToViewport();
  }, [isExpanded, fullScreen, avoidLayoutKey]);

  // the full-screen buttons grow while a cable is drawn («إنهاء الكابل»): keep clear of them
  useEffect(() => {
    const el = fullScreen ? avoidRef?.current : null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => clampToViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullScreen]);

  // The shapes menu opens on the left of the panel. In full screen it must cover neither the
  // panel (near the left edge: opens on its right, or below it) nor the restore buttons (below them).
  useLayoutEffect(() => {
    const m = shapesMenuRef.current?.getBoundingClientRect(); const p = containerRef.current?.getBoundingClientRect();
    let pos: { left: number; top: number } | null = null;
    if (showShapesMenu && fullScreen && m && p) {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      let left = Math.max(8, position.x - 180), top = position.y;
      if (left < p.right + 4 && left + m.width > p.left - 4) {
        if (p.right + AVOID_GAP + m.width <= vw - 8) left = p.right + AVOID_GAP; else top = p.bottom + AVOID_GAP;
      }
      const a = avoidRect();
      if (a && overlaps(left, top, m.width, m.height, a)) top = a.bottom + AVOID_GAP;
      pos = { left, top };
    }
    setShapesMenuPos(prev => (prev?.left === pos?.left && prev?.top === pos?.top ? prev : pos));
  }, [showShapesMenu, position, fullScreen, isExpanded]);

  useEffect(() => {
    window.addEventListener('resize', clampToViewport);
    window.addEventListener('orientationchange', clampToViewport);
    window.visualViewport?.addEventListener('resize', clampToViewport);
    return () => {
      window.removeEventListener('resize', clampToViewport);
      window.removeEventListener('orientationchange', clampToViewport);
      window.visualViewport?.removeEventListener('resize', clampToViewport);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    const maxX = window.innerWidth - (containerRef.current?.offsetWidth || 0);
    const maxY = window.innerHeight - (containerRef.current?.offsetHeight || 0);
    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (fullScreen) clampToViewport(); // dropped on the restore button: move it clear
  };

  const handleShapeClick = (shapeId: ShapeType) => {
    setActiveShapeType(shapeId);
    setTool('shape');
    setShowShapesMenu(false);
  };

  if (!isExpanded) {
    return (
      <div
        ref={containerRef}
        style={{ transform: `translate(${position.x}px, ${position.y}px)`, touchAction: 'none' }}
        className="fixed top-0 left-0 z-50 ui-float !rounded-full p-0.5 cursor-move"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <button
          onClick={() => setIsExpanded(true)}
          className="ui-icon-btn !rounded-full text-ios-blue"
          aria-label={t('history.show')}
          title={t('history.show')}
          data-history-action="show"
        >
          <History {...ICON_MD} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        style={{ transform: `translate(${position.x}px, ${position.y}px)`, touchAction: 'none' }}
        className="fixed top-0 left-0 z-50 flex flex-col items-center ui-float p-1 gap-0.5 cursor-move select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="h-5 w-11 text-ios-tertiary cursor-grab active:cursor-grabbing flex items-center justify-center"
          aria-hidden="true">
          <GripHorizontal size={16} strokeWidth={2} />
        </div>

        <button
          onClick={() => setTool('draw')}
          className={`ui-icon-btn ${tool === 'draw' ? 'is-active' : ''}`}
          title={t('shapes.freeDraw')}
          aria-label={t('shapes.freeDraw')}
          data-history-action="draw"
          aria-pressed={tool === 'draw'}
        >
          <Pencil {...ICON_MD} />
        </button>

        <button
          onClick={() => setShowShapesMenu(!showShapesMenu)}
          className={`ui-icon-btn ${tool === 'shape' || showShapesMenu ? 'is-active' : ''}`}
          title={t('shapes.shapes')}
          aria-label={t('shapes.shapes')}
          data-history-action="shapes"
          aria-expanded={showShapesMenu}
        >
          <Shapes {...ICON_MD} />
        </button>

        <div className="ui-sep-h" aria-hidden="true" />

        <button
          onClick={undo}
          disabled={history.length === 0}
          className="ui-icon-btn"
          title={t('history.undo')}
          aria-label={t('history.undo')}
          data-history-action="undo"
        >
          <Undo2 {...ICON_MD} />
        </button>

        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="ui-icon-btn"
          title={t('history.redo')}
          aria-label={t('history.redo')}
          data-history-action="redo"
        >
          <Redo2 {...ICON_MD} />
        </button>

        <div className="ui-sep-h" aria-hidden="true" />

        <button
          onClick={() => setIsExpanded(false)}
          className="ui-icon-btn text-ios-secondary"
          title={t('history.minimize')}
          aria-label={t('history.minimize')}
          data-history-action="minimize"
        >
          <Minimize2 size={18} strokeWidth={1.75} />
        </button>
      </div>

      {/* Shapes Menu Popup */}
      {showShapesMenu && (
        <div
          ref={shapesMenuRef}
          style={{ 
            position: 'fixed',
            left: `${shapesMenuPos?.left ?? Math.max(8, position.x - 180)}px`,
            top: `${shapesMenuPos?.top ?? position.y}px`
          }}
          className="z-50 ui-float p-1.5 grid grid-cols-3 gap-0.5"
        >
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              onClick={() => handleShapeClick(shape.id)}
              className={`ui-icon-btn ${tool === 'shape' && activeShapeType === shape.id ? 'is-active' : ''}`}
              title={t(`shapes.${shape.id}`)}
              aria-label={t(`shapes.${shape.id}`)}
              data-shape={shape.id}
            >
              {shape.icon}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

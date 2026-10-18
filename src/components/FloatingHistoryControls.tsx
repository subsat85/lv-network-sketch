import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Undo2, Redo2, History, GripHorizontal, Minimize2, Pencil, Square, Circle, Triangle, ArrowRight, Compass, Spline, Shapes } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ShapeType } from '../types/drawing';
import { ICON_MD } from './ui/icons';

const SHAPES: { id: ShapeType; icon: React.ReactNode }[] = [
  { id: 'rectangle', icon: <Square {...ICON_MD} /> },
  { id: 'circle', icon: <Circle {...ICON_MD} /> },
  { id: 'triangle', icon: <Triangle {...ICON_MD} /> },
  { id: 'arrow', icon: <ArrowRight {...ICON_MD} /> },
  { id: 'compass', icon: <Compass {...ICON_MD} /> },
  { id: 'curved_arrow', icon: <Spline {...ICON_MD} /> },
];

export const FloatingHistoryControls: React.FC = () => {
  const { undo, redo, history, redoStack, tool, setTool, activeShapeType, setActiveShapeType } = useDrawingStore();
  const [position, setPosition] = useState({ x: window.innerWidth - 60, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(true);
  const [showShapesMenu, setShowShapesMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the whole widget inside the visible viewport (iOS Safari bars,
  // orientation changes, expand/collapse) using its real rendered size.
  const clampToViewport = () => {
    const w = containerRef.current?.offsetWidth || 0;
    const h = containerRef.current?.offsetHeight || 0;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const margin = 4;
    setPosition(prev => {
      const x = Math.max(margin, Math.min(prev.x, vw - w - margin));
      const y = Math.max(margin, Math.min(prev.y, vh - h - margin));
      return x === prev.x && y === prev.y ? prev : { x, y };
    });
  };

  useLayoutEffect(() => {
    clampToViewport();
  }, [isExpanded]);

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
          aria-label="Show Controls"
          title="Show Controls"
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
          title="قلم حر"
          aria-label="قلم حر"
          aria-pressed={tool === 'draw'}
        >
          <Pencil {...ICON_MD} />
        </button>

        <button
          onClick={() => setShowShapesMenu(!showShapesMenu)}
          className={`ui-icon-btn ${tool === 'shape' || showShapesMenu ? 'is-active' : ''}`}
          title="أشكال"
          aria-label="أشكال"
          aria-expanded={showShapesMenu}
        >
          <Shapes {...ICON_MD} />
        </button>

        <div className="ui-sep-h" aria-hidden="true" />

        <button
          onClick={undo}
          disabled={history.length === 0}
          className="ui-icon-btn"
          title="تراجع"
          aria-label="تراجع"
        >
          <Undo2 {...ICON_MD} />
        </button>

        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="ui-icon-btn"
          title="إعادة"
          aria-label="إعادة"
        >
          <Redo2 {...ICON_MD} />
        </button>

        <div className="ui-sep-h" aria-hidden="true" />

        <button
          onClick={() => setIsExpanded(false)}
          className="ui-icon-btn text-ios-secondary"
          title="تصغير"
          aria-label="تصغير"
        >
          <Minimize2 size={18} strokeWidth={1.75} />
        </button>
      </div>

      {/* Shapes Menu Popup */}
      {showShapesMenu && (
        <div
          style={{ 
            position: 'fixed',
            left: `${Math.max(8, position.x - 180)}px`,
            top: `${position.y}px`
          }}
          className="z-50 ui-float p-1.5 grid grid-cols-3 gap-0.5"
        >
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              onClick={() => handleShapeClick(shape.id)}
              className={`ui-icon-btn ${tool === 'shape' && activeShapeType === shape.id ? 'is-active' : ''}`}
              title={shape.id}
              aria-label={shape.id}
            >
              {shape.icon}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

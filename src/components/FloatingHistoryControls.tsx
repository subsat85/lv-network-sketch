import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Undo2, Redo2, History, GripHorizontal, Minimize2, Pencil, Square, Circle, Triangle, ArrowRight, Compass, Spline, Shapes } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ShapeType } from '../types/drawing';

const SHAPES: { id: ShapeType; icon: React.ReactNode }[] = [
  { id: 'rectangle', icon: <Square size={18} /> },
  { id: 'circle', icon: <Circle size={18} /> },
  { id: 'triangle', icon: <Triangle size={18} /> },
  { id: 'arrow', icon: <ArrowRight size={18} /> },
  { id: 'compass', icon: <Compass size={18} /> },
  { id: 'curved_arrow', icon: <Spline size={18} /> },
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
        className="fixed top-0 left-0 z-50 shadow-lg rounded-full bg-white border border-gray-200 cursor-move"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <button
          onClick={() => setIsExpanded(true)}
          className="p-3 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
          aria-label="Show Controls"
        >
          <History size={24} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        style={{ transform: `translate(${position.x}px, ${position.y}px)`, touchAction: 'none' }}
        className="fixed top-0 left-0 z-50 flex flex-col items-center bg-white border border-gray-200 shadow-lg rounded-2xl p-1 gap-1 cursor-move select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="py-1 text-gray-400 cursor-grab active:cursor-grabbing flex items-center justify-center">
          <GripHorizontal size={18} />
        </div>

        <button
          onClick={() => setTool('draw')}
          className={`p-2 rounded-xl transition-colors ${tool === 'draw' ? 'bg-blue-100 text-blue-600' : 'text-gray-700 hover:bg-gray-100'}`}
          title="قلم حر"
        >
          <Pencil size={18} />
        </button>

        <button
          onClick={() => setShowShapesMenu(!showShapesMenu)}
          className={`p-2 rounded-xl transition-colors ${tool === 'shape' ? 'bg-blue-100 text-blue-600' : 'text-gray-700 hover:bg-gray-100'}`}
          title="أشكال"
        >
          <Shapes size={18} />
        </button>

        <div className="w-6 h-px bg-gray-200 my-1" />

        <button
          onClick={undo}
          disabled={history.length === 0}
          className={`p-2 rounded-xl transition-colors ${history.length > 0 ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300'}`}
          title="تراجع"
        >
          <Undo2 size={18} />
        </button>

        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className={`p-2 rounded-xl transition-colors ${redoStack.length > 0 ? 'text-gray-700 hover:bg-gray-100' : 'text-gray-300'}`}
          title="إعادة"
        >
          <Redo2 size={18} />
        </button>

        <div className="w-6 h-px bg-gray-200 my-1" />

        <button
          onClick={() => setIsExpanded(false)}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
          title="تصغير"
        >
          <Minimize2 size={16} />
        </button>
      </div>

      {/* Shapes Menu Popup */}
      {showShapesMenu && (
        <div
          style={{ 
            position: 'fixed',
            left: `${position.x - 180}px`,
            top: `${position.y}px`
          }}
          className="z-50 bg-white border border-gray-200 shadow-lg rounded-xl p-2 grid grid-cols-3 gap-1"
        >
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              onClick={() => handleShapeClick(shape.id)}
              className={`p-2 rounded-lg transition-colors ${
                tool === 'shape' && activeShapeType === shape.id 
                  ? 'bg-blue-100 text-blue-600' 
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={shape.id}
            >
              {shape.icon}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

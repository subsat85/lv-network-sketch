import React from 'react';
import { 
  Square, Circle, Triangle, ArrowRight, Compass, Spline, Pencil,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { ShapeType } from '../types/drawing';
import { useT } from '../store/localeStore';

export const ShapesPanel: React.FC = () => {
  const { tool, setTool, activeShapeType, setActiveShapeType, style } = useDrawingStore();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const t = useT();

  const shapes: { id: ShapeType; icon: React.ReactNode; label: string }[] = [
    { id: 'rectangle', icon: <Square size={20} />, label: t('shapes.rectangle') },
    { id: 'circle', icon: <Circle size={20} />, label: t('shapes.circle') },
    { id: 'triangle', icon: <Triangle size={20} />, label: t('shapes.triangle') },
    { id: 'arrow', icon: <ArrowRight size={20} />, label: t('shapes.arrow') },
    { id: 'compass', icon: <Compass size={20} />, label: t('shapes.compass') },
    { id: 'curved_arrow', icon: <Spline size={20} />, label: t('shapes.curved_arrow') },
  ];

  const isShapeActive = (id: ShapeType) => tool === 'shape' && activeShapeType === id;

  const handleShapeClick = (shapeId: ShapeType) => {
    setActiveShapeType(shapeId);
    setTool('shape');
  };

  return (
    <div className="bg-white border-t border-gray-200 shadow-sm z-10 flex-shrink-0">
      {/* Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <Pencil size={16} />
          <span>{t('shapes.heading')}</span>
        </span>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Shapes Grid */}
      {isExpanded && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-6 gap-2">
            {/* Free Draw Tool */}
            <button
              onClick={() => setTool('draw')}
              className={`p-2 rounded-lg flex flex-col items-center justify-center transition-colors min-h-[44px] ${
                tool === 'draw'
                  ? 'bg-blue-100 ring-2 ring-blue-500 text-blue-600'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
              title={t('shapes.freeDraw')}
            >
              <Pencil size={20} />
              <span className="text-[10px] mt-1">{t('shapes.freeShort')}</span>
            </button>

            {shapes.map((shape) => (
              <button
                key={shape.id}
                onClick={() => handleShapeClick(shape.id)}
                className={`p-2 rounded-lg flex flex-col items-center justify-center transition-colors min-h-[44px] ${
                  isShapeActive(shape.id)
                    ? 'bg-blue-100 ring-2 ring-blue-500 text-blue-600'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                title={shape.label}
              >
                {shape.icon}
                <span className="text-[10px] mt-1">{shape.label}</span>
              </button>
            ))}
          </div>

          {/* Shape Preview */}
          {tool === 'shape' && activeShapeType && (
            <div className="mt-3 flex items-center justify-center p-3 bg-gray-50 rounded-lg">
              <svg width="60" height="60" viewBox="0 0 60 60">
                {activeShapeType === 'rectangle' && (
                  <rect x="10" y="15" width="40" height="30" 
                    stroke={style.strokeColor} 
                    fill={style.fillColor} 
                    strokeWidth={style.strokeWidth} 
                  />
                )}
                {activeShapeType === 'circle' && (
                  <circle cx="30" cy="30" r="20" 
                    stroke={style.strokeColor} 
                    fill={style.fillColor} 
                    strokeWidth={style.strokeWidth} 
                  />
                )}
                {activeShapeType === 'triangle' && (
                  <polygon points="30,10 50,50 10,50" 
                    stroke={style.strokeColor} 
                    fill={style.fillColor} 
                    strokeWidth={style.strokeWidth} 
                  />
                )}
                {activeShapeType === 'arrow' && (
                  <path d="M10,30 L40,30 M40,30 L30,20 M40,30 L30,40" 
                    stroke={style.strokeColor} 
                    fill="none" 
                    strokeWidth={style.strokeWidth} 
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {activeShapeType === 'compass' && (
                  <g>
                    <circle cx="30" cy="30" r="20" 
                      stroke={style.strokeColor} 
                      fill={style.fillColor} 
                      strokeWidth={style.strokeWidth} 
                    />
                    <polygon points="30,10 34,30 30,28 26,30" fill={style.strokeColor} />
                    <text x="30" y="42" textAnchor="middle" fontSize="14" fontWeight="bold" fill={style.strokeColor}>N</text>
                  </g>
                )}
                {activeShapeType === 'curved_arrow' && (
                  <path d="M10,40 Q30,10 50,40 M50,40 L40,30 M50,40 L40,50" 
                    stroke={style.strokeColor} 
                    fill="none" 
                    strokeWidth={style.strokeWidth} 
                    strokeLinecap="round"
                  />
                )}
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

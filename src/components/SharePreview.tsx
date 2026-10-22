import React, { useState, useRef, useEffect } from 'react';
import { X, Share2, FileDown, RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { PreviewCanvas } from './PreviewCanvas';
import html2canvas from 'html2canvas';
import { useVoltageDrop } from '../utils/useVoltageDrop';
import { LOAD_MODEL_LABEL } from '../utils/vdLabels';
import { DEFAULT_POWER_FACTOR, isPowerFactorDefault } from '../utils/electricalSettings';
import jsPDF from 'jspdf';

interface SharePreviewProps {
  onClose: () => void;
}

// A4 size at 150 DPI
const A4_WIDTH = 1240;
const A4_HEIGHT = 1754;

export const SharePreview: React.FC<SharePreviewProps> = ({ onClose }) => {
  const { elements, connectionDistances, connectionLabelOffsets, poleSizeScale, consumerVariant, currentProjectName, attachedImage, setAttachedImage, distanceTextScale, consumerSizeScale, showDistanceLabels } = useDrawingStore();
  // voltage-drop badges go into the shared image / PDF when they are shown on the drawing
  const showVoltageDrop = useDrawingStore((st) => st.showVoltageDrop);
  const voltageDrop = useVoltageDrop(showVoltageDrop);
  const distanceFlags = useDrawingStore((st) => st.distanceFlags);
  const electrical = useDrawingStore((st) => st.electrical);
  const [transform, setTransform] = useState({ x: A4_WIDTH / 2, y: A4_HEIGHT / 2, scale: 1, rotation: 0 });
  const [isGesturing, setIsGesturing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const fitToPage = () => {
    if (elements.length === 0) return;
    
    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elements.forEach(el => {
      if (el.type === 'path') {
        (el as any).points.forEach((p: any) => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
      } else {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x);
        maxY = Math.max(maxY, el.y);
      }
    });
    
    // Add padding
    const padding = 100;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Calculate scale to fit
    const scaleX = A4_WIDTH / width;
    const scaleY = A4_HEIGHT / height;
    const scale = Math.min(scaleX, scaleY, 2); // Cap max scale
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    setTransform({
      x: (A4_WIDTH / 2) - (centerX * scale),
      y: (A4_HEIGHT / 2) - (centerY * scale),
      scale,
      rotation: 0
    });
  };

  // Fit drawing to page initially
  useEffect(() => {
    fitToPage();
  }, []);

  const handleZoomIn = () => setTransform(prev => ({ ...prev, scale: prev.scale * 1.1 }));
  const handleZoomOut = () => setTransform(prev => ({ ...prev, scale: prev.scale * 0.9 }));
  const handleRotateLeft = () => setTransform(prev => ({ ...prev, rotation: prev.rotation - 5 }));
  const handleRotateRight = () => setTransform(prev => ({ ...prev, rotation: prev.rotation + 5 }));
  const handleReset = fitToPage;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setAttachedImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Gesture Handling
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
  const gestureRef = useRef<{
    startDist: number;
    startAngle: number;
    startTransform: typeof transform;
    startCenter: { x: number, y: number };
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    containerRef.current?.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setIsGesturing(true);
    
    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
      
      gestureRef.current = {
        startDist: dist,
        startAngle: angle,
        startTransform: { ...transform },
        startCenter: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      };
    } else if (pointersRef.current.size === 1) {
      gestureRef.current = {
        startDist: 0,
        startAngle: 0,
        startTransform: { ...transform },
        startCenter: { x: e.clientX, y: e.clientY }
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    if (!gestureRef.current) return;

    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
      
      const scaleFactor = dist / gestureRef.current.startDist;
      const angleDiff = angle - gestureRef.current.startAngle;
      
      setTransform(prev => ({
        ...prev,
        scale: gestureRef.current!.startTransform.scale * scaleFactor,
        rotation: gestureRef.current!.startTransform.rotation + angleDiff,
      }));
    } else if (pointersRef.current.size === 1) {
      const dx = e.clientX - gestureRef.current.startCenter.x;
      const dy = e.clientY - gestureRef.current.startCenter.y;
      
      setTransform(prev => ({
        ...prev,
        x: gestureRef.current!.startTransform.x + dx,
        y: gestureRef.current!.startTransform.y + dy,
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    containerRef.current?.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    
    if (pointersRef.current.size === 0) {
      setIsGesturing(false);
      gestureRef.current = null;
    } else if (pointersRef.current.size === 1) {
      const p = Array.from(pointersRef.current.values())[0];
      gestureRef.current = {
        startDist: 0,
        startAngle: 0,
        startTransform: { ...transform },
        startCenter: { x: p.x, y: p.y }
      };
    }
  };

  const handleExport = async (type: 'pdf' | 'share') => {
    if (isExporting || !contentRef.current) return;
    
    setIsExporting(true);
    
    // Allow UI to update and ensure rendering is complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      const rect = contentRef.current.getBoundingClientRect();
      
      // Try ultra-high resolution first (450 DPI = 3x A4_WIDTH)
      // A4_WIDTH is 1240px (150 DPI). 3x is 3720px.
      let targetWidth = A4_WIDTH * 3;
      let scale = targetWidth / rect.width;
      let quality = 1.0;
      
      let canvas: HTMLCanvasElement;

      try {
        canvas = await html2canvas(contentRef.current, {
          scale: scale, 
          useCORS: true,
          backgroundColor: '#ffffff',
          width: rect.width,
          height: rect.height,
          windowWidth: A4_WIDTH,
          windowHeight: A4_HEIGHT,
          logging: false
        });
      } catch (ultraHighResError) {
        console.warn('Ultra-high-res export failed, retrying with high resolution', ultraHighResError);
        
        try {
          // Fallback to high resolution (300 DPI)
          targetWidth = A4_WIDTH * 2;
          scale = targetWidth / rect.width;
          quality = 0.95;
          
          canvas = await html2canvas(contentRef.current, {
            scale: scale, 
            useCORS: true,
            backgroundColor: '#ffffff',
            width: rect.width,
            height: rect.height,
            windowWidth: A4_WIDTH,
            windowHeight: A4_HEIGHT,
            logging: false
          });
        } catch (highResError) {
          console.warn('High-res export failed, retrying with standard resolution', highResError);
          // Fallback to standard resolution (150 DPI)
          targetWidth = A4_WIDTH;
          scale = targetWidth / rect.width;
          quality = 0.90;
          
          canvas = await html2canvas(contentRef.current, {
            scale: scale, 
            useCORS: true,
            backgroundColor: '#ffffff',
            width: rect.width,
            height: rect.height,
            windowWidth: A4_WIDTH,
            windowHeight: A4_HEIGHT,
            logging: false
          });
        }
      }
      
      const imgData = canvas.toDataURL('image/jpeg', quality);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = 210;
      const pdfHeight = 297;
      const canvasRatio = canvas.width / canvas.height;
      
      let finalWidth = pdfWidth;
      let finalHeight = pdfWidth / canvasRatio;

      if (finalHeight > pdfHeight) {
        finalHeight = pdfHeight;
        finalWidth = pdfHeight * canvasRatio;
      }

      const x = (pdfWidth - finalWidth) / 2;
      const y = (pdfHeight - finalHeight) / 2;

      pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);

      const safeName = currentProjectName?.trim().normalize('NFC') || '';
      // Ensure filename is safe but preserves Unicode
      const safeFilename = safeName.replace(/[\/\\:*?"<>|]/g, '_');
      const filename = safeFilename ? `${safeFilename}.pdf` : `drawing-${Date.now()}.pdf`;

      if (type === 'pdf') {
        pdf.save(filename);
      } else if (type === 'share') {
        const pdfBlob = pdf.output('blob');
        const file = new File([pdfBlob], filename, { type: 'application/pdf' });
        
        if (navigator.share && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: safeName || 'Electrical Sketch',
            text: 'Check out my electrical network sketch.'
          });
        } else {
          // Fallback to download
          pdf.save(filename);
        }
      }
    } catch (err) {
      console.error('Export failed', err);
      alert(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
          <X size={24} />
        </button>
        <h2 className="font-semibold text-lg">Share Preview</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => handleExport('pdf')} 
            disabled={isExporting}
            className={`p-2 rounded-full ${isExporting ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'hover:bg-gray-100'}`} 
            title="Export PDF"
          >
            <FileDown size={24} />
          </button>
          <button 
            onClick={() => handleExport('share')} 
            disabled={isExporting}
            className={`p-2 rounded-full ${isExporting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white flex items-center justify-center`} 
            title="Share"
          >
            {isExporting ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Share2 size={24} />
            )}
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div 
        className="flex-1 overflow-hidden bg-gray-800 flex items-center justify-center p-4 touch-none"
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* A4 Page Container */}
        <div 
          className="bg-white shadow-2xl relative overflow-hidden"
          style={{
            aspectRatio: `${A4_WIDTH}/${A4_HEIGHT}`,
            height: 'min(90%, 100vw * 1.414)', 
            width: 'auto',
            maxWidth: '100%'
          }}
        >
          {/* Content Wrapper */}
          <div 
            ref={contentRef}
            className="w-full h-full"
          >
            <svg 
              viewBox={`0 0 ${A4_WIDTH} ${A4_HEIGHT}`}
              className="w-full h-full block"
              preserveAspectRatio="xMidYMid meet"
            >
              {attachedImage && (
                <image
                  href={attachedImage}
                  x="0"
                  y="0"
                  width={A4_WIDTH}
                  height={A4_HEIGHT}
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              
              <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale}) rotate(${transform.rotation})`}>
                <PreviewCanvas 
                  elements={elements} 
                  connectionDistances={connectionDistances}
                  connectionLabelOffsets={connectionLabelOffsets}
                  poleSizeScale={poleSizeScale}
                  consumerVariant={consumerVariant}
                  distanceTextScale={distanceTextScale}
                  consumerSizeScale={consumerSizeScale}
                  showDistanceLabels={showDistanceLabels}
                  voltageDrop={voltageDrop}
                  distanceFlags={distanceFlags}
                />
              </g>
              {voltageDrop && (
                // what the badges mean, on the page itself (and so in the PDF / image)
                <text x={A4_WIDTH - 40} y={A4_HEIGHT - 40} textAnchor="end" fontSize={22} fill="#374151" fontFamily="sans-serif" direction="rtl" data-vd-legend>
                  {`هبوط الفولتية — نموذج الحمل: ${LOAD_MODEL_LABEL[electrical.loadModel ?? 'constant-current']} — cos φ ${isPowerFactorDefault(electrical) ? `${DEFAULT_POWER_FACTOR} (افتراضي)` : electrical.powerFactor} — الحد ${electrical.limitPercent}% — ≈ تقديري، ؟ غير قابل للحساب`}
                </text>
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border-t border-gray-200 p-4 shrink-0 safe-area-bottom">
        <div className="flex flex-col gap-4 max-w-md mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2">
              <button onClick={handleZoomOut} className="p-2 hover:bg-gray-100 rounded-lg">
                <ZoomOut size={20} />
              </button>
              <button onClick={handleReset} className="p-2 hover:bg-gray-100 rounded-lg">
                <Maximize size={20} />
              </button>
              <button onClick={handleZoomIn} className="p-2 hover:bg-gray-100 rounded-lg">
                <ZoomIn size={20} />
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={handleRotateLeft} className="p-2 hover:bg-gray-100 rounded-lg">
                <RotateCcw size={20} />
              </button>
              <button onClick={handleRotateRight} className="p-2 hover:bg-gray-100 rounded-lg">
                <RotateCw size={20} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700"
            >
              <ImageIcon size={18} />
              {attachedImage ? 'Change Image' : 'Add Background Image'}
            </button>
            {attachedImage && (
              <button 
                onClick={handleRemoveImage}
                className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg"
                title="Remove Image"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
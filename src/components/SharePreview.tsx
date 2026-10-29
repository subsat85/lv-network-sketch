import React, { useState, useRef, useEffect } from 'react';
import { X, Share2, FileDown, RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useDrawingStore } from '../store/drawingStore';
import { PreviewCanvas } from './PreviewCanvas';
import html2canvas from 'html2canvas';
import { useVoltageDrop } from '../utils/useVoltageDrop';
import { loadModelLabel, POLE_STATUS_MARK } from '../utils/vdLabels';
import { DEFAULT_POWER_FACTOR, isPowerFactorDefault } from '../utils/electricalSettings';
import jsPDF from 'jspdf';
import { t as tCurrent, useLocale, useT } from '../store/localeStore';
import { directionOf } from '../i18n';
import { EMPTY_BOX, elementBoxes, fitToPage as pageFit, isEmptyBox, tableBoxes, unionBox } from '../utils/pageFit';
import { drawingPointAt, panTransform, pinchTransform, transformAbout, type PinchStart, type ViewTransform } from '../utils/viewTransform';

interface SharePreviewProps {
  onClose: () => void;
}

// A4 size at 150 DPI
const A4_WIDTH = 1240;
const A4_HEIGHT = 1754;
/** the drawing (and its pole radius on the page), and the room kept between it and the legend */
const POLE_RADIUS = 20;
const LEGEND_GAP = 16;

export const SharePreview: React.FC<SharePreviewProps> = ({ onClose }) => {
  const { elements, connectionDistances, connectionLabelOffsets, poleSizeScale, consumerVariant, currentProjectName, attachedImage, setAttachedImage, distanceTextScale, consumerSizeScale, showDistanceLabels } = useDrawingStore();
  // voltage-drop badges go into the shared image / PDF when they are shown on the drawing
  const showVoltageDrop = useDrawingStore((st) => st.showVoltageDrop);
  const voltageDrop = useVoltageDrop(showVoltageDrop);
  const distanceFlags = useDrawingStore((st) => st.distanceFlags);
  const electrical = useDrawingStore((st) => st.electrical);
  const t = useT();
  const locale = useLocale((st) => st.locale);
  const [transform, setTransformState] = useState<ViewTransform>({ x: A4_WIDTH / 2, y: A4_HEIGHT / 2, scale: 1, rotation: 0 });
  // the latest view transform, readable at once inside pointer events (the state is only read at the
  // next render); every change goes through setTransform, which keeps both the same
  const transformRef = useRef<ViewTransform>(transform);
  const setTransform = (next: ViewTransform) => { transformRef.current = next; setTransformState(next); };
  // the centre of the drawing (drawing units): zoom and rotation turn around it (measured with the fit)
  const pivotRef = useRef<{ x: number; y: number } | null>(null);
  const [isGesturing, setIsGesturing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // the drawing group (view transform applied) and the legend, measured to place the drawing on the page
  const drawingRef = useRef<SVGGElement>(null);
  const legendRef = useRef<SVGTextElement>(null);

  // Fit the drawing to the page: its real drawn extent (every pole, cable, label, badge and the whole
  // transformer table, measured on the page itself), with the table frames counted in full
  // (transformerTableSize), proportions kept, above the voltage-drop legend when it is shown.
  // Only this view transform changes; no element or saved value does.
  // the fit is measured once, when the preview opens (the drawing does not change while it is open):
  // text is measured a little differently at another zoom, so «Reset» re-applies that same fit
  const fitRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const fitToPage = () => {
    if (fitRef.current) { setTransform({ ...fitRef.current, rotation: 0 }); return; }
    if (elements.length === 0) return;
    let content = tableBoxes(elements, t).reduce(unionBox, EMPTY_BOX);
    let measured = false;
    try {
      const b = drawingRef.current?.getBBox();
      if (b && b.width > 0 && b.height > 0) {
        content = unionBox(content, { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height });
        measured = true;
      }
    } catch { /* not measurable (not laid out): the elements' own extents below */ }
    if (!measured) content = elementBoxes(elements, t, POLE_RADIUS * poleSizeScale).reduce(unionBox, content);
    if (isEmptyBox(content)) return;
    // the legend's own box (page units): the drawing stays above it, with a small gap
    let reservedBottom = 0;
    try {
      const lb = legendRef.current?.getBBox();
      if (lb && lb.height > 0) reservedBottom = A4_HEIGHT - (lb.y - LEGEND_GAP);
    } catch { /* no legend */ }
    pivotRef.current = { x: (content.minX + content.maxX) / 2, y: (content.minY + content.maxY) / 2 };
    fitRef.current = pageFit(content, A4_WIDTH, A4_HEIGHT, reservedBottom);
    setTransform({ ...fitRef.current, rotation: 0 });
  };

  // Fit drawing to page initially
  useEffect(() => {
    fitToPage();
  }, []);

  // the drawing point the view turns around: the drawing's centre, or (nothing measured) the point
  // now at the middle of the page
  const pivot = () => pivotRef.current ?? drawingPointAt(transformRef.current, { x: A4_WIDTH / 2, y: A4_HEIGHT / 2 });
  const zoomBy = (f: number) => { const t0 = transformRef.current; setTransform(transformAbout(t0, pivot(), t0.scale * f, t0.rotation)); };
  const rotateBy = (deg: number) => { const t0 = transformRef.current; setTransform(transformAbout(t0, pivot(), t0.scale, t0.rotation + deg)); };
  const handleZoomIn = () => zoomBy(1.1);
  const handleZoomOut = () => zoomBy(0.9);
  const handleRotateLeft = () => rotateBy(-5);
  const handleRotateRight = () => rotateBy(5);
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
  // One finger moves the view, two fingers zoom and turn it around the drawing's centre. Every new
  // transform is computed here, inside the event, from the gesture's own start values (a local copy):
  // nothing is read later from the gesture ref, which the next pointerup / pointercancel may already
  // have cleared (on Safari a quick pinch ended that way: "null is not an object (… startTransform)").
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
  const gestureRef = useRef<
    | { kind: 'pan'; start: ViewTransform; from: { x: number; y: number } }
    | ({ kind: 'pinch' } & PinchStart)
    | null
  >(null);

  // (re)start the gesture from the fingers now down and the transform now shown
  const beginGesture = () => {
    const points = Array.from(pointersRef.current.values());
    const start = { ...transformRef.current };
    if (points.length >= 2) {
      const [p1, p2] = points;
      gestureRef.current = { kind: 'pinch', start, dist: Math.hypot(p2.x - p1.x, p2.y - p1.y), angle: Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI };
    } else if (points.length === 1) {
      gestureRef.current = { kind: 'pan', start, from: { ...points[0] } };
    } else {
      gestureRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    try { containerRef.current?.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setIsGesturing(true);
    if (pointersRef.current.size <= 2) beginGesture();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (!g) return;
    const points = Array.from(pointersRef.current.values());
    if (g.kind === 'pinch' && points.length >= 2) {
      const [p1, p2] = points;
      setTransform(pinchTransform(g, Math.hypot(p2.x - p1.x, p2.y - p1.y), Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI, pivot()));
    } else if (g.kind === 'pan' && points.length === 1) {
      setTransform(panTransform(g.start, g.from, points[0]));
    }
  };

  // pointerup and pointercancel (the system took the touch): the gesture goes on with the fingers left
  const handlePointerUp = (e: React.PointerEvent) => {
    try { containerRef.current?.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!pointersRef.current.delete(e.pointerId)) return;
    if (pointersRef.current.size === 0) setIsGesturing(false);
    beginGesture();
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
            title: safeName || tCurrent('share.shareTitle'),
            text: tCurrent('share.shareText')
          });
        } else {
          // Fallback to download
          pdf.save(filename);
        }
      }
    } catch (err) {
      console.error('Export failed', err);
      alert(tCurrent('dialogs.exportFailed', { error: err instanceof Error ? err.message : tCurrent('dialogs.unknownError') }));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0" style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
        <button onClick={onClose} aria-label={t('share.close')} title={t('share.close')} data-share-action="close" className="p-2 hover:bg-gray-100 rounded-full">
          <X size={24} />
        </button>
        <h2 className="font-semibold text-lg" dir={directionOf(locale)}>{t('share.title')}</h2>
        <div className="flex gap-2">
          <button 
            onClick={() => handleExport('pdf')} 
            disabled={isExporting}
            className={`p-2 rounded-full ${isExporting ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'hover:bg-gray-100'}`} 
            title={t('share.exportPdf')}
            aria-label={t('share.exportPdf')}
            data-share-action="pdf"
          >
            <FileDown size={24} />
          </button>
          <button 
            onClick={() => handleExport('share')} 
            disabled={isExporting}
            className={`p-2 rounded-full ${isExporting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'} text-white flex items-center justify-center`} 
            title={t('share.share')}
            aria-label={t('share.share')}
            data-share-action="share"
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
              
              <g ref={drawingRef} transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale}) rotate(${transform.rotation})`}>
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
                // its right edge 40 px from the page edge in both languages: in right-to-left text that edge is
                // the "start" (with "end" the Arabic legend ran off the page and was cut in the PDF)
                // {na} is the mark exactly as drawn on the poles (POLE_STATUS_MARK, «؟» in both languages); the words follow the language
                <text x={A4_WIDTH - 40} y={A4_HEIGHT - 40} textAnchor={directionOf(locale) === 'rtl' ? 'start' : 'end'} fontSize={22} fill="#374151" fontFamily="sans-serif" direction={directionOf(locale)} ref={legendRef} data-vd-legend>
                  {t('share.legend', { model: loadModelLabel(electrical.loadModel ?? 'constant-current', t), pf: isPowerFactorDefault(electrical) ? t('share.pfDefault', { pf: DEFAULT_POWER_FACTOR }) : String(electrical.powerFactor), limit: electrical.limitPercent, na: POLE_STATUS_MARK.na })}
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
              <button onClick={handleZoomOut} aria-label={t('share.zoomOut')} title={t('share.zoomOut')} data-share-action="zoom-out" className="p-2 hover:bg-gray-100 rounded-lg">
                <ZoomOut size={20} />
              </button>
              <button onClick={handleReset} aria-label={t('share.reset')} title={t('share.reset')} data-share-action="reset" className="p-2 hover:bg-gray-100 rounded-lg">
                <Maximize size={20} />
              </button>
              <button onClick={handleZoomIn} aria-label={t('share.zoomIn')} title={t('share.zoomIn')} data-share-action="zoom-in" className="p-2 hover:bg-gray-100 rounded-lg">
                <ZoomIn size={20} />
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={handleRotateLeft} aria-label={t('share.rotateLeft')} title={t('share.rotateLeft')} data-share-action="rotate-left" className="p-2 hover:bg-gray-100 rounded-lg">
                <RotateCcw size={20} />
              </button>
              <button onClick={handleRotateRight} aria-label={t('share.rotateRight')} title={t('share.rotateRight')} data-share-action="rotate-right" className="p-2 hover:bg-gray-100 rounded-lg">
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
              {attachedImage ? t('share.changeImage') : t('share.addImage')}
            </button>
            {attachedImage && (
              <button 
                onClick={handleRemoveImage}
                className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg"
                title={t('share.removeImage')}
                aria-label={t('share.removeImage')}
                data-share-action="remove-image"
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
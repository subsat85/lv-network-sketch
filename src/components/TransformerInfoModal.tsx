import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Download, Move, ZoomIn, ZoomOut, Trash2, Plus, Minus } from 'lucide-react';

interface BoxCircuits {
  circuits: string;
  emptyCircuits: string;
}

interface TransformerInfo {
  transformerNumber: string;
  mainCable: string;
  mainLinesCount: string;
  cableType: string;
  distributionBoxesCount: string;
  circuitsPerBox: string;
  emptyCircuitsPerBox: string;
  perBoxCircuits?: BoxCircuits[];
  installationMethod: string;
  transformerType: string;
  boxInstallationMethod: string;
  lightingBox: string;
  capacitor: string;
}

interface TransformerInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (info: TransformerInfo) => void;
  onAddToCanvas: (info: TransformerInfo) => void;
}

export const TransformerInfoModal: React.FC<TransformerInfoModalProps> = ({ isOpen, onClose, onSave, onAddToCanvas }) => {
  const [info, setInfo] = useState<TransformerInfo>({
    transformerNumber: '',
    mainCable: '300',
    mainLinesCount: '4',
    cableType: 'copper',
    distributionBoxesCount: '1',
    circuitsPerBox: '4',
    emptyCircuitsPerBox: '0',
    perBoxCircuits: [{ circuits: '4', emptyCircuits: '0' }],
    installationMethod: 'ground',
    transformerType: 'public',
    boxInstallationMethod: 'ground',
    lightingBox: 'none',
    capacitor: 'no',
  });
  
  const [customCable, setCustomCable] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Update perBoxCircuits when distributionBoxesCount changes
  useEffect(() => {
    const boxCount = parseInt(info.distributionBoxesCount) || 1;
    const currentPerBox = info.perBoxCircuits || [];
    
    if (boxCount > 1) {
      // Create or update per-box circuits
      const newPerBox: BoxCircuits[] = [];
      for (let i = 0; i < boxCount; i++) {
        if (i < currentPerBox.length) {
          newPerBox.push(currentPerBox[i]);
        } else {
          newPerBox.push({ circuits: info.circuitsPerBox, emptyCircuits: info.emptyCircuitsPerBox });
        }
      }
      setInfo(prev => ({ ...prev, perBoxCircuits: newPerBox }));
    } else {
      // Single box - use the common values
      setInfo(prev => ({ 
        ...prev, 
        perBoxCircuits: [{ circuits: prev.circuitsPerBox, emptyCircuits: prev.emptyCircuitsPerBox }] 
      }));
    }
  }, [info.distributionBoxesCount]);

  // Update common values when per-box changes for single box
  useEffect(() => {
    if (info.perBoxCircuits && info.perBoxCircuits.length === 1) {
      setInfo(prev => ({
        ...prev,
        circuitsPerBox: prev.perBoxCircuits[0].circuits,
        emptyCircuitsPerBox: prev.perBoxCircuits[0].emptyCircuits
      }));
    }
  }, [info.perBoxCircuits]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(info);
    onClose();
  };

  const handleAddToCanvas = () => {
    onAddToCanvas(info);
    onClose();
  };

  const handleCableChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomInput(true);
      setInfo({ ...info, mainCable: customCable || '' });
    } else {
      setShowCustomInput(false);
      setInfo({ ...info, mainCable: value });
    }
  };

  const handleCustomCableChange = (value: string) => {
    setCustomCable(value);
    setInfo({ ...info, mainCable: value });
  };

  const getCableLabel = () => {
    if (showCustomInput && customCable) return `${customCable} مم²`;
    switch (info.mainCable) {
      case '300': return '300 مم²';
      case '185': return '185 مم²';
      case '120': return '120 مم²';
      case '70': return '70 مم²';
      default: return info.mainCable ? `${info.mainCable} مم²` : 'اختر المقاس';
    }
  };

  const getCableTypeLabel = () => info.cableType === 'copper' ? 'نحاسي' : 'ألمنيوم';
  const getInstallationMethodLabel = () => {
    switch (info.installationMethod) {
      case 'ground': return 'على الأرض';
      case 'hanging': return 'معلق';
      case 'indoor': return 'داخل غرفة';
      default: return '';
    }
  };
  const getTransformerTypeLabel = () => info.transformerType === 'public' ? 'عام' : 'خاص';
  const getBoxInstallationLabel = () => info.boxInstallationMethod === 'ground' ? 'على الأرض' : 'معلق';
  const getLightingBoxLabel = () => {
    switch (info.lightingBox) {
      case 'indoor': return 'داخلي';
      case 'outdoor': return 'خارجي';
      case 'none': return 'لا يوجد';
      default: return '';
    }
  };
  const getCapacitorLabel = () => info.capacitor === 'yes' ? 'موجود' : 'غير موجود';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-l from-blue-600 to-blue-700">
          <h2 className="text-xl font-bold text-white">معلومات المحول</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/20 text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* رقم المحول */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">رقم المحول</label>
              <input
                type="text"
                value={info.transformerNumber}
                onChange={(e) => setInfo({ ...info, transformerNumber: e.target.value })}
                placeholder="أدخل رقم المحول"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
              />
            </div>

            {/* الكيبل الرئيسي */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">الكابل الرئيسي (مم²)</label>
              <div className="relative">
                <select
                  value={showCustomInput ? 'custom' : info.mainCable}
                  onChange={(e) => handleCableChange(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white text-right"
                >
                  <option value="300">300 مم²</option>
                  <option value="185">185 مم²</option>
                  <option value="120">120 مم²</option>
                  <option value="70">70 مم²</option>
                  <option value="custom">أخرى (إدخال يدوي)</option>
                </select>
                <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
              </div>
              {showCustomInput && (
                <input
                  type="number"
                  value={customCable}
                  onChange={(e) => handleCustomCableChange(e.target.value)}
                  placeholder="أدخل المقاس المطلوب"
                  className="w-full mt-2 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
                />
              )}
            </div>

            {/* عدد الخطوط الرئيسية */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">عدد الخطوط الرئيسية</label>
              <input
                type="number"
                min="1"
                value={info.mainLinesCount}
                onChange={(e) => setInfo({ ...info, mainLinesCount: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
              />
            </div>

            {/* نوع الخط */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">نوع الخط</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setInfo({ ...info, cableType: 'copper' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.cableType === 'copper'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  نحاسي
                </button>
                <button
                  onClick={() => setInfo({ ...info, cableType: 'aluminum' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.cableType === 'aluminum'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  ألمنيوم
                </button>
              </div>
            </div>

            {/* عدد صناديق التوزيع */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">عدد صناديق التوزيع</label>
              <input
                type="number"
                min="1"
                value={info.distributionBoxesCount}
                onChange={(e) => setInfo({ ...info, distributionBoxesCount: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
              />
            </div>

            {/*Per-box circuits inputs when multiple boxes */}
            {parseInt(info.distributionBoxesCount) > 1 && info.perBoxCircuits ? (
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-700">الدوائر لكل صندوق على حدة</label>
                {info.perBoxCircuits.map((box, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl">
                    <span className="text-sm font-bold text-blue-700 min-w-[80px]">صندوق {index + 1}</span>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500">الدوائر</label>
                      <input
                        type="number"
                        min="1"
                        value={box.circuits}
                        onChange={(e) => {
                          const newPerBox = [...info.perBoxCircuits!];
                          newPerBox[index] = { ...newPerBox[index], circuits: e.target.value };
                          setInfo({ ...info, perBoxCircuits: newPerBox });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-center"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500">الفارغة</label>
                      <input
                        type="number"
                        min="0"
                        value={box.emptyCircuits}
                        onChange={(e) => {
                          const newPerBox = [...info.perBoxCircuits!];
                          newPerBox[index] = { ...newPerBox[index], emptyCircuits: e.target.value };
                          setInfo({ ...info, perBoxCircuits: newPerBox });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-center"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
            {/* عدد الدوائر لكل صندوق */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">عدد الدوائر لكل صندوق</label>
              <input
                type="number"
                min="1"
                value={info.circuitsPerBox}
                onChange={(e) => setInfo({ ...info, circuitsPerBox: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
              />
            </div>

            {/* عدد الدوائر الفارغة لكل صندوق */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">عدد الدوائر الفارغة بكل صندوق</label>
              <input
                type="number"
                min="0"
                value={info.emptyCircuitsPerBox}
                onChange={(e) => setInfo({ ...info, emptyCircuitsPerBox: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right"
              />
            </div>
              </>
            )}

            {/* طريقة تركيب المحول */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">طريقة تركيب المحول</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'ground', label: 'على الأرض' },
                  { value: 'hanging', label: 'معلق' },
                  { value: 'indoor', label: 'داخل غرفة' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setInfo({ ...info, installationMethod: opt.value })}
                    className={`py-3 px-2 rounded-xl border-2 text-sm transition-all ${
                      info.installationMethod === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* نوع المحول */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">نوع المحول</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setInfo({ ...info, transformerType: 'public' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.transformerType === 'public'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  عام
                </button>
                <button
                  onClick={() => setInfo({ ...info, transformerType: 'private' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.transformerType === 'private'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  خاص
                </button>
              </div>
            </div>

            {/* طريقة تركيب صندوق التوزيع */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">طريقة تركيب صندوق التوزيع</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setInfo({ ...info, boxInstallationMethod: 'ground' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.boxInstallationMethod === 'ground'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  على الأرض
                </button>
                <button
                  onClick={() => setInfo({ ...info, boxInstallationMethod: 'hanging' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.boxInstallationMethod === 'hanging'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  معلق
                </button>
              </div>
            </div>

            {/* صندوق الإنارة */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">صندوق الإنارة</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'indoor', label: 'داخلي' },
                  { value: 'outdoor', label: 'خارجي' },
                  { value: 'none', label: 'لا يوجد' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setInfo({ ...info, lightingBox: opt.value })}
                    className={`py-3 px-2 rounded-xl border-2 text-sm transition-all ${
                      info.lightingBox === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* المكثف */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">المكثف</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setInfo({ ...info, capacitor: 'yes' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.capacitor === 'yes'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  موجود
                </button>
                <button
                  onClick={() => setInfo({ ...info, capacitor: 'no' })}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all ${
                    info.capacitor === 'no'
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  غير موجود
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex gap-3">
            <button
              onClick={handleAddToCanvas}
              className="flex-1 py-3 px-6 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl hover:from-green-600 hover:to-green-700 transition-all shadow-lg flex items-center justify-center gap-2"
            >
              <Download size={18} />
              إضافة للرسم
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-3 px-6 bg-gradient-to-l from-blue-600 to-blue-700 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg"
            >
              حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// مكون جدول معلومات المحول على اللوحة
interface TransformerTableProps {
  info: TransformerInfo;
  x: number;
  y: number;
  scale: number;
  onMove: (x: number, y: number) => void;
  onScale: (scale: number) => void;
  onDelete: () => void;
}

export const TransformerTable: React.FC<TransformerTableProps> = ({ info, x, y, scale, onMove, onScale, onDelete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const tableRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - x, y: e.clientY - y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      onMove(e.clientX - dragStart.x, e.clientY - dragStart.y);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomIn = () => {
    onScale(Math.min(scale + 0.1, 2));
  };

  const handleZoomOut = () => {
    onScale(Math.max(scale - 0.1, 0.5));
  };

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Background */}
      <rect
        x={-10}
        y={-10}
        width={320}
        height={380}
        fill="white"
        stroke="#2563eb"
        strokeWidth={2}
        rx={8}
        className="cursor-move"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      
      {/* Title */}
      <rect x={-10} y={-10} width={320} height={35} fill="#2563eb" rx={8} />
      <rect x={-10} y={20} width={320} height={5} fill="#2563eb" />
      <text x={150} y={8} textAnchor="middle" fill="white" fontSize={16} fontWeight="bold">
        {info.transformerNumber ? `محول ${info.transformerNumber}` : 'معلومات المحول'}
      </text>
      
      {/* Delete button */}
      <g 
        className="cursor-pointer" 
        onClick={onDelete}
        transform="translate(280, -5)"
      >
        <circle r={12} fill="#ef4444" />
        <text x={0} y={4} textAnchor="middle" fill="white" fontSize={12} fontWeight="bold">×</text>
      </g>

      {/* Controls */}
      <g transform="translate(10, 30)">
        {/* Zoom controls */}
        <g transform="translate(260, 0)" className="cursor-pointer" onClick={handleZoomOut}>
          <circle r={12} fill="#e5e7eb" stroke="#9ca3af" />
          <text x={0} y={4} textAnchor="middle" fontSize={14} fontWeight="bold">-</text>
        </g>
        <g transform="translate(280, 0)" className="cursor-pointer" onClick={handleZoomIn}>
          <circle r={12} fill="#e5e7eb" stroke="#9ca3af" />
          <text x={0} y={4} textAnchor="middle" fontSize={14} fontWeight="bold">+</text>
        </g>
      </g>

      {/* Table content */}
      <g transform="translate(15, 75)">
        <line x1={0} y1={0} x2={290} y2={0} stroke="#e5e7eb" strokeWidth={1} />
        
        {/* Rows */}
        {[
          { label: 'الكابل الرئيسي', value: `${info.mainCable} مم²` },
          { label: 'عدد الخطوط', value: info.mainLinesCount },
          { label: 'نوع الخط', value: info.cableType === 'copper' ? 'نحاسي' : 'ألمنيوم' },
          { label: 'صناديق التوزيع', value: info.distributionBoxesCount },
          { label: 'دوائر لكل صندوق', value: info.circuitsPerBox },
          { label: 'دوائر فارغة', value: info.emptyCircuitsPerBox },
          { label: 'تركيب المحول', value: info.installationMethod === 'ground' ? 'على الأرض' : info.installationMethod === 'hanging' ? 'معلق' : 'داخل غرفة' },
          { label: 'نوع المحول', value: info.transformerType === 'public' ? 'عام' : 'خاص' },
          { label: 'تركيب الصندوق', value: info.boxInstallationMethod === 'ground' ? 'على الأرض' : 'معلق' },
          { label: 'صندوق الإنارة', value: info.lightingBox === 'indoor' ? 'داخلي' : info.lightingBox === 'outdoor' ? 'خارجي' : 'لا يوجد' },
          { label: 'المكثف', value: info.capacitor === 'yes' ? 'موجود' : 'غير موجود' },
        ].map((row, i) => (
          <g key={i} transform={`translate(0, ${i * 26})`}>
            <rect x={0} y={0} width={145} height={26} fill={i % 2 === 0 ? '#f9fafb' : 'white'} />
            <rect x={145} y={0} width={145} height={26} fill={i % 2 === 0 ? '#f9fafb' : 'white'} />
            <line x1={0} y1={26} x2={290} y2={26} stroke="#e5e7eb" strokeWidth={1} />
            
            <text x={10} y={17} fontSize={11} fill="#6b7280" fontWeight="500">{row.label}</text>
            <text x={155} y={17} fontSize={11} fill="#1f2937" fontWeight="600">{row.value}</text>
          </g>
        ))}
      </g>
    </g>
  );
};

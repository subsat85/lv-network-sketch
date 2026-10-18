import React from 'react';
import { X, Zap, Circle } from 'lucide-react';
import { ConsumerElement } from '../types/drawing';

interface LoadReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  consumers: ConsumerElement[];
}

interface CableLoad {
  color: string;
  singlePhaseCount: number;
  singlePhaseLoad: number;
  threePhaseCount: number;
  threePhaseLoad: number;
  totalLoad: number;
}

export const LoadReportModal: React.FC<LoadReportModalProps> = ({ isOpen, onClose, consumers }) => {
  if (!isOpen) return null;

  // Calculate load grouped by cable color
  const calculateLoadByCable = (): CableLoad[] => {
    const cableMap = new Map<string, CableLoad>();

    consumers.forEach(consumer => {
      const color = consumer.color || '#000000';
      const count = consumer.count || 1;
      
      if (!cableMap.has(color)) {
        cableMap.set(color, {
          color,
          singlePhaseCount: 0,
          singlePhaseLoad: 0,
          threePhaseCount: 0,
          threePhaseLoad: 0,
          totalLoad: 0
        });
      }

      const cable = cableMap.get(color)!;
      
      if (consumer.variant === 'circle') {
        // Single-phase (واحد فاز) = 4 amps per consumer
        cable.singlePhaseCount += count;
        cable.singlePhaseLoad += count * 4;
      } else {
        // Three-phase (ثلاث فاز) = label as amps, default 32 if no label
        const amps = consumer.label ? parseFloat(consumer.label) : 32;
        cable.threePhaseCount += count;
        cable.threePhaseLoad += count * (isNaN(amps) ? 32 : amps);
      }
      
      cable.totalLoad = cable.singlePhaseLoad + cable.threePhaseLoad;
    });

    return Array.from(cableMap.values()).sort((a, b) => b.totalLoad - a.totalLoad);
  };

  const cableLoads = calculateLoadByCable();
  const totalLoad = cableLoads.reduce((sum, cable) => sum + cable.totalLoad, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-l from-blue-600 to-blue-500 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Zap className="text-white" size={24} />
            <h2 className="text-xl font-bold text-white">تقرير الاحمال</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="text-white" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {cableLoads.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              لا يوجد مشتركين على الكيابل
            </div>
          ) : (
            cableLoads.map((cable, index) => (
              <div 
                key={cable.color} 
                className="bg-gray-50 rounded-xl p-4 border border-gray-200"
              >
                {/* Cable Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-4 h-4 rounded-full border border-gray-300" 
                      style={{ backgroundColor: cable.color }}
                    />
                    <span className="font-bold text-gray-800">كيبل {index + 1}</span>
                  </div>
                  <span className="text-lg font-bold text-blue-600">
                    {cable.totalLoad} امبير
                  </span>
                </div>

                {/* Single Phase */}
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-2">
                    <Circle size={14} className="text-blue-500" fill="currentColor" />
                    <span className="text-gray-600">واحد فاز:</span>
                  </div>
                  <span className="text-gray-800">
                    {cable.singlePhaseCount} مشترك ({cable.singlePhaseLoad} امبير)
                  </span>
                </div>

                {/* Three Phase */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-purple-500" />
                    <span className="text-gray-600">ثلاث فاز:</span>
                  </div>
                  <span className="text-gray-800">
                    {cable.threePhaseCount} مشترك ({cable.threePhaseLoad} امبير)
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer - Total */}
        {cableLoads.length > 0 && (
          <div className="px-6 py-4 bg-gradient-to-l from-green-500 to-emerald-600 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-white font-bold text-lg">الاجمالي</span>
              <span className="text-white font-bold text-2xl">{totalLoad} امبير</span>
            </div>
          </div>
        )}

        {/* Note */}
        <div className="px-6 py-2 bg-gray-50 border-t border-gray-100 flex-shrink-0">
          <div className="text-xs text-gray-500 text-center">
            * واحد فاز = 4 امبير | ثلاث فاز = الرقم المكتوب او 32 امبير الافتراضي
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { X, Zap, Circle } from 'lucide-react';
import { ConsumerElement } from '../types/drawing';
import { invalidLoads, loadsByColor, SINGLE_PHASE_AMPS, THREE_PHASE_DEFAULT_AMPS } from '../utils/loads';
import { useLocale, useT } from '../store/localeStore';
import { directionOf } from '../i18n';

interface LoadReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  consumers: ConsumerElement[];
}

export const LoadReportModal: React.FC<LoadReportModalProps> = ({ isOpen, onClose, consumers }) => {
  const t = useT();
  const locale = useLocale((st) => st.locale);
  if (!isOpen) return null;

  // Load grouped by cable colour — rules in utils/loads.ts (shared with the voltage-drop calculation)
  const cableLoads = loadsByColor(consumers);
  const totalLoad = cableLoads.reduce((sum, cable) => sum + cable.totalLoad, 0);
  // totals are kept exactly as before; values that cannot be a current are pointed out
  const invalid = invalidLoads(consumers);

  return (
    // z-[60]: above FloatingHistoryControls (z-50, rendered later), like the other dialogs (VoltageDropPanel, SpanPropertiesSheet)
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div dir={directionOf(locale)} role="dialog" aria-label={t('loads.title')} data-load-report className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] supports-[height:100dvh]:max-h-[80dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-l from-blue-600 to-blue-500 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Zap className="text-white" size={24} />
            <h2 className="text-xl font-bold text-white">{t('loads.title')}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('loads.close')}
            data-load-report-close
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="text-white" size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {cableLoads.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {t('loads.none')}
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
                    <span className="font-bold text-gray-800">{t('loads.cable', { n: index + 1 })}</span>
                  </div>
                  <span className="text-lg font-bold text-blue-600">
                    {t('loads.amps', { n: cable.totalLoad })}
                  </span>
                </div>

                {/* Single Phase */}
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="flex items-center gap-2">
                    <Circle size={14} className="text-blue-500" fill="currentColor" />
                    <span className="text-gray-600">{t('loads.single')}</span>
                  </div>
                  <span className="text-gray-800">
                    {t('loads.consumers', { n: cable.singlePhaseCount, amps: cable.singlePhaseLoad })}
                  </span>
                </div>

                {/* Three Phase */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 border-2 border-purple-500" />
                    <span className="text-gray-600">{t('loads.three')}</span>
                  </div>
                  <span className="text-gray-800">
                    {t('loads.consumers', { n: cable.threePhaseCount, amps: cable.threePhaseLoad })}
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
              <span className="text-white font-bold text-lg">{t('loads.total')}</span>
              <span className="text-white font-bold text-2xl" data-load-total={totalLoad}>{t('loads.amps', { n: totalLoad })}</span>
            </div>
          </div>
        )}

        {invalid.length > 0 && (
          <div role="alert" className="px-6 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-900 text-start flex-shrink-0">
            {t('loads.invalid', { n: invalid.length, list: invalid.map(c => `«${c.label ?? ''}»${c.count !== 1 ? ` ×${c.count}` : ''}`).join(t('common.listSep')) })}
          </div>
        )}

        {/* Note */}
        <div className="px-6 py-2 bg-gray-50 border-t border-gray-100 flex-shrink-0">
          <div className="text-xs text-gray-500 text-center">
            {t('loads.note', { single: SINGLE_PHASE_AMPS, three: THREE_PHASE_DEFAULT_AMPS })}
          </div>
        </div>
      </div>
    </div>
  );
};

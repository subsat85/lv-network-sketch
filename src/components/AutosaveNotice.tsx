import React from 'react';
import { X } from 'lucide-react';
import { useAutosaveStatus } from '../utils/autosave';

// Shows autosave problems (and the one "restored unlinked" note). Silent when all is well.
export const AutosaveNotice: React.FC = () => {
  const { message, kind, dismiss } = useAutosaveStatus();
  if (!message) return null;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      dir="rtl"
      className={`ui-float absolute left-1/2 top-16 z-40 flex w-[min(92vw,420px)] -translate-x-1/2 items-start gap-2 px-3 py-2 text-[13px] leading-snug ${
        kind === 'error' ? 'border-ios-red/40 text-ios-red' : 'text-ios-label'
      }`}
    >
      <span className="flex-1">{message}</span>
      <button type="button" aria-label="إغلاق التنبيه" onClick={dismiss} className="ui-icon-btn h-6 w-6 flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  );
};

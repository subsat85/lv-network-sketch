import React from 'react';
import { X } from 'lucide-react';
import { MESSAGES, useAutosaveStatus } from '../utils/autosave';
import { useLocale, useT } from '../store/localeStore';
import { directionOf } from '../i18n';

/** one of the known autosave messages, in the interface language (any other text is shown as it is) */
const KEYS = Object.keys(MESSAGES) as (keyof typeof MESSAGES)[];
const messageKey = (message: string) => KEYS.find((k) => MESSAGES[k] === message);

// Shows autosave problems (and the one "restored unlinked" note). Silent when all is well.
export const AutosaveNotice: React.FC = () => {
  const { message, kind, dismiss } = useAutosaveStatus();
  const t = useT();
  const locale = useLocale((st) => st.locale);
  if (!message) return null;
  const key = messageKey(message);
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      dir={directionOf(locale)}
      data-autosave-notice={key ?? 'other'}
      className={`ui-float absolute left-1/2 top-16 z-40 flex w-[min(92vw,420px)] -translate-x-1/2 items-start gap-2 px-3 py-2 text-[13px] leading-snug ${
        kind === 'error' ? 'border-ios-red/40 text-ios-red' : 'text-ios-label'
      }`}
    >
      <span className="flex-1">{key ? t(`autosave.${key}`) : message}</span>
      <button type="button" aria-label={t('autosave.dismiss')} data-autosave-dismiss onClick={dismiss} className="ui-icon-btn h-6 w-6 flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  );
};

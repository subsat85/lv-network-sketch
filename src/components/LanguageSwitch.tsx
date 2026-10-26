import React from 'react';
import { useLocale, useT } from '../store/localeStore';
import type { Locale } from '../i18n';

// The interface language button in the top toolbar. It shows the current language by name
// (no flag) and switches to the other one at once, without reloading: only the language store
// changes (saved under its own key, with <html lang/dir>); the drawing, the open project, the
// tool, the selection and undo/redo are not touched. Its width is fixed, so the buttons after
// it keep their places in both languages.

const other = (l: Locale): Locale => (l === 'ar' ? 'en' : 'ar');

export const LanguageSwitch: React.FC = () => {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const t = useT();
  const next = other(locale);
  const name = t('language.switchName', { current: t(`language.${locale}`), other: t(`language.${next}`) });
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      className="ui-icon-btn !w-16 text-[13px] font-semibold text-ios-blue"
      aria-label={name}
      title={name}
      data-language-switch={locale}
    >
      <span lang={locale}>{t(`language.${locale}`)}</span>
    </button>
  );
};

import { useEffect, useState } from 'react';

// A "small screen" is a phone: narrow (portrait) or short (landscape). Only the phone
// presentation of a few panels depends on it; the desktop layout is unchanged.
export const SMALL_SCREEN_QUERY = '(max-width: 640px), (max-height: 500px)';

export const isSmallScreen = () => {
  try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(SMALL_SCREEN_QUERY).matches; } catch { return false; }
};

/** Whether the screen is small; follows rotation / resizing. */
export const useSmallScreen = () => {
  const [small, setSmall] = useState(isSmallScreen);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(SMALL_SCREEN_QUERY);
    const on = () => setSmall(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return small;
};

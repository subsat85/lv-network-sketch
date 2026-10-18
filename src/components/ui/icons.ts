// Shared icon sizing so every lucide icon has the same visual weight
// (SF Symbols-like: regular weight, consistent optical size).
export const ICON_STROKE = 1.75;

/** Primary toolbars and rails */
export const ICON_LG = { size: 22, strokeWidth: ICON_STROKE } as const;
/** Floating controls and popovers */
export const ICON_MD = { size: 20, strokeWidth: ICON_STROKE } as const;
/** Steppers and inline controls */
export const ICON_SM = { size: 16, strokeWidth: 2 } as const;

// iOS Safari scrolls the document when the on-screen keyboard opens and may
// leave it scrolled after the keyboard closes, even with overflow: hidden.
// The app is a fixed full-screen layout, so the page offset must always be 0.
export const installViewportFix = () => {
  const isEditing = () => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  const reset = () => {
    // While a field is focused Safari may need the offset to keep it above the keyboard.
    if (isEditing()) return;
    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  };
  const resetSoon = () => {
    // Let Safari finish its keyboard / toolbar animation first.
    setTimeout(reset, 50);
    setTimeout(reset, 350);
  };

  document.addEventListener('focusout', resetSoon);
  window.addEventListener('orientationchange', resetSoon);
  window.addEventListener('pageshow', resetSoon);
  window.visualViewport?.addEventListener('resize', resetSoon);
};

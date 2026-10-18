/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // iOS-inspired design tokens (UI chrome only — never used on drawing elements)
      colors: {
        ios: {
          blue: '#007AFF',
          'blue-pressed': '#0062CC',
          red: '#FF3B30',
          green: '#34C759',
          label: '#1C1C1E',
          secondary: '#6B6B70',
          tertiary: '#AEAEB2',
          separator: 'rgba(60, 60, 67, 0.16)',
          fill: 'rgba(118, 118, 128, 0.12)',
          'fill-strong': 'rgba(118, 118, 128, 0.20)',
          grouped: '#F2F2F7',
        },
      },
      borderRadius: {
        ctl: '10px',
        panel: '16px',
      },
      boxShadow: {
        float: '0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 20px rgba(0, 0, 0, 0.08)',
        sheet: '0 -1px 0 rgba(60, 60, 67, 0.10), 0 -6px 20px rgba(0, 0, 0, 0.05)',
        segment: '0 1px 2px rgba(0, 0, 0, 0.10), 0 1px 1px rgba(0, 0, 0, 0.04)',
      },
      // Mobile-first screen sizes
      screens: {
        'mobile': '375px', // Standard mobile (iPhone)
        'mobile-lg': '430px', // Large mobile (iPhone Pro Max)
        'sm': '640px',     // Small tablets  
        'md': '768px',     // Tablets
        'lg': '1024px',    // Desktop
        'xl': '1280px',    // Large desktop
        '2xl': '1536px',   // Extra large desktop
        // Tablet-specific breakpoints
        'tablet': '600px', // Small tablet
        'tablet-lg': '840px', // Large tablet (iPad Air, standard Android tablets)
      },
      // Mobile-optimized spacing
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      // Touch-friendly sizes
      minHeight: {
        'touch': '44px',
        'dvh': '100dvh',
        'screen-safe': 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
      },
      minWidth: {
        'touch': '44px',
      },
      // Container heights for single-screen layouts
      height: {
        'dvh': '100dvh',
        'touch': '44px',
        'screen': '100vh',
        'screen-dvh': '100dvh',
        'screen-safe': 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        'container-full': 'calc(100dvh - env(safe-area-inset-top))',
        'content-area': 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 4rem)',
      },
      // Mobile viewport max widths
      maxWidth: {
        'mobile': '375px',    // Standard mobile container
        'mobile-lg': '430px', // Large mobile container
        'mobile-full': '100vw', // Full mobile width
      },
      // Container and scrollable areas
      maxHeight: {
        'screen-safe': 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        'container-full': 'calc(100dvh - env(safe-area-inset-top))',
        'content-area': 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 4rem)',
      },
    },
  },
  plugins: [],
}
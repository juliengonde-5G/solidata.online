/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Charte bleu pétrole / teal — primaire
        primary: {
          DEFAULT: '#0D9488',
          light: '#14B8A6',
          dark: '#0F766E',
          muted: '#CCFBF1',
          surface: '#F0FDFA',
        },
        // Palette teal complète (alignée design handoff)
        teal: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        // Convention : slate est la palette neutre officielle.
        // gray est redirigé vers slate pour convergence progressive.
        gray: {
          50: '#F8FAFC',   // slate-50
          100: '#F1F5F9',  // slate-100
          200: '#E2E8F0',  // slate-200
          300: '#CBD5E1',  // slate-300
          400: '#94A3B8',  // slate-400
          500: '#64748B',  // slate-500
          600: '#475569',  // slate-600
          700: '#334155',  // slate-700
          800: '#1E293B',  // slate-800
          900: '#0F172A',  // slate-900
        },
        // Alias legacy (utilisé dans DiagrammeFluxTri uniquement)
        'solidata-green': '#0D9488',
        'solidata-dark': '#0F172A',
      },
      borderRadius: {
        'card': '12px',
        'button': '10px',
        'input': '10px',
        'xl': '16px',
        '2xl': '18px',
        '3xl': '22px',
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(15 23 42 / 0.05)',
        'card-hover': '0 4px 12px -2px rgb(15 23 42 / 0.08)',
        'elevated': '0 10px 24px -4px rgb(15 23 42 / 0.08)',
        'sidebar': '2px 0 8px -2px rgb(15 23 42 / 0.04)',
        'topbar': '0 1px 0 0 rgb(15 23 42 / 0.05)',
        'teal-glow': '0 4px 10px -2px rgb(13 148 136 / 0.35)',
      },
      spacing: {
        'sidebar': '15.5rem',           // 248px (design)
        'sidebar-collapsed': '4.25rem', // 68px  (design)
        'topbar': '3.5rem',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(13 148 136 / 0.5)' },
          '70%': { boxShadow: '0 0 0 6px rgb(13 148 136 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(13 148 136 / 0)' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.22s ease-out',
        'fade-in': 'fade-in 0.18s ease-out',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};

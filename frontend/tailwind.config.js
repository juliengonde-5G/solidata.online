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
        // Alias pour compatibilité (à supprimer progressivement)
        'solidata-green': '#0D9488',
        'solidata-green-dark': '#0F766E',
        'solidata-green-light': '#14B8A6',
        'solidata-yellow': '#F59E0B',
        'solidata-yellow-light': '#FEF3C7',
        'solidata-gray': '#64748B',
        'solidata-gray-light': '#F1F5F9',
        'solidata-dark': '#0F172A',
      },
      borderRadius: {
        'card': '12px',
        'card-lg': '16px',
        'button': '10px',
        'input': '10px',
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
        'elevated': '0 10px 15px -3px rgb(0 0 0 / 0.06), 0 4px 6px -4px rgb(0 0 0 / 0.05)',
        'sidebar': '2px 0 8px -2px rgb(0 0 0 / 0.04)',
      },
      spacing: {
        'sidebar': '16rem',
        'sidebar-collapsed': '4.5rem',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0D9488',
          light: '#14B8A6',
          dark: '#0F766E',
          surface: '#F0FDFA',
        },
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
        'solidata-green': '#0D9488',
        'solidata-green-dark': '#0F766E',
        'solidata-yellow': '#F59E0B',
        'solidata-dark': '#0F172A',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      minHeight: {
        touch: '60px',
        'cta-xl': '84px', // CTA primaire parcours chauffeur
      },
      borderRadius: {
        sm: '12px',
        md: '16px',
        lg: '20px',
        xl: '22px',  // bottom sheet
        '2xl': '24px',
        card: '16px',
        button: '12px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        'card-hover': '0 4px 12px -2px rgb(0 0 0 / 0.08)',
        'sticky-eta': '0 8px 24px rgb(0 0 0 / 0.12)',
      },
      keyframes: {
        'scan-line': {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(220px)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(13 148 136 / 0.5)' },
          '70%': { boxShadow: '0 0 0 14px rgb(13 148 136 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(13 148 136 / 0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
      animation: {
        'scan-line': 'scan-line 2.2s ease-in-out infinite alternate',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
      },
    },
  },
  plugins: [],
};

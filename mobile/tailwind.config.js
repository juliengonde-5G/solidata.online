/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'solidata-green': '#8BC540',
        'solidata-green-dark': '#6FA030',
        'solidata-yellow': '#F5A623',
        'solidata-dark': '#1A202C',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      minHeight: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        'solidata-green': '#8BC540',
        'solidata-green-dark': '#6FA030',
        'solidata-green-light': '#A8D96A',
        'solidata-yellow': '#F5A623',
        'solidata-yellow-light': '#FFD580',
        'solidata-gray': '#4A5568',
        'solidata-gray-light': '#E2E8F0',
        'solidata-dark': '#1A202C',
      },
    },
  },
  plugins: [],
};

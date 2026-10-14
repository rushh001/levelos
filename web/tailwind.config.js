/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Budget Android phones ship Noto system fonts for Indic scripts; we never fetch web fonts (offline-first).
      fontFamily: {
        sans: ['system-ui', '"Noto Sans"', '"Noto Sans Devanagari"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

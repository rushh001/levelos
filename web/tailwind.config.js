/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Budget Android phones ship Noto system fonts for Indic scripts; body text never fetches web fonts.
      // The display face (headings, the child-facing moments) is bundled in public/fonts, so it works offline too.
      // Reading cards always use the plain system face: a child learning to read must see textbook letter shapes.
      fontFamily: {
        sans: ['system-ui', '"Noto Sans"', '"Noto Sans Devanagari"', 'sans-serif'],
        display: ['"LevelOS Display"', 'system-ui', '"Noto Sans"', '"Noto Sans Devanagari"', 'sans-serif'],
      },
      colors: {
        paper: '#f4f6fb',
        ink: '#1b1f3b',
        mute: '#5b6178',
        line: '#e3e7f0',
        brand: { DEFAULT: '#4338ca', deep: '#312e81', soft: '#e8eafc', tint: '#f3f4fe' },
        sun: { DEFAULT: '#f5b63a', deep: '#b97a0a', soft: '#fff3d4' },
        leaf: { DEFAULT: '#2f9e5b', deep: '#1f7a43', soft: '#e3f5ea' },
        coral: { DEFAULT: '#e5484d', deep: '#b9262b', soft: '#fde7e8' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 31, 59, 0.05), 0 10px 30px -16px rgba(27, 31, 59, 0.25)',
        lift: '0 2px 4px rgba(27, 31, 59, 0.06), 0 16px 40px -16px rgba(67, 56, 202, 0.35)',
      },
      borderRadius: { '4xl': '2rem' },
    },
  },
  plugins: [],
}

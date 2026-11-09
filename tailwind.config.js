/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Projekt-Palette: dunkles, touch-freundliches Werkstatt-Thema.
        panel: '#161a21',
        panel2: '#1d222b',
        edge: '#2a313c',
        accent: '#4da3ff',
        accent2: '#7c5cff',
        ok: '#3ddc84',
        warn: '#ffb020',
        danger: '#ff5c5c',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

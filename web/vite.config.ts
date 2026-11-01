import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

/** The activity bank is 200 KB of six-language text the API serves. The app ships each entry's id, title, cohorts,
 * script and examples (for the "Show the class" screens), and the whole of the book-based entries with the homework
 * and the sources, so a 10-minute activity can be put together on the phone with no network. */
function activityBank(): Plugin {
  const id = 'virtual:activity-bank'
  const resolved = '\0' + id
  return {
    name: 'levelos-activity-bank',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(source) {
      if (source !== resolved) return
      const path = fileURLToPath(new URL('../content/activities/bank.json', import.meta.url))
      const bank = JSON.parse(readFileSync(path, 'utf8')) as {
        activities: Record<string, unknown>[]
        homework: unknown
        sources: unknown
      }
      const slim = bank.activities.map((a) => {
        const { id, title, cohorts, script, examples, uses_text, reads } = a
        return uses_text ? a : { id, title, cohorts, script, examples, uses_text, reads }
      })
      return [
        `export default ${JSON.stringify(slim)}`,
        `export const homework = ${JSON.stringify(bank.homework)}`,
        `export const sources = ${JSON.stringify(bank.sources)}`,
      ].join('\n')
    },
  }
}

// `npm run dev:https` (mode 'https') serves a self-signed certificate: phones block the microphone on plain
// http:// over Wi-Fi, so testing on a phone on the LAN needs it.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    activityBank(),
    mode === 'https' && basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'LevelOS',
        short_name: 'LevelOS',
        description: 'Voice-first reading-level check for FLN teachers',
        theme_color: '#4338ca',
        background_color: '#f4f6fb',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'en',
        start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // App shell + item banks + instruction audio are precached so a check-in works with no network.
        globPatterns: ['**/*.{js,css,html,svg,json,mp3,ogg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          // API calls are never served from cache; the app's own IndexedDB queue handles offline.
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // Item banks are imported from ../content so the app can run a check-in offline.
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
}))

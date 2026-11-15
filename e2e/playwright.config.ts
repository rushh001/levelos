import path from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * Offline / low-connectivity tests. They drive the installed Chrome (no browser download) through the DevTools
 * protocol: offline, throttled and "connected but no internet" networks, and a fake microphone that plays a WAV.
 *
 * They run against a LOCAL production build (the service worker only exists in a build) and a local API with a
 * throwaway SQLite database seeded with the demo class, never against the hosted demo: the tests add children and
 * run checks, which would change the shared demo class and spend speech credit.
 *
 * No API keys are needed. Without speech keys a recording cannot be AI-scored, so online checks fall back to
 * tap-marking, as they do when the speech services are down.
 */
// Without this, offline mode and request blocking do not reach requests the app's service worker makes (every API
// read goes through it), so "offline" tests would still talk to the server. tests/zz-harness.spec.ts checks it.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'

const ROOT = path.resolve(__dirname, '..')
const PY = process.platform === 'win32' ? path.join('.venv', 'Scripts', 'python') : path.join('.venv', 'bin', 'python')
export const FAKE_MIC = path.join(__dirname, '.fixtures', 'reading.wav')

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one shared server and database
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    viewport: { width: 393, height: 851 }, // a mid-size Android phone
    isMobile: false,
    permissions: ['microphone'],
    serviceWorkers: 'allow',
    trace: 'on',
    screenshot: 'on',
    video: 'off', // needs Playwright's own ffmpeg; the trace has a frame-by-frame view instead
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${FAKE_MIC}`,
      ],
    },
  },
  webServer: [
    {
      // Fresh demo data on every run, in its own database file (the dev database is left alone).
      command: `${PY} -m scripts.seed_demo --reset && ${PY} -m uvicorn app.main:app --port 8000`,
      cwd: path.join(ROOT, 'api'),
      url: 'http://localhost:8000/api/ping',
      // NO_AI: no speech services or Claude, even if api/.env has keys (api/app/config.py).
      env: { DATABASE_URL: 'sqlite:///./e2e.db', APP_ENV: 'dev', KEEP_AWAKE_URL: '', NO_AI: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // A production build with its service worker; `vite preview` proxies /api to :8000 like the dev server.
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      cwd: path.join(ROOT, 'web'),
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
})

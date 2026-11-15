import path from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * The acceptance run (uat/uat.spec.ts): a teacher's day played through the app's screens, a synthetic voice reading
 * each card shown (with planted mistakes) into the microphone, under every network condition, with the real AI
 * marking the cards (the keys in api/.env). It uses the network lab's API (:8000, api/lab.db) and app (:4173) when the
 * lab is open (else starts them the same way), in a visible, slowed-down window, so the run can be watched tap by tap.
 * Writes an HTML report to e2e/uat-reports/<date>/report.html.
 *
 *   cd e2e && npx playwright test -c playwright.uat.config.ts
 */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'

const ROOT = path.resolve(__dirname, '..')
const PY = process.platform === 'win32' ? path.join('.venv', 'Scripts', 'python') : path.join('.venv', 'bin', 'python')

export default defineConfig({
  testDir: './uat',
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    headless: false,
    channel: process.env.PW_CHANNEL ?? 'chromium',
    viewport: { width: 393, height: 851 },
    permissions: ['microphone'],
    serviceWorkers: 'allow',
    trace: 'off',
    actionTimeout: 30_000, // a tap that cannot happen fails the step instead of waiting for ever
    launchOptions: {
      slowMo: 60, // quick, but each tap can still be followed
      args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--window-position=40,40'],
    },
  },
  webServer: [
    {
      command: `${PY} -m uvicorn app.main:app --port 8000`,
      cwd: path.join(ROOT, 'api'),
      url: 'http://localhost:8000/api/ping',
      env: { DATABASE_URL: 'sqlite:///./lab.db', APP_ENV: 'dev', KEEP_AWAKE_URL: '' },
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      cwd: path.join(ROOT, 'web'),
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
})

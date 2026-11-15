#!/usr/bin/env node
/**
 * Network lab: two windows side by side. On the left, the app in a phone-sized window, loaded as it is (nothing is
 * added to the app or its page). On the right, a control window whose buttons change the phone window's network
 * while you use it — airplane mode, connected-but-no-internet, a weak signal that never answers, slow 3G, a flaky
 * line — plus "fresh phone" (wipes everything the app keeps on the phone) and reload. The control window is a
 * separate browser profile, so the network changes never reach it.
 *
 *   cd e2e && npm run lab                 # builds the web app, starts the API and the app, opens the window
 *   npm run lab -- --no-build             # reuse the last build (web/dist)
 *   npm run lab -- --reset                # fresh demo data (api/lab.db)
 *   npm run lab -- --fake-mic             # the microphone plays a tone file instead of your voice
 *
 * Like the tests, it runs a production build (the service worker exists only there) against a local API with its
 * own database (api/lab.db, the dev database is left alone). Speech keys in api/.env.local, if present, are used:
 * with them the AI marks cards while you test; without, you mark them yourself. Log in with "Try the demo class".
 * Close the window (or Ctrl+C) to stop everything.
 *
 * Everything is recorded in e2e/lab-sessions/<date-time>/: events.log (pages opened, network switches, every API
 * request with its status and time, console messages and errors, pop-ups and the answer, and what the app keeps on
 * the phone whenever that changes), screens/ (a screenshot every 5 s when the screen changed, and at every page and
 * network change) and api.log (the server's own log).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Offline mode and request blocking reach the service worker's requests only with this (see playwright.config.ts).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'
const { chromium } = await import('@playwright/test')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const API_DIR = path.join(ROOT, 'api')
const WEB_DIR = path.join(ROOT, 'web')
const PY = process.platform === 'win32' ? path.join('.venv', 'Scripts', 'python') : path.join('.venv', 'bin', 'python')
const APP_URL = 'http://localhost:4173'
const API_URL = 'http://localhost:8000/api/ping'
const args = new Set(process.argv.slice(2))
const PHONE = { width: 393, height: 851 } // a mid-size Android phone
const PANEL = 260 // the control window's width

// ---------------------------------------------------------------- recording

const STAMP = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const SESSION = path.join(HERE, 'lab-sessions', STAMP)
const SHOTS = path.join(SESSION, 'screens')
fs.mkdirSync(SHOTS, { recursive: true })
const events = fs.createWriteStream(path.join(SESSION, 'events.log'), { flags: 'a' })
const apiLog = fs.createWriteStream(path.join(SESSION, 'api.log'), { flags: 'a' })
const clock = () => {
  const d = new Date()
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
/** One line in events.log. */
function rec(kind, text) {
  events.write(`${clock()}  ${kind.padEnd(7)} ${String(text).replace(/\s+/g, ' ').slice(0, 600)}\n`)
}
rec('LAB', `session started (${process.argv.slice(2).join(' ') || 'no options'})`)

// ---------------------------------------------------------------- servers

const children = []
const up = async (url) => fetch(url).then((r) => r.ok).catch(() => false)

async function waitFor(url, what, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await up(url)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${what} did not start within ${ms / 1000} s`)
}

function stopAll() {
  for (const p of children) {
    try {
      process.platform === 'win32' ? spawn('taskkill', ['/pid', String(p.pid), '/t', '/f']) : process.kill(-p.pid)
    } catch {
      try {
        p.kill()
      } catch {
        /* gone */
      }
    }
  }
}

async function startServers() {
  if (await up(API_URL)) {
    console.log('• API already running on :8000, using it (its log is not recorded)')
  } else {
    // With the fake microphone (a tone), the AI would only be paid to hear nothing: off (api/app/config.py NO_AI).
    // With your own voice, the keys in api/.env are used and the AI marks the cards.
    const env = { DATABASE_URL: 'sqlite:///./lab.db', APP_ENV: 'dev', KEEP_AWAKE_URL: '', ...(args.has('--fake-mic') ? { NO_AI: '1' } : {}) }
    const seed = args.has('--reset') || !fs.existsSync(path.join(API_DIR, 'lab.db'))
    console.log(`• starting the API (database api/lab.db${seed ? ', fresh demo data' : ''})`)
    const cmd = `${seed ? `${PY} -m scripts.seed_demo --reset && ` : ''}${PY} -m uvicorn app.main:app --port 8000`
    const p = spawn(cmd, { cwd: API_DIR, shell: true, detached: process.platform !== 'win32', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.on('data', (d) => apiLog.write(d))
    p.stderr.on('data', (d) => {
      apiLog.write(d)
      const s = String(d)
      if (/error|Traceback/i.test(s) && !/GET|POST|PATCH|DELETE/.test(s)) process.stdout.write(`  [api] ${s}`)
    })
    children.push(p)
    await waitFor(API_URL, 'The API', 120_000)
  }
  if (await up(APP_URL)) {
    console.log('• app already running on :4173, using it')
    return
  }
  const build = !args.has('--no-build') || !fs.existsSync(path.join(WEB_DIR, 'dist', 'index.html'))
  console.log(build ? '• building the web app (about 30 s)…' : '• using the last build (web/dist)')
  const cmd = `${build ? 'npm run build && ' : ''}npm run preview -- --port 4173 --strictPort`
  const p = spawn(cmd, { cwd: WEB_DIR, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  p.stderr.on('data', (d) => {
    const s = String(d)
    if (/error/i.test(s) && !/chunk|dynamically imported/i.test(s)) process.stdout.write(`  [web] ${s}`)
  })
  children.push(p)
  await waitFor(APP_URL, 'The app', 240_000)
}

// ---------------------------------------------------------------- fake microphone (optional)

function fakeMic() {
  const file = path.join(HERE, '.fixtures', 'reading.wav')
  if (fs.existsSync(file)) return file
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const rate = 16000
  const n = rate * 4
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const on = t % 0.35 < 0.25 ? 1 : 0
    const v = on * 0.5 * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 720 * t))
    data.writeInt16LE(Math.round(v * 12000), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([h, data]))
  return file
}

// ---------------------------------------------------------------- network conditions

const MODES = {
  online: { icon: '🟢', label: 'Online', hint: 'Normal network' },
  airplane: { icon: '✈️', label: 'Airplane mode', hint: 'No network at all; the phone knows it is offline' },
  nointernet: { icon: '📵', label: 'No internet', hint: 'Phone says online, every request fails at once' },
  weak: { icon: '📶', label: 'Weak signal', hint: 'Phone says online, requests are sent and never answered' },
  slow: { icon: '🐢', label: 'Slow 3G', hint: '2.5 s delay on every request, 400 kbps' },
  flaky: { icon: '🎲', label: 'Flaky', hint: 'Half the requests fail, the rest take 1.5 s' },
}

const state = { mode: 'online', blocked: 0, held: 0, delayed: 0, log: [], dialog: null, session: path.relative(ROOT, SESSION) }
let pendingDialog = null
let ctx
let appPage
let cdp
let heldRoutes = []

function log(line) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  state.log.unshift(`${time}  ${line}`)
  state.log.length = Math.min(state.log.length, 8)
  console.log(`  ${line}`)
  rec('NET', line)
}

async function setMode(mode) {
  if (!MODES[mode]) return
  await ctx.unrouteAll({ behavior: 'ignoreErrors' })
  await ctx.setOffline(false)
  // Requests held by a weak signal go through when the signal comes back (as on a real phone), or fail.
  const held = heldRoutes
  heldRoutes = []
  for (const r of held) {
    if (mode === 'online' || mode === 'slow') await r.continue().catch(() => undefined)
    else await r.abort('timedout').catch(() => undefined)
  }
  if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => undefined)
  Object.assign(state, { mode, blocked: 0, held: 0, delayed: 0 })

  if (mode === 'airplane') {
    await ctx.setOffline(true)
    await ctx.route('**/*', (r) => {
      state.blocked++
      return r.abort('internetdisconnected')
    })
  } else if (mode === 'nointernet') {
    await ctx.route('**/api/**', (r) => {
      state.blocked++
      return r.abort('internetdisconnected')
    })
  } else if (mode === 'weak') {
    await ctx.route('**/api/**', (r) => {
      state.held++
      heldRoutes.push(r)
      rec('HELD', `${r.request().method()} ${new URL(r.request().url()).pathname} (weak signal: no answer)`)
    })
  } else if (mode === 'slow') {
    // A delay on every API request (reaches the service worker's requests too) + DevTools bandwidth for the page.
    await ctx.route('**/api/**', async (r) => {
      state.delayed++
      await new Promise((res) => setTimeout(res, 2500))
      await r.continue().catch(() => undefined)
    })
    if (cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 }).catch(() => undefined)
  } else if (mode === 'flaky') {
    await ctx.route('**/api/**', async (r) => {
      if (Math.random() < 0.5) {
        state.blocked++
        return r.abort('connectionreset')
      }
      state.delayed++
      await new Promise((res) => setTimeout(res, 1500))
      await r.continue().catch(() => undefined)
    })
  }
  log(`${MODES[mode].icon} ${MODES[mode].label}`)
  void shot(`net-${mode}`)
}

async function answerDialog(accept) {
  const d = pendingDialog
  if (!d) return
  pendingDialog = null
  state.dialog = null
  rec('DIALOG', `answered ${accept ? 'OK' : 'Cancel'}`)
  await (accept ? d.accept(d.defaultValue()) : d.dismiss()).catch(() => undefined)
}

async function action(name) {
  rec('LAB', `action: ${name}`)
  if (name === 'reload') {
    log('🔄 reload')
    await appPage.reload().catch(() => undefined)
  } else if (name === 'fresh') {
    // Everything the app keeps on the phone: its database, saved pages, waiting checks, the service worker.
    log('🧹 fresh phone: phone data wiped')
    const origin = new URL(APP_URL).origin
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => undefined)
    await appPage.goto(APP_URL).catch(() => undefined)
  } else if (name === 'drop5') {
    log('⏱️ airplane mode in 5 s…')
    setTimeout(() => void setMode('airplane'), 5000)
  }
}

// ---------------------------------------------------------------- recording the phone window

let shotN = 0
let lastShotAt = 0
let lastShotHash = ''
let shooting = Promise.resolve()

/** A screenshot of the phone in screens/, unless the screen is the same as the last one (or a pop-up is open). */
function shot(reason) {
  shooting = shooting.then(async () => {
    if (!appPage || appPage.isClosed() || pendingDialog) return
    const buf = await appPage.screenshot({ timeout: 5_000 }).catch(() => null)
    if (!buf) return
    const hash = createHash('md5').update(buf).digest('hex')
    if (hash === lastShotHash && reason === 'tick') return
    lastShotHash = hash
    lastShotAt = Date.now()
    const name = `${String(++shotN).padStart(4, '0')}-${clock().slice(0, 8).replace(/:/g, '')}-${reason}.png`
    fs.writeFileSync(path.join(SHOTS, name), buf)
    if (reason !== 'tick') rec('SCREEN', `screens/${name}`)
  })
  return shooting
}

/** What the app keeps on the phone, read from its database without changing it (never creates the database). */
const PHONE_STATE = () =>
  (async () => {
    const header = document.querySelector('header')?.innerText.replace(/\s+/g, ' ').trim() ?? ''
    const dbs = (await indexedDB.databases?.()) ?? []
    if (!dbs.some((d) => d.name === 'levelos')) return { header, db: 'none yet' }
    const db = await new Promise((resolve) => {
      const o = indexedDB.open('levelos')
      o.onsuccess = () => resolve(o.result)
      o.onerror = () => resolve(null)
      o.onupgradeneeded = () => o.transaction?.abort() // never create or upgrade it from here
    })
    if (!db) return { header, db: 'unreadable' }
    db.onversionchange = () => db.close()
    const get = (store, fn) =>
      new Promise((resolve) => {
        if (!db.objectStoreNames.contains(store)) return resolve(null)
        const req = fn(db.transaction(store).objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      })
    const keys = (await get('cache', (s) => s.getAllKeys())) ?? []
    const checks = (await get('checkins', (s) => s.getAll())) ?? []
    const recordings = await get('clips', (s) => s.count())
    const outbox = await get('cache', (s) => s.get('outbox'))
    db.close()
    return {
      header,
      savedPages: keys.length,
      childrenOnPhone: keys.filter((k) => String(k).startsWith('/students/')).length,
      checks: checks.map(
        (c) =>
          `${c.studentName} ${c.language} ${c.status}` +
          ` [${(c.items ?? []).map((i) => (i.skipped ? 'skip' : `${i.level}:${i.marks.filter(Boolean).length}/${i.marks.length}${i.ai ? '+AI' : ''}${i.hesitations ? `,pauses ${i.hesitations}` : ''}`)).join(' ')}]` +
          (c.provisionalLevel ? ` → ${c.provisionalLevel}` : ''),
      ),
      recordingsWaiting: recordings ?? 0,
      outbox: (outbox?.value ?? []).map((x) => `${x.method} ${x.path}`),
    }
  })()

let lastPhone = ''
async function recordPhoneState() {
  if (!appPage || appPage.isClosed() || pendingDialog) return
  const s = await appPage.evaluate(PHONE_STATE).catch(() => null)
  if (!s) return
  const text = JSON.stringify(s)
  if (text !== lastPhone) {
    lastPhone = text
    rec('PHONE', text)
  }
}

/** Every request of the phone window that matters (the API and page loads), with status, time and failures. */
function recordPhone(context, page) {
  const started = new WeakMap()
  const worth = (r) => new URL(r.url()).pathname.startsWith('/api/') || r.resourceType() === 'document'
  const label = (r) => {
    const u = new URL(r.url())
    return `${r.method()} ${u.pathname}${u.search}${r.serviceWorker() ? ' (via service worker)' : ''}`
  }
  // A pop-up answered on the phone window itself (headed Chrome shows it there too): the phone carries on, so the
  // control window stops offering it. A write or a page change can only come from a page that is no longer blocked.
  const dialogGone = (how) => {
    if (!pendingDialog) return
    pendingDialog = null
    state.dialog = null
    rec('DIALOG', `answered on the phone (${how})`)
  }
  context.on('request', (r) => {
    started.set(r, Date.now())
    if (r.method() === 'GET' || r.serviceWorker()) return
    let fromPage = false
    try {
      fromPage = r.frame() === page.mainFrame()
    } catch {
      /* a request with no frame */
    }
    if (fromPage) dialogGone('it sent ' + r.method())
  })
  context.on('requestfinished', async (r) => {
    if (!worth(r)) return
    const res = await r.response().catch(() => null)
    rec('API', `${label(r)} → ${res?.status() ?? '?'} in ${Date.now() - (started.get(r) ?? Date.now())} ms`)
  })
  context.on('requestfailed', (r) => {
    if (!worth(r)) return
    rec('API✗', `${label(r)} failed (${r.failure()?.errorText ?? '?'}) after ${Date.now() - (started.get(r) ?? Date.now())} ms`)
  })
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) return
    dialogGone('the page changed')
    rec('PAGE', f.url().replace(APP_URL, '') || '/')
    setTimeout(() => void shot('page'), 1200)
  })
  page.on('console', (m) => {
    if (m.type() === 'debug') return
    rec('CONSOLE', `${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => {
    rec('ERROR', e.stack ?? e.message)
    void shot('error')
  })
  page.on('crash', () => rec('ERROR', 'the page crashed'))
  page.on('dialog', (d) => {
    // Without this Playwright would dismiss every pop-up at once ("Stop this check?" would do nothing): the control
    // window shows it with OK / Cancel instead.
    pendingDialog = d
    state.dialog = { type: d.type(), message: d.message() }
    rec('DIALOG', `${d.type()}: ${d.message()}`)
  })
  setInterval(() => {
    if (Date.now() - lastShotAt > 4_000) void shot('tick')
  }, 5_000)
  setInterval(() => void recordPhoneState(), 3_000)
}

// ---------------------------------------------------------------- the control window

const CONTROL_HTML = (modes) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Network lab</title>
<style>
  html, body { margin:0; height:100%; background:#1e1b2e; color:#eee; font:13px/1.35 system-ui, -apple-system, sans-serif; }
  .p { box-sizing:border-box; padding:14px 12px; }
  h1 { font-size:15px; margin:0 0 2px; } .sub { color:#a9a3c9; font-size:11px; margin-bottom:12px; }
  button { display:block; width:100%; text-align:left; margin:0 0 7px; padding:8px 9px; border-radius:10px;
           border:1px solid #3b3557; background:#2a2640; color:#eee; cursor:pointer; font:inherit; }
  button:hover { background:#353052; } button.on { background:#6d5dfc; border-color:#8f83ff; }
  button small { display:block; color:#c9c4e8; font-size:11px; margin-top:2px; } button.on small { color:#efeaff; }
  .row { display:flex; gap:6px; } .row button { text-align:center; }
  .stat { margin:8px 0; padding:7px 9px; border-radius:8px; background:#2a2640; font-size:12px; }
  .log { font:11px/1.45 ui-monospace, Menlo, monospace; color:#a9a3c9; white-space:pre-wrap; }
  hr { border:0; border-top:1px solid #3b3557; margin:12px 0; }
  .dlg { margin:8px 0; padding:9px; border-radius:10px; background:#f5c542; color:#2a2100; }
  .dlg #dlgText { margin-bottom:8px; font-weight:600; } .dlg button { background:#fff7dc; color:#2a2100; border-color:#d9a400; }
  .rec { color:#ff6b6b; font-size:11px; margin-top:10px; }
</style></head>
<body><div class="p">
  <h1>📡 Network lab</h1>
  <div class="sub">Changes the network of the phone window, live.<br>Log in there with “Try the demo class”.</div>
  <div id="modes">${Object.entries(modes)
    .map(([k, m]) => `<button data-mode="${k}">${m.icon} ${m.label}<small>${m.hint}</small></button>`)
    .join('')}</div>
  <div class="stat" id="stat"></div>
  <div class="dlg" id="dlg" hidden>
    <div id="dlgText"></div>
    <div class="row"><button id="dlgOk">OK</button><button id="dlgNo">Cancel</button></div>
  </div>
  <hr>
  <button data-act="drop5">⏱️ Airplane mode in 5 s<small>Start a card, then lose the network mid-card</small></button>
  <div class="row">
    <button data-act="reload">🔄 Reload</button>
    <button data-act="fresh" title="Wipes everything the app keeps on the phone">🧹 Fresh phone</button>
  </div>
  <hr>
  <div class="log" id="log"></div>
  <div class="rec" id="rec"></div>
</div>
<script>
  const modes = ${JSON.stringify(modes)}
  document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => window.labSet(b.dataset.mode)))
  document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    if (b.dataset.act === 'fresh' && !confirm('Wipe everything the app keeps on the phone (saved pages, checks not sent yet)?')) return
    window.labAction(b.dataset.act)
  }))
  document.getElementById('dlgOk').onclick = () => window.labDialog(true)
  document.getElementById('dlgNo').onclick = () => window.labDialog(false)
  const paint = async () => {
    const s = await window.labState()
    const dlg = document.getElementById('dlg')
    dlg.hidden = !s.dialog
    if (s.dialog) document.getElementById('dlgText').textContent = '📱 The phone asks: ' + s.dialog.message
    document.getElementById('rec').textContent = '● Recording to ' + s.session
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode))
    const bits = []
    if (s.blocked) bits.push(s.blocked + (s.blocked === 1 ? ' request failed' : ' requests failed'))
    if (s.held) bits.push(s.held + ' hanging')
    if (s.delayed) bits.push(s.delayed + ' delayed')
    document.getElementById('stat').textContent = modes[s.mode].icon + ' ' + modes[s.mode].label + (bits.length ? ' · ' + bits.join(' · ') : '')
    document.getElementById('log').textContent = s.log.join('\\n')
  }
  paint()
  setInterval(paint, 700)
</script></body></html>`

/** Puts a page's window at a place and size on the screen (headed Chromium only). */
async function placeWindow(browser, context, page, bounds) {
  try {
    const session = await context.newCDPSession(page)
    const { targetInfo } = await session.send('Target.getTargetInfo')
    const bcdp = await browser.newBrowserCDPSession()
    const { windowId } = await bcdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId })
    await bcdp.send('Browser.setWindowBounds', { windowId, bounds })
  } catch {
    /* the window stays where the system put it */
  }
}

// ---------------------------------------------------------------- main

process.on('SIGINT', () => {
  rec('LAB', 'session ended (Ctrl+C)')
  stopAll()
  console.log(`\n• recorded in ${path.relative(ROOT, SESSION)}`)
  setTimeout(() => process.exit(0), 300)
})
process.on('exit', stopAll)

try {
  await startServers()
} catch (e) {
  console.error(`✗ ${e.message}`)
  stopAll()
  process.exit(1)
}
// Whether the AI can mark cards in this session (speech keys in api/.env, and not turned off): in the log, so a
// session's recording says what the teacher could expect.
try {
  const h = await (await fetch(API_URL.replace('/ping', '/health'))).json()
  const paths = Object.entries(h.speech_paths ?? {}).filter(([, on]) => on).map(([n]) => n)
  const line = paths.length ? `AI marking on (${paths.join(', ')})` : 'AI marking off (no speech keys, or --fake-mic)'
  rec('LAB', line)
  log(line)
} catch {
  /* an older API */
}

const launchArgs = ['--use-fake-ui-for-media-stream']
if (args.has('--fake-mic')) launchArgs.push('--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fakeMic()}`)

// LAB_SMOKE=<file.png>: no windows; switch every condition once, save a screenshot of the phone, exit (checks the lab).
const SMOKE = process.env.LAB_SMOKE
const browser = await chromium.launch({ headless: !!SMOKE, channel: process.env.LAB_CHANNEL || 'chromium', args: launchArgs })

// The phone: the app as it is, in a phone-sized viewport. Only its network is changed, from outside the page.
ctx = await browser.newContext({ viewport: PHONE, permissions: ['microphone'], serviceWorkers: 'allow' })
appPage = await ctx.newPage()
cdp = await ctx.newCDPSession(appPage)
await cdp.send('Network.enable')

// The control window: its own profile (the phone's network changes never reach it).
const controlCtx = await browser.newContext({ viewport: null })
await controlCtx.exposeBinding('labSet', (_src, mode) => setMode(mode))
await controlCtx.exposeBinding('labAction', (_src, name) => action(name))
await controlCtx.exposeBinding('labState', () => state)
await controlCtx.exposeBinding('labDialog', (_src, accept) => answerDialog(accept))
recordPhone(ctx, appPage)
const control = await controlCtx.newPage()
await control.setContent(CONTROL_HTML(MODES))

if (!SMOKE) {
  await placeWindow(browser, ctx, appPage, { left: 40, top: 30, width: PHONE.width + 16, height: PHONE.height + 88 })
  await placeWindow(browser, controlCtx, control, { left: 40 + PHONE.width + 30, top: 30, width: PANEL, height: 640 })
}
await appPage.goto(APP_URL)
await appPage.bringToFront()
log('🟢 Online')
console.log(`\n✓ Network lab open: the phone on the left, the controls on the right. Log in with "Try the demo class".`)
console.log(`  Close either window or press Ctrl+C to stop.`)
console.log(`  Recording everything to ${path.relative(ROOT, SESSION)}\n`)

if (SMOKE) {
  await appPage.getByRole('button', { name: 'Try the demo class' }).click()
  await appPage.waitForURL(/\/class\//)
  for (const mode of ['airplane', 'nointernet', 'weak', 'slow', 'flaky', 'online']) {
    await control.locator(`button[data-mode="${mode}"]`).click()
    await control.waitForTimeout(400)
    if (state.mode !== mode) throw new Error(`the ${mode} button did not switch the network`)
  }
  await control.locator('button[data-mode="airplane"]').click()
  await control.waitForTimeout(300)
  await appPage.reload()
  await appPage.getByRole('heading', { name: /Reading groups/ }).waitFor({ timeout: 15_000 })
  await appPage.waitForTimeout(800)
  await appPage.screenshot({ path: SMOKE })
  await control.screenshot({ path: SMOKE.replace(/\.png$/, '-control.png') })
  console.log(`✓ smoke check passed: every button switches the network; the app reloads offline (${SMOKE})`)
  await browser.close()
  stopAll()
  process.exit(0)
}

const quit = () => {
  rec('LAB', 'session ended')
  events.end()
  stopAll()
  console.log(`\n• recorded in ${path.relative(ROOT, SESSION)}`)
  setTimeout(() => process.exit(0), 300)
}
browser.on('disconnected', quit)
appPage.on('close', quit)
control.on('close', quit)
await new Promise(() => {}) // until a window is closed

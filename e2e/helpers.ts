import { expect, test, type BrowserContext, type CDPSession, type Page, type Route } from '@playwright/test'

// ---------------------------------------------------------------- reporting

/** A full-page screenshot in the HTML report, named for the step. */
export async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
}

/** A line in the report (timings, card texts, what was cached). */
export function note(type: string, description: string) {
  test.info().annotations.push({ type, description })
  console.log(`  [${test.info().title.split(':')[0]}] ${type}: ${description}`)
}

/** Console errors and failed page errors, collected for the report. */
export function watchConsole(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

// ---------------------------------------------------------------- network conditions (DevTools protocol)

/** Airplane mode: the browser reports offline (navigator.onLine = false) and nothing reaches the network. Pages and
 * files the service worker has cached still load, as on a real phone. */
export async function goOffline(ctx: BrowserContext) {
  // A throttled page has its own DevTools session whose conditions say "online": switch those off too.
  for (const cdp of throttled) {
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => undefined)
  }
  throttled.length = 0
  await ctx.setOffline(true)
  await ctx.route('**/*', (r) => r.abort('internetdisconnected'))
}

export async function goOnline(ctx: BrowserContext) {
  await ctx.unroute('**/*')
  await ctx.setOffline(false)
}

/** "Connected but no internet": the phone says it is online, but every API call fails at once. */
export async function apiFails(ctx: BrowserContext) {
  await ctx.route('**/api/**', (r) => r.abort('internetdisconnected'))
}

/** A weak signal at its worst: the phone says it is online, but API calls never answer. Returns a function that
 * restores the API (and fails the requests that were held). */
export async function apiHangs(ctx: BrowserContext): Promise<() => Promise<void>> {
  const held: Route[] = []
  await ctx.route('**/api/**', (r) => {
    held.push(r)
  })
  return async () => {
    await ctx.unroute('**/api/**')
    await Promise.all(held.map((r) => r.abort('timedout').catch(() => undefined)))
  }
}

const throttled: CDPSession[] = []

/** DevTools' throttling (Network.emulateNetworkConditions) for this page. */
export async function throttle(page: Page, p: { latencyMs: number; downKbps: number; upKbps: number }) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: p.latencyMs,
    downloadThroughput: (p.downKbps * 1000) / 8,
    uploadThroughput: (p.upKbps * 1000) / 8,
  })
  throttled.push(cdp)
  return cdp
}

export const SLOW_3G = { latencyMs: 2000, downKbps: 400, upKbps: 400 }
export const TWO_G = { latencyMs: 3000, downKbps: 100, upKbps: 50 }

// ---------------------------------------------------------------- app state

/** The service worker is active and controls the page, so a reload works with no network. */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true)
}

/** Keys of the server pages kept on the phone (IndexedDB levelos.cache), e.g. "/students/<id>". */
export async function cachedKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('levelos')
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('cache')) return resolve([])
          const req = db.transaction('cache').objectStore('cache').getAllKeys()
          req.onsuccess = () => resolve((req.result as string[]).map(String))
          req.onerror = () => resolve([])
        }
      }),
  )
}

/** Offline checks on the phone (IndexedDB levelos.checkins). */
export async function queuedChecks(page: Page): Promise<{ localId: string; status: string; items: { itemId: string }[] }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('levelos')
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('checkins')) return resolve([])
          const req = db.transaction('checkins').objectStore('checkins').getAll()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve([])
        }
      }),
  )
}

/** The ⏳ count in the header (checks and changes waiting to be sent), 0 when there is none. */
export async function pendingCount(page: Page): Promise<number> {
  const badge = page.locator('header').locator('span, button', { hasText: '⏳' }) // a button that lists what waits
  if (!(await badge.count())) return 0
  return Number((await badge.first().innerText()).replace(/\D/g, '')) || 0
}

// ---------------------------------------------------------------- flows

/** "Try the demo class": the demo teacher has one class, so the app opens straight on it. */
export async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Try the demo class' }).click()
  await page.waitForURL(/\/class\//)
  await expect(page.getByRole('heading', { name: 'Reading groups' })).toBeVisible()
}

export async function classId(page: Page): Promise<string> {
  const m = page.url().match(/\/class\/([^/?#]+)/)
  if (!m) throw new Error(`not on a class page: ${page.url()}`)
  return m[1]
}

/** Waits until the dashboard has kept every child's page on the phone (its offline warm-up). */
export async function waitForWarmUp(page: Page, children = 16) {
  await expect
    .poll(async () => (await cachedKeys(page)).filter((k) => k.startsWith('/students/')).length, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(children)
}

export async function openChild(page: Page, name: string) {
  await page.getByRole('link', { name: new RegExp(`\\b${name}\\b`) }).first().click()
  await page.waitForURL(/\/student\//)
}

export async function startCheck(page: Page) {
  await page.getByRole('button', { name: /Start .*reading check/ }).click()
  await page.waitForURL(/\/check\//)
}

/** Leaves the check on screen without finishing it (the "Stop" button, confirmed). */
export async function stopCheck(page: Page) {
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Stop this check' }).click()
  await page.waitForURL(/\/student\//)
}

/** The text on the card shown now (letters/words, or the passage). */
export async function cardText(page: Page): Promise<string> {
  const cells = await page.locator('.reading-text').allInnerTexts()
  return cells.join(' ').replace(/\s+/g, ' ').trim()
}

const celebration = (page: Page) => page.locator('div.fixed.inset-0.z-50')

export type CardLog = { n: number; text: string; outcome: string; ms: number }

/**
 * Reads one card: record a few seconds (the fake microphone), then, if the app asks for marks (offline, or no
 * speech service), tap `wrong` words as misread and save. Returns what happened, for the report.
 */
export async function readCard(page: Page, n: number, wrong = 0, recordMs = 2500): Promise<CardLog> {
  const text = await cardText(page)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.waitForTimeout(recordMs)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  const save = page.getByRole('button', { name: 'Save marks' })
  const error = page.locator('div.bg-coral-soft') // ErrorBox
  const done = await Promise.race([
    save.waitFor({ timeout: 60_000 }).then(() => 'marks' as const),
    celebration(page).waitFor({ timeout: 60_000 }).then(() => 'scored' as const),
    error.first().waitFor({ timeout: 60_000 }).then(() => 'error' as const),
  ]).catch(() => 'stuck' as const)
  if (done === 'marks') {
    const words = page.locator('section.card').filter({ has: save }).locator('button.rounded-lg')
    for (let i = 0; i < wrong; i++) await words.nth(i).click()
    await save.click()
    await celebration(page).waitFor({ timeout: 30_000 }).catch(() => undefined)
  }
  if (done === 'error' || done === 'stuck') {
    await snap(page, `card ${n}: ${done}`)
    return { n, text, outcome: done, ms: Date.now() - t0 }
  }
  await celebration(page).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined)
  return { n, text, outcome: done, ms: Date.now() - t0 }
}

/**
 * Runs a whole check from the card screen to its end (result page or the offline summary), marking `wrong` words
 * on each card. Skips the picture-meaning step. Returns each card read.
 */
export async function runCheck(page: Page, wrong = 0, maxCards = 5): Promise<CardLog[]> {
  const cards: CardLog[] = []
  for (let guard = 0; guard < 30 && cards.length < maxCards; guard++) {
    if (/\/result\//.test(page.url())) break
    if (await page.getByText('Level from your marks').isVisible().catch(() => false)) break
    // The ladder ended on a fail: "Level found", with one more card on offer. The tests take the ASER default.
    const finish = page.getByRole('button', { name: 'Finish the check' })
    if (await finish.isVisible().catch(() => false)) {
      await finish.click()
      continue
    }
    const meaning = page.getByRole('button', { name: 'Skip', exact: true })
    if (await meaning.isVisible().catch(() => false)) {
      await meaning.click()
      continue
    }
    const record = page.getByRole('button', { name: 'Start recording' })
    if (await record.isVisible().catch(() => false)) {
      const c = await readCard(page, cards.length + 1, wrong)
      cards.push(c)
      if (c.outcome === 'error' || c.outcome === 'stuck') break
      continue
    }
    await page.waitForTimeout(500)
  }
  return cards
}

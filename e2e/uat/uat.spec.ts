/**
 * Acceptance run: a teacher's day played through the app's screens, tap by tap, under every network condition. A
 * synthetic voice (Azure, e2e/uat_say.py) reads each card shown into the microphone, with mistakes planted where the
 * scenario wants them, and the real AI marks the cards when there is network. The report (what the teacher saw at
 * every step, how well the AI's marks matched the planted mistakes, timings) is written to
 * e2e/uat-reports/<date>/report.html.
 *
 *   cd e2e && npx playwright test -c playwright.uat.config.ts
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { SLOW_3G, apiFails, apiHangs, goOffline, goOnline, loginDemo, pendingCount, queuedChecks, throttle, waitForServiceWorker } from '../helpers'

const ROOT = path.resolve(__dirname, '..', '..')
const PY = path.join(ROOT, 'api', '.venv', 'bin', 'python')
const SAY = path.join(ROOT, 'e2e', 'uat_say.py')
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const OUT = path.join(ROOT, 'e2e', 'uat-reports', STAMP)
const VOICES = path.join(ROOT, 'e2e', 'uat-reports', 'voice')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(VOICES, { recursive: true })

// ---------------------------------------------------------------- the app's words, in any of its languages

const LOCALES = ['en', 'hi', 'mr', 'kn', 'ta', 'bn'].map(
  (l) => JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'src', 'locales', `${l}.json`), 'utf8')) as Record<string, unknown>,
)
const lookup = (o: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o)
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A label of the app in whichever of its six languages is on screen (the interface follows the reading test: a
 * Hindi check is shown in Hindi). {{x}} matches anything; `prefix`: only the label's text before its first {{x}};
 * `exact`: the whole text and nothing else. */
function L(key: string, o: { exact?: boolean; prefix?: boolean } = {}): RegExp {
  const alts = [...new Set(LOCALES.map((d) => lookup(d, key)).filter((v): v is string => typeof v === 'string'))].map((v) =>
    escRe(o.prefix ? v.split('{{')[0] : v).replace(/\\\{\\\{\w+\\\}\\\}/g, '.*'),
  )
  if (!alts.length) throw new Error(`no label ${key}`)
  return new RegExp(o.exact ? `^(?:${alts.join('|')})$` : `(?:${alts.join('|')})`)
}

// ---------------------------------------------------------------- the report

interface Step { name: string; ok: boolean; note?: string; shot?: string; ms: number }
interface CardRun {
  n: number
  level: string
  lang: string
  card: string
  said: string
  planted: number[]
  ai: string // what the screen said about the AI
  aiWrong: number[] | null // the words the AI crossed out, when it marked the card
  aiMs: number | null // from Stop to the AI's marks on screen
  live: boolean // marked while the child read
  kind?: string // the kind of mistake planted (S9)
  pauses?: string // the phone's measure of the recording ("read for 12 s · long pauses: 3")
  fixes: number // taps the teacher needed to make the marks right
  oneMore: boolean
}
interface Scenario { id: string; title: string; condition: string; ok: boolean; steps: Step[]; cards: CardRun[]; notes: string[] }
const report: Scenario[] = []
let shotNo = 0

function scenario(id: string, title: string, condition: string): Scenario {
  const s: Scenario = { id, title, condition, ok: true, steps: [], cards: [], notes: [] }
  report.push(s)
  return s
}

async function shot(page: Page, label: string): Promise<string | undefined> {
  const file = `${String(++shotNo).padStart(3, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`
  try {
    await page.screenshot({ path: path.join(OUT, file) })
    return file
  } catch {
    return undefined
  }
}

async function step<T>(s: Scenario, page: Page, name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    const r = await fn()
    s.steps.push({ name, ok: true, note: typeof r === 'string' ? r : undefined, shot: await shot(page, name), ms: Date.now() - t0 })
    return r
  } catch (e) {
    s.ok = false
    s.steps.push({ name, ok: false, note: (e as Error).message.split('\n').slice(0, 6).join('\n'), shot: await shot(page, `FAIL ${name}`), ms: Date.now() - t0 })
    throw e
  }
}

/** A step whose failure is recorded but does not stop the scenario (a quality check among many). */
async function check(s: Scenario, page: Page, name: string, fn: () => Promise<string | void>) {
  try {
    await step(s, page, name, fn)
  } catch {
    /* recorded in the report; the scenario goes on */
  }
}

// ---------------------------------------------------------------- the child's voice

/** The microphone becomes a stream the run plays the voice into (and to the speakers, to be heard). */
async function fakeMicrophone(ctx: BrowserContext) {
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices
    if (!md) return
    const real = md.getUserMedia.bind(md)
    let ac: AudioContext | null = null
    let dest: MediaStreamAudioDestinationNode | null = null
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (!c?.audio) return real(c)
      ac ??= new AudioContext()
      await ac.resume()
      dest = ac.createMediaStreamDestination()
      return dest.stream
    }
    ;(window as unknown as { __uatSay: (b64: string) => Promise<number> }).__uatSay = async (b64: string) => {
      if (!ac || !dest) throw new Error('the microphone is not open')
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
      const buf = await ac.decodeAudioData(bytes.buffer)
      const src = ac.createBufferSource()
      src.buffer = buf
      src.connect(dest)
      src.connect(ac.destination)
      await new Promise<void>((r) => {
        src.onended = () => r()
        src.start()
      })
      return buf.duration
    }
  })
}

function voice(lang: string, level: string, text: string): string {
  const file = path.join(VOICES, `${createHash('sha1').update(`${lang}|${level}|${text}`).digest('hex')}.wav`)
  if (!fs.existsSync(file)) execFileSync(PY, [SAY, lang, level, file, text], { cwd: ROOT, stdio: 'pipe' })
  return fs.readFileSync(file).toString('base64')
}

// ---------------------------------------------------------------- reading a card

const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const toks = (t: string) => t.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}'’]+/gu, ' ').split(/\s+/).filter(Boolean)
const POOL: Record<string, Record<string, string[]>> = {
  en: { letter: [...'mstrlkfvpzhj'], word: ['map', 'log', 'fig', 'jam', 'hut', 'pod', 'rib', 'van', 'wet', 'zip'] },
  hi: { letter: ['प', 'ट', 'ग', 'ज', 'ब', 'ह', 'न', 'म'], word: ['घर', 'नल', 'आम', 'बस', 'दूध', 'कमल', 'फल', 'जल'] },
}

async function cardText(page: Page): Promise<string> {
  // Letters and words: .reading-text cells; a paragraph's lines: .reading-text; a story's: .reading-face.
  const text = (await page.locator('.reading-text, .reading-face').allInnerTexts()).join(' ').replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('no card text on screen')
  return text
}

function levelOf(words: string[]): 'letter' | 'word' | 'passage' {
  if (words.length > 6) return 'passage'
  return words.every((w) => [...seg.segment(w)].length === 1) ? 'letter' : 'word'
}

/** Which words the child gets wrong: spread over the card. */
function spread(total: number, n: number): number[] {
  return Array.from({ length: Math.min(n, total) }, (_, k) => Math.floor(((k + 0.5) * total) / n))
}

/** What the child says: the card with the planted words swapped for others (kept in their sentences). */
function saying(text: string, words: string[], planted: number[], lang: string, level: string): string {
  const pool = POOL[lang][level === 'letter' ? 'letter' : 'word']
  const subs = new Map(planted.map((i, k) => [i, pool.filter((p) => !words.includes(p))[k % pool.length]]))
  if (level !== 'passage') return words.map((w, i) => subs.get(i) ?? w).join(' ')
  let ti = 0
  return text
    .split(/\s+/)
    .map((chunk) => {
      let out = chunk
      for (const tk of toks(chunk)) {
        const sub = subs.get(ti++)
        if (sub) out = out.replace(tk, sub)
      }
      return out
    })
    .join(' ')
}

const AI_STATES: [string, RegExp][] = [
  ['marked', L('phoneCheck.aiMarked')],
  ['no answer (network)', L('phoneCheck.ai_noAnswer')],
  ['not set up', L('phoneCheck.ai_notSetUp')],
  ['unavailable', L('phoneCheck.ai_unavailable')],
  ['could not mark', L('phoneCheck.ai_couldNot')],
  ['could not hear', L('phoneCheck.aiRerecord')],
  ['slow: mark it yourself', L('phoneCheck.aiLate')],
  ['listening', L('phoneCheck.aiListening')],
  ['teacher marking', L('offlineCheck.recorded')],
]

/** Records the child reading the card on screen (the voice, with `mistakes` planted), lets the AI mark it if there
 * is network, then marks it right as the teacher would (fixing anything the AI got wrong) and saves. */
/** A reading made on purpose: what the child says, and which of the card's words count as read wrongly. */
type Custom = (words: string[], text: string, level: string) => { said: string; wrong: number[]; kind: string }

async function readCard(
  page: Page,
  s: Scenario,
  lang: string,
  o: { mistakes: number; live?: boolean; waitAi: boolean; custom?: Custom },
) {
  const text = await cardText(page)
  const words = toks(text)
  const level = levelOf(words)
  const made = o.custom?.(words, text, level)
  const planted = made ? made.wrong : spread(words.length, o.mistakes)
  const said = made ? made.said : saying(text, words, planted, lang, level)
  const oneMore = await page.getByText(L('oneMore.banner')).isVisible().catch(() => false)
  const b64 = voice(lang, level === 'passage' ? 'paragraph' : level, said)

  await page.getByRole('button', { name: L('checkin.record', { exact: true }) }).click()
  await page.waitForTimeout(400)
  const playing = page.evaluate((v) => (window as unknown as { __uatSay: (b: string) => Promise<number> }).__uatSay(v), b64)
  if (o.live && planted.length) {
    const live = page.locator('section.card').filter({ hasText: L('phoneCheck.markWhileReading') })
    await live.waitFor()
    await page.waitForTimeout(700)
    for (const i of planted) await live.locator('button.rounded-lg').nth(i).click()
  }
  await playing
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: L('checkin.stop', { exact: true }) }).click()
  const stopped = Date.now()
  const save = page.getByRole('button', { name: L('checkin.saveMarks', { exact: true }) })
  await save.waitFor({ timeout: 30_000 })
  const panel = page.locator('section.card').filter({ has: save })

  let ai = 'off (no network)'
  let aiMs: number | null = null
  if (o.waitAi) {
    for (let t = 0; t < 60; t++) {
      const note = await panel.innerText()
      const hit = AI_STATES.find(([, re]) => re.test(note))
      ai = hit?.[0] ?? 'unknown'
      if (ai !== 'listening' && ai !== 'slow: mark it yourself') break
      if (ai === 'slow: mark it yourself' && t > 50) break
      await page.waitForTimeout(500)
    }
    if (ai === 'marked') aiMs = Date.now() - stopped
  }
  const wordsUi = panel.locator('button.rounded-lg')
  const pressed = await wordsUi.evaluateAll((els) => els.flatMap((e, i) => (e.getAttribute('aria-pressed') === 'true' ? [i] : [])))
  let fixes = 0
  const count = await wordsUi.count()
  for (let i = 0; i < count; i++) {
    if (planted.includes(i) !== pressed.includes(i)) {
      await wordsUi.nth(i).click()
      fixes++
    }
  }
  const measured = await page.getByText(L('offlineCheck.measured', { prefix: true })).innerText().catch(() => '')
  s.cards.push({
    n: s.cards.length + 1, level, lang, card: text, said, planted, ai, aiWrong: ai === 'marked' ? pressed : null, aiMs,
    live: !!o.live, fixes, oneMore, kind: made?.kind, pauses: measured.replace('Measured on the phone: ', ''),
  })
  await save.click()
  await page.locator('div.fixed.inset-0.z-50').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined)
}

type Plan = {
  lang: string
  waitAi: boolean
  /** Mistakes for the card at this level (`again`: the one more card). */
  mistakes: (level: string, again: boolean) => number
  live?: boolean
  /** At "Level found": give one more card? */
  oneMore?: (level: string) => boolean
  /** Between cards (e.g. the network drops). */
  between?: (cardsRead: number) => Promise<void>
  /** A reading made on purpose for this card (S9), instead of `mistakes` swapped words. */
  custom?: (level: string, again: boolean) => Custom | undefined
}

/** A whole check from its first card to its summary, as the plan says. */
async function runCheck(page: Page, s: Scenario, plan: Plan) {
  let lastLevel = ''
  for (let guard = 0; guard < 60; guard++) {
    if (/\/result\//.test(page.url())) return
    if (await page.getByText(L('offlineCheck.provisional')).isVisible().catch(() => false)) return
    const meaning = page.getByRole('button', { name: L('meaning.skip', { exact: true }) })
    if (await meaning.isVisible().catch(() => false)) {
      await meaning.click()
      continue
    }
    if (await page.getByText(L('oneMore.found', { exact: true })).isVisible().catch(() => false)) {
      const more = page.getByRole('button', { name: L('oneMore.button', { prefix: true }) })
      const want = plan.oneMore?.(lastLevel) && (await more.isVisible().catch(() => false))
      await step(s, page, `Level found → ${want ? 'one more card' : 'finish'}`, async () => {
        await (want ? more : page.getByRole('button', { name: L('oneMore.finish', { exact: true }) })).click()
        return want ? 'the teacher gives one more card at the level just failed' : 'the teacher finishes (ASER default)'
      })
      continue
    }
    if (await page.getByRole('button', { name: L('checkin.record', { exact: true }) }).isVisible().catch(() => false)) {
      await plan.between?.(s.cards.length)
      const text = await cardText(page)
      const level = levelOf(toks(text))
      const again = await page.getByText(L('oneMore.banner')).isVisible().catch(() => false)
      const m = plan.mistakes(level, again)
      lastLevel = level
      await step(s, page, `Card ${s.cards.length + 1} (${level}${again ? ', one more' : ''}): ${m} mistake${m === 1 ? '' : 's'} planted`, async () => {
        await readCard(page, s, plan.lang, { mistakes: m, live: plan.live, waitAi: plan.waitAi, custom: plan.custom?.(level, again) })
        const c = s.cards[s.cards.length - 1]
        return `${c.kind ? `[${c.kind}] ` : ''}"${c.said.slice(0, 90)}" · AI: ${c.ai}${c.aiWrong ? ` (crossed ${JSON.stringify(c.aiWrong)}, truth ${JSON.stringify(c.planted)})` : ''}${c.fixes ? ` · teacher fixed ${c.fixes}` : ''}${c.pauses ? ` · ${c.pauses}` : ''}`
      })
      continue
    }
    await page.waitForTimeout(500)
  }
  throw new Error('the check did not reach its end')
}

// ---------------------------------------------------------------- moving around

/** The child's own page link (not the "waiting for your confirmation" chip, which opens a result). */
const childLink = (page: Page, name: string) => page.locator('a[href^="/student/"]').filter({ hasText: new RegExp(`\\b${name}\\b`) }).first()

async function openChild(page: Page, name: string) {
  await childLink(page, name).click()
  await page.waitForURL(/\/student\//, { timeout: 30_000 })
}

async function startCheck(page: Page, lang: 'English' | 'Hindi') {
  const code = lang === 'Hindi' ? 'hi' : 'en'
  const sw = page.getByRole('group', { name: L('readingTest.label', { exact: true }) }).getByRole('button', { name: L(`lang.${code}`, { exact: true }) })
  if (await sw.isVisible().catch(() => false)) await sw.click()
  await page.getByRole('button', { name: L('readingTest.start') }).click()
  await page.waitForURL(/\/check\//)
}

async function backToClass(page: Page) {
  await page.goto('/')
  await page.waitForURL(/\/class\//)
  await expect(page.getByRole('heading', { name: L('dashboard.groups') })).toBeVisible()
}

async function readyOffline(page: Page) {
  await expect(page.getByText(L('ready.done', { prefix: true })).first()).toBeVisible({ timeout: 60_000 })
}

/** The group a child is shown in on the class page ("Story group"), or "not checked yet". */
async function groupOf(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const isGroup = (e: Element) => e.children.length === 0 && /^(Letter|Word|Paragraph|Story) group$/.test(e.textContent?.trim() ?? '')
    for (const label of Array.from(document.querySelectorAll('main *')).filter(isGroup)) {
      let box = label.parentElement
      for (let k = 0; k < 6 && box; k++, box = box.parentElement) {
        if (Array.from(box.querySelectorAll('*')).filter(isGroup).length > 1) break // climbed past the group's card
        if (Array.from(box.querySelectorAll('a')).some((a) => a.textContent?.includes(n))) return label.textContent!.trim()
      }
    }
    return 'not checked yet'
  }, name)
}

async function flaky(ctx: BrowserContext) {
  await ctx.route('**/api/**', async (r) => {
    if (Math.random() < 0.5) return r.abort('connectionreset')
    await new Promise((res) => setTimeout(res, 1500))
    await r.continue().catch(() => undefined)
  })
  return () => ctx.unroute('**/api/**')
}

const toast = (page: Page, re: RegExp) => page.getByRole('status').filter({ hasText: re })

test.beforeEach(async ({ context }) => {
  await fakeMicrophone(context)
})

// ---------------------------------------------------------------- the scenarios

test('S1 online, English: AI marks, Level found, one more card, result', async ({ page }) => {
  const s = scenario('S1', 'Online · English check with the AI', 'Online (fast)')
  await step(s, page, 'Log in (demo class)', () => loginDemo(page))
  // A child of their own (the lab's data carries the children's levels between runs): the check starts at letters.
  const child = `Uat${Date.now().toString(36).slice(-4)}`
  await step(s, page, `Add the child "${child}" and start the English check`, async () => {
    await page.getByRole('button', { name: /Add child/ }).click()
    await page.getByPlaceholder("Child's first name").fill(child)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await openChild(page, child)
    await startCheck(page, 'English')
  })
  await runCheck(page, s, {
    lang: 'en',
    waitAi: true,
    mistakes: (level, again) => (level === 'word' && !again ? 3 : level === 'passage' ? 1 : 0),
    oneMore: (level) => level === 'word',
  })
  await step(s, page, 'Summary: level from the marks, sent, link to the full result', async () => {
    await expect(page.getByText(L('offlineCheck.provisional'))).toBeVisible()
    await expect(page.getByRole('link', { name: 'See the full result' })).toBeVisible({ timeout: 60_000 })
  })
  await step(s, page, 'Open the full result (from the server)', async () => {
    await page.getByRole('link', { name: 'See the full result' }).click()
    await page.waitForURL(/\/result\//)
    await expect(page.getByText(/What the child read/)).toBeVisible()
    return (await page.locator('main').innerText()).split('\n').slice(0, 4).join(' · ')
  })
})

test('S2 online, Hindi: AI marks', async ({ page }) => {
  const s = scenario('S2', 'Online · Hindi check with the AI', 'Online (fast)')
  await step(s, page, 'Log in', () => loginDemo(page))
  await step(s, page, 'Open Imran, start the Hindi check', async () => {
    await openChild(page, 'Imran')
    await startCheck(page, 'Hindi')
  })
  await runCheck(page, s, { lang: 'hi', waitAi: true, mistakes: (level) => (level === 'passage' ? 4 : 1) })
  await step(s, page, 'Summary', () => expect(page.getByText(/Level from your marks|स्तर/).first()).toBeVisible())
})

test('S3 slow 3G: how long the teacher waits for the AI', async ({ page }) => {
  const s = scenario('S3', 'Slow 3G', 'Slow 3G (2 s latency, 400 kbps)')
  await step(s, page, 'Log in', () => loginDemo(page))
  await step(s, page, 'Network: slow 3G', async () => {
    await throttle(page, SLOW_3G)
  })
  const t0 = Date.now()
  await step(s, page, 'Open Kabir, start the English check', async () => {
    await openChild(page, 'Kabir')
    await startCheck(page, 'English')
    return `${Math.round((Date.now() - t0) / 1000)} s from the class page to the first card`
  })
  await runCheck(page, s, { lang: 'en', waitAi: true, mistakes: (level) => (level === 'word' ? 1 : 0) })
})

test('S4 weak signal: the AI never answers, the teacher marks, it is sent when the signal is back', async ({ page, context }) => {
  const s = scenario('S4', 'Weak signal', 'Weak signal (requests never answer)')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  let restore: () => Promise<void> = async () => undefined
  await step(s, page, 'Open Pooja; then the signal goes weak', async () => {
    await openChild(page, 'Pooja')
    restore = await apiHangs(context)
  })
  await step(s, page, 'Start the English check (no waiting on the network)', () => startCheck(page, 'English'))
  await runCheck(page, s, { lang: 'en', waitAi: true, mistakes: (level) => (level === 'word' ? 2 : 0) })
  await step(s, page, 'Summary: saved on the phone, waiting to be sent', async () => {
    await expect(page.getByText(L('offlineCheck.provisional'))).toBeVisible()
    expect(await pendingCount(page)).toBeGreaterThan(0)
  })
  await step(s, page, 'Signal back: sent by itself, "Saved on the server"', async () => {
    await restore()
    await expect(toast(page, /Saved on the server/)).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => pendingCount(page), { timeout: 30_000 }).toBe(0)
  })
})

test('S5 flaky: a child added while requests drop stays, and is sent once', async ({ page, context }) => {
  const s = scenario('S5', 'Flaky connection', 'Flaky (half the requests dropped, the rest slow)')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  let stop: () => Promise<void> = async () => undefined
  const name = `Uat${Date.now().toString(36).slice(-4)}`
  await step(s, page, `Flaky network; add the child "${name}"`, async () => {
    stop = await flaky(context)
    await page.getByRole('button', { name: /Add child/ }).click()
    await page.getByPlaceholder("Child's first name").fill(name)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible()
  })
  await step(s, page, 'Reload on the flaky network: the child is still there', async () => {
    await page.reload()
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 30_000 })
    const weak = await page.getByRole('status').filter({ hasText: /^(Slow network|Offline)$/ }).first()
      .waitFor({ timeout: 20_000 }).then(() => true, () => false)
    return weak ? 'the header shows the network is not to be trusted' : 'the header still says online (nothing failed in front of the teacher)'
  })
  await step(s, page, 'Connection steady again: sent once, "Saved on the server"', async () => {
    await stop()
    await expect.poll(() => pendingCount(page), { timeout: 60_000 }).toBe(0)
    await page.reload()
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(1)
  })
})

test('S6 connected but no internet: the AI cannot answer, the check is sent later', async ({ page, context }) => {
  const s = scenario('S6', 'Connected, no internet', 'Wi-Fi with no internet (requests fail at once)')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  await step(s, page, 'Internet gone (the phone still says online); open Priya', async () => {
    await apiFails(context)
    await openChild(page, 'Priya')
  })
  await step(s, page, 'Start the English check', () => startCheck(page, 'English'))
  await runCheck(page, s, { lang: 'en', waitAi: true, mistakes: (level) => (level === 'word' ? 1 : 0) })
  await step(s, page, 'Summary on the phone; waiting to be sent', async () => {
    await expect(page.getByText(L('offlineCheck.provisional'))).toBeVisible()
    expect(await pendingCount(page)).toBeGreaterThan(0)
  })
  await step(s, page, 'Internet back: sent', async () => {
    await context.unroute('**/api/**')
    await expect.poll(() => pendingCount(page), { timeout: 60_000 }).toBe(0)
  })
})

test('S7 airplane mode: checks, groups, what waits, the activity, then the sync', async ({ page, context }) => {
  const s = scenario('S7', 'Airplane mode, a whole morning', 'No network at all')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  await step(s, page, 'Airplane mode; reload: the class opens from the phone', async () => {
    await goOffline(context)
    await page.reload()
    await expect(page.getByRole('heading', { name: L('dashboard.groups') })).toBeVisible()
    await readyOffline(page)
    return `Rohan is in: ${await groupOf(page, 'Rohan')}`
  })
  await step(s, page, 'Open Rohan, start the English check', async () => {
    await openChild(page, 'Rohan')
    await startCheck(page, 'English')
  })
  await runCheck(page, s, { lang: 'en', waitAi: false, live: true, mistakes: () => 0 })
  await step(s, page, 'Back on the class page: Rohan already in his new group', async () => {
    await backToClass(page)
    const g = await groupOf(page, 'Rohan')
    expect(g, 'every card read right: a higher group').toMatch(/Paragraph group|Story group/)
    return `Rohan is now in: ${g}`
  })
  await step(s, page, 'Open Diya, start the English check (mistakes tapped while she reads)', async () => {
    await openChild(page, 'Diya')
    await startCheck(page, 'English')
  })
  await runCheck(page, s, { lang: 'en', waitAi: false, live: true, mistakes: (level) => (level === 'letter' ? 3 : 2) })
  await step(s, page, 'Summary: "Practise next" from the marks', async () => {
    await expect(page.getByText('Practise next')).toBeVisible()
  })
  await step(s, page, '⏳: what is waiting to be sent', async () => {
    await backToClass(page)
    await page.locator('header').getByRole('button', { name: /waiting to be sent/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Waiting to be sent' })
    await expect(sheet.getByText(/Reading check: Rohan/)).toBeVisible()
    await expect(sheet.getByText(/Reading check: Diya/)).toBeVisible()
    const text = await sheet.innerText()
    await shot(page, 'what is waiting')
    await sheet.getByRole('button', { name: 'Close' }).click()
    return text.split('\n').filter((l) => l.startsWith('Reading') || l.startsWith('New')).join(' · ')
  })
  await step(s, page, "The Letter group's activity, made on the phone, on today's mistakes", async () => {
    const id = page.url().match(/\/class\/([^/?#]+)/)![1]
    await page.goto(`/class/${id}/activity/letter?lang=en`)
    await expect(page.getByText('Made on this phone (offline)')).toBeVisible({ timeout: 30_000 })
    const stars = await page.locator('span.bg-coral-soft').allInnerTexts()
    return `misread, starred: ${[...new Set(stars)].join(' ') || 'none'}`
  })
  await step(s, page, 'Network back: everything sent, "Saved on the server"', async () => {
    await goOnline(context)
    await backToClass(page)
    await expect.poll(() => pendingCount(page), { timeout: 90_000 }).toBe(0)
    const sent = (await queuedChecks(page)).map((c) => c.status)
    expect(sent).not.toContain('failed')
    return `checks on the phone: ${sent.join(', ')} · Rohan is in: ${await groupOf(page, 'Rohan')}`
  })
})

test('S8 the network drops in the middle of a check', async ({ page, context }) => {
  const s = scenario('S8', 'Network drops mid-check', 'Online, then nothing after the first card')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  await step(s, page, 'Open Meena, start the English check', async () => {
    await openChild(page, 'Meena')
    await startCheck(page, 'English')
  })
  let dropped = false
  await runCheck(page, s, {
    lang: 'en',
    waitAi: true,
    mistakes: (level) => (level === 'word' ? 1 : 0),
    between: async (read) => {
      if (read === 1 && !dropped) {
        dropped = true
        await goOffline(context)
        s.notes.push('The network went after the first card.')
      }
    },
  })
  await step(s, page, 'Summary saved on the phone', () => expect(page.getByText(L('offlineCheck.provisional'))).toBeVisible())
  await step(s, page, 'Network back: sent', async () => {
    await goOnline(context)
    await backToClass(page)
    await expect.poll(() => pendingCount(page), { timeout: 90_000 }).toBe(0)
  })
})

// ---------------------------------------------------------------- S9: mistakes of every kind, on purpose

/** A vowel slip, as children make: cat → cut, pen → pin, sun → son. */
function vowelSlip(w: string): string {
  const swap: Record<string, string> = { a: 'u', e: 'i', i: 'e', o: 'a', u: 'o' }
  const k = [...w].findIndex((c) => c in swap)
  return k < 0 ? `${w}s` : w.slice(0, k) + swap[w[k]] + w.slice(k + 1)
}

test('S9 mistakes of every kind: left out, vowel slips, self-corrections, halting, silence, the wrong text', async ({ page }) => {
  const s = scenario('S9', 'Mistakes of every kind, on purpose', 'Online (fast), real AI')
  await step(s, page, 'Log in', () => loginDemo(page))
  await step(s, page, 'Open Sana, start the English check', async () => {
    await openChild(page, 'Sana')
    await startCheck(page, 'English')
  })
  await step(s, page, 'Silence: record and stop at once → "record again"', async () => {
    await page.getByRole('button', { name: L('checkin.record', { exact: true }) }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: L('checkin.stop', { exact: true }) }).click()
    await expect(page.getByText(/too short|silent|could not hear/i).first()).toBeVisible({ timeout: 15_000 })
    return (await page.getByText(/too short|silent/i).first().innerText().catch(() => '')).trim()
  })
  const plan: Plan = {
    lang: 'en',
    waitAi: true,
    mistakes: () => 0,
    // The word card fails (the slip and the word left out): one more word card, read right, so the ladder goes on
    // up to a passage, which is read halting.
    oneMore: (level) => level === 'word',
    custom: (level, again) => {
      if (again) return undefined
      if (level === 'letter')
        return (words) => ({ said: words.filter((_, i) => i !== 2).join(' '), wrong: [2], kind: 'a letter left out' })
      if (level === 'word')
        return (words) => ({
          // word 1 put right at once (counts as read), word 3 a vowel slip, word 4 left out
          said: words.flatMap((w, i) => (i === 0 ? [vowelSlip(w), w] : i === 2 ? [vowelSlip(w)] : i === 3 ? [] : [w])).join(' '),
          wrong: [2, 3],
          kind: 'self-correction, vowel slip, a word left out',
        })
      // A passage: every word right but three long stops mid-sentence (halting), and one word left out.
      return (words, text) => {
        const chunks = text.split(/\s+/)
        const out: string[] = []
        let stops = 0
        chunks.forEach((c, i) => {
          if (i === 5) return // left out
          out.push(c)
          if (stops < 3 && i > 1 && i % 4 === 2 && !/[.!?।]$/.test(c)) {
            out.push('⏸')
            stops++
          }
        })
        return { said: out.join(' '), wrong: [toks(chunks.slice(0, 5).join(' ')).length], kind: `${stops} long stops mid-sentence (halting), a word left out` }
      }
    },
  }
  // On the first word card the child reads a whole sentence instead: the AI must not mark nonsense.
  let wrongTextDone = false
  plan.between = async () => {
    if (wrongTextDone) return
    const words = toks(await cardText(page))
    if (levelOf(words) !== 'word') return
    wrongTextDone = true
    await step(s, page, 'The wrong text: a whole sentence read on a word card', async () => {
      const b64 = voice('en', 'paragraph', 'My little brother likes to play football with his friends in the big green park every evening after school.')
      await page.getByRole('button', { name: L('checkin.record', { exact: true }) }).click()
      await page.waitForTimeout(400)
      await page.evaluate((v) => (window as unknown as { __uatSay: (b: string) => Promise<number> }).__uatSay(v), b64)
      await page.getByRole('button', { name: L('checkin.stop', { exact: true }) }).click()
      const panel = page.locator('section.card').filter({ has: page.getByRole('button', { name: L('checkin.saveMarks', { exact: true }) }) })
      let said = ''
      for (let t = 0; t < 40; t++) {
        said = await panel.innerText().catch(() => '')
        if (!L('phoneCheck.aiListening').test(said)) break
        await page.waitForTimeout(500)
      }
      const hit = AI_STATES.find(([, re]) => re.test(said))?.[0] ?? 'unknown'
      await shot(page, 'wrong text: what the AI said')
      await page.getByRole('button', { name: L('cancel', { exact: true }) }).click() // record the card again
      expect(hit, 'the AI says it could not hear the card, instead of marking').toBe('could not hear')
      return `AI: ${hit}`
    })
  }
  await runCheck(page, s, plan)
  await step(s, page, 'Summary', () => expect(page.getByText(L('offlineCheck.provisional'))).toBeVisible())
})

// ---------------------------------------------------------------- S10: activities made with no internet

interface Plan10 {
  title?: Record<string, string>
  steps?: Record<string, unknown>[]
  materials?: Record<string, string[]>
  material?: { kind: string; items: string[]; anchors?: Record<string, string> }
  text?: { title?: string; author?: string; licence?: string; source?: unknown; lines?: string[] }
  homework?: Record<string, string>
  focus?: { misread?: string[] }
}
interface Activity10 { id: string; generated_by?: string; source_activity_id?: string; source?: { name?: string } | null; plan: Plan10 }

/** The activity on screen for a group, as the phone keeps it: made on the phone, else the group's list saved online. */
async function activityOnPhone(page: Page, classId: string, cohort: string, lang: string): Promise<Activity10 | null> {
  return page.evaluate(
    ([c, g, l]) =>
      new Promise<Activity10 | null>((resolve) => {
        const open = indexedDB.open('levelos')
        open.onerror = () => resolve(null)
        open.onsuccess = () => {
          const store = open.result.transaction('cache').objectStore('cache')
          const local = store.get(`local-activities/${c}/${g}/${l}`)
          local.onsuccess = () => {
            const mine = (local.result?.value as Activity10[] | undefined)?.[0]
            if (mine) return resolve(mine)
            const server = store.get(`/classes/${c}/activities?cohort=${g}&language=${l}`)
            server.onsuccess = () => resolve((server.result?.value as Activity10[] | undefined)?.[0] ?? null)
            server.onerror = () => resolve(null)
          }
          local.onerror = () => resolve(null)
        }
      }),
    [classId, cohort, lang],
  )
}

/** What a teacher would object to in an activity (the rules the jury's "simpler, shorter" feedback led to). */
function qualityIssues(a: Activity10 | null, cohort: string, ui: string): string[] {
  if (!a) return ['no activity on the phone']
  const p = a.plan
  const issues: string[] = []
  const say = (x: unknown) => (typeof x === 'string' ? x : '')
  const steps = p.steps ?? []
  if (steps.length !== 3) issues.push(`${steps.length} steps (3 expected)`)
  // The app's own rule (api/app/llm/activities.py step_problems): English at most 16 words and the teacher's language
  // at most 120 characters, not counting the example letters or words in brackets.
  const outside = (t: string) => t.replace(/\([^)]*\)/g, ' ')
  steps.forEach((st, i) => {
    const en = say(st.en)
    const local = say(st[ui]) || en
    if (!local) issues.push(`step ${i + 1} has no text in ${ui}`)
    const words = outside(en).split(/\s+/).filter(Boolean).length
    if (words > 16) issues.push(`step ${i + 1} is long in English (${words} words)`)
    if (ui !== 'en' && outside(local).trim().length > 120) issues.push(`step ${i + 1} is long in ${ui}`)
    if (!st.icon) issues.push(`step ${i + 1} has no picture`)
  })
  if (!say(p.title?.[ui]) && !say(p.title?.en)) issues.push('no title')
  const all = JSON.stringify(p)
  const hole = all.match(/\{(title|words|letter|letters)\}/)
  if (hole) issues.push(`a blank left in the text: ${hole[0]}`)
  if (cohort === 'letter') {
    if (p.material?.kind !== 'letters') issues.push('a Letter group should get letter cards')
    if (p.text) issues.push('a Letter group should get no poem')
    const neverFirst = new Set(['ळ', 'ण', 'ಳ', 'ட', 'ள', 'ன', 'ண', 'ற', 'ழ']) // letters that never begin a word
    const missing = (p.material?.items ?? []).filter((x) => !p.material?.anchors?.[x] && !neverFirst.has(x))
    if (missing.length) issues.push(`letters with no picture word: ${missing.join(' ')}`)
  } else if (cohort === 'word') {
    if (p.material?.kind !== 'words' || (p.material.items.length ?? 0) < 4) issues.push('a Word group should get 4+ words to read')
  } else {
    if (!p.text?.lines?.length) issues.push('a Paragraph/Story group should get a text')
    else if (!p.text.author && !p.text.source && !p.text.licence) issues.push('the text is not credited')
  }
  return issues
}

test('S10 activities with no internet: every group, both languages, quality and use', async ({ page, context }) => {
  const s = scenario('S10', 'Activities made on the phone (no internet)', 'No network at all')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  const id = page.url().match(/\/class\/([^/?#]+)/)![1]
  await step(s, page, 'Airplane mode', () => goOffline(context))
  for (const lang of ['en', 'hi'])
    for (const cohort of ['letter', 'word', 'paragraph', 'story']) {
      await check(s, page, `${lang === 'en' ? 'English' : 'Hindi'} · ${cohort} group`, async () => {
        await page.goto(`/class/${id}/activity/${cohort}?lang=${lang}`)
        const madeHere = page.getByText(L('activity.fromPhone')).first()
        // A group with today's activity saved online shows that one; "Another activity" makes one on the phone.
        if (!(await madeHere.isVisible({ timeout: 8_000 }).catch(() => false))) {
          await page.getByRole('button', { name: L('activity.another') }).click()
        }
        await expect(madeHere).toBeVisible({ timeout: 30_000 })
        const ui = (await page.evaluate(() => document.documentElement.lang)) || lang
        const a = await activityOnPhone(page, id, cohort, lang)
        const issues = qualityIssues(a, cohort, ui.slice(0, 2))
        const p = a?.plan
        const title = (p?.title?.[ui.slice(0, 2)] ?? p?.title?.en ?? '?') as string
        const what = p?.material ? `${p.material.kind}: ${p.material.items.join(' ')}` : p?.text ? `text: ${p.text.title ?? ''}${p.text.author ? ` by ${p.text.author}` : ''}` : ''
        if (issues.length) throw new Error(`"${title}": ${issues.join('; ')}`)
        return `"${title}" · ${p?.steps?.length} steps · ${what}`
      })
    }
  await check(s, page, 'Another activity: a different one, still made on the phone', async () => {
    await page.goto(`/class/${id}/activity/word?lang=en`)
    await expect(page.getByText(L('activity.fromPhone')).first()).toBeVisible({ timeout: 30_000 })
    const before = await activityOnPhone(page, id, 'word', 'en')
    await page.getByRole('button', { name: L('activity.another') }).click()
    await expect.poll(async () => (await activityOnPhone(page, id, 'word', 'en'))?.id, { timeout: 30_000 }).not.toBe(before?.id)
    const after = await activityOnPhone(page, id, 'word', 'en')
    const issues = qualityIssues(after, 'word', 'en')
    if (issues.length) throw new Error(issues.join('; '))
    return `"${before?.plan.title?.en}" → "${after?.plan.title?.en}"${before?.source_activity_id === after?.source_activity_id ? ' (same method, another text)' : ''}`
  })
  await check(s, page, 'Listen with no internet', async () => {
    const listen = page.getByRole('button', { name: L('activity.listen') }).first()
    await listen.click()
    await page.waitForTimeout(2500)
    const body = await page.locator('main').innerText()
    if (L('activity.listenNoVoice').test(body)) throw new Error('says listening needs the internet')
    return L('activity.phoneVoice').test(body) ? "read by the phone's own voice" : 'plays the recorded lines'
  })
  await check(s, page, 'Start the 10 minutes: step by step, then the rating', async () => {
    await page.getByRole('button', { name: L('activity.start') }).click()
    for (let i = 0; i < 4; i++) {
      if (await page.getByText(L('activity.finished')).isVisible().catch(() => false)) break
      await shot(page, `run step ${i + 1}`)
      await page.getByRole('button', { name: new RegExp(`(?:${L('next').source}).*→|${L('activity.finish').source}`) }).last().click()
    }
    await expect(page.getByText(L('activity.finished'))).toBeVisible()
    const stars = page.getByRole('button', { name: /5/ })
    if (await stars.count()) await stars.last().click({ timeout: 5_000 }).catch(() => undefined)
    await page.getByRole('button', { name: L('activity.close', { exact: true }) }).last().click()
  })
  await step(s, page, 'Network back', async () => {
    await goOnline(context)
  })
})

// ---------------------------------------------------------------- S11: the question bank with no internet

test('S11 the question bank with no internet: different cards for every child, fresh cards for the same child', async ({ page, context }) => {
  const s = scenario('S11', 'The question bank on the phone (no internet)', 'No network at all')
  await step(s, page, 'Log in, class saved on the phone', async () => {
    await loginDemo(page)
    await waitForServiceWorker(page)
    await readyOffline(page)
  })
  // Each child's page address, read in English before anything switches the screen to Hindi.
  const names = ['Aarav', 'Neha', 'Ravi', 'Sana', 'Kabir', 'Pooja', 'Arjun', 'Kavya', 'Vikram']
  const href: Record<string, string> = {}
  for (const n of names) href[n] = (await childLink(page, n).getAttribute('href')) ?? ''
  await step(s, page, 'Airplane mode', () => goOffline(context))
  const first: { who: string; test: string; level: string; card: string }[] = []
  const firstCard = async (who: string, lang: 'English' | 'Hindi') => {
    await page.goto(href[who])
    await startCheck(page, lang)
    const card = await cardText(page)
    first.push({ who, test: lang, level: levelOf(toks(card)), card })
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: L('checkin.stopCheck', { exact: true }) }).click()
    await page.waitForURL(/\/student\//)
    return card
  }
  for (const who of names) await check(s, page, `${who}: first English card`, async () => `${await firstCard(who, 'English')}`)
  await check(s, page, 'Aarav again: a fresh card', async () => {
    const was = first.find((f) => f.who === 'Aarav')!.card
    const again = await firstCard('Aarav', 'English')
    if (again === was) throw new Error(`the same card twice: ${again}`)
    return `${was} → ${again}`
  })
  for (const who of ['Aarav', 'Neha', 'Kabir', 'Arjun']) await check(s, page, `${who}: first Hindi card`, async () => `${await firstCard(who, 'Hindi')}`)
  await check(s, page, 'Children at the same level get different cards', async () => {
    const byLevel = new Map<string, string[]>()
    for (const f of first) byLevel.set(`${f.test} ${f.level}`, [...(byLevel.get(`${f.test} ${f.level}`) ?? []), f.card])
    const lines = [...byLevel].map(([k, cards]) => `${k}: ${new Set(cards).size} different of ${cards.length}`)
    const repeats = [...byLevel].filter(([, cards]) => cards.length > 1 && new Set(cards).size < cards.length)
    if (repeats.length) throw new Error(`repeated cards: ${lines.join('; ')}`)
    return lines.join(' · ')
  })
  await check(s, page, 'One whole check: no card twice, and the one more card is fresh', async () => {
    await page.goto(href.Kavya)
    await startCheck(page, 'English')
    const before = s.cards.length
    await runCheck(page, s, {
      lang: 'en',
      waitAi: false,
      mistakes: (level, again) => (level === 'passage' && !again ? 4 : 0),
      oneMore: () => true,
    })
    const cards = s.cards.slice(before).map((c) => c.card)
    if (new Set(cards).size < cards.length) throw new Error(`a card came twice: ${cards.join(' | ')}`)
    return `${cards.length} cards, all different`
  })
  await step(s, page, 'Network back: everything sent', async () => {
    await goOnline(context)
    await backToClass(page)
    await expect.poll(() => pendingCount(page), { timeout: 90_000 }).toBe(0)
  })
})

test.afterAll(() => {
  // UAT_APPEND=<an earlier report folder>: one report with that run's scenarios too (those not run again here).
  for (const earlier of (process.env.UAT_APPEND ?? '').split(',').filter(Boolean).reverse()) {
    if (!fs.existsSync(path.join(earlier, 'report.json'))) continue
    const rel = path.relative(OUT, earlier)
    const prev = (JSON.parse(fs.readFileSync(path.join(earlier, 'report.json'), 'utf8')) as Scenario[])
      .filter((p) => !report.some((r) => r.id === p.id))
      .map((p) => ({ ...p, steps: p.steps.map((x) => ({ ...x, shot: x.shot ? `${rel}/${x.shot}` : undefined })) }))
    report.push(...prev)
  }
  report.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  fs.writeFileSync(path.join(OUT, 'report.html'), html(report))
  console.log(`\nReport: ${path.join(OUT, 'report.html')}`)
})

// ---------------------------------------------------------------- the HTML report

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function html(r: Scenario[]): string {
  const aiCards = r.flatMap((s) => s.cards.filter((c) => c.aiWrong !== null).map((c) => ({ s, c })))
  const exact = aiCards.filter(({ c }) => JSON.stringify(c.aiWrong) === JSON.stringify(c.planted)).length
  const words = aiCards.reduce((n, { c }) => n + c.card.split(' ').length, 0)
  const wordHits = aiCards.reduce((n, { c }) => {
    const total = toks(c.card).length
    let hit = 0
    for (let i = 0; i < total; i++) hit += Number(c.planted.includes(i) === c.aiWrong!.includes(i))
    return n + hit
  }, 0)
  const aiTimes = aiCards.map(({ c }) => c.aiMs!).filter(Boolean).sort((a, b) => a - b)
  const median = aiTimes.length ? aiTimes[Math.floor(aiTimes.length / 2)] : null
  const passed = r.filter((s) => s.ok).length
  const steps = r.reduce((n, s) => n + s.steps.length, 0)
  const failedSteps = r.reduce((n, s) => n + s.steps.filter((x) => !x.ok).length, 0)

  const card = (c: CardRun) => {
    const tks = toks(c.card)
    const cells = tks
      .map((w, i) => {
        const p = c.planted.includes(i)
        const a = c.aiWrong?.includes(i)
        const cls = c.aiWrong === null ? (p ? 'tok planted' : 'tok') : p && a ? 'tok hit' : p ? 'tok miss' : a ? 'tok false' : 'tok'
        return `<span class="${cls}">${esc(w)}</span>`
      })
      .join('')
    return `<tr><td>${c.n}${c.oneMore ? ' <span class="pill">one more</span>' : ''}${c.kind ? `<div class="sub">${esc(c.kind)}</div>` : ''}${c.pauses ? `<div class="sub">${esc(c.pauses)}</div>` : ''}</td><td>${c.level}</td><td class="cardcell">${cells}<div class="said">said: ${esc(c.said)}</div></td><td>${esc(c.ai)}${c.live ? '<div class="sub">marked while reading</div>' : ''}</td><td>${c.aiMs ? (c.aiMs / 1000).toFixed(1) + ' s' : '—'}</td><td>${c.fixes}</td></tr>`
  }

  const sections = r
    .map(
      (s) => `
<section class="scenario ${s.ok ? 'ok' : 'bad'}" id="${s.id}">
  <header><span class="badge ${s.ok ? 'ok' : 'bad'}">${s.ok ? 'PASS' : 'FAIL'}</span><h2>${s.id} · ${esc(s.title)}</h2><span class="cond">${esc(s.condition)}</span></header>
  <ol class="steps">${s.steps
    .map(
      (x) => `<li class="${x.ok ? 'ok' : 'bad'}"><div class="line"><span class="mark">${x.ok ? '✓' : '✗'}</span><span class="name">${esc(x.name)}</span><span class="ms">${(x.ms / 1000).toFixed(1)} s</span></div>${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}${x.shot ? `<a href="${x.shot}" target="_blank"><img loading="lazy" src="${x.shot}" alt=""></a>` : ''}</li>`,
    )
    .join('')}</ol>
  ${s.cards.length ? `<table class="cards"><thead><tr><th>#</th><th>Card</th><th>Words (planted mistakes: <span class="tok hit">caught</span> <span class="tok miss">missed</span> <span class="tok false">false alarm</span> <span class="tok planted">teacher only</span>)</th><th>AI</th><th>AI time</th><th>Teacher fixes</th></tr></thead><tbody>${s.cards.map(card).join('')}</tbody></table>` : ''}
  ${s.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
</section>`,
    )
    .join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LevelOS acceptance run</title>
<style>
:root{--bg:#f6f6fb;--card:#fff;--ink:#1b1f3b;--mute:#6b6f8a;--line:#e4e4ef;--ok:#1f7a43;--okbg:#e3f5ea;--bad:#b3261e;--badbg:#fde7e4;--warn:#9a6700;--warnbg:#fff4d6;--brand:#4a3fd1}
@media (prefers-color-scheme:dark){:root{--bg:#14151f;--card:#1d1f2e;--ink:#ecebf5;--mute:#a3a5bd;--line:#2e3045;--ok:#6fd39a;--okbg:#173525;--bad:#ff8a80;--badbg:#3b1b19;--warn:#f0c674;--warnbg:#3a3019;--brand:#9d95ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}.lede{color:var(--mute);margin:0 0 20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}.kpi b{display:block;font-size:24px}.kpi span{color:var(--mute);font-size:13px}
nav.toc{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}nav.toc a{text-decoration:none;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px}nav.toc a.bad{border-color:var(--bad);color:var(--bad)}
.scenario{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin-bottom:20px}.scenario>header{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}.scenario h2{font-size:18px;margin:0}.cond{color:var(--mute);font-size:13px}
.badge{font-size:12px;font-weight:700;border-radius:6px;padding:2px 8px}.badge.ok{background:var(--okbg);color:var(--ok)}.badge.bad{background:var(--badbg);color:var(--bad)}
.steps{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.steps li{border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px}.steps li.bad{border-color:var(--bad);background:var(--badbg)}
.line{display:flex;gap:6px;align-items:baseline}.mark{font-weight:700}.ok .mark{color:var(--ok)}.bad .mark{color:var(--bad)}.name{flex:1;font-weight:600;font-size:14px}.ms{color:var(--mute);font-size:12px}
.note{color:var(--mute);font-size:13px;white-space:pre-wrap;word-break:break-word}.steps img{width:100%;border-radius:8px;border:1px solid var(--line)}
table.cards{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}table.cards th,table.cards td{border-top:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}table.cards th{color:var(--mute);font-weight:600}
.cardcell{min-width:280px}.tok{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 5px;margin:1px}.tok.hit{background:var(--okbg);border-color:var(--ok);color:var(--ok)}.tok.miss{background:var(--badbg);border-color:var(--bad);color:var(--bad)}.tok.false{background:var(--warnbg);border-color:var(--warn);color:var(--warn)}.tok.planted{background:var(--warnbg);border-color:var(--warn)}
.said{color:var(--mute);margin-top:4px}.sub{color:var(--mute);font-size:12px}.pill{font-size:11px;background:var(--warnbg);color:var(--warn);border-radius:999px;padding:0 6px}
@media (max-width:600px){.steps{grid-template-columns:1fr}table.cards{display:block;overflow-x:auto}}
</style></head><body><main>
<h1>LevelOS acceptance run</h1>
<p class="lede">${esc(new Date().toLocaleString('en-IN'))} · the app driven tap by tap on a phone-sized screen; an Azure voice read each card shown into the microphone, with mistakes planted; the real AI marked the cards when there was network. Branch phone-check.</p>
<div class="kpis">
<div class="kpi"><b>${passed}/${r.length}</b><span>scenarios passed</span></div>
<div class="kpi"><b>${steps - failedSteps}/${steps}</b><span>steps passed</span></div>
<div class="kpi"><b>${r.reduce((n, s) => n + s.cards.length, 0)}</b><span>cards read aloud</span></div>
<div class="kpi"><b>${aiCards.length ? `${exact}/${aiCards.length}` : '—'}</b><span>cards the AI marked exactly right</span></div>
<div class="kpi"><b>${aiCards.length ? `${wordHits}/${toks(aiCards.map(({ c }) => c.card).join(' ')).length}` : '—'}</b><span>words the AI judged right</span></div>
<div class="kpi"><b>${median ? (median / 1000).toFixed(1) + ' s' : '—'}</b><span>median wait for the AI's marks</span></div>
</div>
<nav class="toc">${r.map((s) => `<a class="${s.ok ? '' : 'bad'}" href="#${s.id}">${s.ok ? '✓' : '✗'} ${s.id} ${esc(s.condition)}</a>`).join('')}</nav>
${sections}
<p class="lede" style="margin-top:24px">${words} words on cards the AI marked. Synthetic voice: an adult Azure voice, 20% slow; real children will be harder for the AI.</p>
</main></body></html>`
}

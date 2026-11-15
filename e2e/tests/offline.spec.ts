/**
 * What a teacher meets with no network, a weak one, or one that drops. Each test states what SHOULD happen; a
 * failing test is a place where the app breaks offline. Screenshots of every step are in the HTML report
 * (npm run report).
 */
import { expect, test } from '@playwright/test'
import {
  SLOW_3G,
  apiFails,
  apiHangs,
  cachedKeys,
  cardText,
  classId,
  goOffline,
  goOnline,
  loginDemo,
  note,
  openChild,
  pendingCount,
  queuedChecks,
  runCheck,
  snap,
  startCheck,
  stopCheck,
  throttle,
  waitForServiceWorker,
  waitForWarmUp,
  watchConsole,
} from '../helpers'

test('1. prepared phone: after reload with no network, the class, children and activities open', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  note('cached pages', (await cachedKeys(page)).length.toString())

  await goOffline(context)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Reading groups' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^Offline$/ })).toBeVisible()
  await snap(page, 'dashboard offline after reload')

  await openChild(page, 'Meena')
  await expect(page.getByRole('button', { name: /Start .*reading check/ })).toBeVisible()
  await snap(page, 'child page offline')

  // The other reading test's groups were kept too.
  await page.goBack()
  await page.getByRole('group', { name: 'Reading test' }).getByRole('button', { name: 'Hindi' }).click()
  await expect(page.getByRole('heading', { name: /Reading groups|पढ़ने के समूह/ })).toBeVisible()
  await snap(page, 'Hindi groups offline')

  // A 10-minute activity is put together on the phone.
  await page.goto(`/class/${await classId(page)}/activity/letter?lang=en`)
  await expect(page.getByText('Made on this phone (offline)')).toBeVisible({ timeout: 30_000 })
  await snap(page, 'activity made offline')
})

test('2. a whole reading check with no network, then it is sent when the network returns', async ({ page, context }) => {
  const errors = watchConsole(page)
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)

  await goOffline(context)
  await openChild(page, 'Farhan')
  await startCheck(page)
  expect(page.url()).toContain('/check/')
  await snap(page, 'offline check: first card')
  const cards = await runCheck(page, 0)
  for (const c of cards) note(`card ${c.n} (${c.outcome}, ${Math.round(c.ms / 1000)} s)`, c.text)
  expect(cards.length, 'cards read').toBeGreaterThan(0)
  await expect(page.getByText('Level from your marks')).toBeVisible()
  await snap(page, 'offline check: summary')
  expect(await pendingCount(page)).toBeGreaterThan(0)

  await goOnline(context)
  await expect.poll(() => pendingCount(page), { timeout: 90_000 }).toBe(0)
  await page.goto('/')
  await page.waitForURL(/\/class\//)
  await openChild(page, 'Farhan')
  await expect(page.getByText('Past reading checks')).toBeVisible()
  await snap(page, 'after sync: child page')
  if (errors.length) note('console errors', errors.join('\n'))
})

test('3. the cards vary: different children, and the same child twice, do not all get the same card', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  await goOffline(context)

  const open = async (child: string) => {
    await page.goto('/')
    await page.waitForURL(/\/class\//)
    await openChild(page, child)
    await startCheck(page)
    return cardText(page)
  }
  // Ravi reads a whole check; then the first card of four more children; then Ravi again.
  const ravi = await open('Ravi')
  note('first card: Ravi', ravi)
  await runCheck(page, 0)
  const others: string[] = []
  for (const child of ['Neha', 'Pooja', 'Kabir', 'Aarav']) {
    const card = await open(child)
    note(`first card: ${child}`, card)
    others.push(card)
    await stopCheck(page)
  }
  const again = await open('Ravi')
  note('first card: Ravi again', again)
  await snap(page, 'Ravi again')
  // With 2-3 cards per level two children can meet the same card by chance, but five should not all.
  expect.soft(new Set([ravi, ...others]).size, 'children checked one after another get different cards').toBeGreaterThan(1)
  expect.soft(again, 'a child checked again gets a different card').not.toBe(ravi)
})

test('4. the network drops in the middle of a check: the check carries on', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  await openChild(page, 'Diya')
  await startCheck(page)
  expect(page.url(), 'every check runs on the phone, online too').toContain('/check/')
  const first = await runCheck(page, 0, 1)
  note('card 1 (online)', `${first[0]?.outcome}: ${first[0]?.text}`)
  await snap(page, 'after card 1, online')

  await goOffline(context)
  const rest = await runCheck(page, 0, 1)
  note('card 2 (network gone)', `${rest[0]?.outcome}: ${rest[0]?.text}`)
  await snap(page, 'card 2 with the network gone')
  expect(rest[0]?.outcome, 'card 2 can be read and marked with no network').toMatch(/marks|scored/)
  const stillHere = (await page.locator('div.bg-coral-soft').count()) === 0
  expect.soft(stillHere, 'no error box: the teacher is not stuck').toBe(true)
})

test('5. connected but no internet (requests fail at once): the app falls back to the phone', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)

  await apiFails(context)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Reading groups' })).toBeVisible()
  await openChild(page, 'Kabir')
  await startCheck(page)
  await snap(page, 'check started with API unreachable')
  expect(page.url(), 'a phone check starts').toContain('/check/')
})

test('6. weak signal (requests never answer): the app does not spin forever', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)

  const restore = await apiHangs(context)
  await page.reload()
  const t0 = Date.now()
  const shown = await page
    .getByRole('heading', { name: 'Reading groups' })
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  note('dashboard with hanging API', shown ? `shown after ${Math.round((Date.now() - t0) / 1000)} s` : 'not shown in 20 s')
  await snap(page, 'dashboard while the API hangs')
  expect.soft(shown, 'the class opens from the phone within 20 s').toBe(true)

  if (shown) {
    await openChild(page, 'Pooja')
    const started = await page
      .getByRole('button', { name: /Start .*reading check/ })
      .click()
      .then(() => page.waitForURL(/\/check\//, { timeout: 20_000 }))
      .then(() => true)
      .catch(() => false)
    await snap(page, 'starting a check while the API hangs')
    expect.soft(started, 'a check starts within 20 s').toBe(true)
    if (started) {
      // A card read while the AI's request hangs: the teacher marks it, and the check moves on.
      const [card] = await runCheck(page, 0, 1)
      note('card read while the API hangs', `${card?.outcome}, ${Math.round((card?.ms ?? 0) / 1000)} s`)
      await snap(page, 'after a card while the API hangs')
      expect.soft(card?.outcome, 'the card is marked and saved').toBe('marks')
      expect.soft(card?.ms ?? Infinity, 'within 20 s of recording').toBeLessThan(20_000)
    }
  }
  await restore()
})

test('7. fresh phone on a slow network: the signal goes right after login', async ({ page, context }) => {
  await throttle(page, SLOW_3G)
  const t0 = Date.now()
  await loginDemo(page)
  note('login to dashboard on slow 3G', `${Math.round((Date.now() - t0) / 1000)} s`)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)).catch(() => false)
  const keys = await cachedKeys(page)
  note('pages on the phone when the signal went', `${keys.filter((k) => k.startsWith('/students/')).length} of 16 children`)

  await goOffline(context)
  const opened: string[] = []
  const failed: string[] = []
  for (const name of ['Aarav', 'Sana', 'Imran', 'Arjun', 'Kavya']) {
    await page.goto('/')
    const dash = await page
      .getByRole('heading', { name: 'Reading groups' })
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (!dash) {
      failed.push(`${name} (class page did not open)`)
      continue
    }
    await openChild(page, name)
    const ok = await page.getByRole('button', { name: /Start .*reading check/ }).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
    ;(ok ? opened : failed).push(name)
  }
  await snap(page, 'last child opened offline')
  note('children that opened offline', opened.join(', ') || 'none')
  note('children that did not', failed.join(', ') || 'none')
  expect.soft(failed, 'every child of the class opens offline').toEqual([])
})

test('8. changes made offline (new child, group, check for the new child) all reach the server once', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  await goOffline(context)

  await page.getByRole('button', { name: /Add child/ }).click()
  await page.getByPlaceholder("Child's first name").fill('Tara')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('link', { name: /Tara/ })).toBeVisible()
  await snap(page, 'child added offline')

  await openChild(page, 'Tara')
  await startCheck(page)
  await runCheck(page, 1)
  await snap(page, 'check for the new child, offline')
  note('waiting on the phone', String(await pendingCount(page)))

  await goOnline(context)
  await expect.poll(() => pendingCount(page), { timeout: 90_000 }).toBe(0)
  const checks = await queuedChecks(page)
  note('phone checks after sync', checks.map((c) => c.status).join(', '))

  await page.goto('/')
  await page.waitForURL(/\/class\//)
  await page.reload()
  await expect(page.getByRole('link', { name: /Tara/ })).toHaveCount(1)
  await snap(page, 'after sync: dashboard')
})

test('9. a slow network (3G): how long the teacher waits online', async ({ page }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  await throttle(page, SLOW_3G)

  let t0 = Date.now()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Reading groups' })).toBeVisible({ timeout: 60_000 })
  const dash = Date.now() - t0
  t0 = Date.now()
  await openChild(page, 'Sana')
  await startCheck(page)
  const start = Date.now() - t0
  const cards = await runCheck(page, 0, 1)
  note('reload dashboard', `${Math.round(dash / 1000)} s`)
  note('open child + start check', `${Math.round(start / 1000)} s`)
  note('one card (record 2.5 s, upload, result)', `${Math.round((cards[0]?.ms ?? 0) / 1000)} s (${cards[0]?.outcome})`)
  await snap(page, 'after one card on 3G')
  expect.soft(dash, 'dashboard within 10 s').toBeLessThan(10_000)
  expect.soft(start, 'check starts within 10 s').toBeLessThan(10_000)
})

test('10. what is kept safe: the browser is asked not to delete the phone data', async ({ page }) => {
  // Count the app's requests to keep its data. Chrome decides: it says yes to an app added to the home screen (or
  // used often), and always no in a fresh test browser, so what is checked here is that the app asks.
  await page.addInitScript(() => {
    const w = window as unknown as { persistAsked: number }
    w.persistAsked = 0
    const real = navigator.storage?.persist?.bind(navigator.storage)
    if (real) {
      navigator.storage.persist = () => {
        w.persistAsked += 1
        return real()
      }
    }
  })
  await loginDemo(page)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { persistAsked: number }).persistAsked), { timeout: 10_000 })
    .toBeGreaterThan(0)
  const persisted = await page.evaluate(() => navigator.storage?.persisted?.() ?? false)
  const estimate = await page.evaluate(async () => {
    const e = await navigator.storage.estimate()
    return `${Math.round((e.usage ?? 0) / 1024)} KB used of ${Math.round((e.quota ?? 0) / 1024 / 1024)} MB`
  })
  note('storage', estimate)
  note('browser kept the data', persisted ? 'yes' : 'no (a test browser always says no; a phone with the app on its home screen says yes)')
})

test('11. login with no network says so clearly', async ({ page, context }) => {
  await page.goto('/login')
  await waitForServiceWorker(page)
  await goOffline(context)
  await page.reload()
  await page.getByRole('button', { name: 'Try the demo class' }).click()
  await snap(page, 'login offline')
  await expect(page.getByText(/Can't reach|No network/)).toBeVisible()
})

test('12. flaky connection: a child added while requests drop stays on the class page and reaches the server once', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)

  // The connection drops the new child's request, while pages still load (as in the network lab's "Flaky").
  const dropWrites = '**/api/classes/*/students'
  await context.route(dropWrites, (r) => (r.request().method() === 'POST' ? r.abort('connectionreset') : r.continue()))
  await page.getByRole('button', { name: /Add child/ }).click()
  await page.getByPlaceholder("Child's first name").fill('Zoya')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('link', { name: /Zoya/ })).toBeVisible()
  // A page read that reaches the server, which has no Zoya yet: the phone's copy (with her) is shown.
  await page.reload()
  await expect(page.getByRole('link', { name: /Zoya/ })).toBeVisible()
  await snap(page, 'child kept while her request drops')

  // The connection recovers. No event tells the browser so: the app finds out by itself, sends her, says so, and the
  // page refreshes without the teacher reloading.
  await context.unroute(dropWrites)
  const t0 = Date.now()
  await expect(page.getByRole('status').filter({ hasText: /Saved on the server/ })).toBeVisible({ timeout: 40_000 })
  note('sent after the connection recovered', `${Math.round((Date.now() - t0) / 1000)} s`)
  await expect.poll(() => pendingCount(page), { timeout: 20_000 }).toBe(0)
  await expect(page.getByRole('link', { name: /Zoya/ })).toHaveCount(1)
  await snap(page, 'after the connection recovered')
})

test('13. after a check with no network, the class page shows the child in a group at once, and ⏳ lists it', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  const id = await classId(page)
  // A child of their own, not checked yet (other tests check the demo children in the same database).
  await page.getByRole('button', { name: /Add child/ }).click()
  await page.getByPlaceholder("Child's first name").fill('Ishaan')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  // The "Not checked yet" row (its heading stays, with a dash when nobody is left).
  const notChecked = page.getByRole('heading', { name: 'Not checked yet' }).locator('xpath=following-sibling::div[1]')
  await expect(notChecked.getByRole('link', { name: /Ishaan/ })).toHaveCount(1)
  // A child added online is on the phone for use with no network straight away, not at the next save.
  const href = (await notChecked.getByRole('link', { name: /Ishaan/ }).getAttribute('href')) ?? ''
  await expect.poll(async () => (await cachedKeys(page)).includes(href.replace('/student/', '/students/')), { timeout: 15_000 }).toBe(true)

  await goOffline(context)
  await openChild(page, 'Ishaan')
  await startCheck(page)
  await runCheck(page, 0)
  await expect(page.getByText('Level from your marks')).toBeVisible()
  await page.goto(`/class/${id}`)
  await expect(page.getByRole('heading', { name: 'Reading groups' })).toBeVisible()
  // Placed in a group straight away, before anything is sent: no longer "not checked yet".
  await expect(notChecked.getByRole('link', { name: /Ishaan/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Ishaan/ }).first()).toBeVisible()
  await snap(page, 'class page offline after the check')

  await page.getByRole('button', { name: /waiting to be sent/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Waiting to be sent' })
  await expect(sheet.getByText('Reading check: Ishaan')).toBeVisible()
  await snap(page, 'what is waiting')
  await sheet.getByRole('button', { name: 'Close' }).click()

  await goOnline(context)
  await expect.poll(() => pendingCount(page), { timeout: 90_000 }).toBe(0)
  await page.reload()
  await expect(notChecked.getByRole('link', { name: /Ishaan/ })).toHaveCount(0)
})

test('14. the activity made with no network works on the letters the children just misread', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  const id = await classId(page)

  await goOffline(context)
  await openChild(page, 'Aarav') // Letter group
  await startCheck(page)
  const first = (await cardText(page)).split(' ').slice(0, 3)
  await runCheck(page, 3, 1) // the first three letters marked wrong
  await expect(page.getByText('Practise next')).toBeVisible()
  note('letters marked wrong', first.join(' '))

  await page.goto(`/class/${id}/activity/letter?lang=en`)
  await expect(page.getByText('Made on this phone (offline)')).toBeVisible({ timeout: 30_000 })
  const misread = page.getByText(/Misread in their reading check/).first()
  await expect(misread).toBeVisible()
  // The misread letters are in "Made for this group" (folded to one line until opened).
  for (const letter of first) await expect(page.locator('span.bg-coral-soft', { hasText: new RegExp(`^${letter}$`) }).first()).toBeAttached()
  await snap(page, 'activity made offline on the misread letters')
})

test('15. the class page says when it is ready for no network', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await expect(page.getByText(/Ready offline · saved/)).toBeVisible({ timeout: 60_000 })
  await goOffline(context)
  await page.reload()
  await expect(page.getByText(/Ready offline · saved/)).toBeVisible()
  await page.goto('/classes')
  await expect(page.getByText('✓ offline').first()).toBeVisible()
  await snap(page, 'my classes, ready offline')
})

test('16. a word tapped while the child reads stays marked after the recording', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await waitForWarmUp(page)
  await goOffline(context)
  await openChild(page, 'Meena')
  await startCheck(page)
  await page.getByRole('button', { name: 'Start recording' }).click()
  const live = page.locator('section.card').filter({ hasText: 'Listen and tap any word' })
  await expect(live).toBeVisible()
  await live.locator('button.rounded-lg').first().click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  const save = page.getByRole('button', { name: 'Save marks' })
  await expect(save).toBeVisible({ timeout: 30_000 })
  const words = page.locator('section.card').filter({ has: save }).locator('button.rounded-lg')
  await expect(words.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(words.nth(1)).toHaveAttribute('aria-pressed', 'false')
  await snap(page, 'marked while reading')
})

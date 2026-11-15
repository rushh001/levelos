/** Harness check: does blocking reach requests that go through the app's service worker? */
import { expect, test } from '@playwright/test'
import { apiFails, goOffline, loginDemo, waitForServiceWorker } from '../helpers'

async function fetchStatus(page: import('@playwright/test').Page, method: string) {
  return page.evaluate(async (m) => {
    try {
      const r = await fetch('/api/classes', { method: m, headers: { Authorization: `Bearer ${localStorage.getItem('levelos.token')}` } })
      return `answered ${r.status}`
    } catch (e) {
      return `failed: ${(e as Error).message}`
    }
  }, method)
}

test('harness: API blocking reaches service-worker requests', async ({ page, context }) => {
  await loginDemo(page)
  await waitForServiceWorker(page)
  await apiFails(context)
  const get = await fetchStatus(page, 'GET')
  console.log(`  [harness] apiFails, GET via service worker: ${get}`)
  await context.unroute('**/api/**')
  await goOffline(context)
  const off = await fetchStatus(page, 'GET')
  console.log(`  [harness] goOffline, GET via service worker: ${off}`)
  expect(get).toMatch(/failed/)
  expect(off).toMatch(/failed/)
})

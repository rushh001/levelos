/**
 * "Add to home screen": Chrome offers it through the beforeinstallprompt event, which is kept here until the teacher
 * asks. An installed app is also the one Chrome promises not to clear under storage pressure, so the checks waiting
 * on the phone are safe (navigator.storage.persist), and it opens from an icon like any app, with or without network.
 */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let offered: InstallPrompt | null = null
const watchers = new Set<() => void>()
const changed = () => watchers.forEach((w) => w())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // shown in the app's own words, when it makes sense
  offered = e as InstallPrompt
  changed()
})
window.addEventListener('appinstalled', () => {
  offered = null
  changed()
})

/** Open as the installed app (from the home screen or the dock): nothing to offer. iOS says so its own way. */
const installed = () =>
  !!window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Whether the browser's own "install" prompt can be shown now (Chromium: Chrome, Edge, Samsung Internet). */
export const canInstall = () => !!offered && !installed()

/**
 * How this browser adds the app to the home screen, when it is not installed yet:
 *   prompt   the browser's own prompt (Chromium);
 *   ios      iPhone or iPad, any browser (all run on WebKit, which lets no page start an install): Share → Add to
 *            Home Screen. Also what stops Safari clearing the app's data after 7 days without a visit;
 *   mac      Safari on a Mac (macOS 14 or later): File → Add to Dock;
 *   firefox  Firefox on Android: menu → Install;
 *   null     installed already, or a browser that cannot install a web app (Firefox on a computer).
 */
export type InstallHow = 'prompt' | 'ios' | 'mac' | 'firefox' | null

export function installHow(): InstallHow {
  if (installed()) return null
  if (offered) return 'prompt'
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) return 'ios'
  if (/Android/.test(ua) && /Firefox\//.test(ua)) return 'firefox'
  if (/Macintosh/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua)) return 'mac'
  return null
}

export function watchInstall(fn: () => void): () => void {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

export async function install(): Promise<boolean> {
  const p = offered
  if (!p) return false
  await p.prompt()
  const { outcome } = await p.userChoice
  offered = null
  changed()
  if (outcome === 'accepted') void navigator.storage?.persist?.().catch(() => undefined)
  return outcome === 'accepted'
}

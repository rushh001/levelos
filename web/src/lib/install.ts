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

/** Whether the app can be added to the home screen now (not when it is already open as the installed app). */
export const canInstall = () => !!offered && !window.matchMedia?.('(display-mode: standalone)').matches

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

import { useCallback, useEffect, useRef, useState } from 'react'
import { recordingUrl } from '../api'
import type { Word } from './types'

// Only one recording plays at a time across the page.
let playing: HTMLAudioElement | null = null

export type ClipState = 'idle' | 'loading' | 'playing' | 'error'

/** Plays one item's recording: all of it, or a window (one word). `ms` is the playback position while playing. */
export function useClip(checkinId: string, itemResultId: string) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const stopAt = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  // The 'pause' event arrives asynchronously; a pause we make ourselves (to jump to another word) must not end
  // the playback that starts right after it.
  const selfPause = useRef(false)
  const [state, setState] = useState<ClipState>('idle')
  const [ms, setMs] = useState<number | null>(null)

  const halt = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    stopAt.current = null
    setMs(null)
    setState((s) => (s === 'error' ? s : 'idle'))
  }, [])

  useEffect(
    () => () => {
      audio.current?.pause()
      if (timer.current) window.clearInterval(timer.current)
    },
    [],
  )

  const play = useCallback(
    async (fromMs = 0, toMs: number | null = null) => {
      try {
        if (!audio.current) {
          setState('loading')
          const a = new Audio(await recordingUrl(checkinId, itemResultId))
          a.onpause = () => {
            if (selfPause.current) selfPause.current = false
            else halt()
          }
          a.onended = halt
          audio.current = a
        }
        const a = audio.current
        if (playing && playing !== a) playing.pause()
        playing = a
        if (!a.paused) {
          selfPause.current = true
          a.pause()
        }
        a.currentTime = fromMs / 1000
        stopAt.current = toMs
        await a.play()
        setState('playing')
        // Poll rather than rely on timeupdate (~4/s): stops a single word precisely and drives the highlight.
        if (timer.current) window.clearInterval(timer.current)
        timer.current = window.setInterval(() => {
          const now = a.currentTime * 1000
          setMs(now)
          if (stopAt.current !== null && now >= stopAt.current) a.pause()
        }, 50)
      } catch {
        setState('error')
      }
    },
    [checkinId, itemResultId, halt],
  )

  const stop = useCallback(() => audio.current?.pause(), [])
  return { state, ms, play, stop }
}

/** Where to play for word i: its own timing, else the gap between its timed neighbours, else null (whole clip). */
export function wordWindow(words: Word[], i: number): [number, number] | null {
  const pad = 250
  const w = words[i]
  if (w.start_ms !== null && w.end_ms !== null) return [Math.max(0, w.start_ms - pad), w.end_ms + pad]
  let before: number | null = null
  let after: number | null = null
  for (let k = i - 1; k >= 0 && before === null; k--) before = words[k].end_ms
  for (let k = i + 1; k < words.length && after === null; k++) after = words[k].start_ms
  if (before === null && after === null) return null
  const start = before ?? Math.max(0, (after as number) - 2500)
  const end = after ?? (before as number) + 2500
  return [Math.max(0, start - pad), end + pad]
}

/** Index of the word being spoken at `ms`, from word timings (null when unknown). */
export function wordAt(words: Word[], ms: number | null): number | null {
  if (ms === null) return null
  const hit = words.find((w) => w.start_ms !== null && w.end_ms !== null && ms >= w.start_ms && ms <= w.end_ms)
  return hit ? hit.i : null
}

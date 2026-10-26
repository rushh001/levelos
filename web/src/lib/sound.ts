/**
 * Small sounds and tunes, synthesised with Web Audio so nothing is downloaded: a tap, a tick as a pointer moves,
 * a rising chime when the group gets it, a soft low note when they don't, a short fanfare after a card, and a
 * music-box melody for the songs. The teacher can mute it all (a classroom is loud enough); the choice is kept
 * on the phone. Browsers only play sound after a tap, so the context is created on the first tap on the page.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'levelos.sound'
const EVENT = 'levelos:sound'
let ctx: AudioContext | null = null
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === 'off'
  } catch {
    return false
  }
})()

function audio(): AudioContext | null {
  if (muted) return null
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    ctx ??= new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** iOS only lets a page make sound after a tap: create and resume the context inside the first one. */
export function unlock() {
  audio()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
}

/** One note: a music-box tone (a sine with a touch of its octave) that decays on its own. `at` is seconds from now. */
function tone(freq: number, at = 0, dur = 0.3, gain = 0.2, type: OscillatorType = 'sine', out?: AudioNode) {
  const c = audio()
  if (!c) return
  const t0 = c.currentTime + at
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  env.connect(out ?? c.destination)
  for (const [mult, g] of [[1, 1], [2, 0.25]] as const) {
    const o = c.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq * mult, t0)
    const og = c.createGain()
    og.gain.value = g
    o.connect(og).connect(env)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }
}

export const midi = (n: number) => 440 * 2 ** ((n - 69) / 12)

export interface Step {
  /** What this step sings (a letter, a syllable, a word); shown and highlighted while it plays. */
  text: string
  /** MIDI note number, or null for a rest. */
  note: number | null
  beats: number
  /** False for a step with no cell to point at (the song's closing words). */
  point?: boolean
}

export const sound = {
  tap: () => tone(880, 0, 0.06, 0.12),
  tick: () => tone(1320, 0, 0.05, 0.07, 'triangle'),
  flip: () => {
    tone(520, 0, 0.08, 0.1)
    tone(780, 0.06, 0.1, 0.1)
  },
  success: () => [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.09, 0.35, 0.18)),
  wrong: () => {
    tone(196, 0, 0.22, 0.12, 'triangle')
    tone(174.6, 0.12, 0.28, 0.1, 'triangle')
  },
  fanfare: () => [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, i === 5 ? 0.7 : 0.3, 0.16)),

  /** Plays a melody; `onStep(i)` fires as each step starts and `onStep(-1)` at the end. Returns a stop function
   * that silences the notes still to come as well as the highlights. */
  play(steps: Step[], bpm: number, onStep: (i: number) => void): () => void {
    const beat = 60 / bpm
    const timers: number[] = []
    const c = audio()
    const master = c ? c.createGain() : null
    master?.connect(c!.destination)
    let t = 0
    steps.forEach((s, i) => {
      timers.push(window.setTimeout(() => onStep(i), t * 1000))
      if (s.note !== null && master) tone(midi(s.note), t, Math.min(s.beats * beat * 0.95, 1.2), 0.2, 'sine', master)
      t += s.beats * beat
    })
    timers.push(window.setTimeout(() => onStep(-1), t * 1000))
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      master?.disconnect()
    }
  },
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}

export function setSoundOn(on: boolean) {
  muted = !on
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* the choice lasts until the tab closes */
  }
  if (on) unlock()
  window.dispatchEvent(new Event(EVENT))
}

/** Whether sounds play, for the mute button. */
export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribe, () => !muted)
}

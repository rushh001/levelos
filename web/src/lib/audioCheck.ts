/**
 * The recording measured on the phone, with no network and no speech model: the same rules the server applies
 * before and after its speech services (api/app/speech/audio.py and scorer.py), so an offline check gets
 *  - the quality gate: too short, silent or too long → record again now, not found out at sync;
 *  - reading time: only the stretch where the child speaks, not the silence before the teacher taps stop
 *    (reading speed for paragraphs and stories);
 *  - long pauses inside the reading (the "halting" criterion), in every language.
 * Keep the numbers below in step with the server's.
 */

const FRAME_MS = 30
const BELOW_PEAK_DB = 30 // a frame within 30 dB of the loudest frame counts as speech…
const FLOOR_DBFS = -50 // …if it is also above this
const SILENCE_DBFS = -50 // the whole clip quieter than this: silent (scorer.SILENCE_DBFS)
const MIN_DURATION_MS = 600 // scorer.MIN_DURATION_MS
const MAX_DURATION_MS = 180_000 // scorer.MAX_DURATION_MS
export const HESITATION_MS = 3000 // aser_rules.Thresholds.hesitation_ms

export type ClipProblem = 'too_short' | 'silent' | 'too_long'

export interface ClipCheck {
  durationMs: number
  /** From the first to the last frame of speech; null when nothing rises above the floor. */
  readingMs: number | null
  /** Silent stretches longer than HESITATION_MS inside the speech. */
  hesitations: number
  problem: ClipProblem | null
}

const dbfs = (sumSq: number, n: number) => (n && sumSq > 0 ? 20 * Math.log10(Math.sqrt(sumSq / n)) : -120)

/** Pure measurement on mono samples in [-1, 1], so it can be checked without a browser. */
export function measure(samples: Float32Array, rate: number): ClipCheck {
  const durationMs = Math.round((samples.length * 1000) / rate)
  const step = Math.max(1, Math.floor((rate * FRAME_MS) / 1000))
  const levels: number[] = []
  let totalSq = 0
  for (let i = 0; i < samples.length; i += step) {
    let sq = 0
    const end = Math.min(samples.length, i + step)
    for (let j = i; j < end; j++) sq += samples[j] * samples[j]
    totalSq += sq
    levels.push(dbfs(sq, end - i))
  }
  const peak = levels.length ? Math.max(...levels) : -120
  const threshold = Math.max(peak - BELOW_PEAK_DB, FLOOR_DBFS)
  const voiced = levels.map((lv) => lv >= threshold)
  const first = voiced.indexOf(true)
  const last = voiced.lastIndexOf(true)

  let readingMs: number | null = null
  let hesitations = 0
  if (first >= 0) {
    readingMs = Math.min((last + 1) * FRAME_MS, durationMs) - first * FRAME_MS
    let run = 0
    for (let k = first; k <= last; k++) {
      if (voiced[k]) {
        if (run * FRAME_MS > HESITATION_MS) hesitations += 1
        run = 0
      } else run += 1
    }
  }

  let problem: ClipProblem | null = null
  if (durationMs < MIN_DURATION_MS) problem = 'too_short'
  else if (durationMs > MAX_DURATION_MS) problem = 'too_long'
  else if (first < 0 || dbfs(totalSq, samples.length) < SILENCE_DBFS) problem = 'silent'
  return { durationMs, readingMs, hesitations, problem }
}

/** Decodes the phone's recording (WebM/Opus, MP4/AAC…) and measures it. Null when this phone cannot decode it:
 * the check then carries on as before (the clip's length as reading time, no pauses counted). */
export async function checkClip(blob: Blob): Promise<ClipCheck | null> {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    try {
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
      return measure(audio.getChannelData(0), audio.sampleRate)
    } finally {
      void ctx.close().catch(() => undefined)
    }
  } catch {
    return null
  }
}

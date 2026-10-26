import { useCallback, useEffect, useRef, useState } from 'react'

export interface Clip {
  blob: Blob
  mime: string
  durationMs: number
}

// Opus/WebM on Android Chrome (~150 KB/min at 24 kbps), MP4/AAC on iOS Safari.
const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m))
}

export type RecorderState = 'idle' | 'recording' | 'error'
export type RecorderError = 'unsupported' | 'permission' | null

/**
 * One clip at a time. `start()` resolves with the clip once recording stops — by `stop()`, or by itself at
 * `maxMs` (a slow reader can take two minutes over a story) — or with null if it was cancelled or failed.
 */
export function useRecorder(maxMs = 120_000) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0) // how loud the child is right now, 0–1, for the live meter
  const [error, setError] = useState<RecorderError>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const cancelled = useRef(false)

  const release = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void audioCtx.current?.close().catch(() => undefined)
    audioCtx.current = null
    analyser.current = null
    setLevel(0)
  }, [])

  // The meter is a convenience: any phone that cannot give one still records. The context is created inside
  // the teacher's tap (before the permission prompt), the only time iOS lets a page start audio.
  const openMeter = () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      audioCtx.current = new Ctx()
      void audioCtx.current.resume()
    } catch {
      audioCtx.current = null
    }
  }
  const startMeter = (s: MediaStream) => {
    try {
      const c = audioCtx.current
      if (!c) return
      const node = c.createAnalyser()
      node.fftSize = 512
      c.createMediaStreamSource(s).connect(node)
      analyser.current = node
    } catch {
      analyser.current = null
    }
  }
  const readLevel = () => {
    const node = analyser.current
    if (!node) return
    const buf = new Uint8Array(node.fftSize)
    node.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += ((v - 128) / 128) ** 2
    const v = Math.round(Math.min(1, Math.sqrt(sum / buf.length) * 4) * 20) / 20
    setLevel((prev) => (prev === v ? prev : v)) // only a visible change re-renders the page
  }

  useEffect(
    () => () => {
      cancelled.current = true
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
      release()
    },
    [release],
  )

  const start = useCallback(async (): Promise<Clip | null> => {
    setError(null)
    cancelled.current = false
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error')
      setError('unsupported')
      return null
    }
    openMeter()
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, autoGainControl: true },
      })
    } catch {
      setState('error')
      setError('permission')
      return null
    }
    startMeter(stream.current)
    const mime = pickMime()
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime, audioBitsPerSecond: 24_000 } : undefined)
    rec.current = r
    const chunks: Blob[] = []
    const startedAt = Date.now()
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    const done = new Promise<Clip | null>((resolve) => {
      r.onstop = () => {
        release()
        setState('idle')
        const type = r.mimeType || mime || 'audio/webm'
        resolve(cancelled.current ? null : { blob: new Blob(chunks, { type }), mime: type, durationMs: Date.now() - startedAt })
      }
    })
    setElapsed(0)
    r.start(1000)
    setState('recording')
    timer.current = window.setInterval(() => {
      const ms = Date.now() - startedAt
      setElapsed((prev) => (Math.floor(prev / 1000) === Math.floor(ms / 1000) ? prev : ms)) // the clock shows seconds
      readLevel()
      if (ms >= maxMs && r.state === 'recording') r.stop()
    }, 100)
    return done
  }, [maxMs, release])

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    stop()
  }, [stop])

  return { state, elapsed, level, error, start, stop, cancel }
}

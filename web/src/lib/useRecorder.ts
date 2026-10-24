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
  const [error, setError] = useState<RecorderError>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const cancelled = useRef(false)

  const release = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

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
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, autoGainControl: true },
      })
    } catch {
      setState('error')
      setError('permission')
      return null
    }
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
      setElapsed(ms)
      if (ms >= maxMs && r.state === 'recording') r.stop()
    }, 250)
    return done
  }, [maxMs, release])

  const stop = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    stop()
  }, [stop])

  return { state, elapsed, error, start, stop, cancel }
}

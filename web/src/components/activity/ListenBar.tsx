import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isReachable } from '../../api'
import { phoneVoice, playableClips, serverRecording, type Part, type Recording } from '../../lib/speech'

export interface ListenHandle {
  /** Plays one part only (a step's 🔊). */
  playPart: (i: number) => void
}

// 'retry': online, but the reading could not be had this time (the server failing for a moment): pressing again tries
// again. 'none': offline with nothing on the phone to read it; when the network is back it can be pressed again.
type Mode = 'idle' | 'loading' | 'retry' | 'server' | 'clips' | 'phone' | 'none'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * "Listen to this activity": the whole activity read aloud in the teacher's language, with a slider to move to any
 * part and a chip per part (intro, each step, homework, tip). `onPart` tells the page which part is being read, so
 * its step glows. The server's voice when online (kept on the phone afterwards); offline, that kept recording, or for
 * an activity made on the phone the book activity's recorded lines (`clips`), else the phone's own voice.
 */
export const ListenBar = forwardRef<
  ListenHandle,
  { parts: Part[]; ui: string; onPart: (key: string | null) => void; clips?: Record<string, string> | null }
>(function ListenBar({ parts, ui, onPart, clips }, ref) {
    const { t } = useTranslation()
    const [mode, setMode] = useState<Mode>('idle')
    const [rec, setRec] = useState<Recording | null>(null)
    const [playing, setPlaying] = useState(false)
    const [at, setAt] = useState(0) // seconds (server voice) or part index (phone voice)
    const [slow, setSlow] = useState(false)
    const audio = useRef<HTMLAudioElement | null>(null)
    const player = useRef<HTMLAudioElement | null>(null) // the recorded lines, one after another
    const lines = useRef<{ urls: Record<string, string>; release: () => void } | null>(null) // those lines, ready to play
    const voice = useRef<SpeechSynthesisVoice | null>(null)
    const stopAt = useRef<number | null>(null) // one part only: pause when the next one starts
    const run = useRef(0) // the phone voice's current run; an utterance from a cancelled run is ignored
    const slowRef = useRef(slow)
    slowRef.current = slow

    const partAt = (s: number) => (rec ? Math.max(0, rec.starts.filter((x) => x <= s + 0.05).length - 1) : 0)
    const current = mode === 'server' ? partAt(at) : at

    useEffect(
      () => () => {
        audio.current?.pause()
        player.current?.pause()
        if ('speechSynthesis' in window) window.speechSynthesis.cancel()
        lines.current?.release()
        onPart(null)
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    )
    useEffect(() => () => void (rec && URL.revokeObjectURL(rec.url)), [rec])
    useEffect(() => {
      const back = () => setMode((m) => (m === 'none' ? 'idle' : m))
      window.addEventListener('online', back)
      return () => window.removeEventListener('online', back)
    }, [])
    useEffect(() => {
      if (audio.current) audio.current.playbackRate = slow ? 0.85 : 1
      if (player.current) player.current.playbackRate = slow ? 0.85 : 1
    }, [slow, rec])

    // ---------------------------------------------------------------- the phone's voice

    const speakFrom = (i: number, only = false) => {
      const me = ++run.current
      window.speechSynthesis.cancel()
      const say = (k: number) => {
        if (me !== run.current) return
        if (k >= parts.length) {
          setPlaying(false)
          onPart(null)
          return
        }
        const u = new SpeechSynthesisUtterance(parts[k].text)
        if (voice.current) {
          u.voice = voice.current
          u.lang = voice.current.lang
        }
        u.rate = slowRef.current ? 0.85 : 1
        u.onend = () => (only ? (me === run.current && (setPlaying(false), onPart(null))) : say(k + 1))
        setAt(k)
        onPart(parts[k].key)
        window.speechSynthesis.speak(u)
      }
      setPlaying(true)
      say(i)
    }

    // ---------------------------------------------------------------- the recorded lines (offline)

    const playClips = (i: number, only = false) => {
      const me = ++run.current
      const el = player.current ?? new Audio()
      player.current = el
      const urls = lines.current?.urls ?? {}
      const say = (k: number) => {
        if (me !== run.current) return
        while (k < parts.length && !urls[parts[k].key]) k++ // a part with no recording (the homework) is skipped
        if (k >= parts.length) {
          setPlaying(false)
          onPart(null)
          return
        }
        el.src = urls[parts[k].key]
        el.playbackRate = slowRef.current ? 0.85 : 1
        el.onended = () => (only ? me === run.current && (setPlaying(false), onPart(null)) : say(k + 1))
        setAt(k)
        onPart(parts[k].key)
        void el.play().catch(() => me === run.current && (setPlaying(false), onPart(null)))
      }
      setPlaying(true)
      say(i)
    }

    // ---------------------------------------------------------------- the server's recording

    const attach = (r: Recording) => {
      const el = new Audio(r.url)
      el.playbackRate = slowRef.current ? 0.85 : 1
      let said: string | null = null // the part last reported to the page
      const report = (key: string | null) => {
        if (key !== said) onPart((said = key))
      }
      el.addEventListener('timeupdate', () => {
        setAt(el.currentTime)
        if (stopAt.current !== null && el.currentTime >= stopAt.current - 0.05) {
          stopAt.current = null
          el.pause()
          return
        }
        if (!el.paused) report(parts[Math.max(0, r.starts.filter((x) => x <= el.currentTime + 0.05).length - 1)]?.key ?? null)
      })
      el.addEventListener('play', () => setPlaying(true))
      el.addEventListener('pause', () => {
        setPlaying(false)
        report(null)
      })
      el.addEventListener('ended', () => {
        setPlaying(false)
        onPart(null)
      })
      audio.current = el
    }

    const seekTo = (i: number, only = false, r = rec) => {
      if (!audio.current || !r) return
      stopAt.current = only ? (r.starts[i + 1] ?? null) : null
      audio.current.currentTime = r.starts[i] ?? 0
      setAt(r.starts[i] ?? 0)
      void audio.current.play().catch(() => setPlaying(false))
    }

    // ---------------------------------------------------------------- starting

    const start = async (i = 0, only = false) => {
      if (mode === 'server') return seekTo(i, only)
      if (mode === 'clips') return playClips(i, only)
      if (mode === 'phone') return speakFrom(i, only)
      if (mode === 'loading') return
      setMode('loading')
      const r = await serverRecording(ui, parts)
      if (r) {
        attach(r)
        setRec(r)
        setMode('server')
        return seekTo(i, only, r)
      }
      // Offline, an activity made on the phone: the book activity's recorded lines, from the phone's copy.
      const ready = clips ? await playableClips(clips) : null
      if (ready) {
        lines.current?.release()
        lines.current = ready
        setMode('clips')
        return playClips(i, only)
      }
      voice.current = await phoneVoice(ui)
      if (!voice.current) return setMode(navigator.onLine && isReachable() ? 'retry' : 'none')
      setMode('phone')
      speakFrom(i, only)
    }

    useImperativeHandle(ref, () => ({ playPart: (i: number) => void start(i, true) }))

    const toggle = () => {
      if (mode === 'server' && audio.current) {
        stopAt.current = null
        return void (audio.current.paused ? audio.current.play() : audio.current.pause())
      }
      if (mode === 'phone') {
        if (playing) {
          run.current++
          window.speechSynthesis.cancel()
          return setPlaying(false)
        }
        return speakFrom(at)
      }
      if (mode === 'clips' && player.current) {
        if (playing) {
          player.current.pause()
          return setPlaying(false)
        }
        return playClips(at)
      }
      void start(0)
    }

    const label = (p: Part, i: number) =>
      p.key === 'intro' ? t('activity.listenIntro') : p.key === 'homework' ? '🏠' : p.key === 'tip' ? '💡' : String(i)

    if (mode === 'idle' || mode === 'loading' || mode === 'retry') {
      return (
        <button
          onClick={() => void start(0)}
          disabled={mode === 'loading'}
          className="flex w-full items-center gap-3 rounded-2xl bg-brand-soft p-3 text-left transition active:scale-[0.98]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-xl text-white shadow-lift">
            {mode === 'loading' ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : '🔊'}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-brand-deep">{t('activity.listen')}</span>
            <span className="block text-xs text-mute">
              {mode === 'loading' ? t('activity.listenLoading') : mode === 'retry' ? t('retry') : t('activity.listenHint')}
            </span>
          </span>
        </button>
      )
    }
    if (mode === 'none') {
      return <p className="rounded-2xl bg-paper p-3 text-sm text-mute">🔇 {t('activity.listenNoVoice')}</p>
    }

    const max = mode === 'server' ? (rec?.duration ?? 0) : parts.length - 1
    const marks = mode === 'server' ? (rec?.starts ?? []) : parts.map((_, i) => i)
    return (
      <div className="rounded-2xl bg-brand-soft p-3" role="group" aria-label={t('activity.listen')}>
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            aria-label={playing ? t('activity.pause') : t('activity.play')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-white shadow-lift transition active:scale-95"
          >
            {playing ? '⏸' : '▶'}
          </button>
          <div className="relative min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={max || 1}
              step={mode === 'server' ? 0.1 : 1}
              value={at}
              aria-label={t('activity.listenSlider')}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (mode === 'server' && audio.current) {
                  stopAt.current = null
                  audio.current.currentTime = v
                  setAt(v)
                } else if (mode === 'clips') playClips(v)
                else speakFrom(v)
              }}
              className="w-full accent-brand"
            />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0" aria-hidden>
              {marks.slice(1).map((m) => (
                <span key={m} className="absolute -top-2.5 h-2 w-0.5 rounded bg-brand/40" style={{ left: `${(m / (max || 1)) * 100}%` }} />
              ))}
            </div>
          </div>
          {mode === 'server' && (
            <span className="shrink-0 text-xs tabular-nums text-mute">
              {clock(at)} / {clock(max)}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {parts.map((p, i) => (
            <button
              key={p.key}
              onClick={() => (mode === 'server' ? seekTo(i) : mode === 'clips' ? playClips(i) : speakFrom(i))}
              className={`min-w-[2.25rem] rounded-full px-2.5 py-1 text-sm font-semibold transition active:scale-95 ${
                i === current && playing ? 'bg-brand text-white' : 'bg-white text-brand-deep'
              }`}
            >
              {label(p, i)}
            </button>
          ))}
          <button
            onClick={() => setSlow((s) => !s)}
            aria-pressed={slow}
            className={`ml-auto rounded-full px-2.5 py-1 text-sm ${slow ? 'bg-brand text-white' : 'bg-white text-mute'}`}
          >
            🐢 {t('activity.slower')}
          </button>
        </div>
        {mode === 'phone' && <p className="mt-1 text-xs text-mute">{t('activity.phoneVoice')}</p>}
      </div>
    )
  })

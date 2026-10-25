import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Plays the pre-recorded instruction for this item level (shipped with the app, so it works offline):
 * `/audio/<test>/<level>.mp3`, or `/audio/<test>-<spoken>/` when an English test is explained in a regional
 * language (en-hi, en-kn, …). */
export function InstructionAudio({ test, spoken, level }: { test: string; spoken: string; level: string }) {
  const { t } = useTranslation()
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [missing, setMissing] = useState(false)

  if (missing) return null
  const play = () => {
    audio.current?.pause()
    const a = new Audio(`/audio/${spoken === test ? test : `${test}-${spoken}`}/${level}.mp3`)
    audio.current = a
    a.onended = () => setPlaying(false)
    a.onerror = () => {
      setPlaying(false)
      setMissing(true)
    }
    setPlaying(true)
    void a.play().catch(() => setPlaying(false))
  }
  return (
    <button
      onClick={play}
      aria-label={t('checkin.playInstruction')}
      className={`shrink-0 rounded-full border border-blue-200 bg-white px-3 py-2 text-xl ${playing ? 'animate-pulse' : ''}`}
    >
      🔊
    </button>
  )
}

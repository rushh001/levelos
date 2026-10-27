import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Plays the pre-recorded instruction for this item level in the language of the test (shipped with the app, so
 * it works offline): `/audio/<test>/<level>.mp3`. `onPlaying` lets the page animate while it plays. */
export function InstructionAudio({
  test,
  level,
  onPlaying,
}: {
  test: string
  level: string
  onPlaying?: (playing: boolean) => void
}) {
  const { t } = useTranslation()
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    onPlaying?.(playing)
  }, [playing, onPlaying])
  useEffect(() => () => audio.current?.pause(), [])

  if (missing) return null
  const play = () => {
    audio.current?.pause()
    const a = new Audio(`/audio/${test}/${level}.mp3`)
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
      className={`relative shrink-0 rounded-full border border-brand/20 bg-white px-3 py-2 text-xl shadow-card transition active:scale-95 ${
        playing ? 'text-brand' : ''
      }`}
    >
      {playing && <span className="absolute inset-0 rounded-full border-2 border-brand/50 pulse-ring" aria-hidden />}
      🔊
    </button>
  )
}

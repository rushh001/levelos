import { useTranslation } from 'react-i18next'
import { setSoundOn, useSoundOn } from '../lib/sound'

/** Mutes the app's sounds (a classroom is loud enough); remembered on the phone. */
export function SoundToggle({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const on = useSoundOn()
  return (
    <button
      onClick={() => setSoundOn(!on)}
      aria-pressed={on}
      aria-label={t(on ? 'sound.off' : 'sound.on')}
      title={t(on ? 'sound.off' : 'sound.on')}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white text-base shadow-card transition active:scale-95 ${on ? '' : 'opacity-60'} ${className}`}
    >
      {on ? '🔊' : '🔇'}
    </button>
  )
}

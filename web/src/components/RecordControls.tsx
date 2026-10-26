import { useTranslation } from 'react-i18next'
import type { useRecorder } from '../lib/useRecorder'
import { Button } from './ui'

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The big microphone. While recording, a ring around it grows with the child's voice, so both can see the phone
 * is listening; the teacher taps it again to stop. */
export function RecordControls({
  recorder,
  onRecord,
  onTap,
  hint,
  tapLabel,
}: {
  recorder: ReturnType<typeof useRecorder>
  onRecord: () => void
  onTap: () => void
  hint?: string
  tapLabel?: string
}) {
  const { t } = useTranslation()
  if (recorder.state === 'recording') {
    const scale = 1 + recorder.level * 0.9
    return (
      <div className="mt-5 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-coral-deep">
          <span className="h-3 w-3 rounded-full bg-coral animate-pulse" />
          <span className="font-mono text-lg tabular-nums">{clock(recorder.elapsed)}</span>
        </div>
        <p className="text-center text-sm text-mute">{t('checkin.recording')}</p>
        <div className="relative flex h-32 w-32 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-coral/15 transition-transform duration-100 ease-out"
            style={{ transform: `scale(${scale})` }}
          />
          <span aria-hidden className="absolute inset-3 rounded-full border-2 border-coral/40 pulse-ring" />
          <button
            onClick={recorder.stop}
            className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full bg-coral font-display text-lg text-white shadow-lift transition active:scale-95 active:bg-coral-deep"
          >
            <span className="mb-0.5 block h-5 w-5 rounded bg-white" aria-hidden />
            {t('checkin.stop')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-5 flex flex-col items-center gap-3">
      <p className="text-center text-sm text-mute">{hint ?? t('checkin.showChild')}</p>
      <button
        onClick={onRecord}
        aria-label={t('checkin.record')}
        className="flex h-24 w-24 items-center justify-center rounded-full bg-brand text-4xl text-white shadow-lift transition active:scale-95 active:bg-brand-deep"
      >
        🎤
      </button>
      {recorder.error && (
        <p className="text-center text-sm text-coral-deep">
          {t(recorder.error === 'permission' ? 'checkin.micPermission' : 'checkin.micUnsupported')}
        </p>
      )}
      <Button kind="ghost" onClick={onTap}>
        {tapLabel ?? t('checkin.markByTap')}
      </Button>
    </div>
  )
}

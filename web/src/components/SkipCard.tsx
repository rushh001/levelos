import { useTranslation } from 'react-i18next'

/**
 * The teacher's way past a card the child should not be made to read. A skipped card counts for nothing: the level
 * comes only from the cards the child reads, and the check moves on to a card not tried yet. Small and grey on
 * purpose: it is for the teacher, not the child.
 */
export function SkipCard({ onSkip, disabled }: { onSkip: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 flex justify-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onSkip}
        className="rounded-full border border-line bg-white px-4 py-1.5 text-sm font-semibold text-mute transition active:scale-95 disabled:opacity-50"
      >
        ⏭ {t('checkin.skipCard')}
      </button>
    </div>
  )
}

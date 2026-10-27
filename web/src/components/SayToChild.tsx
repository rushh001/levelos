import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemPublic } from '../lib/types'
import { InstructionAudio } from './InstructionAudio'
import { Mascot } from './Mascot'

/**
 * What the teacher says before the child reads, in the language of the test like everything else on the screen:
 * a Hindi test in Hindi, the English test in English, a Tamil test in Tamil. The parrot "says" it while the
 * recording plays.
 */
export function SayToChild({ item, test }: { item: ItemPublic; test: string }) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const lines = item.instructions as Record<string, string | undefined>
  return (
    <div className="mb-3 flex items-center gap-3 rounded-3xl bg-brand-soft p-3">
      <Mascot mood={playing ? 'speaking' : 'idle'} size={56} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-deep/70">{t('checkin.sayToChild')}</div>
        <div className="text-lg leading-snug text-ink">{lines[test] ?? lines.en}</div>
      </div>
      <InstructionAudio key={item.id} test={test} level={item.level} onPlaying={setPlaying} />
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemPublic } from '../lib/types'
import { useUiLang } from '../lib/uiLang'
import { InstructionAudio } from './InstructionAudio'
import { Mascot } from './Mascot'

/**
 * What the teacher says before the child reads, in the language the child is taught in: a regional-language test
 * in that language; the English test in the app's language (English in the English app, Kannada in the Kannada
 * app, as ASER explains its English test in the child's language). Below it, the meaning for the teacher when the
 * app is in another language. The parrot "says" it while the recording plays.
 */
export function SayToChild({ item, test }: { item: ItemPublic; test: string }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const [playing, setPlaying] = useState(false)
  const lines = item.instructions as Record<string, string | undefined>
  const spoken = test === 'en' && lines[ui] ? ui : test
  return (
    <div className="mb-3 flex items-center gap-3 rounded-3xl bg-brand-soft p-3">
      <Mascot mood={playing ? 'speaking' : 'idle'} size={56} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-deep/70">{t('checkin.sayToChild')}</div>
        <div className="text-lg leading-snug text-ink">{lines[spoken] ?? lines.en}</div>
        {spoken !== ui && lines[ui] && <div className="text-sm text-mute">{lines[ui]}</div>}
      </div>
      <InstructionAudio key={`${item.id}-${spoken}`} test={test} spoken={spoken} level={item.level} onPlaying={setPlaying} />
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import type { ItemPublic } from '../lib/types'
import { useUiLang } from '../lib/uiLang'
import { InstructionAudio } from './InstructionAudio'

/**
 * What the teacher says before the child reads, in the language the child is taught in: a regional-language test
 * in that language; the English test in the app's language (English in the English app, Kannada in the Kannada
 * app, as ASER explains its English test in the child's language). Below it, the meaning for the teacher when the
 * app is in another language.
 */
export function SayToChild({ item, test }: { item: ItemPublic; test: string }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const lines = item.instructions as Record<string, string | undefined>
  const spoken = test === 'en' && lines[ui] ? ui : test
  return (
    <div className="mb-3 rounded-xl bg-blue-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase text-blue-800">{t('checkin.sayToChild')}</div>
          <div className="text-lg">{lines[spoken] ?? lines.en}</div>
          {spoken !== ui && lines[ui] && <div className="text-sm text-slate-600">{lines[ui]}</div>}
        </div>
        <InstructionAudio key={`${item.id}-${spoken}`} test={test} spoken={spoken} level={item.level} />
      </div>
    </div>
  )
}

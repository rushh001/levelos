import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { activityExamples, fillExamples } from '../../lib/content'
import type { Activity, ActivityPlan } from '../../lib/types'
import { pick, useUiLang } from '../../lib/uiLang'
import { Mascot } from '../Mascot'
import { SoundToggle } from '../SoundToggle'
import { Stars } from '../Stars'
import { BuildScreen } from './BuildScreen'
import { ChainScreen } from './ChainScreen'
import { ChartScreen } from './ChartScreen'
import { FindWrongScreen } from './FindWrongScreen'
import { FlashScreen } from './FlashScreen'
import { PairsScreen } from './PairsScreen'
import { PictureMatchScreen } from './PictureMatchScreen'
import { RhymeScreen } from './RhymeScreen'

/**
 * "Show the class": the activity as a full-screen, big-text, tappable version the teacher holds up to the group.
 * Each screen is driven by the bank entry's examples for the group's language and the plan's practice words, so a
 * Tamil group builds Tamil words and an English group changes English vowels.
 */
export type ScreenKind = 'chain' | 'pairs' | 'build' | 'flash' | 'chart' | 'findwrong' | 'match' | 'rhyme'

const SCREENS: Record<string, ScreenKind> = {
  'matra-change-chain': 'chain',
  'vowel-change-chain': 'chain',
  'look-alike-letter-pairs': 'pairs',
  'word-building-cards': 'build',
  'letter-card-word-building': 'build',
  'sight-word-flash': 'flash',
  'barakhadi-chart-reading': 'chart',
  'sound-chart-reading': 'chart',
  'correct-the-incorrect': 'findwrong',
  'word-picture-match': 'match',
  'rhyme-and-read': 'rhyme',
}

export function hasShowScreen(activityId: string): boolean {
  return activityId in SCREENS
}

export const SCREEN_ICON: Record<ScreenKind, string> = {
  chain: '🔤',
  pairs: '👀',
  build: '🧩',
  flash: '⚡',
  chart: '📊',
  findwrong: '🔍',
  match: '🖼️',
  rhyme: '🎵',
}

export function screenKind(activityId: string): ScreenKind | null {
  return SCREENS[activityId] ?? null
}

/** What a screen needs of an activity: the bank entry it adapts, its title and the group's practice words. */
export type Showable = Pick<Activity, 'source_activity_id'> & { plan: Pick<ActivityPlan, 'title' | 'practice_words'> }

export interface ScreenProps {
  lang: string
  ex: Record<string, string>
  words: string[]
  /** Stars and a bounce from the parrot: the group got it. */
  celebrate: () => void
}

export function ShowClass({ activity, lang, onClose }: { activity: Showable; lang: string; onClose: () => void }) {
  const { t } = useTranslation()
  const ui = useUiLang()
  const kind = SCREENS[activity.source_activity_id]
  const ex = activityExamples(activity.source_activity_id, lang, ui)
  const title = fillExamples(pick(activity.plan.title, ui) ?? '', ex)
  const [burst, setBurst] = useState(0)
  const [happy, setHappy] = useState(false)
  const celebrate = useCallback(() => {
    setBurst((b) => b + 1)
    setHappy(true)
    window.setTimeout(() => setHappy(false), 1800)
  }, [])
  const props: ScreenProps = { lang, ex, words: activity.plan.practice_words, celebrate }
  const screen = {
    chain: <ChainScreen {...props} />,
    pairs: <PairsScreen {...props} />,
    build: <BuildScreen {...props} />,
    flash: <FlashScreen {...props} />,
    chart: <ChartScreen {...props} />,
    findwrong: <FindWrongScreen {...props} />,
    match: <PictureMatchScreen {...props} />,
    rhyme: <RhymeScreen {...props} />,
  }[kind]

  // A portal: the page's enter animation would otherwise make the page, not the screen, the overlay's frame.
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-paper pop" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <header className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={onClose}
          aria-label={t('show.close')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg text-ink shadow-card transition active:scale-95"
        >
          ✕
        </button>
        <div className="min-w-0 flex-1 truncate font-display text-lg text-brand-deep">{title}</div>
        <SoundToggle />
        <div className="relative shrink-0">
          {burst > 0 && <Stars key={burst} n={10} seed={burst} spread={36} />}
          <Mascot mood={happy ? 'happy' : 'still'} size={44} />
        </div>
      </header>
      <div className="flex-1 overflow-auto px-4 pb-4">{screen}</div>
      <footer
        className="border-t border-line bg-white px-4 py-2 text-center text-sm text-mute"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        {t(`show.hint.${kind}`)}
      </footer>
    </div>,
    document.body,
  )
}

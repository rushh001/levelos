import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chartFor } from '../../lib/content'
import { showCard } from '../../lib/graphemes'
import { ALPHABET_SONG, rowChant } from '../../lib/music'
import { pictureFor } from '../../lib/pictures'
import { sound, type Step } from '../../lib/sound'
import type { ScreenProps } from './ShowClass'

type Mode = 'row' | 'column' | 'diagonal' | 'zigzag'
const MODES: Mode[] = ['row', 'column', 'diagonal', 'zigzag']
const STEP_MS = 900

interface Cell {
  text: string
  word?: string
  emoji?: string
}

/** The barakhadi / kagunita / uyirmei chart, or the English letter-sound chart, with a pointer that runs along a
 * row, a column, a diagonal or a zig-zag, as the activity's steps say, and a song: the alphabet song over a–z, or
 * the chant of a row. Tap any cell to point at it. */
export function ChartScreen({ lang, ex }: ScreenProps) {
  const { t } = useTranslation()
  const chart = chartFor(lang)
  const grid = useMemo(() => {
    if (!chart) return null
    if (chart.letters) {
      const letters = [...chart.letters]
      const cols = 5
      const rows = Math.ceil(letters.length / cols)
      const cells: Cell[][] = Array.from({ length: rows }, (_, r) =>
        letters.slice(r * cols, r * cols + cols).map((l) => {
          const pic = chart.pictures?.[l]
          return { text: l, word: pic?.[0], emoji: pic?.[1] }
        }),
      )
      return { cells, heads: null as string[] | null, rowHeads: null as string[] | null, letters }
    }
    const consonants = (chart.consonants ?? '').split(' ').filter(Boolean)
    const signs = chart.vowel_signs ?? ['']
    const cells: Cell[][] = consonants.map((c) => signs.map((s) => ({ text: c + s })))
    return { cells, heads: signs.map((s) => (s ? showCard(s) : '–')), rowHeads: consonants, letters: null as string[] | null }
  }, [chart])

  // The example row and column from the bank (क का कि …, का खा गा …) are where the pointer starts.
  const start = useMemo(() => {
    if (!grid) return { r: 0, c: 0 }
    const firstRow = (ex.row ?? '').split(' ')[0]
    const r = Math.max(0, grid.cells.findIndex((row) => row[0]?.text === firstRow))
    const colCell = (ex.column ?? '').split(' ')[0]
    let c = 0
    if (colCell) {
      const hit = grid.cells.find((row) => row.some((cell) => cell.text === colCell))
      c = Math.max(0, hit ? hit.findIndex((cell) => cell.text === colCell) : 0)
    }
    return { r, c }
  }, [grid, ex.row, ex.column])

  const [cursor, setCursor] = useState<[number, number]>([start.r, start.c])
  const [mode, setMode] = useState<Mode>('row')
  const [path, setPath] = useState<[number, number][] | null>(null)
  const [step, setStep] = useState(0)
  const [singing, setSinging] = useState<{ steps: Step[]; i: number } | null>(null)
  const stopSong = useRef<(() => void) | null>(null)
  const refs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    if (!path) return
    if (step >= path.length) {
      setPath(null)
      return
    }
    setCursor(path[step])
    sound.tick()
    const timer = window.setTimeout(() => setStep(step + 1), STEP_MS)
    return () => window.clearTimeout(timer)
  }, [path, step])

  useEffect(() => () => stopSong.current?.(), [])

  useEffect(() => {
    refs.current.get(`${cursor[0]}-${cursor[1]}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [cursor])

  if (!grid) return null
  const rows = grid.cells.length
  const cols = grid.cells[0]?.length ?? 0

  const stopAll = () => {
    stopSong.current?.()
    stopSong.current = null
    setSinging(null)
    setPath(null)
  }

  const play = (m: Mode) => {
    stopAll()
    const [r0, c0] = cursor
    const p: [number, number][] = []
    if (m === 'row') for (let c = 0; c < cols; c++) p.push([r0, c])
    if (m === 'column') for (let r = 0; r < rows; r++) p.push([r, c0])
    if (m === 'diagonal') for (let i = 0; i < Math.min(rows, cols); i++) p.push([(r0 + i) % rows, i])
    if (m === 'zigzag')
      for (let i = 0; i < 3; i++) {
        const r = (r0 + i) % rows
        for (let c = 0; c < cols; c++) p.push([r, i % 2 === 0 ? c : cols - 1 - c])
      }
    setMode(m)
    setStep(0)
    setPath(p)
  }

  /** The alphabet song over the letters, or the chant of the pointer's row. */
  const sing = () => {
    stopAll()
    const r0 = cursor[0]
    const steps = grid.letters ? ALPHABET_SONG : rowChant(grid.cells[r0].map((c) => c.text))
    setSinging({ steps, i: 0 })
    stopSong.current = sound.play(steps, grid.letters ? 126 : 104, (i) => {
      if (i < 0) {
        setSinging(null)
        return
      }
      setSinging({ steps, i })
      const s = steps[i]
      if (grid.letters) {
        const pos = s.point !== false && s.text.length === 1 ? grid.letters.indexOf(s.text.toLowerCase()) : -1
        if (pos >= 0) setCursor([Math.floor(pos / cols), pos % cols])
      } else {
        setCursor([r0, i])
      }
    })
  }

  return (
    <div className="flex min-h-full flex-col gap-3 py-2">
      <div className="flex flex-wrap justify-center gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => (path && mode === m ? stopAll() : play(m))}
            aria-pressed={path !== null && mode === m}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold shadow-card transition active:scale-95 ${
              path && mode === m ? 'bg-coral text-white' : 'bg-white text-brand-deep'
            }`}
          >
            {path && mode === m ? `■ ${t('show.stop')}` : `▶ ${t(`show.${m}`)}`}
          </button>
        ))}
        <button
          onClick={() => (singing ? stopAll() : sing())}
          aria-pressed={singing !== null}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold shadow-card transition active:scale-95 ${
            singing ? 'bg-coral text-white' : 'bg-sun-soft text-sun-deep'
          }`}
        >
          {singing ? `■ ${t('show.stop')}` : `♪ ${t('show.sing')}`}
        </button>
      </div>
      {singing && (
        <div key={singing.i} className="mx-auto rounded-full bg-sun-soft px-5 py-1.5 font-display text-2xl text-brand-deep pop">
          ♪ {singing.steps[singing.i]?.text}
        </div>
      )}
      <div className="overflow-auto rounded-3xl bg-white p-2 shadow-card" style={{ maxHeight: '70vh' }}>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `${grid.rowHeads ? 'auto ' : ''}repeat(${cols}, minmax(3.4rem, 1fr))`, minWidth: `${cols * 3.6}rem` }}
        >
          {grid.heads && (
            <>
              <div />
              {grid.heads.map((h, c) => (
                <div key={c} className="sticky top-0 z-10 bg-white py-1 text-center text-base text-mute">
                  {h}
                </div>
              ))}
            </>
          )}
          {grid.cells.map((row, r) => (
            <Fragment key={r}>
              {grid.rowHeads && (
                <div className="sticky left-0 z-10 flex items-center justify-center bg-white px-1 text-base text-mute">
                  {grid.rowHeads[r]}
                </div>
              )}
              {row.map((cell, c) => {
                const on = cursor[0] === r && cursor[1] === c
                const pic = cell.word ? pictureFor(cell.word, 'en') : null
                return (
                  <button
                    key={`${r}-${c}`}
                    ref={(el) => {
                      if (el) refs.current.set(`${r}-${c}`, el)
                    }}
                    onClick={() => {
                      stopAll()
                      sound.tap()
                      setCursor([r, c])
                    }}
                    className={`flex min-h-[3.4rem] flex-col items-center justify-center rounded-xl px-1 py-1 transition ${
                      on ? 'z-20 scale-110 bg-sun-soft ring-4 ring-sun text-brand-deep' : 'bg-paper text-ink'
                    }`}
                  >
                    <span className="text-2xl font-semibold">{cell.text}</span>
                    {cell.word && (
                      <span className="flex items-center gap-1 text-[11px] leading-tight text-mute">
                        {pic ? <img src={pic} alt="" width={22} height={22} draggable={false} /> : <span>{cell.emoji}</span>}
                        {cell.word}
                      </span>
                    )}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

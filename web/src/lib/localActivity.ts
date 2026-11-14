/**
 * The 10-minute activity, put together on the phone when the server cannot be reached. It follows the server's
 * rules (api/app/llm/activities.py) on the same bundled data: only activities built on a free book text; what the
 * children read matches the group (letters for a Letter group, single words for a Word group, a short rhyme for a
 * Paragraph group, a story or long poem for a Story group); the group's last activity is left out and texts rotate;
 * Paragraph and Story groups get homework; the book and the NCERT goal are credited; the activity that works on most
 * of the group's mistakes comes first, and the plan says which mistakes those are. Online, the server (and Claude)
 * make the activity as before; this is only the offline path.
 */
import bank, { homework, sources } from 'virtual:activity-bank'
import { db } from '../db'
import { UI_LANGS } from '../i18n'
import { isAscii, isLatinScript, letterCards, textsFor, wordsOf, type BundledText } from './content'
import { clusters } from './graphemes'
import type { Activity, ActivityFocus, ActivityMaterial, ActivityPlan, Cohort } from './types'

type BankEntry = (typeof bank)[number]
type Filled = Record<string, string>

const SHORT_WORDS = 35
const SHORT_LINES = 12
const VIRAMA = new Set([0x094d, 0x09cd, 0x0bcd, 0x0ccd].map((c) => String.fromCharCode(c)))
const TA_NO_START = new Set([...'லளழறனணஙஞட'])
const TA_NO_END = ['க்', 'ச்', 'ஞ்', 'ட்', 'த்', 'ப்', 'ங்', 'ற்']

const isShort = (t: BundledText) => t.lines.join(' ').split(/\s+/).filter(Boolean).length <= SHORT_WORDS && t.lines.length <= SHORT_LINES
const tamilFragment = (w: string) => {
  const code = w.charCodeAt(0)
  return code >= 0x0b80 && code <= 0x0bff && (TA_NO_START.has(w[0]) || TA_NO_END.some((e) => w.endsWith(e)))
}
const simpleWord = (w: string) =>
  isAscii(w) ? w.length >= 2 && w.length <= 5 && /^[a-z]+$/i.test(w) : clusters(w).length >= 2 && clusters(w).length <= 3 && !tamilFragment(w)

/** Words for a Word group: the rhyme's own words to find first, then its other short words, simple ones first. */
function wordsFrom(t: BundledText): ActivityMaterial {
  const tokens = wordsOf(t).map((w) => (isAscii(w) && w !== 'I' ? w.toLowerCase() : w))
  const inner = (w: string) => [...w.slice(0, -1)].some((c) => VIRAMA.has(c))
  const own = t.words_to_find.map((w) => (isAscii(w) ? w.toLowerCase() : w)).filter((w) => tokens.includes(w))
  const plain = tokens.filter((w) => simpleWord(w) && !inner(w))
  const items: string[] = []
  for (const w of [...own, ...plain, ...tokens]) if (simpleWord(w) && !items.includes(w)) items.push(w)
  return { kind: 'words', items: items.slice(0, 8) }
}

function materialFor(a: BankEntry, t: BundledText): ActivityMaterial | null {
  if (a.reads === 'words') {
    const m = wordsFrom(t)
    return m.items.length >= 4 ? m : null
  }
  return null
}

/** The language's text of this kind the group has not read yet, else the one it read longest ago. */
function pickText(lang: string, kind: string, used: string[], fits?: (t: BundledText) => boolean): BundledText | null {
  const pool = textsFor(lang).filter((t) => t.kind === kind && (!fits || fits(t)))
  const fresh = pool.filter((t) => !used.includes(t.id))
  if (fresh.length || !pool.length) return fresh[0] ?? null
  return pool.reduce((a, b) => (used.indexOf(a.id) >= used.indexOf(b.id) ? a : b))
}

function textFor(a: BankEntry, lang: string, cohort: Cohort, used: string[], turn: number): [BundledText | null, ActivityMaterial | null] {
  const kind = a.uses_text as string
  if (a.reads === 'letters') {
    // Letter cards with picture words, no poem; the text only keeps the activity on offer (as on the server).
    const cards = letterCards(lang, turn)
    return [pickText(lang, kind, used), cards.items.length >= 3 ? cards : null]
  }
  if (a.reads === 'words') {
    for (const short of [true, false]) {
      const t = pickText(lang, kind, used, (x) => (!short || isShort(x)) && !!materialFor(a, x))
      if (t) return [t, materialFor(a, t)]
    }
    return [null, null]
  }
  if (cohort === 'paragraph') return [pickText(lang, kind, used, isShort), null]
  if (kind === 'rhyme') return [pickText(lang, kind, used, (x) => !isShort(x)) ?? pickText(lang, kind, used), null]
  return [pickText(lang, kind, used), null]
}

/** Fills {title}, {words}, {letter} and {letters} in every language's text. */
function filler(t: BundledText, m: ActivityMaterial | null): (s: string) => string {
  const first = Array.from(new Set(t.words_to_find.map((w) => (clusters(w)[0] ?? '').toLowerCase()).filter(Boolean)))
  const values: Filled = { title: t.title, words: t.words_to_find.join(', '), letter: first[0] ?? '', letters: first.join(', ') }
  if (m?.kind === 'letters') Object.assign(values, { letter: m.items[0], letters: m.items.join(', '), words: Object.values(m.anchors ?? {}).join(', ') })
  if (m?.kind === 'words') values.words = m.items.join(', ')
  return (s) => s.replace(/\{(title|words|letter|letters)\}/g, (_, k: string) => values[k] ?? '')
}

const perLang = <T,>(v: Record<string, T> | undefined, f: (x: T) => T): Record<string, T> =>
  Object.fromEntries(Object.entries(v ?? {}).filter(([l]) => UI_LANGS.includes(l)).map(([l, x]) => [l, f(x)]))

function plan(a: BankEntry, t: BundledText, m: ActivityMaterial | null): ActivityPlan {
  const fill = filler(t, m)
  const p: ActivityPlan = {
    title: perLang(a.title, fill),
    materials: perLang(a.materials, (list) => list.map(fill)),
    steps: (a.steps ?? []).map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'string' ? fill(v) : v])) as ActivityPlan['steps'][number]),
    practice_words: m ? m.items : t.words_to_find.slice(0, 6),
    watch_for: perLang(a.watch_for, fill),
    why: { en: '' },
  }
  // A Letter group works with letter cards only; a Word group hears the rhyme its words come from.
  if (m?.kind !== 'letters') {
    p.text = {
      id: t.id,
      kind: t.kind,
      title: t.title,
      author: t.author,
      year: t.year ?? null,
      licence: t.licence,
      lines: t.lines,
      words_to_find: t.words_to_find,
      questions: t.questions ?? [],
      source: t.source,
      note: t.note ?? null,
      read_aloud: !!m,
    }
  }
  if (m) p.material = m
  else p.homework = perLang(homework[t.kind], (s) => s.replace('{title}', t.title))
  return p
}

function sourceOf(a: BankEntry): Activity['source'] {
  const ref = a.source?.ref
  const s = ref ? sources[ref] : undefined
  if (!s || !a.source) return null
  const notes = Object.fromEntries(Object.entries(a.source).filter(([k]) => k.startsWith('note')))
  return { name: s.name, url: s.url, note: a.source.note, ...notes }
}

/** The group's recent activities (newest first): which bank entries and which texts it had. */
function recentOf(list: Activity[]) {
  return { activities: list.map((x) => x.source_activity_id), texts: list.map((x) => x.plan.text?.id).filter((x): x is string => !!x) }
}

/** The group as the phone's copy of the class page knows it: how many children, and their mistakes per pattern. */
export interface GroupInfo {
  children: number
  pattern_counts: Record<string, number>
}

/** What the activity is for (as the server's focus_of): the group's most common mistakes and whether it works on them.
 * The letters or words the children misread are known only to the server. */
function focusOf(group: GroupInfo | undefined, a: BankEntry): ActivityFocus | null {
  if (!group) return null
  const ranked = Object.entries(group.pattern_counts)
    .filter(([, n]) => n > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
  const works = new Set(a.patterns ?? [])
  return { children: group.children, patterns: ranked.map(([pattern, children]) => ({ pattern, children, targeted: works.has(pattern) })), misread: [] }
}

/** A 10-minute activity for the group, made on the phone: the book-based activity for its level that works on most
 * of the group's mistakes (`group`, from the class page), not the one it did last time, on the text it has not read
 * yet (or read longest ago). Null if the language has no texts. */
export function makeLocalActivity(cohort: Cohort, lang: string, earlier: Activity[], group?: GroupInfo): Activity | null {
  const recent = recentOf(earlier)
  const script = isLatinScript(lang) ? 'latin' : 'indic'
  const usable = bank.filter((a) => a.uses_text && a.cohorts.includes(cohort) && (a.script ?? script) === script && (a.readers ?? [cohort]).includes(cohort))
  const picked = usable.map((a) => [a, ...textFor(a, lang, cohort, recent.texts, earlier.length)] as const).filter(([x, t, m]) => t && (x.reads !== 'letters' || m))
  const pool = picked.length > 2 ? picked.filter(([a]) => a.id !== recent.activities[0]) : picked
  const counts = group?.pattern_counts ?? {}
  const overlap = (a: BankEntry) => (a.patterns ?? []).reduce((n, p) => n + (counts[p] ?? 0), 0)
  const ranked = [...pool].sort(([x], [y]) => overlap(y) - overlap(x) || Number(!x.script) - Number(!y.script)) // stable, as on the server
  const chosen = ranked[0]
  if (!chosen) return null
  const [a, t, m] = chosen
  const made = plan(a, t as BundledText, m)
  made.focus = focusOf(group, a)
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cohort,
    language: lang,
    source_activity_id: a.id,
    source: sourceOf(a),
    plan: made,
    accepted: false,
    generated_by: 'phone',
    teacher_rating: null,
    created_at: new Date().toISOString(),
  }
}

// The activities made on this phone, kept per class, group and language (newest first).
const key = (classId: string, cohort: string, lang: string) => `local-activities/${classId}/${cohort}/${lang}`

export async function localActivities(classId: string, cohort: string, lang: string): Promise<Activity[]> {
  const row = await db.cache.get(key(classId, cohort, lang)).catch(() => undefined)
  return (row?.value as Activity[] | undefined) ?? []
}

export async function saveLocalActivity(classId: string, a: Activity): Promise<void> {
  const list = await localActivities(classId, a.cohort, a.language)
  const next = [a, ...list.filter((x) => x.id !== a.id)].slice(0, 20)
  await db.cache.put({ key: key(classId, a.cohort, a.language), value: next, updatedAt: Date.now() })
}

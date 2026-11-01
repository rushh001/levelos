/**
 * LM Studio: a local AI model on the teacher's own computer, used when the LevelOS server cannot be reached.
 *
 * LM Studio (https://lmstudio.ai) serves a downloaded model through an OpenAI-compatible API on this computer
 * (default http://localhost:1234; set VITE_LMSTUDIO_URL to change it). With no internet, on a laptop that runs
 * LM Studio, the app picks the group's activity from the book bank as usual (lib/localActivity.ts) and asks the
 * local model to adapt its wording: title, why, steps and what to watch for, in English and the teacher's language.
 * The book text, the letters or words the children read and the homework are never handed over to be rewritten.
 *
 * LM Studio is used only when it answers: it must be running with its local server started and a model loaded
 * (and "Enable CORS" on, as the browser calls it). If it is not running, or does not answer in time, or returns a
 * plan that breaks the rules, the phone-made activity is used instead and labelled as such.
 */
import type { Activity, ActivityPlan } from './types'

const BASE = ((import.meta.env.VITE_LMSTUDIO_URL as string | undefined) ?? 'http://localhost:1234').replace(/\/$/, '')
const CONNECT_MS = 1500
const GENERATE_MS = 150_000

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi', kn: 'Kannada', ta: 'Tamil', bn: 'Bengali' }
// A letter of the teacher's language's script must appear in its text (so English is not passed off as Hindi).
const SCRIPT: Record<string, RegExp> = {
  hi: /[ऀ-ॿ]/,
  mr: /[ऀ-ॿ]/,
  kn: /[ಀ-೿]/,
  ta: /[஀-௿]/,
  bn: /[ঀ-৿]/,
}

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

/** The model LM Studio has loaded, or null when LM Studio is not running here (or has no model loaded). */
export async function lmStudioModel(): Promise<string | null> {
  try {
    const res = await withTimeout(`${BASE}/v1/models`, {}, CONNECT_MS)
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { id: string }[] }
    return body.data?.map((m) => m.id).find((id) => !/embed/i.test(id)) ?? null
  } catch {
    return null
  }
}

interface Adapted {
  title_en: string
  title_local: string
  why_en: string
  why_local: string
  steps: { minutes: number; en: string; local: string }[]
  watch_for_en: string
  watch_for_local: string
}

const str = { type: 'string' }
const SCHEMA = {
  type: 'object',
  properties: {
    title_en: str,
    title_local: str,
    why_en: str,
    why_local: str,
    steps: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: {
        type: 'object',
        properties: { minutes: { type: 'integer' }, en: str, local: str },
        required: ['minutes', 'en', 'local'],
      },
    },
    watch_for_en: str,
    watch_for_local: str,
  },
  required: ['title_en', 'title_local', 'why_en', 'why_local', 'steps', 'watch_for_en', 'watch_for_local'],
}

const READS: Record<string, string> = {
  letters: 'only the single letters listed; never a word, a line or the rhyme (the teacher says the rhyme aloud and the children listen)',
  words: 'only the single words listed, one at a time; never a line or the rhyme (the teacher may say the rhyme aloud)',
  text: 'the text itself',
}

function prompt(a: Activity, local: string): { system: string; user: string } {
  const p = a.plan
  const pickEn = (v: Record<string, string | undefined> | undefined) => v?.en ?? ''
  const reads = p.material?.kind === 'letters' ? 'letters' : p.material?.kind === 'words' ? 'words' : 'text'
  const system = [
    'You adapt one classroom reading activity into a concrete 10-minute plan for a small group of children in an Indian government primary school.',
    'Keep the activity\'s method and its text exactly; adapt only the wording, the examples and the timing. Do not invent a different activity.',
    `The children read ${READS[reads]}.`,
    'Use only the letters or words given as examples. Never rewrite, shorten or translate the text.',
    `Write 3 or 4 short steps whose minutes add up to 10. Each step is one or two plain sentences a teacher can follow while standing in front of the group, in English ("en") and in ${local} ("local", in ${local}'s own script).`,
    `"title" and "watch_for" in English and ${local} too; "why" is one sentence linking the activity to what this group needs.`,
    'No children\'s names, nothing that shames a child. Reply with the JSON object only.',
  ].join('\n')
  const user = JSON.stringify({
    group: { level: a.cohort, reads },
    activity: {
      title: pickEn(p.title),
      materials: p.materials.en ?? [],
      steps: p.steps.map((s) => ({ minutes: s.minutes, text: s.en })),
      watch_for: pickEn(p.watch_for),
    },
    children_read: p.material?.items ?? null,
    text: p.text ? { title: p.text.title, author: p.text.author, lines: p.text.lines.slice(0, 12) } : null,
    teacher_language: local,
  })
  return { system, user }
}

/** The plan's rules, checked in code: 3 or 4 steps of about 10 minutes, every field filled, the teacher's language
 * in its own script. */
function valid(out: Adapted, ui: string): boolean {
  const steps = out.steps ?? []
  const total = steps.reduce((n, s) => n + (Number(s.minutes) || 0), 0)
  const texts = [out.title_en, out.title_local, out.why_en, out.why_local, out.watch_for_en, out.watch_for_local, ...steps.flatMap((s) => [s.en, s.local])]
  if (steps.length < 3 || steps.length > 4 || total < 8 || total > 12) return false
  if (texts.some((t) => typeof t !== 'string' || !t.trim())) return false
  const script = SCRIPT[ui]
  return !script || [out.title_local, ...steps.map((s) => s.local)].every((t) => script.test(t))
}

function parse(content: string): Adapted | null {
  const json = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(json) as Adapted
  } catch {
    return null
  }
}

/**
 * The activity adapted by LM Studio's model, or null (not running, too slow, or a plan that breaks the rules: the
 * caller then keeps the phone-made one). `base` is the phone-made activity; `ui` the teacher's language.
 */
export async function adaptWithLmStudio(model: string, base: Activity, ui: string): Promise<Activity | null> {
  const local = LANGUAGE_NAMES[ui] ?? 'English'
  const { system, user } = prompt(base, local)
  let content: string
  try {
    const res = await withTimeout(
      `${BASE}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.4,
          max_tokens: 1500,
          response_format: { type: 'json_schema', json_schema: { name: 'activity_plan', strict: true, schema: SCHEMA } },
        }),
      },
      GENERATE_MS,
    )
    if (!res.ok) return null
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    content = body.choices?.[0]?.message?.content ?? ''
  } catch {
    return null
  }
  const out = parse(content)
  if (!out || !valid(out, ui)) return null
  const two = (en: string, loc: string) => (ui === 'en' ? { en } : { en, [ui]: loc })
  const plan: ActivityPlan = {
    ...base.plan, // the text, the letters or words, the homework and the materials stay as the bank has them
    title: two(out.title_en.trim(), out.title_local.trim()),
    why: two(out.why_en.trim(), out.why_local.trim()),
    steps: out.steps.map((s) => ({ minutes: Math.round(Number(s.minutes)), ...two(s.en.trim(), s.local.trim()) })),
    watch_for: two(out.watch_for_en.trim(), out.watch_for_local.trim()),
  }
  return { ...base, plan, generated_by: `lmstudio:${model}` }
}

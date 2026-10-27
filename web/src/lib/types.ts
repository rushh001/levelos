export type Level = 'beginner' | 'letter' | 'word' | 'paragraph' | 'story'
export type ItemLevel = Exclude<Level, 'beginner'>
export type Cohort = 'letter' | 'word' | 'paragraph'
/** Text in English and the teacher's language ({en, hi} for a Hindi class, {en, kn} for a Kannada one). */
export type Bilingual = Partial<Record<string, string>>

export interface Teacher {
  id: string
  login: string
  name: string
  ui_lang: string
}

/** A child's level and group in one reading test (language). */
export interface LangLevel {
  provisional_level: Level | null
  confirmed_level: Level | null
  level: Level | null
  level_confirmed: boolean
  cohort: Cohort | null
  cohort_override: Cohort | null
}

/** Top-level level fields describe `language`; `levels` has every reading test the child takes. */
export interface StudentSummary extends LangLevel {
  id: string
  first_name: string
  names?: Record<string, string> // the name per interface language, when given (Meena / मीना)
  avatar: string
  grade: number
  home_lang: string | null
  assessment_language: string
  language: string
  languages: string[]
  levels: Record<string, LangLevel>
  checkins: number
  last_checkin_at: string | null
  pending_review: boolean
  review_checkin_id: string | null // the reading check waiting for the teacher's confirmation
  patterns: string[]
}

export interface ClassSummary {
  id: string
  name: string
  names?: Record<string, string>
  grade: number
  language: string
  languages: string[]
  students_count: number
  students?: StudentSummary[]
}

export interface ItemPublic {
  id: string
  lang: string
  level: ItemLevel
  units: string[] | null
  sentences: string[] | null
  title: string | null
  instructions: Bilingual
}

export interface Word {
  i: number
  ref: string
  label: 'correct' | 'self_correct' | 'sub' | 'omit'
  uncertain: boolean
  heard: Record<string, string | null>
  labels: Record<string, string>
  pa: { accuracy: number | null; error_type: string | null } | null
  start_ms: number | null
  end_ms: number | null
  teacher_correct: boolean | null
}

export interface ItemScore {
  item_id: string
  level: ItemLevel
  lang: string
  status: 'scored' | 'rerecord' | 'failed'
  reason: string | null
  duration_ms: number
  reading_ms: number | null
  words: Word[]
  extras: { hyp: string; label: string }[]
  counts: { total: number; correct: number; errors: number; self_corrections: number; uncertain: number; uncertain_open: number }
  hesitations: number | null
  wcpm: number | null
  passed: boolean | null
  passed_best: boolean | null
  passed_worst: boolean | null
  needs_review: boolean
  primary: string | null
  ai_scored?: boolean
}

export interface ItemResult {
  id: string
  position: number
  item_id: string
  item_level: ItemLevel
  source: 'ai' | 'offline_marks'
  passed: boolean | null
  needs_review: boolean
  /** A recording is kept on the server for the teacher to listen again. */
  has_audio: boolean
  result: ItemScore
  /** The picture step after a word card: which words the child knew the meaning of. Never part of the level. */
  meaning: MeaningAnswer[] | null
}

export interface MeaningAnswer {
  word: string
  correct: boolean
}

export interface Evidence {
  pattern: string
  item_id: string
  words: { i: number; ref: string; heard: string | null }[]
  note_en: string
  [note: `note_${string}`]: string | undefined // in the teacher's language: note_hi, note_kn, …
}

export interface Diagnosis {
  error_patterns: string[]
  evidence: Evidence[]
  summary: Bilingual
  confidence: 'low' | 'medium' | 'high'
  model: string
  created_at: string
}

export type CheckinStatus = 'in_progress' | 'needs_review' | 'scored' | 'abandoned'

export interface Checkin {
  id: string
  student_id: string
  local_id: string | null
  language: string
  status: CheckinStatus
  source: 'ai' | 'offline_marks'
  start_level: ItemLevel
  level_suggested: Level | null
  level_final: Level | null
  teacher_overrode: boolean
  started_at: string
  scored_at: string | null
  items: ItemResult[]
  awaiting_review: boolean
  next_item: ItemPublic | null
  diagnosis: Diagnosis | null
}

export interface UploadResult {
  status: 'scored' | 'rerecord' | 'failed'
  reason: string | null
  item_result: ItemResult | null
  checkin: Checkin
}

export interface CohortCard {
  cohort: Cohort
  students: StudentSummary[]
  confirmed: number
  dominant_patterns: string[]
  pattern_counts: Record<string, number>
}

export interface Dashboard {
  class: ClassSummary
  language: string
  cohorts: CohortCard[]
  not_assessed: StudentSummary[]
  pending_review: string[]
}

export interface StudentDetail extends StudentSummary {
  class_id: string
  checkins_list: Checkin[]
  level_history: { at: string; provisional: Level | null; confirmed: Level | null; source: string; checkin_id: string | null }[]
}

export interface Health {
  ok: boolean
  languages: string[]
  claude: boolean
  speech_paths: Record<string, boolean>
  audio_retention_days?: number
  claude_budget?: { available: boolean }
}

export interface ActivityPlan {
  title: Bilingual
  materials: Partial<Record<string, string[]>>
  steps: { minutes: number; en: string; [lang: string]: string | number }[]
  practice_words: string[]
  watch_for: Bilingual
  why: Bilingual
}

export interface Activity {
  id: string
  cohort: Cohort
  language: string
  source_activity_id: string
  source: { name: string; url: string; note: string; [note: `note_${string}`]: string | undefined } | null
  plan: ActivityPlan
  accepted: boolean
  generated_by: string
  teacher_rating: number | null
  created_at: string
}

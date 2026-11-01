/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The slice of content/activities/bank.json the app uses, served by the plugin in vite.config.ts: every entry's
 * id, title, cohorts, script and examples, the whole of the book-based entries, the homework and the sources. */
declare module 'virtual:activity-bank' {
  type ByLang = Record<string, string>
  const activities: {
    id: string
    title: ByLang
    cohorts: string[]
    script?: string
    examples?: Record<string, Record<string, string | Record<string, string>>>
    uses_text?: 'rhyme' | 'story'
    reads?: 'letters' | 'words' | 'text'
    readers?: string[]
    patterns?: string[]
    minutes?: number
    materials?: Record<string, string[]>
    steps?: { minutes: number; [lang: string]: string | number }[]
    watch_for?: ByLang
    source?: { ref: string; note: string } & Record<string, string>
  }[]
  export default activities
  export const homework: Record<'rhyme' | 'story', ByLang>
  export const sources: Record<string, { name: string; url: string }>
}

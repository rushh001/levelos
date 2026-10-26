/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The slice of content/activities/bank.json the app uses, served by the plugin in vite.config.ts. */
declare module 'virtual:activity-bank' {
  const activities: {
    id: string
    title: Record<string, string>
    cohorts: string[]
    script?: string
    examples?: Record<string, Record<string, string | Record<string, string>>>
  }[]
  export default activities
}

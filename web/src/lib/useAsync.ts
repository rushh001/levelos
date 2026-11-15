import { useCallback, useEffect, useRef, useState } from 'react'
import { SYNCED_EVENT } from '../api'

/** Load data on mount (and when `deps` change); `reload` re-runs it. `refreshOnSync`: also re-runs when changes
 * kept on the phone reach the server, so the page shows the server's copy without the teacher reloading. Only for
 * plain reads. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { refreshOnSync?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const value = await fnRef.current()
      setData(value)
      setError(null)
      return value
    } catch (e) {
      setError(e as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const refreshOnSync = !!opts.refreshOnSync
  useEffect(() => {
    if (!refreshOnSync) return
    const on = () => void reload()
    window.addEventListener(SYNCED_EVENT, on)
    return () => window.removeEventListener(SYNCED_EVENT, on)
  }, [refreshOnSync, reload])

  return { data, setData, error, loading, reload }
}

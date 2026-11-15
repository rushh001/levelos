import { useCallback, useEffect, useRef, useState } from 'react'
import { FRESH_EVENT, SYNCED_EVENT } from '../api'

/** Load data on mount (and when `deps` change); `reload` re-runs it. `refreshOnSync`: also re-runs when changes
 * kept on the phone reach the server, or a slow server answer arrives after the page was shown from the phone's
 * copy, so the page shows the server's copy without the teacher reloading. Only for plain reads. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { refreshOnSync?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    try {
      const value = await fnRef.current()
      if (request === sequence.current) {
        setData(value)
        setError(null)
      }
      return value
    } catch (e) {
      if (request === sequence.current) setError(e as Error)
      return null
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => { ++sequence.current }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const refreshOnSync = !!opts.refreshOnSync
  useEffect(() => {
    if (!refreshOnSync) return
    const on = () => void reload()
    // Also when a slow server answer comes after the page was shown from the phone's copy (a quiet refresh: the
    // read that follows finds the newer copy on the phone).
    window.addEventListener(SYNCED_EVENT, on)
    window.addEventListener(FRESH_EVENT, on)
    return () => {
      window.removeEventListener(SYNCED_EVENT, on)
      window.removeEventListener(FRESH_EVENT, on)
    }
  }, [refreshOnSync, reload])

  return { data, setData, error, loading, reload }
}

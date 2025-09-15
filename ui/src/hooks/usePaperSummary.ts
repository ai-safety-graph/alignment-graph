import { useEffect, useState } from 'react'
import { getSummaryByUrl, type Summary } from '../lib/summaries'

export function usePaperSummary(url?: string) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!url) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    getSummaryByUrl(url)
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? 'Failed')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return { data, loading, error }
}

export type Summary = {
  sm: string
  t: string
  au: string
  pd: string
  ln: string
  dm: string
  cid: number
}
type SummariesJson = { summaries: Record<string, Summary> }

let cache: Map<string, Summary> | null = null
let inflight: Promise<Map<string, Summary>> | null = null

const canon = (url: string) => {
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    return u.toString()
  } catch {
    return url
  }
}

async function loadMap(): Promise<Map<string, Summary>> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetch('/summaries.json', { cache: 'force-cache' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load summaries.json: ${r.status}`)
        const json = (await r.json()) as SummariesJson
        const m = new Map<string, Summary>()
        for (const [k, v] of Object.entries(json.summaries)) {
          m.set(canon(k), v)
          if (v?.ln) m.set(canon(v.ln), v) // index by ln too
        }
        cache = m
        return m
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export async function getSummaryByUrl(url?: string | null) {
  if (!url) return null
  const m = await loadMap()
  return m.get(canon(url)) ?? null
}

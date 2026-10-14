// Cookieless, anonymous product analytics via Umami Cloud.
//
// Loaded only in production builds with VITE_UMAMI_WEBSITE_ID set, and
// `data-domains` keeps deploy previews and localhost out of the stats.
// Umami tracks route changes itself; `track` sends custom events. Never pass
// query text or anything user-identifying -- search terms are logged
// server-side instead (api/search_log.py).

const UMAMI_SRC = 'https://cloud.umami.is/script.js'
const UMAMI_DOMAINS = 'alignmentgraph.com'

type EventData = Record<string, string | number | boolean>

declare global {
  interface Window {
    umami?: { track: (event: string, data?: EventData) => void }
  }
}

export function initAnalytics(
  websiteId: string | undefined = import.meta.env.VITE_UMAMI_WEBSITE_ID,
  enabled: boolean = import.meta.env.PROD,
) {
  if (!enabled || !websiteId) return
  const script = document.createElement('script')
  script.defer = true
  script.src = UMAMI_SRC
  script.dataset.websiteId = websiteId
  script.dataset.domains = UMAMI_DOMAINS
  document.head.appendChild(script)
}

export function track(event: string, data?: EventData) {
  try {
    window.umami?.track(event, data)
  } catch {
    // analytics must never break the app
  }
}

import { fetchPaper } from './api'

export type Summary = {
  sm: string
  t: string
  au: string
  pd: string
  ln: string
  dm: string
  cid: number
}

export async function getSummaryByUrl(
  url?: string | null,
): Promise<Summary | null> {
  if (!url) return null

  const paper = await fetchPaper(url)
  if (!paper) return null
  return {
    sm: paper.sm ?? '',
    t: paper.t,
    au: paper.au,
    pd: paper.pd,
    ln: paper.ln,
    dm: paper.dm,
    cid: paper.cid,
  }
}

const DOMAIN_LABELS: Record<string, string> = {
  gov: 'governance',
  tech: 'technology',
  both: 'gov/tech',
  unknown: 'unknown',
}

export function domainLabel(dm: string): string {
  return DOMAIN_LABELS[dm] ?? dm
}

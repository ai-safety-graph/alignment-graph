const DOMAIN_LABELS: Record<string, string> = {
  gov: 'Government',
  tech: 'Technical',
  both: 'Gov/Tech',
  unknown: 'Unknown',
}

export function domainLabel(dm: string): string {
  return DOMAIN_LABELS[dm] ?? dm
}

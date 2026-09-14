function stringHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function tagToColor(tag: string): string {
  const hue = (stringHash(tag) * 137.508) % 360
  return `hsl(${hue}, 65%, 55%)`
}

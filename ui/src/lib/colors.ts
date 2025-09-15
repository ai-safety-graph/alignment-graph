export function cidToColor(cid: number): string {
  const hue = (cid * 137.508) % 360
  return `hsl(${hue}, 65%, 55%)`
}

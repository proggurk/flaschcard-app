const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// "10 min", "3 d", "2 mo", "1.5 yr"
export function formatInterval(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`
  const days = Math.round(ms / DAY)
  if (days < 30) return `${days} d`
  if (days < 365) return `${Math.round(days / 30)} mo`
  return `${(days / 365).toFixed(1)} yr`
}

export function formatWhen(timestamp: number): string {
  const ms = timestamp - Date.now()
  return ms <= 0 ? 'now' : `in ${formatInterval(ms)}`
}

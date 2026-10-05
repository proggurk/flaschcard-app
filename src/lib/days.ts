// Like Anki, a "study day" starts at 4 am, so a late-night session still
// counts towards the day you started it.
export const DAY_STARTS_AT_HOUR = 4
export const DAY_MS = 24 * 60 * 60 * 1000

export function studyDayStart(t: number): number {
  const d = new Date(t)
  if (d.getHours() < DAY_STARTS_AT_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(DAY_STARTS_AT_HOUR, 0, 0, 0)
  return d.getTime()
}

// "2026-10-04": which study day a timestamp belongs to (local time)
export function studyDayKey(t: number): string {
  const d = new Date(studyDayStart(t))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Start of the study day `n` days before the one containing `t`
// (going via noon so daylight-saving changes can't skip or repeat a day)
export function studyDayStartDaysAgo(t: number, n: number): number {
  return studyDayStart(studyDayStart(t) + 12 * 60 * 60 * 1000 - n * DAY_MS)
}

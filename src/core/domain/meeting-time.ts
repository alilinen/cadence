import { isValidTimeZone, resolveWallClock } from '../time/zone.js'

export function meetingTime(value: string, timezone: string): { start?: number; error?: string } {
  if (!isValidTimeZone(timezone)) return { error: 'Choose a valid timezone, such as Europe/London.' }
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!parts) return { error: 'Choose a date and time.' }
  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [number, number, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59) {
    return { error: 'Choose a valid date and time.' }
  }
  const result = resolveWallClock({ year, month, day, hour, minute, second: 0 }, timezone)
  if (result.kind !== 'normal') return { error: 'The clocks change at that time. Choose a time outside the clock change.' }
  return { start: result.instant }
}

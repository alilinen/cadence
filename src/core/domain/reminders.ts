export interface ReminderRule {
  minutes: number
  audience: 'guests' | 'hosts' | 'both'
  subject?: string
  message?: string
}

export const DEFAULT_REMINDERS: ReminderRule[] = [
  { minutes: 1440, audience: 'both' },
  { minutes: 60, audience: 'both' },
]

export const MAX_REMINDERS = 6
export const MAX_REMINDER_MINUTES = 30 * 24 * 60
export const REMINDER_FIELDS = ['guest', 'host', 'event', 'date', 'time', 'meeting_link'] as const

export function reminderLead(minutes: number): string {
  for (const [size, unit] of [[1440, 'day'], [60, 'hour'], [1, 'minute']] as const) {
    if (minutes % size === 0) {
      const count = minutes / size
      return `${count} ${unit}${count === 1 ? '' : 's'}`
    }
  }
  throw new Error('Invalid reminder time')
}

export function reminderError(rules: ReminderRule[]): string | null {
  if (rules.length > MAX_REMINDERS) return `Choose up to ${MAX_REMINDERS} reminders.`
  const times = new Set<number>()
  for (const rule of rules) {
    if (!Number.isInteger(rule.minutes) || rule.minutes < 5 || rule.minutes > MAX_REMINDER_MINUTES) return 'Choose a lead time between 5 minutes and 30 days.'
    if (!['guests', 'hosts', 'both'].includes(rule.audience)) return 'Choose who should receive each reminder.'
    if (times.has(rule.minutes)) return 'Choose a different time for each reminder.'
    times.add(rule.minutes)
    if ((rule.subject?.length ?? 0) > 180 || /[\r\n]/.test(rule.subject ?? '')) return 'Keep the subject on one line, up to 180 characters.'
    if ((rule.message?.length ?? 0) > 2000) return 'Keep the message within 2,000 characters.'
    for (const match of `${rule.subject ?? ''} ${rule.message ?? ''}`.matchAll(/\{([^{}]+)\}/g)) {
      if (!REMINDER_FIELDS.some(field => field === match[1])) return `Unknown placeholder ${match[0]}.`
    }
  }
  return null
}

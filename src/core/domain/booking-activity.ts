// These tokens are part of the original idempotency key, including the spelling of reminder intervals.
// Queued jobs and encrypted retry envelopes reference that key for the lifetime of the booking.
const originalIdentity = {
  'confirmation': 'Confirmation',
  'reschedule': 'Reschedule',
  'cancellation': 'Cancellation',
  'participants.updated': 'Participants updated',
  'participant.removed': 'Participant removed',
  'host.added': 'Host added',
  'host.removed': 'Host removed',
  'calendar.create': 'Calendar create',
  'calendar.update': 'Calendar update',
  'calendar.delete': 'Calendar delete',
  'calendar.join_link': 'Calendar join link',
  'availability.check': 'Availability check',
} as const

type ReminderOperation = `reminder.${number}m` | 'reminder.1h' | 'reminder.24h'
export type ActivityOperation = keyof typeof originalIdentity | ReminderOperation
export type ActivityRole = 'Booker' | 'Guest' | 'Host' | 'Former guest' | 'Organizer'

export function reminderOperation(lead: number | '1h' | '24h'): ReminderOperation {
  return typeof lead === 'number' ? `reminder.${lead}m` : `reminder.${lead}`
}

export function isReminder(operation: ActivityOperation): operation is ReminderOperation {
  return operation.startsWith('reminder.')
}

export function reminderMinutes(operation: ActivityOperation | 'unknown'): number | undefined {
  if (operation === 'unknown' || !isReminder(operation)) return undefined
  const amount = Number(operation.slice('reminder.'.length,-1))
  return operation.endsWith('h') ? amount * 60 : amount
}

export function activityIdentity(operation: ActivityOperation): string {
  if (!isReminder(operation)) return originalIdentity[operation]
  const lead = operation.slice('reminder.'.length)
  return 'Reminder (' + (lead.endsWith('m') ? lead.slice(0,-1) + ' min' : lead) + ')'
}

export function isCalendarWrite(operation: ActivityOperation | 'unknown'): boolean {
  return operation === 'calendar.create' || operation === 'calendar.update' || operation === 'calendar.delete'
}

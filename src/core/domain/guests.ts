import { isValidEmail } from './booking-service.js'
import type { Booking } from './types.js'

export const MAX_ADDITIONAL_GUESTS = 10

/** The same validation applies to public forms, API clients and host-created meetings. */
export function parseAdditionalGuests(value: unknown, primaryEmail: string): { emails: string[]; error?: string } {
  const values = typeof value === 'string' ? value.split(/[\n,;]+/).filter((v) => v.trim()) : value ?? []
  if (!Array.isArray(values) || values.length > MAX_ADDITIONAL_GUESTS) {
    return { emails: [], error: `Add up to ${MAX_ADDITIONAL_GUESTS} guests.` }
  }
  if (values.some((v) => typeof v !== 'string' || !isValidEmail(v.trim()))) {
    return { emails: [], error: 'Enter a valid email for each guest, separated by commas or new lines.' }
  }
  return { emails: [...new Set((values as string[]).map((v) => v.trim().toLowerCase()))].filter((v) => v !== primaryEmail.trim().toLowerCase()) }
}

export function bookingGuests(booking: Booking): Array<{ email: string; name: string }> {
  return [
    { email: booking.guestEmail, name: booking.guestName },
    ...(booking.additionalGuests ?? []).map((email) => ({ email, name: email })),
  ]
}

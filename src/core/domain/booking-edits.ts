import { queueCalendarSync } from '../../adapters/queue/consumer.js'
import type { Booking, EventType, User } from './types.js'
import type { BookingRevision, EnginePorts, Repositories } from '../../ports.js'
import { bookingFootprint } from '../slots/engine.js'
import { intervalToBuckets } from '../slots/intervals.js'
import { localDateString } from '../time/zone.js'
import { canManageTeam } from './teams.js'
import { parseAdditionalGuests } from './guests.js'
import { notifyBookingParticipantsChanged } from '../../adapters/notify.js'
import { isValidEmail } from './booking-service.js'
import { issueManageToken } from './auth-flows.js'

/** Shared transaction for dashboard edits and changes read from the organizer's calendar. */
export async function applyBookingRevision(
  ports: EnginePorts, repos: Repositories, booking: Booking, eventType: EventType,
  patch: Pick<BookingRevision, 'startUtc' | 'endUtc' | 'additionalGuests' | 'status'> &
    Pick<BookingRevision, 'guestName' | 'guestEmail' | 'manageTokenHash'>,
): Promise<Booking | null> {
  const host = await repos.users.byId(booking.hostUserId)
  if (!host || !Number.isFinite(patch.startUtc) || !Number.isFinite(patch.endUtc) ||
      patch.endUtc <= patch.startUtc || patch.endUtc - patch.startUtc > 86_400_000) return null
  const hostIds = booking.hostUserIds.length ? booking.hostUserIds : [booking.hostUserId]
  const footprint = bookingFootprint(patch.startUtc, patch.endUtc, eventType)
  const buckets = patch.status === 'cancelled' ? [] : hostIds.flatMap((hostUserId) =>
    intervalToBuckets(footprint).map((bucketStart) => ({ hostUserId, bucketStart })))
  return repos.bookings.revise(booking.id, booking.revision ?? 0, ports.crypto.randomToken(24), {
    ...patch, localDate: localDateString(patch.startUtc, host.tz),
    cancelledAt: patch.status === 'cancelled' ? ports.clock.now() : null,
  }, buckets)
}

export async function editBookingGuests(
  ports: EnginePorts, repos: Repositories, actor: User,
  input: { bookingId: string; revision: number; guests?: unknown; booker?: { name: unknown; email: unknown }; notify?: 'all' | 'new' },
): Promise<{ ok: true; booking: Booking } | { ok: false; error: string }> {
  const booking = await repos.bookings.byId(input.bookingId)
  const fail = (error: string) => ({ ok: false as const, error })
  if (!booking) return fail('Booking not found.')
  const eventType = await repos.eventTypes.byId(booking.eventTypeId)
  const membership = eventType?.ownerTeamId
    ? (await repos.teams.memberships(actor.id)).find((m) => m.teamId === eventType.ownerTeamId) ?? null : null
  if (!booking.hostUserIds.includes(actor.id) && booking.hostUserId !== actor.id &&
      !(eventType?.ownerTeamId && canManageTeam(actor, membership))) return fail('Booking not found.')
  if (!eventType || booking.status !== 'confirmed' || booking.startUtc <= ports.clock.now()) {
    return fail('Guests can only be edited on an upcoming confirmed booking.')
  }
  if (input.revision !== (booking.revision ?? 0)) return fail('This booking changed. Reload it before editing guests.')
  const name = input.booker ? (typeof input.booker.name === 'string' ? input.booker.name.trim() : '') : booking.guestName
  const email = input.booker ? (typeof input.booker.email === 'string' ? input.booker.email.trim().toLowerCase() : '') : booking.guestEmail
  if (!name || name.length > 200) return fail('Enter a booker name of up to 200 characters.')
  if (!isValidEmail(email)) return fail('Enter a valid booker email address.')
  const parsed = parseAdditionalGuests(input.guests ?? booking.additionalGuests, email)
  if (parsed.error) return fail(parsed.error)
  const hostEmails = new Set<string>()
  for (const id of new Set([booking.hostUserId, ...booking.hostUserIds])) {
    const h = await repos.users.byId(id)
    if (h) hostEmails.add(h.email.toLowerCase())
  }
  if ((email !== booking.guestEmail && hostEmails.has(email.toLowerCase())) || parsed.emails.some((email) => hostEmails.has(email))) return fail('That person is already a host. Use the host controls to change their attendance.')
  const before = [...(booking.additionalGuests ?? [])].sort()
  if (name === booking.guestName && email === booking.guestEmail && JSON.stringify(before) === JSON.stringify([...parsed.emails].sort())) return { ok: true, booking }
  const issued = email !== booking.guestEmail ? await issueManageToken({ crypto: ports.crypto }, booking, 'manage') : undefined
  const updated = await applyBookingRevision(ports, repos, booking, eventType, {
    startUtc: booking.startUtc, endUtc: booking.endUtc, additionalGuests: parsed.emails, status: 'confirmed',
    guestName: name, guestEmail: email, ...(issued ? { manageTokenHash: issued.tokenHash } : {}),
  })
  if (!updated) return fail('This booking changed or its time is no longer available. Reload and try again.')
  await queueCalendarSync(ports, { kind: 'calendar.sync', bookingId: booking.id, action: 'update' }).catch(error => console.error('[cadence] calendar update failed to queue',error))
  const host = await repos.users.byId(updated.hostUserId)
  if (host) await notifyBookingParticipantsChanged({ ports, booking: updated, previous: booking, eventType, host,
    notify: input.booker ? 'all' : input.notify,
    ...(issued ? { manageToken: issued.token } : {}) })
  return { ok: true, booking: updated }
}

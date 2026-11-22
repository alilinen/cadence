import { queueCalendarSync } from './queue/consumer.js'
import type { Booking, CalendarConnection } from '../core/domain/types.js'
import type { EnginePorts, Repositories } from '../ports.js'
import { applyBookingRevision } from '../core/domain/booking-edits.js'
import { parseAdditionalGuests } from '../core/domain/guests.js'
import { needsReconnect } from './oauth.js'
import { notifyWebhooks } from './notify.js'

/** Only stored organizer events are considered; unrelated calendar events are never imported. */
export async function reconcileGoogleBooking(ports: EnginePorts, repos: Repositories, booking: Booking): Promise<void> {
  const stored: Array<{ conn: CalendarConnection; eventId: string }> = []
  for (const [id, eventId] of Object.entries(booking.externalEventIds)) {
    const conn = await repos.connections.byId(id)
    if (conn?.provider === 'google' && conn.calendarIdWrite) stored.push({ conn, eventId })
  }
  // Same anchor as outbound updates: the current organizer's stored event, or the first retained one.
  const primary = stored.find((s) => s.conn.userId === booking.hostUserId) ?? stored[0]
  if (!primary) return
  const { conn, eventId } = primary
  try {
    if ((booking.calendarSyncRevision ?? 0) !== (booking.revision ?? 0)) {
      // A dashboard edit awaiting its write must never be reverted by Google's older copy.
      await queueCalendarSync(ports, { kind: 'calendar.sync', bookingId: booking.id, action: 'update' })
      return
    }
    const provider = ports.calendars.get('google')
    if (!provider.getEvent) return
    const remote = await provider.getEvent(conn, eventId)
    if (!remote.organizer) throw new Error('The linked event is no longer owned by this calendar. Review it in Google Calendar.')
    const eventType = await repos.eventTypes.byId(booking.eventTypeId)
    if (!eventType) return
    const excluded = new Set<string>([booking.guestEmail.toLowerCase()])
    const explicitGuests = new Set((booking.additionalGuests ?? []).map((email) => email.toLowerCase()))
    for (const id of new Set([booking.hostUserId, ...booking.hostUserIds])) {
      const host = await repos.users.byId(id)
      if (host) excluded.add(host.email.toLowerCase())
      for (const connection of await repos.connections.listForUser(id)) {
        if (connection.providerAccountEmail && !explicitGuests.has(connection.providerAccountEmail.toLowerCase())) excluded.add(connection.providerAccountEmail.toLowerCase())
      }
    }
    if (conn.providerAccountEmail && !explicitGuests.has(conn.providerAccountEmail.toLowerCase())) excluded.add(conn.providerAccountEmail.toLowerCase())
    const parsed = parseAdditionalGuests(remote.guests?.filter((g) => !excluded.has(g.toLowerCase())), booking.guestEmail)
    if (!remote.cancelled && parsed.error) throw new Error(parsed.error)
    // Removing the original booker is a different operation from editing additional guests.
    if (!remote.cancelled && !remote.guests?.some((g) => g.toLowerCase() === booking.guestEmail.toLowerCase())) {
      throw new Error('The original booker is missing from Google Calendar. Restore them there or cancel this booking.')
    }
    const start = remote.start ?? booking.startUtc
    const end = remote.end ?? booking.endUtc
    const guests = remote.cancelled ? booking.additionalGuests ?? [] : parsed.emails
    const sameGuests = JSON.stringify([...guests].sort()) === JSON.stringify([...(booking.additionalGuests ?? [])].sort())
    if (!remote.cancelled && start === booking.startUtc && end === booking.endUtc && sameGuests) return
    const updated = await applyBookingRevision(ports, repos, booking, eventType, {
      startUtc: start, endUtc: end, additionalGuests: guests, status: remote.cancelled ? 'cancelled' : 'confirmed',
    })
    if (!updated) throw new Error(`Google Calendar changed this meeting to ${new Date(start).toISOString()}, but the change conflicts with another booking or a newer edit. Resolve the conflict and sync again.`)
    await queueCalendarSync(ports, { kind: 'calendar.sync', bookingId: booking.id, action: remote.cancelled ? 'delete' : 'update' })
    // Google owns notifications for edits made there; importing must not send another ICS invitation.
    await notifyWebhooks(ports, remote.cancelled ? 'booking.cancelled' : 'booking.rescheduled', updated, eventType, { source: 'google_calendar' })
  } catch (err) {
    if (needsReconnect(err)) await repos.connections.updateSyncStatus(conn.id, 'needs_reconnect')
    throw err
  }
}

export async function reconcileGoogleCalendars(ports: EnginePorts, now: number): Promise<void> {
  const repos = ports.repositories({ consistency: 'bookmark' })
  // Fair oldest-checked order bounds each tick without starving later bookings.
  for (const booking of await repos.bookings.forCalendarSync(50)) {
    let error: string | null = null
    try { await reconcileGoogleBooking(ports, repos, booking) }
    catch (err) {
      console.error('[cadence] Google booking reconciliation failed', booking.id, err)
      error = err instanceof Error ? err.message.slice(0, 500) : 'Google Calendar could not be checked. Try again later.'
    }
    await repos.bookings.recordCalendarCheck(booking.id, now, error)
  }
}

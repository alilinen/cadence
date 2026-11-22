/**
 * Cron work: reminders, hold expiry, lock pruning, telemetry.
 *
 * Runs every 5 minutes. Each task is independent and failure-isolated —
 * a telemetry ping that cannot reach the internet must not stop reminders
 * going out.
 */

import { emailBranding } from '../core/domain/branding.js'
import { reconcileGoogleCalendars } from './calendar-reconcile.js'
import type { EnginePorts } from '../ports.js'
import type { Booking, EventType, User } from '../core/domain/types.js'

const DAY = 86_400_000

export async function runScheduledTasks(ports: EnginePorts, now: number): Promise<void> {
  // Reconcile before reminders so an external move cannot send an old-time reminder.
  await reconcileGoogleCalendars(ports, now).catch((err) => console.error('[cadence] calendar reconciliation failed', err))
  const tasks: Array<[string, Promise<unknown>]> = [
    ['expire-holds', expireHolds(ports, now)],
    ['prune-locks', pruneLocks(ports, now)],
    ['reminders', sendReminders(ports, now)],
    ['digests', sendDigests(ports, now)],
  ]
  const activity = ports.repositories({consistency:'bookmark'}).activity
  if (activity) tasks.push(['expire-activity-claims', activity.expireClaims(now - 30 * 60_000, now)])
  if (ports.config.telemetryEnabled) tasks.push(['telemetry', sendTelemetry(ports, now)])

  for (const [name, task] of tasks) {
    try {
      await task
    } catch (err) {
      console.error(`[cadence] scheduled task ${name} failed`, err)
    }
  }
}

/**
 * Sweep expired holds.
 *
 * Belt and braces: holds are already filtered on read by `expires_at > now`,
 * and each DO clears its own via alarm. This catches rows whose DO alarm was
 * lost, so the table cannot grow without bound.
 */
async function expireHolds(ports: EnginePorts, now: number): Promise<void> {
  const repos = ports.repositories({ consistency: 'bookmark' })
  await repos.slotLocks.expireHolds(now)
}

/**
 * Prune slot_locks for past bookings.
 *
 * A 7-day trailing window is kept deliberately: locks are the record of what
 * occupied a calendar, and having a week of history makes "why was I not
 * offered that slot?" answerable.
 */
async function pruneLocks(ports: EnginePorts, now: number): Promise<void> {
  const repos = ports.repositories({ consistency: 'bookmark' })
  await repos.slotLocks.pruneLocksBefore(now - 7 * DAY)
}

/** Queue references only. Delivery checks the current time, rule and recipients again. */
export async function sendReminders(ports: EnginePorts, now: number): Promise<void> {
  const repos = ports.repositories({ consistency: 'bookmark' })
  const due = await repos.bookings.dueReminders(now)
  for (const job of due) {
    // The Cadence deployment delivers inline. A failed recipient must not block other meetings.
    try { await ports.queue.send({ kind: 'reminder', ...job }) }
    catch (error) { console.error('[cadence] reminder dispatch failed', job.bookingId, error) }
  }
}

/**
 * The morning digest (core/domain/digest.ts): for each host who opted in
 * and is due right now, today's confirmed meetings in their timezone.
 * The day is marked sent before the email is built, so an overlapping or
 * repeated tick sends nothing more; an empty day is marked too and sends
 * nothing at all.
 */
export async function sendDigests(ports: EnginePorts, now: number): Promise<void> {
  const repos = ports.repositories({ consistency: 'bookmark' })
  const { dailyDigestEmail } = await import('../core/email-templates.js')
  const { digestBookings, digestDue, digestRange } = await import('../core/domain/digest.js')
  for (const host of await repos.users.listDigestRecipients()) {
    const date = digestDue(host, now)
    if (!date) continue
    // One conditional UPDATE is the claim: an overlapping tick that reads
    // the same row loses here and sends nothing (caught by review).
    if (!(await repos.users.claimDigest(host.id, date))) continue
    const range = digestRange(date, host.tz)
    const todays = digestBookings(await repos.bookings.listForHost(host.id, range), range)
    if (todays.length === 0) continue
    const meetings: Array<{ booking: Booking; eventType: EventType; coHosts: User[] }> = []
    for (const booking of todays) {
      const eventType = await repos.eventTypes.byId(booking.eventTypeId)
      if (!eventType) continue
      const coHosts: User[] = []
      for (const id of booking.hostUserIds.filter((h) => h !== host.id)) {
        const u = await repos.users.byId(id)
        if (u) coHosts.push(u)
      }
      meetings.push({ booking, eventType, coHosts })
    }
    if (meetings.length === 0) continue
    const mail = dailyDigestEmail({
      brandName: ports.config.brandName,
      ...await emailBranding(repos.settings, ports.config.baseUrl),
      ...(ports.config.supportEmail ? { supportEmail: ports.config.supportEmail } : {}),
      host,
      date,
      meetings,
      dashboardUrl: `${ports.config.baseUrl.replace(/\/$/, '')}/dashboard`,
    })
    await ports.queue.send({ kind: 'email', message: { to: host.email, toName: host.name, subject: mail.subject, html: mail.html, text: mail.text } })
  }
}

/**
 * Opt-in telemetry (ADR-0006 §5).
 *
 * Counts only. No emails, names, slugs, URLs or calendar content — the payload
 * is small enough to read in full here, which is the point: the claim is
 * auditable rather than trusted.
 */
async function sendTelemetry(ports: EnginePorts, now: number): Promise<void> {
  // Once a day, not every 5 minutes.
  const hourOfDay = new Date(now).getUTCHours()
  const minute = new Date(now).getUTCMinutes()
  if (hourOfDay !== 3 || minute >= 5) return

  const repos = ports.repositories({ consistency: 'unconstrained' })
  const counts = await repos.telemetryCounts()

  if (!ports.config.telemetryUrl) return
  await fetch(ports.config.telemetryUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: '0.1.1',
      users: counts.users,
      eventTypes: counts.eventTypes,
      bookings: counts.bookings,
    }),
  }).catch(() => {})
}

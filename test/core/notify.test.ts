import { describe, expect, it, vi } from 'vitest'
import type { Booking, CalendarConnection, EventType, User } from '../../src/core/domain/types.js'
import { notifyBookingCancelled, notifyBookingCreated, notifyBookingRescheduled, notifyBookingReminder } from '../../src/adapters/notify.js'
import { createCloudflareSender } from '../../src/adapters/email/index.js'
import type { EnginePorts, QueueMessage } from '../../src/ports.js'

/**
 * Regression coverage for the reschedule/cancel .ics collision: a booking
 * that a reschedule has SUPERSEDED (`rescheduledTo` set) must never get a
 * CANCEL .ics attached to its cancellation email, because that CANCEL would
 * share a UID with the replacement's REQUEST and the two SEQUENCE numbers
 * cannot be made to reliably agree on which one is stale — see the design
 * note on `icsCancelSuppressed` in src/core/ics.ts.
 *
 * These tests exercise `notifyBookingCancelled` itself (not just the pure
 * `ics.ts` helpers) so a future call site that starts invoking it on a
 * superseded booking is caught here, not just in the primitives.
 */

const START = Date.UTC(2026, 7, 14, 9, 0, 0)

const host: User = {
  id: 'u_host',
  email: 'grace@example.com',
  name: 'Grace Hopper',
  tz: 'America/New_York',
  slug: 'grace',
  avatarKey: null,
  company: null,
  jobTitle: null,
  companyUrl: null,
  role: 'member',
  createdAt: 0,
}

function eventType(patch: Partial<EventType> = {}): EventType {
  return {
    id: 'et_1',
    ownerUserId: 'u_host',
    ownerTeamId: null,
    schedulingType: 'personal',
    slug: 'intro',
    title: 'Intro call',
    description: 'A short chat.',
    durationMinutes: 30,
    slotIntervalMinutes: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 60,
    maxHorizonDays: 60,
    maxPerDay: null,
    locationType: 'google_meet',
    locationValue: null,
    questions: [],
    active: true,
    createdAt: 0,
    scheduleId: null,
    ...patch,
  }
}

function booking(patch: Partial<Booking> = {}): Booking {
  return {
    id: 'bk_1',
    eventTypeId: 'et_1',
    hostUserId: 'u_host',
    hostUserIds: ['u_host'],
    guestName: 'Ada Lovelace',
    guestEmail: 'ada@example.com',
    guestTimezone: 'Europe/Kyiv',
    startUtc: START,
    endUtc: START + 30 * 60_000,
    localDate: '2026-08-14',
    status: 'confirmed',
    answers: {},
    externalEventIds: {},
    conferenceUrl: null,
    rescheduleOf: null,
    rescheduledTo: null,
    manageTokenHash: 'hash',
    cancelledAt: null,
    createdAt: Date.UTC(2026, 7, 10, 12, 0, 0),
    ...patch,
  }
}

/** Only the repositories used by booking notifications. */
function fakePorts(sent: QueueMessage[], history: Booking[] = [], connections: CalendarConnection[] = [], failConnectionLookup = false): EnginePorts {
  return {
    repositories: () =>
      ({
        webhooks: { listForUser: async () => [] },
        bookings: { byId: async (id: string) => history.find((b) => b.id === id) ?? null },
        connections: { listForUser: async (id: string) => {
          if (failConnectionLookup) throw new Error('Connection lookup unavailable')
          return connections.filter((c) => c.userId === id)
        } },
      }) as unknown as ReturnType<EnginePorts['repositories']>,
    queue: {
      send: async (message: QueueMessage) => {
        sent.push(message)
      },
      sendBatch: async (messages: QueueMessage[]) => {
        sent.push(...messages)
      },
    },
    config: {
      baseUrl: 'https://cadence.example',
      brandName: 'Cadence',
      supportEmail: 'help@cadence.example',
      fromEmail: 'noreply@cadence.example',
      fromName: 'Cadence',
      telemetryEnabled: false,
    },
  } as unknown as EnginePorts
}

function emailAttachments(sent: QueueMessage[]): Array<
  Array<{ filename: string; content: string; contentType: string }> | undefined
> {
  return sent
    .filter((m): m is Extract<QueueMessage, { kind: 'email' }> => m.kind === 'email')
    .map((m) => m.message.attachments)
}

describe('notifyBookingCancelled — CANCEL suppressed for a superseded leg', () => {
  it('attaches no .ics when the cancelled booking has been superseded by a reschedule', async () => {
    const sent: QueueMessage[] = []
    const superseded = booking({
      status: 'cancelled',
      rescheduledTo: 'bk_2',
      cancelledAt: START,
    })

    await notifyBookingCancelled({
      ports: fakePorts(sent),
      booking: superseded,
      eventType: eventType(),
      host,
      cancelledBy: 'guest',
    })

    const attachments = emailAttachments(sent)
    expect(attachments).toHaveLength(2) // guest + host
    for (const a of attachments) expect(a).toBeUndefined()
  })

  it('still attaches a .ics CANCEL for a genuine, terminal cancellation', async () => {
    const sent: QueueMessage[] = []
    const trulyCancelled = booking({
      status: 'cancelled',
      rescheduledTo: null,
      cancelledAt: START,
    })

    await notifyBookingCancelled({
      ports: fakePorts(sent),
      booking: trulyCancelled,
      eventType: eventType(),
      host,
      cancelledBy: 'guest',
    })

    const attachments = emailAttachments(sent)
    expect(attachments).toHaveLength(2)
    for (const a of attachments) {
      expect(a).toBeDefined()
      expect(a?.[0]?.contentType).toContain('method=CANCEL')
    }
  })
})

describe('scheduling attachments through confirmation, two reschedules and cancellation', () => {
  const connection: CalendarConnection = {
    id: 'conn_host', userId: host.id, provider: 'google', providerAccountEmail: host.email,
    encryptedTokens: 'unused', keyVersion: 1, calendarIdsRead: ['primary'],
    calendarIdWrite: 'primary', syncStatus: 'ok', createdAt: 0,
  }
  const connections = [connection, { ...connection, id: 'conn_other', userId: 'u_other' }]
  const scenarios: Array<{ label: string; ids: Record<string, string>; omitHost: boolean; failLookup?: boolean }> = [
    { label: 'own synced event', ids: { conn_host: 'google_own' }, omitHost: true },
    { label: 'own and another host’s synced events', ids: { conn_host: 'google_own', conn_other: 'google_other' }, omitHost: true },
    { label: 'only another host’s synced event', ids: { conn_other: 'google_other' }, omitHost: false },
    { label: 'no recorded synced event', ids: {}, omitHost: false },
    { label: 'an event with no matching connection', ids: { conn_missing: 'google_missing' }, omitHost: false },
    { label: 'failed connection lookup', ids: { conn_host: 'google_own' }, omitHost: false, failLookup: true },
  ]

  it.each(scenarios)('$label', async ({ ids, omitHost, failLookup }) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const original = booking({ externalEventIds: { ...ids } })
      const moved = booking({ id: 'bk_2', rescheduleOf: original.id, externalEventIds: { ...ids }, startUtc: START + 86_400_000, endUtc: START + 86_400_000 + 30 * 60_000, createdAt: original.createdAt + 1000 })
      const movedAgain = booking({ id: 'bk_3', rescheduleOf: moved.id, externalEventIds: { ...ids }, startUtc: START + 2 * 86_400_000, endUtc: START + 2 * 86_400_000 + 30 * 60_000, createdAt: original.createdAt + 2000 })
      const cancelled = { ...movedAgain, status: 'cancelled' as const, cancelledAt: original.createdAt + 3000 }
      const sent: QueueMessage[] = []
      const ports = fakePorts(sent, [original, moved, movedAgain], connections, failLookup)
      const common = { ports, eventType: eventType({ title: 'Réunion — demo ✓' }), host }
      await notifyBookingCreated({ ...common, booking: original })
      await notifyBookingRescheduled({ ...common, booking: moved, previous: original })
      await notifyBookingRescheduled({ ...common, booking: movedAgain, previous: moved })
      await notifyBookingCancelled({ ...common, booking: cancelled, cancelledBy: 'guest' })

      const emails = sent.filter((m): m is Extract<QueueMessage, { kind: 'email' }> => m.kind === 'email').map((m) => m.message)
      const guestMail = emails.filter((m) => m.to === original.guestEmail)
      const hostMail = emails.filter((m) => m.to === host.email)
      expect(guestMail).toHaveLength(4)
      expect(hostMail).toHaveLength(4)
      for (const mail of guestMail) {
        expect(mail.attachments?.[0]?.filename).toBe('invite.ics')
        expect(typeof mail.attachments?.[0]?.content).toBe('string')
      }
      for (const mail of hostMail) {
        if (omitHost) {
          expect(mail.attachments).toBeUndefined()
          expect(mail.text).not.toContain('attached')
          expect(mail.html).not.toContain('attached')
        } else expect(mail.attachments?.[0]?.filename).toBe('invite.ics')
      }

      const deliveries: Array<{ to: string; calendar?: string; mime?: string }> = []
      const sender = createCloudflareSender({
        from: ports.config.fromEmail,
        binding: { send: async (message: EmailMessageBuilder) => {
          const attachment = message.attachments?.[0]
          let calendar: string | undefined
          if (attachment) {
            expect(attachment.content).toBeInstanceOf(Uint8Array)
            calendar = new TextDecoder().decode(attachment.content as Uint8Array)
            expect(calendar.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
            expect(calendar.endsWith('END:VCALENDAR\r\n')).toBe(true)
            expect(calendar).toContain('Réunion — demo ✓')
          }
          deliveries.push({ to: typeof message.to === 'string' ? message.to : (message.to as EmailAddress).email, calendar, mime: attachment?.type })
          return { messageId: 'local-check' }
        } } as unknown as SendEmail,
      })
      for (const mail of emails) await sender.send(mail)
      const guest = deliveries.filter((m) => m.to === original.guestEmail)
      const organizer = deliveries.filter((m) => m.to === host.email)
      const property = (calendar: string, name: string) => calendar.replace(/\r\n[ \t]/g, '').split('\r\n').find((line) => line.startsWith(name + ':'))?.slice(name.length + 1)
      const calendars = guest.map((m) => m.calendar!)
      expect(new Set(calendars.map((c) => property(c, 'UID'))).size).toBe(1)
      expect(property(calendars[0]!, 'UID')).toBeTruthy()
      expect(calendars.map((c) => property(c, 'SEQUENCE'))).toEqual(['0', '1', '2', '3'])
      expect(calendars.map((c) => property(c, 'METHOD'))).toEqual(['REQUEST', 'REQUEST', 'REQUEST', 'CANCEL'])
      expect(calendars.map((c) => property(c, 'STATUS'))).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CANCELLED'])
      expect(guest.map((m) => m.mime)).toEqual(['text/calendar; method=REQUEST', 'text/calendar; method=REQUEST', 'text/calendar; method=REQUEST', 'text/calendar; charset=utf-8; method=CANCEL'])
      expect(property(calendars[1]!, 'DTSTART')).not.toBe(property(calendars[0]!, 'DTSTART'))
      expect(property(calendars[2]!, 'DTSTART')).not.toBe(property(calendars[1]!, 'DTSTART'))
      for (let i = 0; i < 4; i++) {
        expect(organizer[i]?.calendar).toBe(omitHost ? undefined : guest[i]?.calendar)
        expect(organizer[i]?.mime).toBe(omitHost ? undefined : guest[i]?.mime)
      }
      expect(original.externalEventIds).toEqual(ids)
      expect(moved.externalEventIds).toEqual(ids)
      expect(movedAgain.externalEventIds).toEqual(ids)
      if (failLookup) expect(log).toHaveBeenCalledTimes(4)
      else expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})

describe('all participating hosts and additional guests', () => {
  it('reminds every participant and isolates an individual delivery failure', async () => {
    const cohost = { ...host, id: 'u_cohost', email: 'cohost@example.com' }
    const sent: QueueMessage[] = []
    const ports = fakePorts(sent)
    ports.queue.send = async (message) => {
      if (message.kind === 'email' && message.message.to === host.email) throw new Error('Queue unavailable')
      sent.push(message)
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await notifyBookingReminder({ ports, host, hosts: [host, cohost], eventType: eventType(),
        booking: booking({ hostUserIds: [host.id, cohost.id], additionalGuests: ['extra@example.com', cohost.email] }) }, '1h')
      const mails = sent.filter((m) => m.kind === 'email').map((m) => m.message)
      expect(mails.map((m) => m.to).sort()).toEqual(['ada@example.com', 'cohost@example.com', 'extra@example.com'])
      expect(mails.every((m) => !m.attachments)).toBe(true)
      expect(error).toHaveBeenCalled()
    } finally { error.mockRestore() }
  })

  it('sends every lifecycle update once, applies sync suppression per host and protects manage tokens', async () => {
    const cohost = { ...host, id: 'u_cohost', email: 'cohost@example.com', name: 'Co Host', tz: 'Europe/London' }
    const excluded = { ...host, id: 'u_absent', email: 'absent@example.com' }
    const shared = { hostUserIds: [host.id, cohost.id], additionalGuests: ['extra@example.com', cohost.email], externalEventIds: { conn_host: 'google-event' } }
    const original = booking(shared)
    const moved = booking({ ...shared, id: 'bk_move', rescheduleOf: original.id, startUtc: START + 86400000, endUtc: START + 86400000 + 1800000 })
    const again = booking({ ...shared, id: 'bk_again', rescheduleOf: moved.id, startUtc: START + 172800000, endUtc: START + 172800000 + 1800000 })
    const sent: QueueMessage[] = []
    const conn = { id: 'conn_host', userId: host.id } as CalendarConnection
    const ports = fakePorts(sent, [original, moved, again], [conn])
    const ctx = { ports, host, hosts: [host, cohost, excluded], eventType: eventType(), manageToken: 'private_manage_token' }
    await notifyBookingCreated({ ...ctx, booking: original })
    await notifyBookingRescheduled({ ...ctx, booking: moved, previous: original })
    await notifyBookingRescheduled({ ...ctx, booking: again, previous: moved })
    await notifyBookingCancelled({ ...ctx, booking: { ...again, status: 'cancelled' }, cancelledBy: 'host' })
    const mails = sent.filter((m) => m.kind === 'email').map((m) => m.message)
    expect(mails).toHaveLength(16)
    expect(mails.some((m) => m.to === excluded.email)).toBe(false)
    for (const recipient of [original.guestEmail, 'extra@example.com', cohost.email]) {
      const own = mails.filter((m) => m.to === recipient)
      expect(own).toHaveLength(4)
      const calendars = own.map((m) => Buffer.from(m.attachments![0]!.content, 'base64').toString('utf8').replace(/\r\n /g, ''))
      expect(calendars.map((ics) => /SEQUENCE:(\d+)/.exec(ics)?.[1])).toEqual(['0', '1', '2', '3'])
      expect(calendars.map((ics) => /METHOD:(\w+)/.exec(ics)?.[1])).toEqual(['REQUEST', 'REQUEST', 'REQUEST', 'CANCEL'])
      expect(new Set(calendars.map((ics) => /UID:(.+)/.exec(ics)?.[1])).size).toBe(1)
      for (const ics of calendars) {
        expect(ics).toContain('mailto:extra@example.com')
        expect(ics).not.toContain('private_manage_token')
      }
      if (recipient === 'extra@example.com') for (const mail of own) expect(mail.html + mail.text).not.toContain('private_manage_token')
    }
    for (const mail of mails.filter((m) => m.to === host.email)) {
      expect(mail.attachments).toBeUndefined()
      expect(mail.text).not.toContain('attached')
    }
    expect(mails.find((m) => m.to === original.guestEmail)!.html).toContain('private_manage_token')
  })

  it('resolves co-hosts when the caller only supplies the primary host', async () => {
    const other = { ...host, id: 'u_other', email: 'other@example.com' }
    const sent: QueueMessage[] = []
    const ports = fakePorts(sent)
    const repos = ports.repositories({ consistency: 'unconstrained' })
    repos.users = { byId: async () => other } as unknown as typeof repos.users
    ports.repositories = () => repos
    await notifyBookingCreated({ ports, host, eventType: eventType(), booking: booking({ hostUserIds: [host.id, other.id] }) })
    expect(sent.filter((m) => m.kind === 'email').map((m) => m.message.to)).toContain(other.email)
  })
})

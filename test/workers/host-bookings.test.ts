/**
 * Host-side booking management, under the real Workers runtime.
 *
 * What is asserted: a host sees their own bookings and nobody else's, the
 * booking page shows who is in the meeting, and cancel / reschedule from
 * the dashboard have the same effects as the guest's link — the status
 * write, the calendar-sync message, the guest's email (with the host's
 * note in it). The co-host forms are checked against the contract of
 * `changeBookingHosts`: its placeholder refuses everything as `not_found`,
 * and that sentence on the page is the proof the route called it (the
 * mapping of every other reason is a pure function, tested in test/core).
 */

import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildDashboardRoutes } from '../../src/http/dashboard-routes.js'
import { hostChangeFailureMessage } from '../../src/http/pages/dashboard.js'
import { createD1Repositories } from '../../src/adapters/d1/repositories.js'
import { createWebCrypto } from '../../src/adapters/crypto/webcrypto.js'
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../../src/core/domain/auth-service.js'
import {
  createFakeBlobStorage,
  createFakeEmailSender,
  createFakeRateLimiter,
  fakeConfig,
} from '../../src/testing/fakes.js'
import type { SlotService } from '../../src/engine.js'
import type { Booking } from '../../src/core/domain/types.js'
import type {
  BlobCache,
  BookingAttempt,
  Cache as CachePort,
  CalendarProviders,
  EnginePorts,
  HostCoordinator,
  QueueMessage,
  QueuePort,
} from '../../src/ports.js'

const db = env.DB

const BASE = 'http://localhost'
const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000
const ALICE_ID = 'usr_hb_alice'
const BOB_ID = 'usr_hb_bob'
const CAROL_ID = 'usr_hb_carol'
const OUTSIDER_ID = 'usr_hb_outsider'
const TEAM_ID = 'team_hb'
const ET_PERSONAL = 'et_hb_personal'
const ET_TEAM = 'et_hb_team'
const B_UP = 'bk_hb_up'
const B_TEAM = 'bk_hb_team'
const B_PAST = 'bk_hb_past'
const B_CANC = 'bk_hb_canc'
const B_MOVE = 'bk_hb_move'

function keyMaterial(seed: number): string {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i * 7) & 0xff
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

const crypto_ = createWebCrypto({
  keys: { 1: keyMaterial(1) },
  currentVersion: 1,
  signingKey: keyMaterial(9),
})

const calendars: CalendarProviders = {
  get() {
    throw new Error('test: no calendar provider is configured')
  },
  available: () => [],
}

const cache: CachePort = {
  async get() {
    return null
  },
  async put() {},
  async delete() {},
}

const blobCache: BlobCache = {
  async get() {
    return null
  },
  async put() {},
}

/** Every message the routes enqueue: the emails and the calendar syncs are what the assertions read. */
const sent: QueueMessage[] = []
const queue: QueuePort = {
  async send(message) {
    sent.push(message)
  },
  async sendBatch(messages) {
    sent.push(...messages)
  },
}

/**
 * The coordinator, reduced to the one thing the reschedule route needs from
 * it: a confirmed replacement row. Written through the real D1 repository
 * so `markRescheduled` and the page's reads see it.
 */
const booked: BookingAttempt[] = []
let bookingSequence = 0
const coordinator = new Proxy({} as HostCoordinator, {
  get(_target, prop) {
    if (prop === 'book') {
      return async (_hostUserId: string, request: BookingAttempt) => {
        booked.push(request)
        const id = `bk_hb_new_${++bookingSequence}`
        const booking: Booking = {
          id,
          eventTypeId: request.eventTypeId,
          hostUserId: request.hostUserIds[0]!,
          hostUserIds: request.hostUserIds,
          guestName: request.guestName,
          guestEmail: request.guestEmail,
          additionalGuests: request.additionalGuests,
          guestTimezone: request.guestTimezone,
          startUtc: request.start,
          endUtc: request.end,
          localDate: new Date(request.start).toISOString().slice(0, 10),
          status: 'confirmed',
          answers: request.answers,
          externalEventIds: {},
          conferenceUrl: null,
          rescheduleOf: request.rescheduleOf ?? null,
          rescheduledTo: null,
          manageTokenHash: await crypto_.hash(`tok_${id}`),
          cancelledAt: null,
          createdAt: NOW,
        }
        const created = await createD1Repositories(db, { consistency: 'bookmark' }).bookings.createWithLocks(booking, [])
        return { ok: true, booking: created ?? booking, manageToken: `tok_${id}` }
      }
    }
    return () => {
      throw new Error(`test: coordinator.${String(prop)} is not stubbed`)
    }
  },
})

const ports: EnginePorts = {
  repositories: (scope) => createD1Repositories(db, scope),
  calendars,
  oauth: {
    forProvider: () => null,
    redirectUri: (name, purpose) => `${BASE}/auth/${name}/callback?purpose=${purpose}`,
  },
  email: createFakeEmailSender(),
  crypto: crypto_,
  cache,
  blobCache,
  blobStorage: createFakeBlobStorage(),
  clock: { now: () => Date.now() },
  queue,
  coordinator,
  rateLimiter: createFakeRateLimiter(),
  config: fakeConfig({ baseUrl: BASE }),
}

/** Three slots on the first two days of whatever range is asked for. */
const slots: SlotService = {
  async forEventType({ range }) {
    const hour = Math.ceil(range.start / 3_600_000) * 3_600_000
    const starts = [hour + DAY, hour + DAY + 30 * 60_000, hour + 2 * DAY]
    return starts
      .filter((s) => s < range.end)
      .map((start) => ({ start, end: start + 30 * 60_000, eligibleHostIds: [ALICE_ID] }))
  },
}

const app = buildDashboardRoutes(ports, slots)

async function get(path: string, cookie?: string): Promise<Response> {
  return app.fetch(new Request(`${BASE}${path}`, cookie ? { headers: { cookie } } : {}))
}

async function post(path: string, body: Record<string, string>, cookie?: string): Promise<Response> {
  const form = new FormData()
  for (const [k, v] of Object.entries(body)) form.append(k, v)
  return app.fetch(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      body: form,
      ...(cookie ? { headers: { cookie } } : {}),
    }),
  )
}

async function seedSession(userId: string): Promise<string> {
  const token = crypto_.randomToken(32)
  await db
    .prepare(
      `INSERT INTO sessions (id_hash,user_id,expires_at,absolute_expires_at,bookmark,created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(await crypto_.hash(token), userId, NOW + SESSION_TTL_MS, NOW + SESSION_ABSOLUTE_TTL_MS, null, NOW)
    .run()
  return `${SESSION_COOKIE_NAME}=${token}`
}

async function csrfFrom(path: string, cookie: string): Promise<string> {
  const page = await get(path, cookie)
  return /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''
}

interface SeedBooking {
  id: string
  eventTypeId: string
  hosts: string[]
  start: number
  status?: Booking['status']
  guestTimezone?: string
  answers?: Record<string, string>
  externalEventIds?: Record<string, string>
  cancelledAt?: number | null
}

async function seedBooking(b: SeedBooking): Promise<void> {
  await db
    .prepare(
      `INSERT INTO bookings
       (id,event_type_id,host_user_id,host_user_ids_json,guest_name,guest_email,guest_timezone,
        start_utc,end_utc,local_date,status,answers_json,external_event_ids_json,reschedule_of,
        rescheduled_to,manage_token_hash,cancelled_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      b.id, b.eventTypeId, b.hosts[0]!, JSON.stringify(b.hosts), 'Grace Hopper', 'grace@example.test',
      b.guestTimezone ?? 'UTC', b.start, b.start + 30 * 60_000, new Date(b.start).toISOString().slice(0, 10),
      b.status ?? 'confirmed', JSON.stringify(b.answers ?? {}), JSON.stringify(b.externalEventIds ?? {}), null,
      null, await crypto_.hash(`seed_${b.id}`), b.cancelledAt ?? null, NOW,
    )
    .run()
  if (Object.keys(b.externalEventIds ?? {}).length) {
    await db.prepare('UPDATE bookings SET calendar_sync_revision=0 WHERE id=?').bind(b.id).run()
  }
}

async function bookingRow(id: string): Promise<{ status: string; rescheduled_to: string | null; reschedule_of: string | null } | null> {
  return db
    .prepare('SELECT status, rescheduled_to, reschedule_of FROM bookings WHERE id = ?')
    .bind(id)
    .first<{ status: string; rescheduled_to: string | null; reschedule_of: string | null }>()
}

function emailsTo(address: string): Array<{ subject: string; text: string }> {
  const out: Array<{ subject: string; text: string }> = []
  for (const m of sent) {
    if (m.kind === 'email' && m.message.to === address) out.push({ subject: m.message.subject, text: m.message.text })
  }
  return out
}

beforeAll(async () => {
  const insert = 'INSERT INTO users (id,email,name,tz,slug,created_at) VALUES (?,?,?,?,?,?)'
  await db.prepare(insert).bind(ALICE_ID, 'alice-hb@example.test', 'Alice Host', 'Europe/Kyiv', 'alice-hb', NOW).run()
  await db.prepare(insert).bind(BOB_ID, 'bob-hb@example.test', 'Bob Host', 'UTC', 'bob-hb', NOW).run()
  await db.prepare(insert).bind(CAROL_ID, 'carol-hb@example.test', 'Carol Admin', 'UTC', 'carol-hb', NOW).run()
  await db.prepare(insert).bind(OUTSIDER_ID, 'outsider-hb@example.test', 'Outsider', 'UTC', 'outsider-hb', NOW).run()

  await db.prepare('INSERT INTO teams (id,name,slug,created_at) VALUES (?,?,?,?)').bind(TEAM_ID, 'Support Crew', 'support-hb', NOW).run()
  const member = 'INSERT INTO team_members (team_id,user_id,role,rr_weight) VALUES (?,?,?,?)'
  await db.prepare(member).bind(TEAM_ID, ALICE_ID, 'member', 1).run()
  await db.prepare(member).bind(TEAM_ID, BOB_ID, 'member', 1).run()
  await db.prepare(member).bind(TEAM_ID, CAROL_ID, 'admin', 1).run()

  const eventType = `INSERT INTO event_types
    (id,owner_user_id,owner_team_id,scheduling_type,slug,title,description,duration_minutes,
     slot_interval_minutes,buffer_before_minutes,buffer_after_minutes,min_notice_minutes,
     max_horizon_days,max_per_day,location_type,location_value,questions_json,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  await db
    .prepare(eventType)
    .bind(ET_PERSONAL, ALICE_ID, null, 'personal', 'intro', 'Intro call', '', 30, null, 0, 0, 0, 60, null,
      'google_meet', null, '[]', 1, NOW)
    .run()
  await db
    .prepare(eventType)
    .bind(ET_TEAM, null, TEAM_ID, 'collective', 'support-call', 'Support call', '', 30, null, 0, 0, 0, 60, null,
      'custom_link', 'https://meet.example.test/support', JSON.stringify([{ id: 'q1', label: 'Budget', type: 'text', required: false }]), 1, NOW)
    .run()

  await seedBooking({ id: B_UP, eventTypeId: ET_PERSONAL, hosts: [ALICE_ID], start: NOW + 2 * DAY })
  await seedBooking({
    id: B_TEAM,
    eventTypeId: ET_TEAM,
    hosts: [ALICE_ID, BOB_ID],
    start: NOW + 3 * DAY,
    guestTimezone: 'America/New_York',
    answers: { q1: 'About 5k' },
    externalEventIds: { conn_a: 'evt_1', conn_b: 'evt_2' },
  })
  await seedBooking({ id: B_PAST, eventTypeId: ET_PERSONAL, hosts: [ALICE_ID], start: NOW - 2 * DAY })
  await seedBooking({ id: B_CANC, eventTypeId: ET_PERSONAL, hosts: [ALICE_ID], start: NOW + DAY, status: 'cancelled', cancelledAt: NOW - DAY })
  await seedBooking({ id: B_MOVE, eventTypeId: ET_PERSONAL, hosts: [ALICE_ID], start: NOW + 5 * DAY })
})

beforeEach(() => {
  sent.length = 0
  booked.length = 0
})

// ---------------------------------------------------------------------------

describe('bookings list', () => {
  it('shows the upcoming view by default: confirmed, not yet over, co-hosts named', async () => {
    const cookie = await seedSession(ALICE_ID)
    const html = await (await get('/dashboard/bookings', cookie)).text()
    expect(html).toContain(`/dashboard/bookings/${B_UP}`)
    expect(html).toContain(`/dashboard/bookings/${B_TEAM}`)
    expect(html).toContain('with Bob Host')
    expect(html).not.toContain(`/dashboard/bookings/${B_PAST}`)
    expect(html).not.toContain(`/dashboard/bookings/${B_CANC}`)
    expect(html).toContain('Times in Europe/Kyiv')
  })

  it('the past and cancelled views, each with only its own rows', async () => {
    const cookie = await seedSession(ALICE_ID)
    const past = await (await get('/dashboard/bookings?view=past', cookie)).text()
    expect(past).toContain(`/dashboard/bookings/${B_PAST}`)
    expect(past).not.toContain(`/dashboard/bookings/${B_UP}`)
    expect(past).not.toContain(`/dashboard/bookings/${B_CANC}`)

    const cancelled = await (await get('/dashboard/bookings?view=cancelled', cookie)).text()
    expect(cancelled).toContain(`/dashboard/bookings/${B_CANC}`)
    expect(cancelled).toContain('Cancelled</span>')
    expect(cancelled).not.toContain(`/dashboard/bookings/${B_UP}`)
  })

  it('a co-host sees the team booking; a member with nothing booked sees the empty state', async () => {
    const bob = await (await get('/dashboard/bookings', await seedSession(BOB_ID))).text()
    expect(bob).toContain(`/dashboard/bookings/${B_TEAM}`)
    expect(bob).toContain('with Alice Host')
    expect(bob).not.toContain(`/dashboard/bookings/${B_UP}`)

    const outsider = await (await get('/dashboard/bookings', await seedSession(OUTSIDER_ID))).text()
    expect(outsider).toContain('Nothing booked yet')
    expect(outsider).not.toContain('/dashboard/bookings/bk_')
  })

  it('the home page links each upcoming row to its booking, and to the full list', async () => {
    const html = await (await get('/dashboard', await seedSession(ALICE_ID))).text()
    expect(html).toContain(`href="/dashboard/bookings/${B_UP}"`)
    expect(html).toContain('href="/dashboard/bookings">See all</a>')
  })
})

describe('booking page', () => {
  it('is a 404 for someone who neither hosts it nor manages the team', async () => {
    const outsider = await seedSession(OUTSIDER_ID)
    expect((await get(`/dashboard/bookings/${B_UP}`, outsider)).status).toBe(404)
    expect((await get(`/dashboard/bookings/${B_TEAM}`, outsider)).status).toBe(404)
    // A team admin manages the team's bookings, not a member's personal ones.
    const carol = await seedSession(CAROL_ID)
    expect((await get(`/dashboard/bookings/${B_UP}`, carol)).status).toBe(404)
    expect((await get(`/dashboard/bookings/${B_TEAM}`, carol)).status).toBe(200)
    // The co-host sees it too, though they are not the primary host.
    expect((await get(`/dashboard/bookings/${B_TEAM}`, await seedSession(BOB_ID))).status).toBe(200)
  })

  it('shows the meeting in both zones, the guest and their answers, every participant, and the sync state', async () => {
    const html = await (await get(`/dashboard/bookings/${B_TEAM}`, await seedSession(ALICE_ID))).text()
    expect(html).toContain('Support call')
    expect(html).toContain('Support Crew')
    expect(html).toContain('Europe/Kyiv')
    expect(html).toContain('For the guest')
    expect(html).toContain('America/New_York')
    expect(html).toContain('30 min')
    expect(html).toContain('https://meet.example.test/support')
    expect(html).toContain('Grace Hopper')
    expect(html).toContain('mailto:grace@example.test')
    expect(html).toContain('Budget')
    expect(html).toContain('About 5k')
    expect(html).toContain('On 2 calendars')
    expect(html).toContain('Alice Host')
    expect(html).toContain('(you)')
    expect(html).toContain('Bob Host')
    expect(html).toContain('Carol Admin')
    expect(html).toContain('Required')
    expect(html).toContain('Not on this one')
    expect(html).toContain(`href="/dashboard/bookings/${B_TEAM}/reschedule"`)
    expect(html).toContain(`action="/dashboard/bookings/${B_TEAM}/cancel"`)
    expect(html).toContain('name="note"')
  })

  it('links the title to the editor only for someone who may edit the event type', async () => {
    const alice = await (await get(`/dashboard/bookings/${B_TEAM}`, await seedSession(ALICE_ID))).text()
    expect(alice).not.toContain(`href="/dashboard/event-types/${ET_TEAM}"`)
    const carol = await (await get(`/dashboard/bookings/${B_TEAM}`, await seedSession(CAROL_ID))).text()
    expect(carol).toContain(`href="/dashboard/event-types/${ET_TEAM}"`)
    const own = await (await get(`/dashboard/bookings/${B_UP}`, await seedSession(ALICE_ID))).text()
    expect(own).toContain(`href="/dashboard/event-types/${ET_PERSONAL}"`)
  })

  it('offers nothing to change on a past or cancelled booking', async () => {
    const cookie = await seedSession(ALICE_ID)
    const past = await (await get(`/dashboard/bookings/${B_PAST}`, cookie)).text()
    expect(past).toContain('already happened')
    expect(past).not.toContain(`action="/dashboard/bookings/${B_PAST}/cancel"`)
    const cancelled = await (await get(`/dashboard/bookings/${B_CANC}`, cookie)).text()
    expect(cancelled).toContain('nothing left to change')
    expect(cancelled).not.toContain(`/dashboard/bookings/${B_CANC}/reschedule`)
  })
})

describe('cancel', () => {
  it('cancels, releases the slot, enqueues the calendar delete, and mails the guest the note', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_UP}`, cookie)
    const res = await post(`/dashboard/bookings/${B_UP}/cancel`, { csrf, note: 'Something came up, sorry for the short notice.' }, cookie)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/dashboard/bookings/${B_UP}?cancelled=1`)

    expect((await bookingRow(B_UP))?.status).toBe('cancelled')
    expect(sent).toContainEqual({ kind: 'calendar.sync', bookingId: B_UP, action: 'delete' })

    const [guestMail] = emailsTo('grace@example.test')
    expect(guestMail?.subject).toContain('Cancelled')
    expect(guestMail?.text).toContain('Alice Host cancelled Intro call and wrote: “Something came up, sorry for the short notice.”')

    const page = await (await get(`/dashboard/bookings/${B_UP}?cancelled=1`, cookie)).text()
    expect(page).toContain('Booking cancelled.')
    expect(page).toContain('Cancelled</span>')
  })

  it('refuses to cancel a booking that is not confirmed, and says why', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_CANC}`, cookie)
    const res = await post(`/dashboard/bookings/${B_CANC}/cancel`, { csrf }, cookie)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('This booking is cancelled, so it cannot be cancelled.')
    expect(sent).toHaveLength(0)
  })

  it('is a 404 for a stranger, and a 403 without the CSRF token', async () => {
    const stranger = await seedSession(OUTSIDER_ID)
    const csrf = await csrfFrom('/dashboard/bookings', stranger)
    expect((await post(`/dashboard/bookings/${B_TEAM}/cancel`, { csrf }, stranger)).status).toBe(404)
    const alice = await seedSession(ALICE_ID)
    expect((await post(`/dashboard/bookings/${B_TEAM}/cancel`, { note: 'x' }, alice)).status).toBe(403)
    expect((await bookingRow(B_TEAM))?.status).toBe('confirmed')
  })
})

describe('reschedule', () => {
  it('renders the next two weeks of slots grouped by day, each linking to a confirm step', async () => {
    const cookie = await seedSession(ALICE_ID)
    const html = await (await get(`/dashboard/bookings/${B_MOVE}/reschedule`, cookie)).text()
    const links = html.match(new RegExp(`/dashboard/bookings/${B_MOVE}/reschedule\\?start=\\d+`, 'g')) ?? []
    expect(links).toHaveLength(3)
    expect((html.match(/<h3 class="pu-day-heading"/g) ?? []).length).toBe(2)
    expect(html).toContain('times in Europe/Kyiv')

    const start = Number(/start=(\d+)/.exec(links[0]!)?.[1])
    const confirm = await (await get(`/dashboard/bookings/${B_MOVE}/reschedule?start=${start}`, cookie)).text()
    expect(confirm).toContain('Move to this time?')
    expect(confirm).toContain(`name="start" value="${start}"`)
    expect(confirm).toContain('Move booking')
  })

  it('moves the booking: a replacement is booked, the original marked moved, both syncs enqueued', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_MOVE}`, cookie)
    const start = Math.ceil(Date.now() / 3_600_000) * 3_600_000 + DAY
    const res = await post(`/dashboard/bookings/${B_MOVE}/reschedule`, { csrf, start: String(start) }, cookie)
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    const newId = /\/dashboard\/bookings\/([^?]+)\?moved=1/.exec(location)?.[1]
    expect(newId).toBeTruthy()

    expect(booked).toHaveLength(1)
    expect(booked[0]).toMatchObject({ eventTypeId: ET_PERSONAL, hostUserIds: [ALICE_ID], start, rescheduleOf: B_MOVE, guestEmail: 'grace@example.test' })

    const old = await bookingRow(B_MOVE)
    expect(old?.status).toBe('rescheduled')
    expect(old?.rescheduled_to).toBe(newId)
    const fresh = await bookingRow(newId!)
    expect(fresh?.status).toBe('confirmed')
    expect(fresh?.reschedule_of).toBe(B_MOVE)

    expect(sent).toContainEqual({ kind: 'calendar.sync', bookingId: newId, action: 'create', manageToken: `tok_${newId}` })
    expect(sent).toContainEqual({ kind: 'calendar.sync', bookingId: B_MOVE, action: 'delete' })

    const page = await (await get(location, cookie)).text()
    expect(page).toContain('Booking moved.')
    const oldPage = await (await get(`/dashboard/bookings/${B_MOVE}`, cookie)).text()
    expect(oldPage).toContain('Moved</span>')
    expect(oldPage).toContain(`href="/dashboard/bookings/${newId}">See the new time.</a>`)
  })

  it('cannot move a past or a cancelled booking, and says so', async () => {
    const cookie = await seedSession(ALICE_ID)
    const past = await (await get(`/dashboard/bookings/${B_PAST}/reschedule`, cookie)).text()
    expect(past).toContain('This meeting has already happened, so it cannot be moved.')
    expect(past).not.toContain('?start=')
    const cancelled = await (await get(`/dashboard/bookings/${B_CANC}/reschedule`, cookie)).text()
    expect(cancelled).toContain('This booking is cancelled, so it cannot be moved.')

    const csrf = await csrfFrom(`/dashboard/bookings/${B_PAST}`, cookie)
    const res = await post(`/dashboard/bookings/${B_PAST}/reschedule`, { csrf, start: String(NOW + DAY) }, cookie)
    expect(res.status).toBe(400)
    expect(booked).toHaveLength(0)
  })

  it('rejects a missing start, and is a 404 for a stranger', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_UP}`, cookie)
    const res = await post(`/dashboard/bookings/${B_TEAM}/reschedule`, { csrf, start: 'soon' }, cookie)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('No new time was chosen.')

    const stranger = await seedSession(OUTSIDER_ID)
    expect((await get(`/dashboard/bookings/${B_TEAM}/reschedule`, stranger)).status).toBe(404)
  })
})

describe('co-hosts', () => {
  it('offers the add and remove forms on a team booking, to an attending host and to a team admin', async () => {
    for (const id of [ALICE_ID, CAROL_ID]) {
      const html = await (await get(`/dashboard/bookings/${B_TEAM}`, await seedSession(id))).text()
      expect(html).toContain('Add a co-host')
      expect(html).toContain(`action="/dashboard/bookings/${B_TEAM}/hosts/add"`)
      // Carol is the only member not yet attending, so she is the only option.
      expect(html).toContain(`<option value="${CAROL_ID}">Carol Admin</option>`)
      expect(html).not.toContain(`<option value="${BOB_ID}"`)
      expect(html).toContain(`action="/dashboard/bookings/${B_TEAM}/hosts/${BOB_ID}/remove"`)
      expect(html).toContain(`action="/dashboard/bookings/${B_TEAM}/hosts/${ALICE_ID}/remove"`)
    }
  })

  it('offers neither on a personal booking', async () => {
    const html = await (await get(`/dashboard/bookings/${B_UP}`, await seedSession(ALICE_ID))).text()
    expect(html).not.toContain('Add a co-host')
    expect(html).not.toContain('/hosts/')
  })

  // The real changeBookingHosts is behind these forms: an add claims the
  // new host's locks and lands on the booking page with a notice; a
  // team admin who is not attending may remove a co-host the same way.
  it('adds a co-host through changeBookingHosts and comes back to the booking page', async () => {
    // Bob's integration subscribes to host changes; it must hear about the
    // add now and, below, about his own removal.
    await createD1Repositories(db, { consistency: 'bookmark' }).webhooks.create({
      id: 'wh_hb_bob', userId: BOB_ID, url: 'https://hooks.example.test/bob', secret: 's', events: ['booking.hosts_changed'], active: true, createdAt: NOW,
    })
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_TEAM}`, cookie)
    const res = await post(`/dashboard/bookings/${B_TEAM}/hosts/add`, { csrf, userId: CAROL_ID }, cookie)
    expect(res.status).toBe(302)
    const hook = sent.find((m) => m.kind === 'webhook' && m.event === 'booking.hosts_changed') as { webhookId: string; payload: Record<string, unknown> } | undefined
    expect(hook?.webhookId).toBe('wh_hb_bob')
    expect(hook?.payload).toMatchObject({ id: B_TEAM, hostsAdded: [CAROL_ID], hostsRemoved: [], hostUserIds: [ALICE_ID, BOB_ID, CAROL_ID] })
    expect(res.headers.get('location')).toBe(`/dashboard/bookings/${B_TEAM}?hosts=1`)
    const row = await db.prepare('SELECT host_user_ids_json FROM bookings WHERE id = ?').bind(B_TEAM).first<{ host_user_ids_json: string }>()
    expect(JSON.parse(row!.host_user_ids_json)).toEqual([ALICE_ID, BOB_ID, CAROL_ID])
    const locks = await db.prepare('SELECT COUNT(*) AS n FROM slot_locks WHERE booking_id = ? AND host_user_id = ?').bind(B_TEAM, CAROL_ID).first<{ n: number }>()
    expect(locks!.n).toBeGreaterThan(0)
    // Adding her again is refused with the domain's own sentence.
    const again = await post(`/dashboard/bookings/${B_TEAM}/hosts/add`, { csrf, userId: CAROL_ID }, cookie)
    expect(again.status).toBe(400)
    expect(await again.text()).toContain(hostChangeFailureMessage('already_host'))
  })

  it('removes a co-host through it too, for a team admin who is not on the booking', async () => {
    const cookie = await seedSession(CAROL_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_TEAM}`, cookie)
    const before = sent.length
    const res = await post(`/dashboard/bookings/${B_TEAM}/hosts/${BOB_ID}/remove`, { csrf }, cookie)
    expect(res.status).toBe(302)
    // The removed host's own subscription still hears about the exit.
    const hook = sent.slice(before).find((m) => m.kind === 'webhook') as { webhookId: string; event: string; payload: Record<string, unknown> } | undefined
    expect(hook?.webhookId).toBe('wh_hb_bob')
    expect(hook?.event).toBe('booking.hosts_changed')
    expect(hook?.payload).toMatchObject({ hostsRemoved: [BOB_ID], hostsAdded: [] })
    expect((hook?.payload['hostUserIds'] as string[])).not.toContain(BOB_ID)
    const row = await db.prepare('SELECT host_user_ids_json FROM bookings WHERE id = ?').bind(B_TEAM).first<{ host_user_ids_json: string }>()
    expect(JSON.parse(row!.host_user_ids_json)).not.toContain(BOB_ID)
    const locks = await db.prepare('SELECT COUNT(*) AS n FROM slot_locks WHERE booking_id = ? AND host_user_id = ?').bind(B_TEAM, BOB_ID).first<{ n: number }>()
    expect(locks!.n).toBe(0)
  })

  it('asks for a member when the select was submitted empty', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_TEAM}`, cookie)
    const res = await post(`/dashboard/bookings/${B_TEAM}/hosts/add`, { csrf, userId: '' }, cookie)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Choose a team member to add.')
  })

  it('a reschedule carries the booking\'s CURRENT hosts, not the event type\'s list', async () => {
    // After the add and remove above the team booking is Alice + Carol,
    // while the event type still resolves to Alice + Bob. Moving it must
    // not hand the meeting back to Bob or drop Carol.
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/bookings/${B_TEAM}`, cookie)
    const before = booked.length
    const start = Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 2 * DAY
    const res = await post(`/dashboard/bookings/${B_TEAM}/reschedule`, { csrf, start: String(start) }, cookie)
    expect(res.status).toBe(302)
    expect(booked).toHaveLength(before + 1)
    expect([...booked[before]!.hostUserIds].sort()).toEqual([ALICE_ID, CAROL_ID].sort())
  })

  it('a stranger cannot reach the forms at all', async () => {
    const stranger = await seedSession(OUTSIDER_ID)
    const csrf = await csrfFrom('/dashboard/bookings', stranger)
    const res = await post(`/dashboard/bookings/${B_TEAM}/hosts/add`, { csrf, userId: OUTSIDER_ID }, stranger)
    expect(res.status).toBe(404)
  })
})

describe('create meeting from the dashboard', () => {
  const draft = () => ({ source: 'one-off', requestKey: crypto_.randomToken(24), title: 'Planning together', duration: '30', location: 'custom', locationValue: 'Room A', when: new Date(NOW + 7 * DAY).toISOString().slice(0,16), timezone: 'UTC', name: 'Guest', email: 'guest@example.com', additionalGuests: 'Teammate@example.com, second@example.com' })
  it('requires sign-in, CSRF and ownership of the selected event or team', async () => {
    expect((await get('/dashboard/meetings/new')).status).toBe(302)
    const cookie = await seedSession(OUTSIDER_ID)
    expect((await get(`/dashboard/meetings/new?source=event:${ET_PERSONAL}`, cookie)).status).toBe(404)
    expect((await post('/dashboard/meetings', draft(), cookie)).status).toBe(403)
    const csrf = await csrfFrom('/dashboard/meetings/new?source=one-off', cookie)
    expect((await post('/dashboard/meetings', { ...draft(), csrf, source: `team:${TEAM_ID}` }, cookie)).status).toBe(404)
  })

  it('rejects an automatic one-off without a writable host and keeps manual locations available', async () => {
    const cookie = await seedSession(ALICE_ID)
    const path = '/dashboard/meetings/new?source=one-off'
    const html = await (await get(path, cookie)).text()
    expect(html).not.toContain('<option value="google_meet"')
    expect(html).toContain('value="custom"')
    const response = await post('/dashboard/meetings', { ...draft(), location: 'google_meet', csrf: await csrfFrom(path, cookie) }, cookie)
    expect(response.status).toBe(400)
    expect(booked).toHaveLength(0)
  })

  it('creates a private one-off with multiple guests and keeps it off public pages and event-type lists', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom('/dashboard/meetings/new?source=one-off', cookie)
    const response = await post('/dashboard/meetings', { ...draft(), csrf }, cookie)
    expect(response.status).toBe(302)
    const request = booked.at(-1)!
    expect(request.additionalGuests).toEqual(['teammate@example.com', 'second@example.com'])
    const repos = createD1Repositories(db, { consistency: 'bookmark' })
    const et = await repos.eventTypes.byId(request.eventTypeId)
    expect(et?.oneOff).toBe(true)
    expect(et?.title).toBe('Planning together')
    expect(await repos.eventTypes.bySlug('alice-hb', et!.slug)).toBeNull()
    expect(await repos.eventTypes.bookingPageContext('alice-hb', et!.slug)).toBeNull()
    expect((await repos.eventTypes.listForUser(ALICE_ID)).some((e) => e.id === et!.id)).toBe(false)
    const page = await (await get(response.headers.get('location')!, cookie)).text()
    expect(page).toContain('Planning together')
    expect(page).toContain('teammate@example.com')
  })

  it('uses existing event settings and preserves invalid form values without booking', async () => {
    const cookie = await seedSession(ALICE_ID)
    const csrf = await csrfFrom(`/dashboard/meetings/new?source=event:${ET_PERSONAL}`, cookie)
    const invalid = { ...draft(), csrf, source: `event:${ET_PERSONAL}`, additionalGuests: 'not an email' }
    const failed = await post('/dashboard/meetings', invalid, cookie)
    expect(failed.status).toBe(400)
    expect(await failed.text()).toContain('not an email')
    expect(booked).toHaveLength(0)
    const response = await post('/dashboard/meetings', { ...invalid, additionalGuests: 'friend@example.com' }, cookie)
    expect(response.status).toBe(302)
    expect(booked[0]?.eventTypeId).toBe(ET_PERSONAL)
    expect(booked[0]?.hostUserIds).toEqual([ALICE_ID])
  })

  it('a team manager can choose co-hosts but cannot inject an outsider', async () => {
    const cookie = await seedSession(CAROL_ID)
    const csrf = await csrfFrom(`/dashboard/meetings/new?source=team:${TEAM_ID}`, cookie)
    const form = { ...draft(), csrf, source: `team:${TEAM_ID}`, hostIds: OUTSIDER_ID }
    expect((await post('/dashboard/meetings', form, cookie)).status).toBe(400)
    expect(booked).toHaveLength(0)
    const response = await post('/dashboard/meetings', { ...form, hostIds: ALICE_ID }, cookie)
    expect(response.status).toBe(302)
    expect(booked[0]?.hostUserIds).toEqual([ALICE_ID])
  })
})

describe('editing additional guests in the dashboard',()=>{
  const B_EDIT = 'bk_guest_editor'
  beforeEach(async()=>{
    await db.prepare('DELETE FROM slot_locks WHERE booking_id=?').bind(B_EDIT).run()
    await db.prepare('DELETE FROM bookings WHERE id=?').bind(B_EDIT).run()
    await seedBooking({id:B_EDIT,eventTypeId:ET_PERSONAL,hosts:[ALICE_ID],start:NOW+12*DAY})
  })
  it('offers the editor and saves guests through the protected booking route',async()=>{
    const cookie=await seedSession(ALICE_ID)
    const path=`/dashboard/bookings/${B_EDIT}`
    const html=await(await get(path,cookie)).text()
    expect(html).toContain('Edit guests')
    expect(html).toContain('<option value="all" selected>Notify everyone</option>')
    expect(html).toContain('<option value="new">Only notify new participants</option>')
    expect(html).toContain('name="revision" value="0"')
    const response=await post(`${path}/guests`,{csrf:await csrfFrom(path,cookie),revision:'0',guests:'guest2@example.test'},cookie)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('?guests=1')
    const saved=await createD1Repositories(db,{consistency:'bookmark'}).bookings.byId(B_EDIT)
    expect(saved?.additionalGuests).toEqual(['guest2@example.test'])
    expect(saved?.revision).toBe(1)
  })
  it('validates the notification choice and passes new-only mode to guest editing',async()=>{
    const cookie=await seedSession(ALICE_ID)
    const path=`/dashboard/bookings/${B_EDIT}`
    const form={csrf:await csrfFrom(path,cookie),revision:'0',guests:'guest2@example.test',notify:'invalid'}
    expect((await post(`${path}/guests`,form,cookie)).status).toBe(400)
    expect(sent).toEqual([])
    expect((await createD1Repositories(db,{consistency:'bookmark'}).bookings.byId(B_EDIT))?.revision).toBe(0)
    expect((await post(`${path}/guests`,{...form,notify:'new'},cookie)).status).toBe(302)
    expect(sent.filter((m)=>m.kind==='email').map((m)=>m.message.to)).toEqual(['guest2@example.test'])
    expect(sent.some((m)=>m.kind==='calendar.sync' && m.action==='update')).toBe(true)
  })
  it('requires CSRF and booking access for both guest edits and manual sync',async()=>{
    const hostCookie=await seedSession(ALICE_ID)
    const strangerCookie=await seedSession(OUTSIDER_ID)
    const path=`/dashboard/bookings/${B_EDIT}`
    for(const action of ['guests','booker','sync']) {
      expect((await post(`${path}/${action}`,{revision:'0',guests:'g@example.test'},hostCookie)).status).toBe(403)
      expect((await post(`${path}/${action}`,{csrf:await csrfFrom('/dashboard',strangerCookie),revision:'0',guests:'g@example.test'},strangerCookie)).status).toBe(404)
    }
  })
  it('edits the booker through the protected route without moving or recreating the meeting',async()=>{
    const cookie=await seedSession(ALICE_ID)
    const path=`/dashboard/bookings/${B_EDIT}`
    const before=(await createD1Repositories(db,{consistency:'bookmark'}).bookings.byId(B_EDIT))!
    const page=await(await get(path,cookie)).text()
    expect(page).toContain('Edit booker')
    expect(page).toContain('Booker email')
    const csrf=await csrfFrom(path,cookie)
    const form={csrf,revision:'0',name:'Replacement Booker',email:'replacement@example.test'}
    expect((await post(`${path}/booker`,{...form,revision:''},cookie)).status).toBe(400)
    const response=await post(`${path}/booker`,form,cookie)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('?booker=1')
    const saved=(await createD1Repositories(db,{consistency:'bookmark'}).bookings.byId(B_EDIT))!
    expect(saved).toMatchObject({guestName:form.name,guestEmail:form.email,startUtc:before.startUtc,endUtc:before.endUtc,
      conferenceUrl:before.conferenceUrl,externalEventIds:before.externalEventIds,revision:1})
    expect(saved.manageTokenHash).not.toBe(before.manageTokenHash)
    expect((await post(`${path}/booker`,form,cookie)).status).toBe(409)
    expect((await post(`${path}/booker`,{...form,revision:'1',email:'invalid'},cookie)).status).toBe(409)
    const {revision,...missingRevision}=form
    expect((await post(`${path}/booker`,missingRevision,cookie)).status).toBe(400)
  })
})

describe('dashboard diagnostics access', () => {
  it('keeps the checker read-only and saves outage policy through event settings', async () => {
    const path = '/dashboard/event-types/' + ET_PERSONAL
    const owner = await seedSession(ALICE_ID)
    const outsider = await seedSession(OUTSIDER_ID)
    expect((await get(path + '/availability', outsider)).status).toBe(404)
    expect((await get(path + '/availability?date=2026-02-30', owner)).status).toBe(400)
    const html = await (await get(path + '/availability', owner)).text()
    expect(html).toContain('Why this time?')
    expect(html).toContain('href="/dashboard/availability">← Availability')
    expect(html).not.toContain('name="policy"')
    expect(html).not.toContain('Save policy')
    expect(await (await get(path, owner)).text()).toContain('value="allow" selected')
    expect((await post(path + '/calendar-policy', { policy: 'block' }, owner)).status).toBe(403)
    const csrf = await csrfFrom(path, owner)
    expect((await post(path + '/calendar-policy', { csrf, policy: 'invalid' }, owner)).status).toBe(400)
    const saved = await post(path + '/calendar-policy', { csrf, policy: 'block' }, owner)
    expect(saved.status).toBe(303)
    expect(saved.headers.get('location')).toBe(path + '?policySaved=1#calendar-outages')
    expect(await (await get(path, owner)).text()).toContain('value="block" selected')
    expect(await (await get(path + '/availability', owner)).text()).toContain('that host is excluded until the check succeeds.')
  })

  it('opens personal and participating team checks directly from Availability', async () => {
    const owner = await seedSession(ALICE_ID)
    const member = await seedSession(BOB_ID)
    const page = await (await get('/dashboard/availability', owner)).text()
    expect(page).toContain('aria-label="Check a time"')
    expect(page).toContain('action="/dashboard/availability/check"')
    expect(page).toContain('<option value="' + ET_PERSONAL + '">')
    expect(page).toContain('<option value="' + ET_TEAM + '">')
    const memberPage = await (await get('/dashboard/availability', member)).text()
    expect(memberPage).not.toContain('<option value="' + ET_PERSONAL + '">')
    expect(memberPage).toContain('<option value="' + ET_TEAM + '">')
    const check = await get('/dashboard/availability/check?event=' + ET_PERSONAL, owner)
    expect(check.status).toBe(302)
    expect(check.headers.get('location')).toBe('/dashboard/event-types/' + ET_PERSONAL + '/availability')
    expect((await get(check.headers.get('location')!, owner)).status).toBe(200)
    const outsider = await seedSession(OUTSIDER_ID)
    expect(await (await get('/dashboard/availability', outsider)).text()).not.toContain('aria-label="Check a time"')
    expect((await get(check.headers.get('location')!, outsider)).status).toBe(404)
  })

  it('lets a participating teammate inspect only their own details without editing policy', async () => {
    const path = '/dashboard/event-types/' + ET_TEAM + '/availability'
    const member = await seedSession(BOB_ID)
    const page = await get(path, member)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<h3>Bob Host')
    expect(html).not.toContain('<h3>Alice Host')
    expect(html).not.toContain('name="policy"')
    expect(
      (await post('/dashboard/event-types/' + ET_TEAM + '/calendar-policy', { csrf: await csrfFrom('/dashboard', member), policy: 'block' }, member)).status,
    ).toBe(404)
    expect((await get(path, await seedSession(OUTSIDER_ID))).status).toBe(404)
    await db
      .prepare('INSERT INTO event_type_hosts (event_type_id,user_id,required) VALUES (?,?,1)')
      .bind(ET_TEAM, ALICE_ID)
      .run()
    expect((await get(path, member)).status).toBe(404)
    expect(await (await get('/dashboard/availability', member)).text()).not.toContain('<option value="' + ET_TEAM + '">')
  })

  it('keeps activity scoped to its booking and hides it from unrelated users',async()=>{
    const path = '/dashboard/bookings/'+B_UP
    const owner = await seedSession(ALICE_ID)
    const outsider = await seedSession(OUTSIDER_ID)
    const csrf = await csrfFrom(path,owner)
    const other = await csrfFrom('/dashboard/bookings',outsider)
    const journal = ports.repositories({consistency:'bookmark'}).activity!
    await journal.add({id:'scoped-step',bookingId:B_TEAM,revision:0,operation:'confirmation',action:'Confirmation',target:'private@example.test',
      role:'Booker',recipient:'private@example.test',detail:'',state:'accepted',created:NOW,updated:NOW,retried:0,receipt:null,payload:null})
    expect((await post(path+'/activity/scoped-step',{csrf,intent:'retry'},owner)).status).toBe(404)
    expect((await post('/dashboard/bookings/'+B_TEAM+'/activity/scoped-step',{csrf:other,intent:'retry'},outsider)).status).toBe(404)
    const html = await (await get(path,owner)).text()
    expect(html).toContain('Booking activity')
    expect(html).not.toContain('private@example.test')
  })
})

describe('calendar queue handoff', () => {
  it.each([false, true])(
    'preserves a queued deletion or an actionable failure when queue rejects=%s',
    async (fault) => {
      const id = 'probe-delete-' + String(fault)
      await seedBooking({
        id,
        eventTypeId: ET_PERSONAL,
        hosts: [ALICE_ID],
        start: NOW + 2 * DAY,
        externalEventIds: { calendar: 'external-event' },
      })
      const cookie = await seedSession(ALICE_ID),
        path = '/dashboard/bookings/' + id
      const csrf = await csrfFrom(path, cookie),
        send = ports.queue.send
      ports.queue.send = async (m) => {
        if (fault && m.kind === 'calendar.sync') throw new Error('fixture queue rejected')
        await send(m)
      }
      try {
        const response = await post(path + '/cancel', { csrf }, cookie)
        expect(response.status).toBe(302)
        expect((await bookingRow(id))?.status).toBe('cancelled')
        const rows = await ports.repositories({ consistency: 'bookmark' }).activity!.list(id)
        expect(
          sent.some((j) => j.kind === 'calendar.sync' && j.bookingId === id && j.action === 'delete') ||
            rows.some((r) => r.action === 'Calendar delete' && r.state === 'failed'),
        ).toBe(true)
      } finally {
        ports.queue.send = send
      }
    },
  )
})

import { overlapsAny } from './core/slots/intervals.js'
/**
 * The composition root (ADR-0003 §1).
 *
 * `createEngine(ports)` is the ONLY way the engine is constructed. Nothing
 * inside reaches for a global binding, which is precisely what lets the cloud
 * control-plane supply tenant-scoped repositories without the engine knowing
 * tenants exist.
 */

import type { EnginePorts, Repositories, RequestScope } from './ports.js'
import { buildRouter } from './http/router.js'
import { bookingFootprint, computeSlots, candidatesInWindow, freeIntervalsForHost, type HostAvailabilityInput } from './core/slots/engine.js'
import type { CalendarConnection, EventType, Interval, Schedule, Slot, User } from './core/domain/types.js'
import { combineBusy, partitionConnections } from './core/domain/booking-service.js'
import { hostSettings } from './core/domain/hosts.js'
import { localDateString, localTimeToInstant } from './core/time/zone.js'
import { needsReconnect } from './adapters/oauth.js'

export interface Engine {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>
  /** Direct domain access for embedders and for the cloud control-plane. */
  slots: SlotService
}

export interface SlotService {
  forEventType(input: {
    eventType: EventType
    hostUsers: User[]
    range: Interval
    scope?: RequestScope
  }): Promise<Slot[]>
}

export interface EngineDeps {
  ports: EnginePorts
}

export function createEngine(ports: EnginePorts): Engine {
  const slots = createSlotService(ports)
  const app = buildRouter(ports, slots)

  return {
    fetch: async (request, env, ctx) => app.fetch(request, env as never, ctx),
    slots,
  }
}

/**
 * The schedule a host's slots are drawn from for one event type — shared by
 * BOTH the listing path (`createSlotService.forEventType` below) and the
 * commit-time re-check (`adapters/coordinator.ts`'s `buildHostInputs`). The
 * two used to disagree: a fix applied only here once left the commit path
 * still validating against the host's default schedule regardless of what
 * was assigned, so a guest booking a real, currently-listed slot on an
 * assigned schedule could 409, while a slot the assigned schedule never
 * offered could still commit. One function, one behavior, both call sites.
 *
 * `scheduleId` is only ever written for a personal event type
 * (dashboard-routes.ts/rest.ts refuse it on a team-owned one), so this needs
 * no `schedulingType` branch — for a team event it's always null and every
 * host falls through to their own default, unchanged. Scoped by `userId`
 * (not just the id) so an assigned schedule can never resolve to a
 * different host's row.
 */
export async function resolveSchedule(
  repos: Repositories,
  userId: string,
  scheduleId: string | null,
): Promise<Schedule | null> {
  if (!scheduleId) return repos.availability.forUser(userId)
  const assigned = await repos.availability.byId(userId, scheduleId)
  return assigned ?? repos.availability.forUser(userId)
}

/**
 * Assembling a host's availability picture.
 *
 * Note where each input comes from, because it is the ADR-0006 §1 rule in
 * code: own bookings and holds are read from D1 (strongly consistent, and the
 * writes users notice immediately), external calendars from KV-cached freeBusy
 * (advisory, re-checked before commit).
 */
export function createSlotService(ports: EnginePorts): SlotService {
  return { forEventType: input => loadSlots(ports, input) }
}

interface CalendarCheck {
  provider: string
  calendars: string[]
  checked: number
  ok: boolean
}

export interface HostExplanation {
  id: string
  name: string
  role: string
  reasons: string[]
  schedule: string
  calendars: string[]
}

export const calendarPolicyKey = (id: string) => 'strict-calendar:' + id

export async function loadSlots(ports: EnginePorts, {eventType, hostUsers, range, scope}: Parameters<SlotService['forEventType']>[0],
  inspect?: {start: number; viewer: string; hosts: HostExplanation[]}): Promise<Slot[]> {
  const repos = ports.repositories(scope ?? { consistency: 'unconstrained' })
  const hostIds = hostUsers.map((u) => u.id)
  if (hostIds.length === 0) return []

  // computeSlots grids each availability window at its OWN unclipped
  // boundary and only filters candidate STARTS to `range` afterward (see
  // core/slots/engine.ts) — so a candidate's buffered footprint (its
  // start minus bufferBefore, its end plus bufferAfter) can legitimately
  // land outside `range` while the start itself stays inside it. Busy
  // data queried only for `range` would then miss real conflicts sitting
  // just outside it, and a listing could advertise a start that
  // deterministically 409s at commit. The exact bound: every candidate
  // start is itself within `range` (computeSlots filters on that), so its
  // footprint can extend earlier by at most bufferBefore, and later by at
  // most the event's own duration plus bufferAfter — `bookingFootprint`
  // applied to `range.start` and `range.end` pushed out by the duration.
  const busyRange = bookingFootprint(
    range.start,
    range.end + eventType.durationMinutes * 60_000,
    eventType,
  )

  const [busyByHost, holdsByHost, settings, policy] = await Promise.all([
    repos.slotLocks.busyBuckets(hostIds, busyRange),
    repos.slotLocks.activeHolds(hostIds, busyRange, ports.clock.now()),
    hostSettings(repos, eventType),
    repos.settings.get(calendarPolicyKey(eventType.id)),
  ])

  // Per-host reads run concurrently rather than in an await loop: with N
  // hosts the sequential version costs N x (availability + connections)
  // round trips, and round-trip count is what the latency budget is spent
  // on (ADR-0007, and the measurement in EventTypeRepository).
  const built: HostAvailabilityInput[] = await Promise.all(
    hostUsers.map(async (user) => {
      // A team host's per-event schedule (event_type_hosts) wins over
      // the event type's own scheduleId, which is only ever set for a
      // personal event type anyway; both fall through to the default.
      const own = settings.get(user.id)
      const [availability, external] = await Promise.all([
        resolveSchedule(repos, user.id, own?.scheduleId ?? eventType.scheduleId),
        checkCalendars(ports, repos, await repos.connections.listForUser(user.id), busyRange, policy === 'block', true),
      ])
      const schedule: HostAvailabilityInput['availability'] = availability ?? { userId:user.id, timezone:user.tz, weekly:[[],[],[],[],[],[],[]], overrides:[] }
      const perDay = await perDayCounts(repos, user, range, eventType, schedule.timezone)
      const input: HostAvailabilityInput = {
        hostUserId: user.id,
        required: own?.required ?? true,
        availability: schedule,
        busy: combineBusy(
          busyByHost.get(user.id) ?? [],
          holdsByHost.get(user.id) ?? [],
          external.busy,
        ),
        bookingsPerLocalDate: perDay,
      }
      if (inspect) {
        const {start, viewer} = inspect
        const date = localDateString(start, schedule.timezone)
        const end = start + eventType.durationMinutes * 60_000
        const footprint = bookingFootprint(start, end, eventType)
        const windows = freeIntervalsForHost(input, range)
        const contains = (i: Interval) => windows.some(w => w.start <= i.start && i.end <= w.end)
        const reasons: string[] = []
        if (!contains({start,end})) reasons.push(schedule.overrides.some(o => o.date === date) ? 'Outside the date override' : 'Outside working hours')
        else if (!contains(footprint)) reasons.push('The meeting fits, but its buffer extends outside working hours')
        if (overlapsAny(footprint, combineBusy(busyByHost.get(user.id) ?? [], [], []))) reasons.push('A booking overlaps the meeting or its buffer')
        if (overlapsAny(footprint, combineBusy([], holdsByHost.get(user.id) ?? [], []))) reasons.push('Another guest temporarily holds this time')
        if (overlapsAny(footprint, external.confirmed)) reasons.push('Busy on a connected calendar during the meeting or buffer')
        if (eventType.maxPerDay != null && (perDay?.get(date) ?? 0) >= eventType.maxPerDay) reasons.push('Daily booking limit reached')
        if (external.checks.some(c => !c.ok)) reasons.push(policy === 'block' ? 'Unavailable until calendars can be checked' : 'Calendar availability unverified; bookings allowed')
        if (eventType.schedulingType !== 'collective' && contains(footprint) &&
            !windows.some(w => candidatesInWindow(w, eventType.durationMinutes * 60_000,
              (eventType.slotIntervalMinutes ?? eventType.durationMinutes) * 60_000,
              eventType.bufferBeforeMinutes * 60_000, eventType.bufferAfterMinutes * 60_000).includes(start))) reasons.push('Between offered start times')
        inspect.hosts.push({id:user.id, name:user.name || user.slug,
          schedule: (availability ? (viewer === user.id ? availability.name : 'Host schedule') : 'No schedule') + ' · ' + schedule.timezone +
            (schedule.overrides.some(o => o.date === date) ? ' · Date override' : ' · Weekly hours'),
          role:eventType.schedulingType === 'round_robin' ? 'Rotation' : own?.required === false ? 'Optional' : 'Required', reasons,
          calendars: external.checks.map(c => {
            const label = viewer === user.id ? c.calendars.join(', ') : c.calendars.length + ' calendar(s)'
            return c.provider + ' · ' + label + ' · ' + (c.ok ? 'checked' : 'check failed') + ' ' + new Date(c.checked).toISOString()
          })})
      }
      return input
    }),
  )
  return computeSlots({eventType, hosts: built, range, now: ports.clock.now()})
}

export async function checkCalendars(ports: EnginePorts, repos: Repositories, connections: CalendarConnection[],
  range: Interval, strict: boolean, cached: boolean) {
  const confirmed: Interval[] = []
  const checks: CalendarCheck[] = []
  for (const conn of partitionConnections(connections).read) {
    const calendars = conn.calendarIdsRead.length ? conn.calendarIdsRead : [conn.provider === 'google' ? 'primary' : conn.providerAccountEmail]
    const key = cached ? 'fb3:' + await ports.crypto.hash(JSON.stringify([conn.id, calendars, range.start, range.end])) : ''
    try {
      const hit = cached ? await ports.cache.get<{busy: Interval[]; checked: number}>(key).catch(() => null) : null
      const failed = new Set<string>()
      let reconnect = false
      const result = hit ?? {busy: await ports.calendars.get(conn.provider).getBusy(conn, range, (ids, error) => {
        ids.forEach(id => failed.add(id))
        reconnect ||= needsReconnect(error)
      }), checked: ports.clock.now()}
      confirmed.push(...result.busy)
      const verified = calendars.filter(id => !failed.has(id))
      if (verified.length) checks.push({provider:conn.provider, calendars:verified, checked:result.checked, ok:true})
      if (failed.size) checks.push({provider:conn.provider, calendars:[...failed], checked:result.checked, ok:false})
      if (reconnect) await repos.connections.updateSyncStatus(conn.id,'needs_reconnect').catch(() => {})
      if (cached && !hit && !failed.size) await ports.cache.put(key, result, 60).catch(() => {})
    } catch (error) {
      checks.push({provider:conn.provider, calendars, checked:ports.clock.now(), ok:false})
      if (needsReconnect(error)) await repos.connections.updateSyncStatus(conn.id, 'needs_reconnect').catch(() => {})
    }
  }
  return {confirmed, checks, busy: strict && checks.some(c => !c.ok) ? [range] : confirmed}
}

/** Per-day booking counts, only when the event type actually caps them. */
async function perDayCounts(
  repos: ReturnType<EnginePorts['repositories']>,
  user: User,
  range: Interval,
  eventType: EventType,
  availabilityTz: string,
): Promise<Map<string, number> | undefined> {
  if (eventType.maxPerDay == null) return undefined
  const counts = new Map<string, number>()
  const bookings = await repos.bookings.listForHost(user.id, {
    start: dayRange(localDateString(range.start, availabilityTz), availabilityTz).start,
    end: dayRange(localDateString(range.end - 1, availabilityTz), availabilityTz).end,
  })
  for (const b of bookings) {
    // Recomputed from `startUtc` in THIS host's own availability timezone —
    // never `b.localDate`. That column is stamped once, in the PRIMARY
    // host's timezone (booking-service.ts), so for a collective booking's
    // non-primary hosts it can name the wrong calendar day near a timezone
    // boundary and undercount their cap.
    const date = localDateString(b.startUtc, availabilityTz)
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }
  return counts
}

/**
 * Which days in a month have any bookable slot.
 *
 * Computed from the same pipeline as the slot list so the calendar can never
 * show a day as available that then turns out to have nothing.
 */
export function daysWithSlots(slots: Slot[], timezone: string): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const s of slots) map.set(localDateString(s.start, timezone), true)
  return map
}

/** The UTC range covering a host-local month. */
export function monthRange(month: string, timezone: string): Interval {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const nextMonth = new Date(Date.UTC(y, m, 1))
  const next = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`
  return {
    start: localTimeToInstant(first, 0, timezone),
    end: localTimeToInstant(next, 0, timezone),
  }
}

/** The UTC range covering one host-local day — NOT start + 24h (DST). */
export function dayRange(date: string, timezone: string): Interval {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
  return {
    start: localTimeToInstant(date, 0, timezone),
    end: localTimeToInstant(nextDate, 0, timezone),
  }
}

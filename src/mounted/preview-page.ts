/** Review-only entry: sample schedule, no storage, calendar connections or email delivery. */
import { parseAdditionalGuests } from '../core/domain/guests.js'
import { computeSlots } from '../core/slots/engine.js'
import { isValidTimeZone, localDateString, localTimeToInstant, localDatesBetween } from '../core/time/zone.js'
import { daysWithSlots, monthRange } from '../engine.js'
import { clampMonth } from '../http/router.js'
import { bookedConfirmation, confirmForm, errorPage, eventHeader, monthGrid, shellFoot, shellHead, slotList, type BookingPageData } from '../http/pages/booking.js'
import type { EventType, User, WeeklySchedule } from '../core/domain/types.js'
import { MOUNT } from './mount.js'

export const DEMO_PATH = '/alex/demo'
export const host: User = { id: 'cadence-preview', email: 'preview@example.invalid', name: 'Alex', tz: 'Europe/London', slug: 'alex', avatarKey: null, company: 'Cadence', jobTitle: null, companyUrl: null, role: 'admin', createdAt: 0 }
export const demoEvent: EventType = {
  id: 'cadence-demo-preview', ownerUserId: host.id, ownerTeamId: null, schedulingType: 'personal', slug: 'demo',
  title: 'See Cadence in action',
  description: 'Choose a time to discuss your project.',
  durationMinutes: 30, slotIntervalMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 10, minNoticeMinutes: 60,
  maxHorizonDays: 60, maxPerDay: null, locationType: 'google_meet', locationValue: null,
  questions: [
    { id: 'company', label: 'Company', type: 'text', required: false },
    { id: 'agenda', label: 'What would you like to discuss?', type: 'textarea', required: false },
  ],
  active: true, createdAt: 0, scheduleId: null,
}

export function previewData(url: URL, now: number): BookingPageData {
  const param = url.searchParams
  const requestedZone = param.get('tz') ?? host.tz
  const zone = isValidTimeZone(requestedZone) ? requestedZone : host.tz
  const currentMonth = localDateString(now, zone).slice(0, 7)
  const requestedDate = param.get('date') ?? ''
  const requestedMonth = param.get('month') ?? requestedDate.slice(0, 7)
  const month = clampMonth(/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : currentMonth, currentMonth, currentMonth, 60)
  const range = monthRange(month, zone)
  const windows = [{ startMinute: 9 * 60, endMinute: 17 * 60 }]
  const weekly: WeeklySchedule = [[], windows, windows, windows, windows, windows, []]
  const busy = localDatesBetween(range.start, range.end, host.tz).map(date => ({
    start: localTimeToInstant(date, 12 * 60, host.tz), end: localTimeToInstant(date, 13 * 60, host.tz),
  }))
  const slots = computeSlots({ eventType: demoEvent, hosts: [{ hostUserId: host.id, availability: { userId: host.id, timezone: host.tz, weekly, overrides: [] }, busy }], range, now })
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate.startsWith(month) ? requestedDate : slots[0] ? localDateString(slots[0].start, zone) : undefined
  return {
    host, eventType: demoEvent, ownerSlug: host.slug, brandName: 'Cadence', month,
    guestTimezone: zone, baseUrl: `${url.origin}${MOUNT}`, daysWithSlots: daysWithSlots(slots, zone),
    selectedDate, slots: slots.filter(slot => localDateString(slot.start, zone) === selectedDate),
  }
}

export async function renderPreview(request: Request, now = Date.now()): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/') {
    url.pathname = `${MOUNT}${DEMO_PATH}`
    return Response.redirect(url.href, 302)
  }
  if (url.pathname !== DEMO_PATH && url.pathname !== `${DEMO_PATH}/confirm`) return new Response('Not found', { status: 404 })
  if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
  let start = Number(url.searchParams.get('start'))
  let values: Record<string, string> = {}
  const errors: Record<string, string> = {}
  if (request.method === 'POST') {
    if (url.pathname !== `${DEMO_PATH}/confirm`) return new Response('Not found', { status: 404 })
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('Expected a booking form', { status: 415 })
    const body = await request.arrayBuffer()
    if (body.byteLength > 16_384) return new Response('Booking form is too large', { status: 413 })
    const form = new URLSearchParams(new TextDecoder().decode(body))
    start = Number(form.get('start'))
    url.searchParams.set('tz', form.get('tz') ?? host.tz)
    for (const key of ['name', 'email', 'additionalGuests']) values[key] = (form.get(key) ?? '').trim().slice(0, 2000)
    for (const question of demoEvent.questions) values[question.id] = (form.get(`q_${question.id}`) ?? '').trim().slice(0, 2000)
    const name = values.name ?? ''
    const email = values.email ?? ''
    const guests = parseAdditionalGuests(values.additionalGuests, email)
    if (guests.error) errors.additionalGuests = guests.error
    if (!name || name.length > 200) errors.name = 'Enter your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = 'Enter a valid email address.'
  }
  const zone = url.searchParams.get('tz') ?? host.tz
  if (url.pathname.endsWith('/confirm') && Number.isFinite(start) && start > 0) url.searchParams.set('date', localDateString(start, isValidTimeZone(zone) ? zone : host.tz))
  const data = previewData(url, now)
  let body: string
  if (url.pathname.endsWith('/confirm')) {
    if (!data.slots?.some(slot => slot.start === start)) return new Response(errorPage('Choose another time', 'That sample time is not available. Return to the calendar to choose a time.'), { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
    if (request.method === 'POST' && !Object.keys(errors).length) {
      body = bookedConfirmation({ eventTitle: demoEvent.title, hostName: host.name, start, guestTimezone: data.guestTimezone, manageUrl: DEMO_PATH, notice: 'This is a design preview. No booking was saved and no calendar invitation was sent.', locationLabel: 'Google Meet' })
        .replace("You're booked", 'Preview complete')
        .replace('>Confirmed<', '>Design preview<')
        .replace('aria-label="Booking confirmed"', 'aria-label="Booking preview complete"')
        .replace('Reschedule or cancel', 'Choose another time')
    } else body = eventHeader(data) + confirmForm({ ...data, confirmStart: start }, start, { errors, values })
  } else body = eventHeader(data) + `<div class="pu-grid">${monthGrid(data)}${slotList(data)}</div>`
  return new Response(shellHead({ title: 'Book a demo — Cadence', brandName: 'Cadence', ...(url.pathname === DEMO_PATH ? { surface: 'calendar' as const } : {}) }) + body + shellFoot(false), { status: Object.keys(errors).length ? 422 : 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}


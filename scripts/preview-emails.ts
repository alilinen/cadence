/** Local design evidence only. No credentials, calendar writes or email sending. */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Booking, EventType, User } from '../src/core/domain/types.js'
import * as mail from '../src/core/email-templates.js'

const host: User = { id: 'preview', email: 'alex@example.invalid', name: 'Alex', tz: 'Europe/London', slug: 'alex', avatarKey: null, company: 'Cadence', jobTitle: null, companyUrl: 'https://organizer.example', role: 'admin', createdAt: 0 }
const eventType: EventType = { id: 'preview', ownerUserId: host.id, ownerTeamId: null, schedulingType: 'personal', slug: 'demo', title: 'See Cadence in action', description: '', durationMinutes: 30, slotIntervalMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 10, minNoticeMinutes: 60, maxHorizonDays: 60, maxPerDay: null, locationType: 'google_meet', locationValue: null, questions: [], active: true, createdAt: 0, scheduleId: null }
const startUtc = Date.UTC(2026, 9, 29, 10)
const booking: Booking = { id: 'preview', eventTypeId: eventType.id, hostUserId: host.id, hostUserIds: [host.id], guestName: 'Taylor Morgan', guestEmail: 'taylor@example.invalid', guestTimezone: 'Europe/London', startUtc, endUtc: startUtc + 1_800_000, localDate: '2026-10-29', status: 'confirmed', answers: {}, externalEventIds: {}, conferenceUrl: 'https://meet.google.com/example-preview', rescheduleOf: null, rescheduledTo: null, manageTokenHash: '', cancelledAt: null, createdAt: 0 }
const baseUrl = 'https://organizer.example/book'
const context: mail.BookingEmailContext = { booking, eventType, host, brandName: 'Cadence', baseUrl, supportEmail: host.email, rescheduleUrl: 'https://organizer.example/book/preview/reschedule', cancelUrl: 'https://organizer.example/book/preview/cancel', bookingUrl: 'https://organizer.example/book/dashboard/bookings/preview' }
const hostChange: mail.BookingHostChangeInput = { brandName: 'Cadence', baseUrl, hostName: 'Alex', hostTz: host.tz, eventTitle: eventType.title, guestName: booking.guestName, guestEmail: booking.guestEmail, startUtc, endUtc: booking.endUtc, hostNames: ['Alex'], editorName: 'Taylor', bookingUrl: context.bookingUrl!, supportEmail: host.email }
const examples: Record<string, mail.EmailContent> = {
  confirmation: mail.bookingConfirmationForGuest(context),
  'host-confirmation': mail.bookingConfirmationForHost(context),
  rescheduled: mail.bookingRescheduled({ ...context, audience: 'guest', previous: { startUtc: startUtc - 3_600_000, endUtc: booking.endUtc - 3_600_000 } }),
  cancelled: mail.bookingCancelled({ ...context, audience: 'guest', cancelledBy: 'guest', rebookUrl: 'https://organizer.example/book' }),
  reminder: mail.bookingReminder({ ...context, audience: 'guest', when: '1h' }),
  'sign-in': mail.magicLinkEmail({ brandName: 'Cadence', baseUrl, url: 'https://organizer.example/book/preview/sign-in', ip: '192.0.2.1', userAgent: 'Chrome on macOS', expiresMinutes: 15, supportEmail: host.email }),
  digest: mail.dailyDigestEmail({ brandName: 'Cadence', baseUrl, host, date: '2026-10-29', meetings: [{ booking, eventType, coHosts: [] }], dashboardUrl: 'https://organizer.example/book/dashboard' }),
  'host-added': mail.hostAddedEmail({ brandName: 'Cadence', baseUrl, eventTitle: eventType.title, teamName: 'Cadence', schedulingType: 'collective', required: true, scheduleName: 'Working hours', editorName: 'Taylor', availabilityUrl: 'https://organizer.example/book/dashboard/availability' }),
  'booking-host-added': mail.hostAddedToBookingEmail(hostChange),
  'booking-host-removed': mail.hostRemovedFromBookingEmail(hostChange),
}
const output = resolve('proof/emails') + '/'
mkdirSync(output, { recursive: true })
copyFileSync('assets/cadence-email.png', `${output}cadence-email.png`)
for (const [name, content] of Object.entries(examples)) {
  if (!content.html.startsWith('<!doctype html>') || !content.text) throw new Error(`Incomplete email: ${name}`)
  writeFileSync(`${output}${name}.html`, content.html.replace(`${baseUrl}/cadence-email.png`, 'cadence-email.png'))
  writeFileSync(`${output}${name}.txt`, content.text)
}
writeFileSync(`${output}index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadence email previews</title><body style="font:16px/1.6 Arial,sans-serif;padding:24px;color:#161a1f;background:#f9f9f9"><h1>Cadence email previews</h1><p>Illustrative messages. These links do not sign in or manage a real booking.</p><ul>${Object.keys(examples).map(name => `<li><a href="${name}.html">${name.replaceAll('-', ' ')}</a> · <a href="${name}.txt">plain text</a></li>`).join('')}</ul></body></html>`)
console.log(`Rendered ${Object.keys(examples).length} email examples in proof/emails/`)

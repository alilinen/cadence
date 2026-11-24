/** Local-only dashboard renderer. No authentication, credentials, storage or writes. */
import { createMeetingPage } from '../http/pages/create-meeting.js'
import { apiKeysPage, hostBookingPage, bookingsPage, connectionsPage, dashboardHome, schedulesPage, settingsPage, teamsPage } from '../http/pages/dashboard.js'
import { demoEvent, host } from './preview-page.js'
import type { Schedule } from '../core/domain/types.js'

export function previewDashboard(url: URL, mount = '/book'): Response {
  if (!url.pathname.startsWith('/dashboard')) return new Response('Not found', { status: 404 })
  const chrome = { brandName: 'Cadence', user: host, csrf: 'preview-only', emailDelivery: 'cloudflare' as const }
  const hours = [{ startMinute: 540, endMinute: 1020 }]
  const schedule: Schedule = { id: 'preview-hours', userId: host.id, name: 'Working hours', timezone: host.tz,
    isDefault: true, weekly: [[], hours, hours, hours, hours, hours, []], overrides: [] }
  const baseUrl = `${url.origin}${mount}`
  const poolEvent = { ...demoEvent, id: 'cadence-pool-preview', title: 'Team introduction', schedulingType: 'round_robin' as const, ownerUserId: null, ownerTeamId: 'sample-team' }
  let html: string
  switch (url.pathname) {
    case '/dashboard': html = dashboardHome({ ...chrome, baseUrl, eventTypes: [{ eventType: demoEvent, ownerSlug: host.slug }], upcomingBookings: [], hasCalendarConnection: false, defaultSchedule: schedule }); break
    case '/dashboard/meetings/new': {
      const source = url.searchParams.get('source') ?? ''
      const eventType = [demoEvent, poolEvent].find((et) => source === `event:${et.id}`)
      html = createMeetingPage({ ...chrome, sources: [{ value: 'one-off', label: 'One-off meeting · with me' }, ...[demoEvent, poolEvent].map((et) => ({ value: `event:${et.id}`, label: et.title }))], source, eventType,
        hosts: [{ user: host, optional: false }, ...(eventType === poolEvent ? [{ user: { ...host, id: 'sample-cohost', name: 'Jamie', email: 'jamie@example.invalid' }, optional: false }] : [])], requestKey: 'preview-only' })
      break
    }
    case '/dashboard/bookings/preview': {
      const start = Date.UTC(2026,10,17,14)
      html = hostBookingPage({ ...chrome, booking: { id:'preview',eventTypeId:demoEvent.id,
        hostUserId:host.id,hostUserIds:[host.id],guestName:'Alex Morgan',guestEmail:'alex@example.invalid',
        additionalGuests:['jamie@example.invalid'],guestTimezone:'Europe/London',startUtc:start,endUtc:start+1_800_000,
        localDate:'2026-11-17',status:'confirmed',answers:{},externalEventIds:{preview:'preview-event'},
        conferenceUrl:null,rescheduleOf:null,rescheduledTo:null,manageTokenHash:'preview-only',cancelledAt:null,createdAt:start-86_400_000,
        revision:0,calendarSyncRevision:0,calendarCheckedAt:start-86_400_000,
      },eventType:demoEvent,canEditEventType:false,teamName:null,participants:[{user:host,required:null,attends:true}],
        canChangeHosts:false,addable:[],now:start-86_400_000 })
      break
    }
    case '/dashboard/bookings': html = bookingsPage({ ...chrome, view: 'upcoming', rows: [], truncated: false }); break
    case '/dashboard/availability': html = schedulesPage({ ...chrome, schedules: [schedule] }); break
    case '/dashboard/connections': html = connectionsPage({ ...chrome, connections: [], availableProviders: [] }); break
    case '/dashboard/settings': html = settingsPage({ ...chrome, baseUrl, channels: [] }); break
    case '/dashboard/api-keys': html = apiKeysPage({ ...chrome, keys: [] }); break
    case '/dashboard/teams': html = teamsPage({ ...chrome, teams: [] }); break
    default: return new Response('This dashboard action is available after production setup. This preview cannot save changes.', { status: 404 })
  }
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

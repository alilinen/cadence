import type { EventType, Slot } from '../../core/domain/types.js'
import type { HostExplanation } from '../../engine.js'
import { escapeHtml as esc } from './booking.js'
import { shellBottom, shellTop, type DashboardChrome } from './dashboard.js'

export function inspectorPage(
  chrome: DashboardChrome,
  et: EventType,
  date: string,
  time: string,
  start: number,
  now: number,
  hosts: HostExplanation[],
  slots: Slot[],
  strict: boolean,
  otherOccurrence?: string,
  manage = true,
) {
  const path = '/dashboard/event-types/' + encodeURIComponent(et.id)
  const slot = slots.find((s) => s.start === start)
  const reasons = []
  if (!et.active) reasons.push('This event type is paused.')
  if (start < now + et.minNoticeMinutes * 60_000)
    reasons.push('This start is before the minimum notice period.')
  if (start > now + et.maxHorizonDays * 86_400_000) reasons.push('This start is beyond the booking horizon.')
  if (!hosts.length) reasons.push('No participating hosts.')
  if (
    !slot &&
    !reasons.length &&
    et.schedulingType === 'collective' &&
    !hosts.some((h) => h.role === 'Required' && h.reasons.length)
  )
    reasons.push(manage ? 'This start is outside the shared slot grid for required hosts.' : 'The required hosts do not share an available start at this time.')
  return (
    shellTop(chrome, 'Why this time?', 'availability') +
    `<p><a href="/dashboard/availability">← Availability</a></p>
  <h1>Why this time?</h1><p>${esc(et.title)}</p>
  <div class="pu-grid" style="grid-template-columns:1fr">
  <form method="get" class="pu-card">
  <label>Date <input name="date" type="date" value="${esc(date)}" required></label>
  <label>Start time (${esc(chrome.user.tz)}) <input name="time" type="time" value="${esc(time)}" required></label>
  <div style="margin-top:1rem"><button class="pu-btn">Check time</button></div></form>
  ${
    slots.length
      ? `<details class="pu-card"><summary>Available starts on this day (${slots.length})</summary>
  <ul>${slots.map((s) => `<li><a href="?date=${esc(date)}&amp;instant=${s.start}">${esc(new Date(s.start).toLocaleTimeString('en-GB', { timeZone: chrome.user.tz, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }))}</a></li>`).join('')}</ul></details>`
      : ''
  }
  ${otherOccurrence ? `<p>This clock time occurs twice. <a href="${esc(otherOccurrence)}">Inspect the other occurrence</a></p>` : ''}
  <section class="pu-card"><h2>${slot ? 'Available' : 'Unavailable'}</h2>
  <p>${esc(new Date(start).toLocaleString('en-GB', { timeZone: chrome.user.tz, timeZoneName: 'short' }))} · ${et.durationMinutes} min</p>
  <p>Starts every ${et.slotIntervalMinutes ?? et.durationMinutes} min · Buffer ${et.bufferBeforeMinutes} min before and ${et.bufferAfterMinutes} min after · Minimum notice ${et.minNoticeMinutes} min · ${et.maxHorizonDays}-day horizon</p>
  ${reasons.map((r) => `<p>${esc(r)}</p>`).join('')}
  ${hosts
    .map(
      (h) => `<h3>${esc(h.name)} · ${esc(h.role)}</h3>
  <p>${esc(h.schedule)}</p><p>${esc(h.reasons.join('. ') || (slot?.eligibleHostIds.includes(h.id) ? 'Available for this start' : 'No individual conflict found'))}</p>
  ${h.calendars.length ? '<ul>' + h.calendars.map((c) => `<li>${esc(c)}</li>`).join('') + '</ul>' : '<p>No external calendar selected for conflict checks.</p>'}`,
    )
    .join('')}
  <p><a href="/dashboard/availability">Working hours</a> · <a href="/dashboard/connections">My calendar connections</a>${manage ? ` · <a href="${path}">Event rules</a>` : ''}</p></section>
  <section class="pu-card"><h2>Calendar outages</h2>
  <p>If a participating host’s calendar cannot be checked, ${strict ? 'that host is excluded until the check succeeds.' : 'bookings use known availability.'}</p>
  ${manage ? `<p><a href="${path}#calendar-outages">Edit outage policy in event settings</a></p>` : ''}</section></div>` +
    shellBottom(chrome.brandName)
  )
}

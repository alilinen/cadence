import type { CalendarSelection, CalendarShare, SharedCalendarEvent } from '../../ports.js'
import { formatInZone, localTimeToInstant, shiftDate } from '../../core/time/zone.js'
import { shellTop, shellBottom, csrfField, type DashboardChrome } from './dashboard.js'
import { escapeHtml as esc } from './booking.js'

export interface SharedPerson { id: string; name: string; slug: string }
export interface CalendarChoice extends CalendarSelection { name: string; account: string }
export interface PersonWeek { person: SharedPerson; events: SharedCalendarEvent[]; incomplete: boolean }
const path = '/dashboard/shared-calendar'
const name = (p: SharedPerson) => p.name || p.slug
const selectionValue = (s: CalendarSelection) => JSON.stringify([s.connectionId, s.calendarId])

export function sharingPage(chrome: DashboardChrome, teammates: SharedPerson[], shares: CalendarShare[], choices: CalendarChoice[], unavailable: boolean, notice?: string) {
  return shellTop(chrome, 'Calendar sharing', 'shared') +
    `<p><a href="${path}">← Shared calendar</a></p><h1>Calendar sharing</h1>
    <p class="pu-muted">Choose who can see your week. Sharing is off for each teammate until you save their access.</p>
    ${notice ? `<p role="status" class="pu-notice">${esc(notice)}</p>` : ''}
    ${unavailable ? '<p role="alert">Some calendars could not be loaded. Saving will share titles only from the calendars checked below.</p>' : ''}
    ${!teammates.length ? '<p class="pu-card">Join a team to share your calendar.</p>' : ''}
    ${teammates.map(person => {
      const grant = shares.find(s => s.ownerId === chrome.user.id && s.viewerId === person.id)
      const selected = new Set(grant?.calendars.map(selectionValue))
      const action = `${path}/sharing/${encodeURIComponent(person.id)}`
      return `<details class="pu-card pu-sharing"><summary><strong>${esc(name(person))}</strong><span>${grant ? 'Sharing on' : 'Sharing off'}</span></summary>
        <form method="post" action="${action}">${csrfField(chrome.csrf)}
        <fieldset class="pu-fs"><legend>Show meeting titles from</legend>
        ${choices.length ? choices.map(c => `<label class="pu-option"><input type="checkbox" name="calendar" value="${esc(selectionValue(c))}" ${selected.has(selectionValue(c)) ? 'checked' : ''}>
          <span>${esc(c.name)} <small>${esc(c.account)}</small></span></label>`).join('') : '<p>No calendars available for sharing titles.</p>'}
        </fieldset>
        <p class="pu-help">Choose calendars you have permission to share. This person will see titles and times from the selected calendars. Your other availability conflicts and private meetings appear as Busy. Attendees, notes and meeting links stay private.</p>
        <div class="pu-actions"><button class="pu-btn" name="intent" value="save">${grant ? 'Save changes' : 'Share my calendar'}</button>
        ${grant ? '<button class="pu-btn pu-btn-ghost" name="intent" value="revoke">Revoke access</button>' : ''}</div></form></details>`
    }).join('')}` + shellBottom(chrome.brandName)
}

export function sharedCalendarPage(chrome: DashboardChrome, monday: string, available: SharedPerson[], weeks: PersonWeek[]) {
  const zone = chrome.user.tz
  const days = Array.from({length:7}, (_,i) => shiftDate(monday, i))
  const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => formatInZone(localTimeToInstant(date, 720, zone), zone, options)
  const first = dateLabel(monday, {month:'short', day:'numeric'})
  const last = dateLabel(days[6]!, {month:'short', day:'numeric', year:'numeric'})
  const link = (delta: number) => {
    const search = new URLSearchParams({ week: shiftDate(monday, delta), filter: '1' })
    for (const w of weeks) search.append('person', w.person.id)
    return esc(path + '?' + search)
  }
  const clock = (time: number) => formatInZone(time, zone, {hour:'2-digit', minute:'2-digit'})
  return shellTop(chrome, 'Shared calendar', 'shared') +
    `<div class="pu-meeting-heading"><h1>Shared calendar</h1><a class="pu-btn pu-btn-ghost" href="${path}/sharing">Manage sharing</a></div>
    ${!available.length ? '<section class="pu-card"><h2>No calendars shared with you yet</h2><p>A teammate can give you access from Manage sharing in their dashboard.</p></section>' :
    `<form method="get" action="${path}" class="pu-person-filter"><input type="hidden" name="filter" value="1"><input type="hidden" name="week" value="${monday}">
    <fieldset><legend>Show teammates</legend>${available.map(p => `<label><input name="person" type="checkbox" value="${esc(p.id)}" ${weeks.some(w=>w.person.id===p.id) ? 'checked' : ''}>${esc(name(p))}</label>`).join('')}</fieldset>
    <button class="pu-btn pu-btn-ghost">Apply</button></form>
    <section class="pu-card"><div class="pu-week-heading"><div><h2>${first} – ${last}</h2><small>${esc(zone)}</small></div>
    <nav aria-label="Choose week"><a href="${link(-7)}" aria-label="Previous week">←</a> <a href="${path}">This week</a> <a href="${link(7)}" aria-label="Next week">→</a></nav></div>
    ${weeks.filter(w=>w.incomplete).map(w=>`<p class="pu-notice" role="status">Some calendar information for ${esc(name(w.person))} is unavailable.</p>`).join('')}
    ${weeks.length ? `<div class="pu-shared-week">${days.map(date=>{
      const start = localTimeToInstant(date, 0, zone), end = localTimeToInstant(date, 1440, zone)
      const items = weeks.flatMap(w=>w.events.filter(e=>e.start<end && e.end>start).map(event=>({ event, person: w.person }))).sort((a,b)=>a.event.start-b.event.start)
      return `<section class="pu-shared-day"><h3>${dateLabel(date,{weekday:'short',day:'numeric'})}</h3>
      ${items.length ? items.map(({event:e,person})=>`<article class="pu-calendar-item${e.title ? '' : ' busy'}">
        <small>${e.allDay || (e.start<=start && e.end>=end) ? 'All day' : `${clock(Math.max(start,e.start))}–${clock(Math.min(end,e.end))}`}${e.free ? ' · Free' : ''}</small>
        <strong>${esc(e.title || 'Busy')}</strong><span>${esc(name(person))}</span></article>`).join('') : '<span class="pu-muted" aria-label="No events">—</span>'}</section>`
    }).join('')}</div>` : '<p>Select a teammate to see their week.</p>'}</section>`}` + shellBottom(chrome.brandName)
}

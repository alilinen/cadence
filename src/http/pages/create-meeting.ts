import type { EventType, User } from '../../core/domain/types.js'
import { additionalGuestsField, bookingQuestionFields, escapeHtml } from './booking.js'
import { csrfField, shellBottom, shellTop, type DashboardChrome } from './dashboard.js'

export interface MeetingSource { value: string; label: string }
export interface CreateMeetingData extends DashboardChrome {
  sources: MeetingSource[]
  source?: string
  eventType?: EventType
  hosts?: Array<{ user: User; optional: boolean }>
  values?: Record<string, string>
  selectedHostIds?: string[]
  errors?: Record<string, string>
  capableHosts?: Set<string>
  requestKey: string
}

export function createMeetingPage(d: CreateMeetingData): string {
  const v = d.values ?? {}
  const errors = d.errors ?? {}
  const source = d.sources.find((s) => s.value === d.source)
  const field = (key: string, label: string, type = 'text', fallback = '', attributes = '') => `<div class="pu-meeting-field">
    <label for="${key}">${label}</label><input id="${key}" name="${key}" type="${type}" value="${escapeHtml(v[key] ?? fallback)}" ${attributes}${errors[key] ? ` aria-invalid="true" aria-describedby="err-${key}"` : ''}>
    ${errors[key] ? `<p class="pu-err" id="err-${key}">${escapeHtml(errors[key])}</p>` : ''}</div>`
  const formFields = new Set(['title', 'duration', 'locationValue', 'when', 'timezone', 'hosts', 'name', 'email', 'additionalGuests'])
  const summary = Object.keys(errors).length ? `<div class="pu-callout" role="alert" tabindex="-1" id="meeting-errors"><strong>Check these details</strong><ul>${Object.entries(errors).map(([key, error]) => `<li><a href="#${escapeHtml(formFields.has(key) ? key : `q-${key}`)}">${escapeHtml(error)}</a></li>`).join('')}</ul></div><script>document.getElementById('meeting-errors').focus()</script>` : ''
  const oneOff = !d.eventType
  const roundRobin = d.eventType?.schedulingType === 'round_robin'
  return shellTop(d, 'Create meeting', 'bookings') + `
    <div class="pu-meeting-heading"><div><h1>Create meeting</h1><p class="pu-muted">One person or a whole group. Get everyone into the same conversation.</p></div><a class="pu-btn pu-btn-ghost" href="/dashboard/bookings">Back to bookings</a></div>
    ${source ? `
    <div class="pu-meeting-layout">
      <section class="pu-card" aria-label="Meeting details">${summary}
        <div class="pu-card-title"><h2>${escapeHtml(source.label)}</h2><a href="/dashboard/meetings/new">Change</a></div>
        <form method="post" action="/dashboard/meetings" class="pu-meeting-form">
          ${csrfField(d.csrf)}<input type="hidden" name="source" value="${escapeHtml(source.value)}"><input type="hidden" name="requestKey" value="${escapeHtml(d.requestKey)}">
          ${oneOff ? `<fieldset><legend>Meeting details</legend>
            ${field('title', 'Meeting title', 'text', '', 'required maxlength="200"')}
            <div class="pu-meeting-pair">${field('duration', 'Duration (minutes)', 'number', '30', 'required min="5" max="480" step="5"')}
            <div class="pu-meeting-field"><label for="location">Location</label><select id="location" name="location">${d.capableHosts?.size ? `<option value="google_meet"${v['location'] !== 'custom' ? ' selected' : ''}>Automatic video link (Google Meet or Teams)</option>` : ''}<option value="custom"${v['location'] === 'custom' ? ' selected' : ''}>Custom link or location</option></select></div></div>
            <div id="custom-location">${field('locationValue', 'Custom link or location', 'text', '', 'maxlength="500"')}</div>
            <script>(()=>{const select=document.getElementById('location');const custom=document.getElementById('custom-location');const update=()=>{custom.hidden=select.value!=='custom';};select.addEventListener('change',update);update();})()</script>
          </fieldset>` : ''}
          <fieldset><legend>When</legend><div class="pu-meeting-pair">
            ${field('when', 'Date and time', 'datetime-local', '', 'required step="300"')}
            ${field('timezone', 'Timezone', 'text', d.user.tz, 'required list="meeting-timezones"')}
            <datalist id="meeting-timezones">${[...new Set([d.user.tz, 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'UTC'])].map((zone) => `<option value="${escapeHtml(zone)}">`).join('')}</datalist>
          </div><p class="pu-muted">${d.eventType ? `${d.eventType.durationMinutes} minutes. ` : ''}Working hours and Cadence bookings are checked for every host. Connected calendars also contribute their selected conflicts.</p></fieldset>
          <fieldset id="hosts"><legend>${roundRobin ? 'Host pool' : 'Hosts'}</legend>
            ${roundRobin ? '<p class="pu-muted">One available host from this pool will be assigned.</p>' : ''}
            ${(d.hosts ?? []).map(({ user, optional }) => oneOff && source.value.startsWith('team:')
              ? `<label class="pu-host-choice"><input type="checkbox" name="hostIds" value="${escapeHtml(user.id)}"${(d.selectedHostIds ?? [d.user.id]).includes(user.id) ? ' checked' : ''}><span>${escapeHtml(user.name || user.email)}<small>${escapeHtml(user.email)}</small></span></label>`
              : `<p class="pu-meeting-host">${escapeHtml(user.name || user.email)}${roundRobin ? '' : ` <span class="pu-muted">${optional ? 'Optional · joins when available' : 'Required'}</span>`}</p>`).join('')}
            ${errors['hosts'] ? `<p class="pu-err">${escapeHtml(errors['hosts'])}</p>` : ''}
          </fieldset>
          <fieldset><legend>Guests</legend><div class="pu-meeting-pair">
            ${field('name', 'Primary guest name', 'text', '', 'required maxlength="200"')}
            ${field('email', 'Primary guest email', 'email', '', 'required maxlength="254"')}
          </div>${additionalGuestsField(v['additionalGuests'], errors['additionalGuests'])}</fieldset>
          <fieldset><legend>Notes</legend>${bookingQuestionFields(d.eventType ?? { questions: [] }, v, errors)}</fieldset>
          <div class="pu-meeting-submit"><button class="pu-btn" type="submit">Create meeting</button><p class="pu-muted">${d.emailDelivery === 'console' ? 'Email delivery is off for this installation.' : 'Booking emails go to guests and participating hosts.'}</p></div>
        </form>
      </section>
      <aside class="pu-meeting-aside"><h2>${oneOff ? 'Just this meeting' : 'Your event, already set up'}</h2><p>${oneOff ? 'Set a title, a time and the people you need. This meeting stays private and won’t create a public booking link.' : 'Use the event’s duration, hosts, location and booking questions.'}</p><hr><h3>One-to-one or one-to-many</h3><p>Start with one guest. Add more email addresses to bring the group together.</p><p>After creating the meeting, manage it from Bookings.</p></aside>
    </div>` : `
    <section class="pu-card pu-meeting-source" aria-label="Choose a meeting">
      <h2>Start with a meeting type</h2><p class="pu-muted">Use a saved event type, or arrange a one-off without setting up a booking page.</p>
      <form method="get" action="/dashboard/meetings/new"><label for="source">Meeting type</label><select id="source" name="source">${d.sources.map((s) => `<option value="${escapeHtml(s.value)}">${escapeHtml(s.label)}</option>`).join('')}</select><div class="pu-meeting-submit"><button class="pu-btn" type="submit">Continue</button></div></form>
    </section>`}` + shellBottom(d.brandName)
}

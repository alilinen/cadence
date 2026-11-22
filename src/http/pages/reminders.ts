import type { Booking, EventType } from '../../core/domain/types.js'
import { MAX_REMINDERS, reminderLead, REMINDER_FIELDS, type ReminderRule } from '../../core/domain/reminders.js'
import { bookingReminder, type EmailAudience, type EmailContent } from '../../core/email-templates.js'
import { escapeHtml as esc } from './booking.js'
import { csrfField, shellBottom, shellTop, type DashboardChrome } from './dashboard.js'

export function readReminderRules(form: FormData): ReminderRule[] {
  const values = (name: string) => form.getAll(name).map(v => String(v).trim())
  const amounts = values('amount'), units = values('unit'), audiences = values('audience')
  const subjects = values('subject'), messages = values('message')
  return amounts.map((amount,i) => ({
    minutes: Number(amount) * ({ minutes: 1, hours: 60, days: 1440 }[units[i] ?? ''] ?? NaN),
    audience: audiences[i] as ReminderRule['audience'],
    subject: subjects[i] || undefined, message: messages[i] || undefined,
  }))
}

export function sampleReminder(chrome: DashboardChrome, eventType: EventType, rule: ReminderRule, audience: EmailAudience, start: number, branding: { baseUrl: string; logoUrl?: string }) {
  const booking: Booking = {
    id: 'preview', eventTypeId: eventType.id, hostUserId: chrome.user.id, hostUserIds: [chrome.user.id],
    guestName: 'Alex Morgan', guestEmail: 'alex@example.invalid', guestTimezone: chrome.user.tz,
    startUtc: start, endUtc: start + eventType.durationMinutes * 60_000, status: 'confirmed',
    conferenceUrl: eventType.locationType === 'google_meet' ? 'https://meet.google.com/example-room' : null,
    localDate: '', externalEventIds: {}, answers: {}, manageTokenHash: '', rescheduleOf: null, rescheduledTo: null,
    cancelledAt: null, createdAt: 0,
  }
  return bookingReminder({ ...branding, host: chrome.user, booking, eventType, when: rule, audience, brandName: chrome.brandName })
}

export function remindersPage(chrome: DashboardChrome, et: EventType, rules: ReminderRule[], version: string, options: {
  error?: string; notice?: string; preview?: EmailContent; open?: number
} = {}) {
  const action = '/dashboard/event-types/' + encodeURIComponent(et.id)
  return shellTop(chrome, 'Email reminders', 'events') + `<p><a href="${action}">← ${esc(et.title)}</a></p><h1>Email reminders</h1>
    <p class="pu-muted">Set when hosts and guests hear from you before ${esc(et.title)}.</p>
    ${options.error ? `<p role="alert" class="pu-callout">${esc(options.error)}</p>` : ''}
    ${options.notice ? `<p role="status" class="pu-notice">${esc(options.notice)}</p>` : ''}
    <form method="post" action="${action}/reminders" class="pu-reminder-form">${csrfField(chrome.csrf)}
    <input type="hidden" name="version" value="${esc(version)}">
    ${rules.map((r,i) => {
      const unit = r.minutes && r.minutes % 1440 === 0 ? 'days' : r.minutes && r.minutes % 60 === 0 ? 'hours' : 'minutes'
      const amount = r.minutes / (unit === 'days' ? 1440 : unit === 'hours' ? 60 : 1)
      return `<details class="pu-card pu-reminder"${i === (options.open ?? 0) ? ' open' : ''}><summary><strong>${Number.isInteger(r.minutes) && r.minutes > 0 ? esc(reminderLead(r.minutes)) + ' before' : 'Reminder'}</strong> <small>${r.audience === 'both' ? 'Guests and hosts' : r.audience === 'hosts' ? 'Hosts' : 'Guests'}</small></summary>
        <div class="pu-rule-fields"><div><label for="amount-${i}">Send before the meeting</label>
        <div class="pu-rule-when"><input id="amount-${i}" type="number" name="amount" min="1" max="43200" required value="${Number.isFinite(amount) ? amount : ''}">
        <select name="unit" aria-label="Time unit">${['minutes','hours','days'].map(u=>`<option${u === unit ? ' selected' : ''}>${u}</option>`).join('')}</select></div></div>
        <div><label for="audience-${i}">Send to</label><select id="audience-${i}" name="audience">
        ${Object.entries({both:'Guests and participating hosts',guests:'Guests',hosts:'Participating hosts'}).map(([key,label])=>`<option value="${key}"${key === r.audience ? ' selected' : ''}>${label}</option>`).join('')}</select></div></div>
        <label for="subject-${i}">Subject</label><input id="subject-${i}" name="subject" maxlength="180" value="${esc(r.subject ?? '')}" placeholder="Use the standard reminder subject">
        <label for="message-${i}">Message</label><textarea id="message-${i}" name="message" maxlength="2000" rows="3" placeholder="Use the standard reminder message">${esc(r.message ?? '')}</textarea>
        <p class="pu-help">Personalize your message with ${REMINDER_FIELDS.map(f=>`<code>{${f}}</code>`).join(' ')}. Meeting details appear below your message.</p>
        <div class="pu-actions">${(['guest','host'] as const).filter(a=>r.audience==='both' || r.audience===a+'s').map(a=>`<button class="pu-btn pu-btn-ghost" name="intent" value="preview-${a}-${i}">Preview ${a} email</button>`).join('')}
        <button class="pu-btn pu-btn-ghost" name="intent" value="remove-${i}" formnovalidate>Remove</button></div></details>`
    }).join('') || '<p class="pu-card">No reminders. Save to turn off reminder emails for this event type.</p>'}
    <div class="pu-actions">${rules.length < MAX_REMINDERS ? '<button class="pu-btn pu-btn-ghost" name="intent" value="add" formnovalidate>Add reminder</button>' : ''}
    <button name="intent" value="save" class="pu-btn">Save reminders</button></div></form>
    ${options.preview ? `<section class="pu-card" id="email-preview"><h2>Email preview</h2><p><strong>Subject</strong> ${esc(options.preview.subject)}</p>
      <iframe title="Reminder email preview" sandbox="" srcdoc="${esc(options.preview.html)}" class="pu-email-preview"></iframe></section>` : ''}` + shellBottom(chrome.brandName)
}

import type { BookingAppearance } from '../../core/domain/appearance.js'
import { LAYOUTS, THEME_BEHAVIOURS } from '../../core/domain/appearance.js'
import type { EventType, Slot, Team } from '../../core/domain/types.js'
import { localDateString, localTimeToInstant, shiftDate } from '../../core/time/zone.js'
import { bookingCalendar, escapeHtml as esc, eventHeader, logoHtml, shellFoot, shellHead, type BookingPageData } from './booking.js'
import { csrfField, shellBottom, shellTop, type DashboardChrome } from './dashboard.js'

export function appearancePage(chrome: DashboardChrome, teams: Team[], team: Team | null, value: BookingAppearance, notice?: string, error?: string) {
  const action = '/dashboard/appearance' + (team ? '?team=' + encodeURIComponent(team.id) : '')
  function palette(mode: 'light' | 'dark') {
    const colours = mode === 'light' ? value : value.dark ?? value
    const field = (key: 'accent' | 'background', label: string, fallback: string) => {
      const name = mode === 'light' ? key : 'dark-' + key
      return `<div class="pu-colour"><label class="pu-option"><input type="checkbox" id="enable-${name}" name="enable-${name}"${colours[key] ? ' checked' : ''}>${label}</label>
        <input type="color" name="${name}" aria-label="${mode} mode ${label.toLowerCase()} colour" value="${esc(colours[key] ?? fallback)}"></div>`
    }
    return `<fieldset class="pu-palette" data-palette="${mode}"><legend class="pu-sr">${mode === 'light' ? 'Light' : 'Dark'} mode colours</legend>
      ${field('accent', 'Buttons and selections', mode === 'light' ? '#161a1f' : '#f2f2f2')}
      ${field('background', 'Page background', mode === 'light' ? '#f9f9f9' : '#111111')}</fieldset>`
  }
  const choice = (name: string, choices: string[]) => choices.map((key, i) =>
    `<label><input type="radio" name="${name}" value="${key}"${i === 0 ? ' checked' : ''}><span>${key[0]!.toUpperCase() + key.slice(1)}</span></label>`).join('')
  return shellTop(chrome, 'Appearance', 'appearance') + `<h1>Booking page appearance</h1>
    ${teams.length ? `<form class="pu-owner-picker" action="/dashboard/appearance" method="get"><label for="appearance-owner">Booking pages</label>
      <select id="appearance-owner" name="team"><option value="">My personal links</option>${teams.map(t=>`<option value="${esc(t.id)}"${t.id === team?.id ? ' selected' : ''}>${esc(t.name)} · team links</option>`).join('')}</select>
      <button class="pu-btn pu-btn-ghost">Open settings</button></form>` : '<p class="pu-muted">For your personal booking links.</p>'}
    ${notice ? `<p class="pu-notice" data-appearance-published role="status">${esc(notice)}</p>` : ''}${error ? `<p class="pu-callout" role="alert">${esc(error)}</p>` : ''}
    <form method="post" enctype="multipart/form-data" action="${esc(action)}" class="pu-appearance-form">${csrfField(chrome.csrf)}
      <input type="hidden" name="palettes" value="2">
      <fieldset class="pu-templates"><legend>Template</legend><div class="pu-layout-cards">${Object.entries(LAYOUTS).map(([key, info])=>
        `<label class="pu-layout-card"><input type="radio" name="layout" value="${key}"${value.layout === key ? ' checked' : ''}>
        <span class="pu-layout-icon ${key}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <strong>${info.name}</strong><small>${info.description}</small></label>`).join('')}</div></fieldset>
      <div class="pu-appearance-controls"><fieldset><legend>Theme behaviour</legend>
        <label for="theme-behaviour">Booking page theme</label><select id="theme-behaviour" name="themeBehaviour">${Object.entries(THEME_BEHAVIOURS).map(([key, label]) => `<option value="${key}"${(value.themeBehaviour ?? 'light') === key ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <p class="pu-help">Fixed themes hide the calendar switcher. Follow website uses your website’s theme when embedded and light mode for direct links. Independent lets visitors choose.</p></fieldset><fieldset><legend>Brand colours</legend>
        <fieldset class="pu-segments"><legend class="pu-sr">Colour mode</legend>${choice('previewTheme',['light','dark'])}</fieldset>
        ${palette('light')}${palette('dark')}
        <p class="pu-help">Unchecked colours use the defaults for this mode.</p></fieldset>
        <fieldset><legend>Logo</legend>${value.logoKey ? logoHtml({key:value.logoKey,shape:'natural',name:'Current booking page logo'}) : ''}
        <label for="appearance-logo-url">Logo URL</label><input id="appearance-logo-url" name="imageUrl" type="url" maxlength="2048" placeholder="https://example.com/logo.png">
        <p class="pu-help">Use a public HTTPS image URL. File uploads appear when image storage is enabled.</p>
        <div data-image-upload><label for="appearance-logo">Upload a logo</label><input id="appearance-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp">
        <p class="pu-help">PNG, JPEG or WebP, up to 5 MB.</p></div>${value.logoKey ? '<label class="pu-option"><input type="checkbox" name="removeLogo">Remove current logo</label>' : ''}</fieldset>
        <p class="pu-help">${chrome.user.role === 'admin' ? '<a href="/dashboard/admin#browser-icon">Browser icon and app branding</a> are managed in Admin.' : 'Your administrator manages the browser icon and app-wide branding.'}</p>
        <div class="pu-actions"><button class="pu-btn pu-btn-ghost" name="intent" value="preview" formtarget="appearance-preview">Update preview</button>
        <button class="pu-btn" name="intent" value="publish">Publish appearance</button></div></div>
      <section class="pu-appearance-preview"><div class="pu-preview-heading"><h2>Booking page preview</h2>
        <fieldset class="pu-segments"><legend class="pu-sr">Preview width</legend>${choice('previewWidth',['desktop','mobile'])}</fieldset></div>
        <div class="pu-preview-stage"><iframe title="Booking page preview" name="appearance-preview" sandbox="allow-same-origin" src="${esc(action + (team ? '&' : '?') + 'sample=1')}"></iframe></div>
        <p class="pu-help" role="status" data-preview-status>Sample times. Changes go live when you publish.</p>
      </section>
    </form><script src="/brand/appearance-editor.js" defer></script>` + shellBottom(chrome.brandName)
}

export function appearanceSample(chrome: DashboardChrome, team: Team | null, appearance: BookingAppearance, example: EventType | undefined, now: number, previewTheme: 'light' | 'dark', logoSrc: string | undefined, identity: Pick<BookingPageData, 'host' | 'hosts' | 'companyLogo'>) {
  const host = { ...identity.host, appearance }
  const eventType: EventType = example ?? {
    id:'sample', ownerUserId: team ? null : host.id, ownerTeamId: team?.id ?? null, schedulingType: team ? 'collective' : 'personal',
    slug:'introduction', title:'Introduction', description:'', durationMinutes:30, slotIntervalMinutes:null, bufferBeforeMinutes:0,
    bufferAfterMinutes:0, minNoticeMinutes:0, maxHorizonDays:60, maxPerDay:null, locationType:'google_meet', locationValue:null,
    questions:[], active:true, createdAt:0, scheduleId:null, publicAgenda:'',
  }
  const today = localDateString(now,host.tz)
  const slots: Slot[] = []
  for (let i = 0; i < 14; i++) {
    const date = shiftDate(today,i)
    for (const minutes of [540,630,780,900]) {
      const start = localTimeToInstant(date,minutes,host.tz)
      if (start > now) slots.push({start, end:start + eventType.durationMinutes * 60_000, eligibleHostIds:[host.id]})
    }
  }
  const selected = localDateString(slots[0]!.start,host.tz)
  const data: BookingPageData = { ...identity, host, team:team ? {...team,appearance} : null, ownerSlug:team?.slug || host.slug,
    brandName:chrome.brandName, month:selected.slice(0,7), selectedDate:selected, eventType, guestTimezone:host.tz, baseUrl:'',
    daysWithSlots:new Map(slots.map(s=>[localDateString(s.start,host.tz),true])), slots:slots.filter(s=>localDateString(s.start,host.tz) === selected) }
  const sampleTheme = appearance.themeBehaviour === 'light' || appearance.themeBehaviour === 'dark' ? appearance.themeBehaviour : previewTheme
  return shellHead({ title:'Booking page preview', previewTheme: sampleTheme, brandName:chrome.brandName, appearance, ownerLabel:team?.name || host.name, durationMinutes:eventType.durationMinutes, logoSrc })
    + eventHeader(data) + bookingCalendar(data,slots,today) + shellFoot()
}

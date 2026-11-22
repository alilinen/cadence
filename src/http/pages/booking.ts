/**
 * The public booking page (spec §5.1, ADR-0007 §3).
 *
 * Server-rendered strings rather than a component framework: the §7 budget is
 * <100 ms TTFB and <80 KB gzip, and the interaction model — pick a day, pick a
 * slot, fill a form — is three navigations, not an application.
 *
 * The page is session-free by design (ADR-0005 §5). It carries no cookie and
 * no ambient authority, which is what lets the dashboard cookie stay
 * SameSite=Lax while this page is embedded cross-origin in an iframe.
 *
 * Streaming: `shellHead` is flushed before any D1 read so TTFB is a function of
 * edge render, not of a replica round trip. We also hold a time-to-first-slot
 * budget (<400 ms) precisely so that flushing early cannot flatter the number
 * while the page is still useless (ADR-0007 §3).
 */

import { CLASSIC, colourInk, isColour, type BookingAppearance } from '../../core/domain/appearance.js'
import type { ResolvedHost } from '../../core/domain/hosts.js'
import { imageSource } from '../../core/domain/branding.js'
import type { LogoShape } from '../../core/domain/media.js'
import type { CompanyLogo,
  Team, EventType, Slot, User } from '../../core/domain/types.js'
import { effectiveQuestions } from '../../core/domain/booking-service.js'
import { slotStateClassName } from '../../core/slot-state.js'
import { formatInZone, localDateString, mondayOf, offsetLabel, shiftDate } from '../../core/time/zone.js'
import { CADENCE_FAVICON, CADENCE_LOGO, isCadenceBrand } from '../brand.js'
import { embedResizeScriptTag } from '../embed.js'
import { pageCss } from '../styles.js'

/**
 * The wordmark in a public-facing footer always points here, not at `/` —
 * on a self-hosted install, `/` is that operator's own homepage, and a
 * curious guest clicking the Cadence logo wants the project, not another loop
 * back into the same deployment they're already looking at.
 */
export const CADENCE_SITE_URL = '/docs'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function locationHtml(location: string): string {
  const label = escapeHtml(location)
  return /^https?:\/\//i.test(location) ? `<a href="${label}" rel="noreferrer">${label}</a>` : label
}

export function brandWordmark(brandName: string): string {
  return isCadenceBrand(brandName) ? CADENCE_LOGO : `<span data-instance-wordmark>${escapeHtml(brandName)}</span>`
}

export interface PageChrome {
  title: string
  surface?: 'dashboard' | 'calendar'
  description?: string
  brandName: string
  themeColor?: string
  previewTheme?: 'light' | 'dark'
  appearance?: BookingAppearance | null
  logoSrc?: string
  ownerLabel?: string
  durationMinutes?: number
  /**
   * Open Graph / Twitter card. Deliberately opt-in, not automatic: a
   * dashboard or guest-manage page carries a session or a guest's own manage
   * token in its URL, and neither should ever be the thing a chat app
   * unfurls a preview for. Only the public booking page passes this.
   *
   * `image` is required, not defaulted, because OG crawlers need an absolute
   * URL and this module has no `baseUrl` of its own to build one from — the
   * caller already has it.
   */
  og?: { url: string; image: string; externalImage?: boolean }
  /**
   * The one URL a search engine should index this page under. Absent means
   * NOT INDEXED: the head carries `noindex` instead. Indexing is opt-in for
   * the same reason Open Graph is — a dashboard, a confirm step, a guest's
   * manage link and an embedded copy of the booking page are all reachable
   * by a crawler that follows links, and none of them is a page anyone
   * should find by searching. The public booking page passes its own URL
   * without the `?date=…&tz=…` a crawler found it with, so every variant
   * folds back into one result.
   */
  canonical?: string
}

function paletteCss(appearance: Pick<BookingAppearance, 'background' | 'accent'>): string {
  const values: string[] = []
  if (appearance?.accent && isColour(appearance.accent)) {
    values.push(`--s-ink:${appearance.accent}`, `--s-on-ink:${colourInk(appearance.accent)}`)
  }
  if (appearance?.background && isColour(appearance.background)) {
    const bg = appearance.background, ink = colourInk(bg)
    values.push(`--s-bg:${bg}`, `--s-text:${ink}`, `color-scheme:${ink === '#000000' ? 'light' : 'dark'}`)
    for (const [token, percent] of [['panel', 3], ['input', 5], ['hover', 8], ['sel', 12], ['line', 24], ['line2', 40], ['t2', 85], ['t3', 80]] as const) {
      values.push(`--s-${token}:color-mix(in srgb, ${bg}, ${ink} ${percent}%)`)
    }
    if (!appearance.accent) values.push(`--s-ink:${ink}`, `--s-on-ink:${bg}`)
  }
  return values.join(';')
}

export function pageAppearance(d: Pick<BookingPageData, 'team' | 'host'>): BookingAppearance {
  return (d.team ? d.team.appearance : d.host.appearance) ?? CLASSIC
}

export function shellHead(chrome: PageChrome): string {
  const appearance = chrome.appearance
  const behaviour = chrome.surface === 'dashboard' ? 'independent' : appearance?.themeBehaviour ?? 'light'
  const theme = chrome.previewTheme ?? (behaviour === 'dark' ? 'dark' : behaviour === 'independent' ? undefined : 'light')
  const light = appearance ? paletteCss(appearance) : ''
  const dark = appearance ? paletteCss(appearance.dark ?? appearance) : ''
  const colours = [
    light && `:root[data-theme=light]{${light}}@media(prefers-color-scheme:light){:root:not([data-theme]){${light}}}`,
    dark && `:root[data-theme=dark]{${dark}}@media(prefers-color-scheme:dark){:root:not([data-theme]){${dark}}}`,
  ].filter(Boolean).join('')
  return `<!doctype html>
<html lang="en-GB" data-theme-behaviour="${behaviour}"${chrome.previewTheme ? ' data-theme-preview' : ''}${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(chrome.title)}</title>
${chrome.description ? `<meta name="description" content="${escapeHtml(chrome.description)}">` : ''}
<meta name="color-scheme" content="light dark">
<script src="/book/brand/theme.js"></script>
<meta name="theme-color" content="${chrome.themeColor ?? '#111111'}">
<link rel="icon" type="image/svg+xml" sizes="any" href="${CADENCE_FAVICON}">
${
  chrome.canonical
    ? `<link rel="canonical" href="${escapeHtml(chrome.canonical)}">`
    : '<meta name="robots" content="noindex">'
}
${
  chrome.og
    ? `<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(chrome.brandName)}">
<meta property="og:url" content="${escapeHtml(chrome.og.url)}">
<meta property="og:title" content="${escapeHtml(chrome.title)}">
${chrome.description ? `<meta property="og:description" content="${escapeHtml(chrome.description)}">` : ''}
<meta property="og:image" content="${escapeHtml(chrome.og.image)}">
${chrome.og.externalImage ? '' : `<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">`}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(chrome.title)}">
${chrome.description ? `<meta name="twitter:description" content="${escapeHtml(chrome.description)}">` : ''}
<meta name="twitter:image" content="${escapeHtml(chrome.og.image)}">`
    : ''
}
<style>${pageCss()}</style>
<link rel="stylesheet" href="/book/brand/cadence.css">
${colours ? `<style>${colours}</style>` : ''}
${chrome.surface === 'calendar' ? '<script src="/book/brand/calendar-navigation.js" defer></script>' : ''}
</head>
<body class="${chrome.surface === 'dashboard' ? 'cadence-dashboard' : 'cadence-booking'}"${appearance ? ` data-layout="${escapeHtml(appearance.layout)}"` : ''}>
<a class="cadence-skip" href="#main">Skip to booking</a>
<header class="cadence-top"><a class="cadence-lockup" data-brand-home href="/">${chrome.logoSrc ? `<img class="pu-brand-logo" height="44" src="${escapeHtml(chrome.logoSrc)}" alt="${escapeHtml(chrome.ownerLabel || chrome.brandName)}">` : appearance?.logoKey ? logoHtml({ key: appearance.logoKey, shape: 'natural', name: chrome.ownerLabel || chrome.brandName, size: 44 }) : `${brandWordmark(chrome.brandName)}`}</a><div class="cadence-top-actions"><button class="cadence-theme" type="button"${behaviour !== 'independent' || chrome.previewTheme ? ' hidden' : ''} data-theme-toggle aria-label="Switch color theme"><svg data-theme-icon="dark" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z"/></svg><svg data-theme-icon="light" hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button></div></header>
<main class="pu-wrap" id="main"${chrome.surface === 'calendar' ? ' data-booking-calendar' : ''}>`
}

export function shellFoot(_poweredBy = true, embed = false, _operator?: string | null): string {
  return `</main>
<div class="cadence-under"><nav aria-label="Booking footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></div>
${embed ? embedResizeScriptTag() : ''}
</body></html>`
}

/** Placeholder emitted with the shell, replaced when slot data arrives. */
export function slotsSkeleton(): string {
  return `<div id="pu-slots" aria-busy="true" aria-live="polite">
  <p class="pu-sr">Loading available times…</p>
  ${Array.from({ length: 6 }, () => '<div class="pu-skeleton"></div>').join('\n  ')}
</div>`
}

export interface BookingPageData {
  host: User
  /**
   * The owning team, for a team-owned page. It no longer heads the page:
   * the company logo does, and the team's name (if it chose to show it) is
   * a modest suffix after the hosts' names in `hostsRow`.
   */
  team?: Team | null
  /** The instance's company logo, heading team pages. Absent on a personal page's render, or when none is set. */
  companyLogo?: CompanyLogo | null
  /** The instance's brand name, shown beside a round company logo. */
  brandName?: string
  /**
   * The hosts the guest will meet — the resolved set (core/domain/hosts.ts),
   * in display order, with whether each is required. Rendered by
   * `hostsRow`, separately from the header, because resolving them is a D1
   * read and the header is flushed before any of those (ADR-0007 §3).
   */
  hosts?: ResolvedHost[]
  /**
   * The slug this page is actually reachable at — a user's OR a team's.
   * `host` is a representative user for display/timezone-default purposes
   * only (team-owned event types have no single "owner" user); using
   * `host.slug` for URL generation instead of this field routed every link
   * on a team event's page to a team member's personal page, 404ing there.
   */
  ownerSlug: string
  eventType: EventType
  /** The month being displayed, as a host-local `YYYY-MM`. */
  month: string
  /** Day → whether it has any bookable slot. */
  daysWithSlots: Map<string, boolean>
  selectedDate?: string
  slots?: Slot[]
  guestTimezone: string
  baseUrl: string
  /**
   * Set only on the confirm page, where the timezone picker must post back
   * to `/confirm` with the chosen slot's `start` rather than to the
   * month/day view — the confirm page has no `date`/`month` in its own URL
   * to fall back to, and the day-view form action would otherwise silently
   * discard the guest's already-chosen slot.
   */
  confirmStart?: number
  /** True when served inside the embed iframe (`?embed=1`) — propagated through every internal link so the resize snippet keeps firing past the first navigation. */
  embed?: boolean
}

/**
 * A `size`×`size` circle: the uploaded avatar/logo thumbnail if the
 * user or team has one, otherwise a CSS-only initials badge so the layout
 * never depends on whether a photo has been uploaded. Shared between the
 * booking page header and the dashboard settings page — the same key served
 * by the same `/avatars/:key` route either way.
 */
/**
 * A logo in the shape its owner chose: `circle` is `avatarHtml` (square
 * crop, round mask); `natural` is the uncropped "-fit" rendering, aligned
 * by height — as wide as its proportions make it, capped at three times
 * the height so a banner cannot push the title off the row. Initials when
 * there is no image, as for avatars.
 */
export function logoHtml(opts: { key: string | null; shape?: LogoShape | null; name: string; size?: number; alt?: string }): string {
  const size = opts.size ?? 40
  if (opts.key && opts.shape === 'natural') {
    return `<img src="${escapeHtml(imageSource(opts.key, 'natural'))}" alt="${escapeHtml(opts.alt ?? opts.name)}" height="${size}" style="height:${size}px;width:auto;max-width:${size * 3}px;object-fit:contain;display:block;flex:none" loading="lazy">`
  }
  return avatarHtml({ key: opts.key, name: opts.name, size, ...(opts.alt !== undefined ? { alt: opts.alt } : {}) })
}

export function avatarHtml(opts: { key: string | null; name: string; size?: number; alt?: string }): string {
  const size = opts.size ?? 40
  if (opts.key) {
    return `<img src="${escapeHtml(imageSource(opts.key))}" alt="${escapeHtml(opts.alt ?? opts.name)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;flex:none" loading="lazy">`
  }
  const initial = opts.name.trim().charAt(0).toUpperCase()
  const layout = `width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--pu-font-mono);font-weight:600;font-size:${Math.round(size * 0.42)}px;flex:none`
  // No name means no initial: a letter from the slug or the email would
  // look like an identity the host never entered. The neutral ring is the
  // open-slot shape — something still to be filled in — not a green badge
  // claiming a name that isn't there.
  if (!initial) {
    return `<div aria-hidden="true" style="${layout};background:var(--pu-paper-dim);color:var(--pu-ink-500);border:2px solid var(--pu-line)">?</div>`
  }
  return `<div aria-hidden="true" style="${layout};background:var(--pu-green-tint);color:var(--pu-green-700)">${escapeHtml(initial)}</div>`
}

/**
 * The company shown for this booking page, or null. A team-owned event's
 * `host` is one representative member picked by `bookingPageContext` for
 * display purposes (see that function's own comment) — real, but not "the"
 * host of a round-robin/collective event. Their company is personal to them,
 * not the team, so it only ever renders for a personal event type, where
 * `host` really is the host. Shared by the header and the page footer so the
 * two can never disagree.
 */
export function displayCompany(d: Pick<BookingPageData, 'host' | 'eventType'>): string | null {
  return d.eventType.ownerTeamId === null ? d.host.company : null
}

/**
 * The muted line under the host's name — "CEO, Acme Inc", either half
 * optional, the company wrapped in a link when the host set one. Returns
 * HTML (everything interpolated is escaped here). Same personal-event-only
 * gate as `displayCompany` — a representative team member's personal
 * title/company would read as the team's. The href was validated to be
 * absolute http(s) at save time (`isHttpUrl` in dashboard-routes.ts), so a
 * stored value can never be a javascript:/data: scheme.
 */
function identityLineHtml(d: Pick<BookingPageData, 'host' | 'eventType'>): string | null {
  if (d.eventType.ownerTeamId !== null) return null
  const companyHtml = d.host.company
    ? d.host.companyUrl
      ? `<a class="pu-host-link" href="${escapeHtml(d.host.companyUrl)}" target="_blank" rel="noopener">${escapeHtml(d.host.company)}</a>`
      : escapeHtml(d.host.company)
    : ''
  const parts = [d.host.jobTitle ? escapeHtml(d.host.jobTitle) : '', companyHtml].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/** "Alice", "Alice and Bob", "Alice, Bob and Carol" — `conjunction` is "and" or "or". */
export function joinNames(names: string[], conjunction: 'and' | 'or' = 'and'): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`
}

/**
 * The sentence naming who the guest will meet, as HTML. Collective promises
 * only the REQUIRED hosts — "You'll meet Alice and Bob" — and says the
 * optional ones "join when free", because that is exactly what an optional
 * host does: a slot is listed whether or not they are free for it, and the
 * confirmation names whoever actually joined. Round-robin names the pool
 * and never a specific person, because the host is picked at commit
 * (ADR-0004 §5: listings are advisory about who). More than four names in
 * a group collapse to three plus a CSS-only "and N more" — no script.
 *
 * Exported on its own because the event-type editor previews it under the
 * Hosts block ("Guests will see"): one function, so the preview and the
 * booking page cannot drift apart. Empty for a personal page or no hosts.
 */
export function hostsSentence(d: Pick<BookingPageData, 'eventType' | 'hosts' | 'team'>): string {
  const hosts = d.hosts ?? []
  if (d.eventType.ownerTeamId === null || hosts.length === 0) return ''
  const collective = d.eventType.schedulingType === 'collective'
  const conj = collective ? 'and' : 'or'
  const promised = collective ? hosts.filter((h) => h.required) : hosts
  const optional = collective ? hosts.filter((h) => !h.required) : []
  const name = (h: ResolvedHost) => h.user.name || h.user.slug

  const group = (list: ResolvedHost[]): string => {
    const names = list.map(name)
    if (names.length <= 4) return `<strong>${escapeHtml(joinNames(names, conj))}</strong>`
    const rest = names.slice(3)
    return (
      `<strong>${escapeHtml(names.slice(0, 3).join(', '))}</strong>` +
      ` <details class="pu-hosts-more"><summary>and ${rest.length} more</summary><span>${escapeHtml(joinNames(rest, conj))}</span></details>`
    )
  }
  // The team, modestly, in parentheses after the people — unless the team
  // chose not to show its name to guests at all.
  const team = d.team && d.team.showName !== false ? ` <span class="pu-hosts-team">(${escapeHtml(d.team.name)})</span>` : ''
  const lead = promised.length > 0 ? `${collective ? "You'll meet " : 'With one of '}${group(promised)}${team}` : ''
  const joins =
    optional.length > 0
      ? `${lead ? '. ' : ''}${group(optional)} ${optional.length === 1 ? 'joins' : 'join'} when free${lead ? '' : team}`
      : ''
  return `${lead}${joins}`
}

/**
 * Who the guest will meet, for a team-owned page: the avatars and the
 * sentence from `hostsSentence`. Empty for a personal page.
 */
export function hostsRow(d: Pick<BookingPageData, 'eventType' | 'hosts' | 'team'>): string {
  const hosts = d.hosts ?? []
  if (d.eventType.ownerTeamId === null || hosts.length === 0) return ''
  const collective = d.eventType.schedulingType === 'collective'
  const promised = collective ? hosts.filter((h) => h.required) : hosts
  const optional = collective ? hosts.filter((h) => !h.required) : []
  const name = (h: ResolvedHost) => h.user.name || h.user.slug

  // Avatars: the promised hosts first, then optional ones; more than four
  // in total collapses to three and a count.
  const ordered = [...promised, ...optional]
  const shown = ordered.length > 4 ? ordered.slice(0, 3) : ordered
  const stack = shown.map((h) => avatarHtml({ key: h.user.avatarKey, name: name(h), size: 32 })).join('')
  const count = ordered.length > 4 ? `<span class="pu-hosts-count" aria-hidden="true">+${ordered.length - 3}</span>` : ''

  return `<div class="pu-hosts" aria-label="Hosts">
    <div class="pu-hosts-stack">${stack}${count}</div>
    <p class="pu-hosts-text">${hostsSentence(d)}</p>
  </div>`
}

/**
 * The row above the title. A personal page is headed by the host — photo,
 * name, company and title — or by the event type's own logo in place of
 * the photo. A team page is headed by the COMPANY: the instance's logo
 * (the event type's own logo wins), with the brand name beside a round
 * one and nothing beside a wordmark, which already says the name. A team
 * is not a brand, so its name is not up here — it is a suffix after the
 * hosts' names in `hostsRow`, if the team shows it at all. A team page
 * with no logo of either kind has no head row: just the title.
 */
function pageHead(d: BookingPageData): string {
  if (!d.team) {
    const name = d.host.name || d.host.slug
    const identity = identityLineHtml(d)
    return `<div class="pu-host">
    ${logoHtml({ key: d.eventType.logoKey ?? d.host.avatarKey, shape: d.eventType.logoKey ? (d.eventType.logoShape ?? 'circle') : 'circle', name, size: 56 })}
    <div>
      <p class="pu-host-name">${escapeHtml(name)}</p>
      ${identity ? `<p class="pu-host-org">${identity}</p>` : ''}
    </div>
  </div>`
  }
  const key = d.eventType.logoKey ?? d.companyLogo?.key ?? null
  if (!key) return ''
  const shape = d.eventType.logoKey ? (d.eventType.logoShape ?? 'circle') : (d.companyLogo?.shape ?? 'circle')
  const name = d.brandName ?? ''
  return `<div class="pu-host">
    ${logoHtml({ key, shape, name: name || d.eventType.title, size: 56 })}
    ${shape === 'circle' && name ? `<div><p class="pu-host-name">${escapeHtml(name)}</p></div>` : ''}
  </div>`
}

export function eventHeader(d: BookingPageData): string {
  const durationLabel = `${d.eventType.durationMinutes} min`
  const location = locationLabel(d.eventType)
  const agenda = (d.eventType.publicAgenda ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  const clock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>'
  const video = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/></svg>'
  const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
  return `<header class="pu-event-header">
${pageHead(d)}
<h1>${escapeHtml(d.eventType.title)}</h1>
${d.eventType.description ? `<p class="pu-muted">${escapeHtml(d.eventType.description)}</p>` : ''}
${hostsRow(d)}
<ul class="pu-meta">
<li>${clock}${escapeHtml(durationLabel)}</li>
${location ? `<li>${video}${escapeHtml(location)}</li>` : ''}
<li>${timezonePicker(d)}</li>
</ul>
${agenda.length ? `<div class="cadence-agenda"><strong>We’ll make time for</strong><ul>${agenda.map(line => `<li>${check}${escapeHtml(line)}</li>`).join('')}</ul></div>` : ''}
</header>`
}

// Populated once per isolate, not per request — `Intl.supportedValuesOf`
// enumerates the runtime's whole tzdata, which doesn't change between
// requests.
const TIMEZONES: readonly string[] = (() => {
  try {
    // `supportedValuesOf('timeZone')` does not include `UTC` itself in this
    // runtime — without adding it back, a guest already on UTC can see it
    // (their own zone is always prepended, see `timezonePicker`), but no one
    // else can ever pick it.
    const zones = new Set(Intl.supportedValuesOf('timeZone'))
    zones.add('UTC')
    return [...zones].sort()
  } catch {
    return ['UTC']
  }
})()

// Escaping and joining ~400 <option> tags on every single booking-page
// request (month view, day view, confirm — every one renders this picker)
// was slow enough to measurably lengthen the request-rate-limiter smoke
// test's 120-request loop, giving the token bucket real wall-clock time to
// partially refill before the request meant to be denied. None of this
// output depends on the request, so it is built once per isolate; the only
// per-request work is marking one zone `selected`.
const TIMEZONE_OPTIONS_BASE: string = TIMEZONES.map(
  (z) => `<option value="${escapeHtml(z)}">${escapeHtml(z.replace(/_/g, ' '))}</option>`,
).join('')

function timezoneOptionsHtml(selected: string): string {
  if (!TIMEZONES.includes(selected)) {
    // Defensive fallback for a zone the runtime doesn't recognise — prepend
    // it rather than silently dropping the guest's own (mis-detected) zone
    // from the list.
    return (
      `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected.replace(/_/g, ' '))}</option>` +
      TIMEZONE_OPTIONS_BASE
    )
  }
  const marker = `value="${escapeHtml(selected)}">`
  return TIMEZONE_OPTIONS_BASE.replace(marker, `value="${escapeHtml(selected)}" selected>`)
}

/**
 * A real, submitting `<select>` rather than a static label: the guest's
 * detected zone is only a guess (see `resolveGuestTimezone`), and until this
 * existed the only way to correct it was editing `?tz=` in the URL by hand.
 * A GET form degrades to a plain submit button with no JS (`<noscript>`);
 * `onchange` submit is the enhancement, not the only path.
 */
function timezonePicker(d: BookingPageData): string {
  const options = timezoneOptionsHtml(d.guestTimezone)
  // The confirm page has already committed to one slot, which lives only in
  // `start` — its own URL carries no `date`/`month` to fall back to. Posting
  // to the month/day view like every other page would silently drop that
  // slot, so this page's picker instead posts back to `/confirm` itself.
  const action = d.confirmStart !== undefined ? `${bookingPath(d)}/confirm` : bookingPath(d)
  const hiddenFields =
    d.confirmStart !== undefined
      ? `<input type="hidden" name="start" value="${d.confirmStart}">`
      : `${d.selectedDate ? `<input type="hidden" name="date" value="${escapeHtml(d.selectedDate)}">` : ''}
    <input type="hidden" name="month" value="${escapeHtml(d.month)}">`
  // Only numbers interpolated into the style attribute — the zone string
  // itself never is (it's validated upstream, but belt and braces).
  const offset = offsetLabel(Date.now(), d.guestTimezone)
  const zoneCh = d.guestTimezone.length
  const offsetCh = offset.length
  return `<form class="pu-tz-form" method="get" action="${escapeHtml(action)}">
    ${hiddenFields}
    ${d.embed ? '<input type="hidden" name="embed" value="1">' : ''}
    <label class="pu-sr" for="pu-tz">Timezone</label>
    <span class="pu-tz-wrap">
      <svg class="pu-tz-globe" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
        fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18"></path>
      </svg>
      <select id="pu-tz" name="tz" class="pu-tz-select" onchange="this.form.requestSubmit()"
        style="width:calc(${zoneCh + offsetCh}ch + 4.5rem);padding-right:calc(${offsetCh}ch + 2.2rem)">${options}</select>
      <span class="pu-tz-offset">${escapeHtml(offset)}</span>
    </span>
    <noscript><button type="submit" class="pu-btn pu-btn-ghost" style="padding:.15rem .5rem">Set</button></noscript>
  </form>`
}

function locationLabel(et: EventType): string {
  switch (et.locationType) {
    case 'google_meet':
      return 'Video meeting'
    case 'phone':
      return 'Phone call'
    case 'in_person':
      return et.locationValue ?? 'In person'
    case 'custom_link':
      return et.locationValue ? 'Online' : 'Location to be arranged'
    default:
      return ''
  }
}

/**
 * The month grid.
 *
 * Rendered as links, not buttons: a day view is a URL, which means the back
 * button works, the page is shareable, and the whole flow degrades to plain
 * HTML with no JavaScript at all.
 */
export function monthGrid(d: BookingPageData): string {
  const [yStr, mStr] = d.month.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const leading = firstOfMonth.getUTCDay()
  const todayLocal = localDateString(Date.now(), d.host.tz)

  const cells: string[] = []
  for (let i = 0; i < leading; i++) cells.push('<span></span>')

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const has = d.daysWithSlots.get(date) === true
    const current = date === todayLocal ? ' aria-current="date"' : ''
    const selected = date === d.selectedDate ? ' aria-selected="true"' : ''
    if (has) {
      const href =
        `${bookingPath(d)}?date=${date}&tz=${encodeURIComponent(d.guestTimezone)}` +
        (d.embed ? '&embed=1' : '')
      cells.push(
        `<a class="pu-day" data-has-slots="1"${current}${selected} href="${escapeHtml(href)}" ` +
          `aria-label="${escapeHtml(humanDate(date, d.guestTimezone))}, times available` +
          `${selected ? ', selected' : ''}">${day}</a>`,
      )
    } else {
      cells.push(`<span class="pu-day" aria-disabled="true"${current}${selected}>${day}</span>`)
    }
  }

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(firstOfMonth)

  const prev = shiftMonth(d.month, -1)
  const next = shiftMonth(d.month, 1)
  const base = bookingPath(d)
  const tzq = `&tz=${encodeURIComponent(d.guestTimezone)}${d.embed ? '&embed=1' : ''}`

  return `<section class="pu-card" aria-label="Choose a day">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
    <a class="pu-btn pu-btn-ghost" style="padding:.35rem .6rem"
       href="${escapeHtml(`${base}?month=${prev}${tzq}`)}" data-calendar-nav aria-label="Previous month"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></a>
    <h2 style="margin:0">${escapeHtml(monthLabel)}</h2>
    <a class="pu-btn pu-btn-ghost" style="padding:.35rem .6rem"
       href="${escapeHtml(`${base}?month=${next}${tzq}`)}" data-calendar-nav aria-label="Next month"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
  </div>
  <div class="pu-cal" role="grid">
    ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      .map((x) => `<div class="pu-cal-head" role="columnheader" aria-label="${x}">${x.slice(0, 3)}</div>`)
      .join('')}
    ${cells.join('\n    ')}
  </div>
</section>`
}

/** The same availability and confirm links drive all three views. */
export function bookingCalendar(d: BookingPageData, slots: Slot[], today: string): string {
  const layout = pageAppearance(d).layout
  if (layout === 'classic') return `<div class="pu-grid">${monthGrid(d)}${slotList(d)}</div>`
  const grouped = new Map<string, Slot[]>()
  for (const slot of slots) {
    const date = localDateString(slot.start, d.guestTimezone)
    if (!grouped.has(date)) grouped.set(date, [])
    grouped.get(date)!.push(slot)
  }
  const week = layout === 'week'
  const anchor = mondayOf(d.selectedDate ?? today)
  const availableDates = Array.from(grouped.keys()).filter(date => date.startsWith(d.month)).sort()
  const pageSize = 5
  const selectedIndex = d.selectedDate ? availableDates.findIndex(date => date >= d.selectedDate!) : 0
  const offset = Math.floor(Math.max(0, selectedIndex < 0 ? availableDates.length - 1 : selectedIndex) / pageSize) * pageSize
  const dates = week
    ? Array.from({ length: 7 }, (_, i) => shiftDate(anchor, i))
    : availableDates.slice(offset, offset + pageSize)
  const period = week ? 'week' : 'month'
  const heading = week ? `${shortDate(anchor)} – ${shortDate(shiftDate(anchor, 6))}`
    : new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d.month + '-01T12:00:00Z'))
  const link = (key: 'date' | 'month', value: string, label: string, text: string) => {
    const search = new URLSearchParams({ [key]: value, tz: d.guestTimezone })
    if (d.embed) search.set('embed', '1')
    return `<a class="pu-btn pu-btn-ghost" href="${escapeHtml(bookingPath(d) + '?' + search)}" data-calendar-nav aria-label="${label}">${text}</a>`
  }
  const nav = (direction: number) => {
    const date = week ? shiftDate(anchor, direction * 7) : shiftMonth(d.month, direction)
    const limit = shiftDate(today, d.eventType.maxHorizonDays)
    if (week ? date < mondayOf(today) || date > mondayOf(limit) : date < today.slice(0, 7) || date > limit.slice(0, 7)) return ''
    return link(week ? 'date' : 'month', date, `${direction < 0 ? 'Previous' : 'Next'} ${period}`, direction < 0 ? '←' : '→')
  }
  const earlier = availableDates[offset - pageSize], later = availableDates[offset + pageSize]
  const more = !week && (earlier || later) ? `<nav class="pu-actions" aria-label="Browse available dates">
    ${earlier ? link('date', earlier, 'Earlier available dates', 'Earlier dates') : ''}
    ${later ? link('date', later, 'More available dates', 'More dates') : ''}</nav>` : ''
  return `<section class="pu-layout-picker" id="cadence-times"><div class="pu-week-heading"><div><h2>${heading}</h2><small>${escapeHtml(d.guestTimezone)}</small></div>
    <nav aria-label="Choose ${period}">${nav(-1)}${nav(1)}</nav></div>
    <div class="pu-pick-${layout}">${dates.map((date, i) => {
      const choices = grouped.get(date) ?? []
      const links = `<div class="pu-choice-times">${choices.map(s => slotLink(d, s)).join('')}</div>`
      if (week) return `<section class="pu-pick-day"><h3>${shortDate(date, true)}</h3>${choices.length ? links : '<span class="pu-muted" aria-label="No available times">—</span>'}</section>`
      return `<details class="pu-agenda-day"${i === 0 ? ' open' : ''}><summary>${escapeHtml(humanDate(date, d.guestTimezone))}<small>${choices.length} ${choices.length === 1 ? 'time' : 'times'}</small></summary>${links}</details>`
    }).join('') || '<p>No available times this month.</p>'}</div>${more}</section>`
}

function shortDate(date: string, weekday = false): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...(weekday ? {weekday:'short' as const} : {month:'short' as const}), day:'numeric' }).format(new Date(date + 'T12:00:00Z'))
}

/** Slot list for a chosen day, in the GUEST's timezone. */
export function slotList(d: BookingPageData): string {
  if (!d.selectedDate) {
    return `<section class="pu-card" id="cadence-times" aria-label="Available times">
      <p class="pu-muted">Pick a day to see available times.</p></section>`
  }
  const slots = d.slots ?? []
  if (slots.length === 0) {
    return `<section class="pu-card" id="cadence-times" aria-label="Available times">
      <h2>${escapeHtml(humanDate(d.selectedDate, d.guestTimezone))}</h2>
      <p class="pu-muted">No times available on this day.</p></section>`
  }

  // Every slot the query engine hands back here has already cleared holds,
  // bookings, past times and the host's notice window (src/core/slots/
  // engine.ts never returns those) — so every slot on this page is, by
  // construction, in the 'available' state. slotStateClassName still goes
  // through the shared src/core/slot-state.ts mapping (rather than a literal
  // "pu-slot pu-slot-available" string here) so this call site and the CSS
  // in src/http/styles.ts can never drift from the one place that owns the
  // state → class relationship. The 'held'/'booked'/'past'/
  // 'outside-notice-window' classes it can also produce are exercised today
  // by the semantic-tokens reference page and by test/core/slot-state.test.ts,
  // not by live traffic — showing any of them here would mean the query
  // engine surfacing a status per slot instead of silently omitting it,
  // which is a product decision (does a guest get to see that a time is
  // held/booked at all?) outside this ticket's scope.
  const items = slots.map(s => slotLink(d, s)).join('\n    ')

  return `<section class="pu-card" id="cadence-times" aria-label="Available times">
  <h2>${escapeHtml(humanDate(d.selectedDate, d.guestTimezone))}</h2>
  <p class="pu-muted" style="font-size:.8125rem">
    Times shown in ${escapeHtml(d.guestTimezone)} (${escapeHtml(offsetLabel(slots[0]!.start, d.guestTimezone))})
  </p>
  <div class="pu-slots">${items}</div>
</section>`
}

function slotLink(d: BookingPageData, slot: Slot): string {
  const label = formatInZone(slot.start, d.guestTimezone, { hour: 'numeric', minute: '2-digit' })
  const href = `${bookingPath(d)}/confirm?start=${slot.start}&tz=${encodeURIComponent(d.guestTimezone)}` + (d.embed ? '&embed=1' : '')
  return `<a class="${slotStateClassName('available')}" href="${escapeHtml(href)}" rel="nofollow">
    <time datetime="${new Date(slot.start).toISOString()}">${escapeHtml(label)}</time></a>`
}

export function additionalGuestsField(value = '', error?: string): string {
  return `<details class="pu-extra-guests"${value || error ? ' open' : ''}>
    <summary>Add guests <span class="pu-muted">(optional)</span></summary>
    <label for="additionalGuests">Guest email addresses</label>
    <textarea id="additionalGuests" name="additionalGuests" rows="3" maxlength="2600" aria-describedby="guests-hint${error ? ' err-additionalGuests' : ''}"${error ? ' aria-invalid="true"' : ''}>${escapeHtml(value)}</textarea>
    <p class="pu-muted" id="guests-hint">Up to 10 people, separated by commas or new lines. Everyone receives an invitation and can see the attendees and meeting notes. The original booker and hosts manage reschedules and cancellations.</p>
    ${error ? `<p class="pu-err" id="err-additionalGuests">${escapeHtml(error)}</p>` : ''}
  </details>`
}

export function bookingQuestionFields(et: Pick<EventType, 'questions'>, values: Record<string, string> = {}, errors: Record<string, string> = {}): string {
  return effectiveQuestions(et)
    .map((q) => {
      const err = errors[q.id]
      const val = escapeHtml(values[q.id] ?? '')
      const req = q.required ? ' required aria-required="true"' : ''
      const desc = err ? ` aria-describedby="err-${escapeHtml(q.id)}"` : ''
      const field =
        q.type === 'textarea'
          ? `<textarea id="q-${escapeHtml(q.id)}" name="q_${escapeHtml(q.id)}"${req}${desc}>${val}</textarea>`
          : q.type === 'select'
            ? `<select id="q-${escapeHtml(q.id)}" name="q_${escapeHtml(q.id)}"${req}${desc}>
                 <option value=""></option>
                 ${(q.options ?? [])
                   .map(
                     (o) =>
                       `<option value="${escapeHtml(o)}"${values[q.id] === o ? ' selected' : ''}>${escapeHtml(o)}</option>`,
                   )
                   .join('')}
               </select>`
            : `<input id="q-${escapeHtml(q.id)}" name="q_${escapeHtml(q.id)}" value="${val}"${req}${desc}>`
      return `<label for="q-${escapeHtml(q.id)}">${escapeHtml(q.label)}${q.required ? '' : ' <span class="pu-muted">(optional)</span>'}</label>
        ${field}
        ${err ? `<p class="pu-err" id="err-${escapeHtml(q.id)}">${escapeHtml(err)}</p>` : ''}`
    })
    .join('\n')
}

/** The confirmation form. Includes the hidden hold id when one was placed. */
export function confirmForm(
  d: BookingPageData,
  start: number,
  opts: { holdId?: string; errors?: Record<string, string>; values?: Record<string, string> } = {},
): string {
  const et = d.eventType
  const errors = opts.errors ?? {}
  const values = opts.values ?? {}
  const when = formatInZone(start, d.guestTimezone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const questions = bookingQuestionFields(et, values, errors)

  return `<section class="pu-card" aria-label="Confirm your booking">
  <h2>Confirm your booking</h2>
  <div class="pu-slot-chosen">
    <span class="pu-dot-lg" aria-hidden="true"></span>
    <span><strong class="pu-time">${escapeHtml(when)}</strong><br>
     <span class="pu-muted">${escapeHtml(d.guestTimezone)} · ${escapeHtml(String(et.durationMinutes))} min</span></span>
  </div>
  <form method="post" action="${escapeHtml(bookingPath(d))}/confirm">
    <input type="hidden" name="start" value="${start}">
    <input type="hidden" name="tz" value="${escapeHtml(d.guestTimezone)}">
    ${d.embed ? '<input type="hidden" name="embed" value="1">' : ''}
    ${opts.holdId ? `<input type="hidden" name="hold" value="${escapeHtml(opts.holdId)}">` : ''}
    <div class="cadence-contact-fields"><div class="cadence-field"><label for="name">Your name</label>
    <input id="name" name="name" required aria-required="true" autocomplete="name"
           value="${escapeHtml(values['name'] ?? '')}"
           ${errors['name'] ? 'aria-describedby="err-name"' : ''}>
    ${errors['name'] ? `<p class="pu-err" id="err-name">${escapeHtml(errors['name'])}</p>` : ''}
    </div><div class="cadence-field"><label for="email">Email</label>
    <input id="email" name="email" type="email" required aria-required="true" autocomplete="email"
           value="${escapeHtml(values['email'] ?? '')}"
           ${errors['email'] ? 'aria-describedby="err-email"' : ''}>
    ${errors['email'] ? `<p class="pu-err" id="err-email">${escapeHtml(errors['email'])}</p>` : ''}
</div></div>
    ${additionalGuestsField(values['additionalGuests'], errors['additionalGuests'])}
    ${questions}
    <div style="margin-top:1.25rem;display:flex;gap:.75rem;flex-wrap:wrap">
      <button class="pu-btn" type="submit">Confirm booking</button>
      <a class="pu-btn pu-btn-ghost" href="${escapeHtml(bookingPath(d))}?date=${escapeHtml(localDateString(start, d.guestTimezone))}${d.embed ? '&embed=1' : ''}">Back</a>
    </div>
  </form>
</section>`
}

export function bookedConfirmation(opts: {
  eventTitle: string
  hostName: string
  start: number
  guestTimezone: string
  notice: string
  manageUrl: string
  locationLabel?: string
}): string {
  const when = formatInZone(opts.start, opts.guestTimezone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return `<section class="pu-card pu-confirm" aria-label="Booking confirmed">
  <svg class="pu-confirm-icon" width="56" height="56" viewBox="0 0 96 96" aria-hidden="true">
    <path class="pu-ring-arc" d="M 69.2 30.8 A 30 30 0 1 1 26.8 30.8"
      fill="none" stroke-width="9" stroke-linecap="round"></path>
    <circle class="pu-ring-dot" cx="48" cy="22" r="11"></circle>
  </svg>
  <p><span class="pu-badge">Confirmed</span></p>
  <h1>You're booked</h1>
  <p class="pu-muted"><strong style="color:var(--pu-ink-950)">${escapeHtml(opts.eventTitle)}</strong> with ${escapeHtml(opts.hostName)}</p>
  <dl class="pu-confirm-details">
    <div><dt>When</dt><dd class="pu-time">${escapeHtml(when)}<br>
      <span class="pu-muted">${escapeHtml(opts.guestTimezone)}</span></dd></div>
    ${opts.locationLabel ? `<div><dt>Where</dt><dd>${locationHtml(opts.locationLabel)}</dd></div>` : ''}
  </dl>
  <p class="pu-muted">${escapeHtml(opts.notice)}</p>
  <p style="margin-top:1.25rem">
    <a class="pu-btn pu-btn-ghost" href="${escapeHtml(opts.manageUrl)}">Reschedule or cancel</a>
  </p>
</section>`
}

/**
 * The 409 page.
 *
 * A slot can be listed and then lost: listings may come from a read replica
 * (ADR-0007 §2) and round-robin listings are advisory about who. This is an
 * expected outcome, so it reads as a normal step with the next action right
 * there — not as an error.
 */
export function slotTakenPage(d: BookingPageData, date: string): string {
  return `<section class="pu-card" aria-label="Time no longer available">
  <h1>That time was just taken</h1>
  <p class="pu-muted">Someone booked it while you were filling in the form. Here are the other times that day.</p>
  <p style="margin-top:1rem">
    <a class="pu-btn" href="${escapeHtml(bookingPath(d))}?date=${escapeHtml(date)}&tz=${encodeURIComponent(d.guestTimezone)}${d.embed ? '&embed=1' : ''}">See available times</a>
  </p>
</section>`
}

export function errorPage(title: string, message: string): string {
  return `<section class="pu-card">
  <h1>${escapeHtml(title)}</h1>
  <p class="pu-muted">${escapeHtml(message)}</p>
</section>`
}

// ---------------------------------------------------------------------------

export function bookingPath(d: { ownerSlug: string; eventType: EventType }): string {
  return `/${encodeURIComponent(d.ownerSlug)}/${encodeURIComponent(d.eventType.slug)}`
}

function humanDate(date: string, _tz: string): string {
  const [y, m, dd] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, dd)))
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

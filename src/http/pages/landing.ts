/**
 * The marketing landing page and the "vs. Calendly" comparison page, served
 * at `/` and `/calendly-alternative`. The docs section itself (`/docs` and
 * its sub-pages) lives in pages/docs.ts, which reuses `shell()`/`footer()`
 * exported from here so both halves of the site share one page frame.
 *
 * Same rendering approach as the booking page (server-rendered template
 * strings, no client framework, no external assets) but with its own page
 * shell: the booking page's `shellHead`/`shellFoot` bakes in the `.pu-wrap`
 * 900px reading column and the "powered by" footer, neither of which fits a
 * page whose job is to sell the product rather than book a meeting. This
 * file owns its own shell instead of reaching into booking.ts for one.
 *
 * Every claim on this page is checkable against README.md, docs/spec.md or
 * docs/self-hosting.md — this is a public repo, and an overclaiming landing
 * page is the fastest way to lose the trust the pledge is supposed to buy.
 */

import { CADENCE_FAVICON, CADENCE_LOGO } from '../brand.js'
import { escapeHtml, CADENCE_SITE_URL } from './booking.js'
import { pageCss, LANDING_CSS } from '../styles.js'

export interface LandingPageOptions {
  brandName: string
  baseUrl: string
  /** Defaults to the Cadence source repository. */
  githubUrl?: string
  /** Path to a real, live booking page used for the "see a booking page" CTA. */
  demoPath?: string
  /**
   * The legal entity operating this deployment — same source as /privacy and
   * /terms (EngineConfig.legalOperator). Unset by default: a self-hosted
   * deployment run by nobody-in-particular has nothing honest to put here,
   * so the footer just omits the line rather than naming this repo's owner.
   */
  operator?: string
  /** GA4 measurement id (EngineConfig.analyticsId) — see `analyticsTag`. */
  analyticsId?: string
}

export interface CalendlyAlternativePageOptions {
  brandName: string
  baseUrl: string
  githubUrl?: string
  operator?: string
  analyticsId?: string
}

/**
 * Shared with pages/docs.ts, which owns the docs shell — one repo map (this
 * file) rather than two copies drifting.
 */
export const DEFAULT_GITHUB_URL = 'https://github.com/alilinen/cadence'

/**
 * A GA4 tag, gated behind `EngineConfig.analyticsId` — unset for every
 * deployment by default (see the doc comment on that field in ports.ts). A
 * malformed id (this is operator config, not request input, but defense in
 * depth costs nothing here) is dropped rather than interpolated into the
 * inline script.
 */
function analyticsTag(id: string | undefined): string {
  if (!id || !/^G-[A-Z0-9]+$/i.test(id)) return ''
  const safeId = escapeHtml(id)
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${safeId}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${safeId}');
</script>`
}

/** Exported for pages/docs.ts: the docs pages want the exact same page frame. */
export function shell(
  opts: { brandName: string; title: string; description: string; baseUrl: string; path?: string; analyticsId?: string },
  body: string,
): string {
  const origin = opts.baseUrl.replace(/\/$/, '')
  const url = `${origin}${opts.path ?? ''}`
  const image = `${origin}/og/default.png`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#111111">
<link rel="icon" type="image/svg+xml" sizes="any" href="${CADENCE_FAVICON}">
<link rel="canonical" href="${escapeHtml(url)}">
${analyticsTag(opts.analyticsId)}
<!-- Open Graph / Twitter: one shared brand card for now — a booking page's
     own title/description still varies per host and event type (see
     pages/booking.ts), only the image is shared until per-page OG images
     exist. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(opts.brandName)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta data-default-card property="og:image" content="${escapeHtml(image)}">
<meta data-default-card-size property="og:image:width" content="1200">
<meta data-default-card-size property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(opts.title)}">
<meta name="twitter:description" content="${escapeHtml(opts.description)}">
<meta data-default-card name="twitter:image" content="${escapeHtml(image)}">
<script src="/brand/theme.js"></script>
<style>${pageCss()}${LANDING_CSS}</style>
<link rel="stylesheet" href="/brand/fonts.css">
<link rel="stylesheet" href="/brand/cadence.css">
</head>
<body>
${body}
</body></html>`
}

/** Exported for pages/docs.ts: the docs footer must match the marketing footer exactly. */
export function footer(githubUrl: string, operator?: string): string {
  return `<footer class="pu-landing-footer">
  <nav aria-label="Footer">
    <a href="${escapeHtml(githubUrl)}">Source code</a>
    <a href="/docs">Docs</a>
    <a href="/calendly-alternative">vs. Calendly</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </nav>
  <p class="pu-muted" style="text-align:center;margin:0">
    <a class="pu-mark" href="${CADENCE_SITE_URL}" target="_blank" rel="noopener">${CADENCE_LOGO}</a> — scheduling that shows up on time
  </p>
  ${operator ? `<p class="pu-muted" style="text-align:center;margin:.35rem 0 0;font-size:.8125rem">${escapeHtml(operator)}</p>` : ''}
</footer>`
}

export function landingPage(opts: LandingPageOptions): string {
  const githubUrl = opts.githubUrl ?? DEFAULT_GITHUB_URL
  const example = `${opts.baseUrl.replace(/\/$/, '')}/you/intro`
  // No fallback: a fresh or self-hosted deployment has no host/event type
  // seeded yet, and a hardcoded demo identity here would make every such
  // deployment's own homepage embed a 404ing iframe on first boot. The demo
  // CTA and the live embed both simply don't render without a real one.
  const demoPath = opts.demoPath
  // `demoPath` is always "/{userSlug}/{eventSlug}".
  const [, demoUser = '', demoEvent = ''] = demoPath?.split('/') ?? []

  const body = `<div class="pu-landing">
<header class="pu-hero">
  <p class="pu-mark">${CADENCE_LOGO}<span class="pu-hero-clock" id="pu-hero-clock" aria-hidden="true"></span></p>
  <h1>Schedule a meeting</h1>
  <p class="pu-hero-lede">An open, edge-native scheduler — a full single-team alternative to
    Calendly, teams and round-robin included, that runs entirely on Cloudflare Workers.</p>
  <div class="pu-hero-cta">
    <a class="pu-btn" href="/login">Sign in</a>
    <a class="pu-btn pu-btn-ghost" href="${escapeHtml(githubUrl)}">View source</a>
    ${demoPath ? `<a class="pu-btn pu-btn-ghost" href="${escapeHtml(demoPath)}">See a booking page</a>` : ''}
  </div>
</header>
<script>(function(){
  var el = document.getElementById('pu-hero-clock');
  if (!el) return;
  function tick(){
    var d = new Date();
    el.textContent = ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  tick();
  // Always add the class — the fade-in it triggers is downgraded to an
  // immediate, static opacity:1 under prefers-reduced-motion (see styles.ts),
  // so gating this on the media query here would leave the clock at its
  // pre-animation opacity:0 forever for exactly the users who most need it
  // to just appear.
  el.classList.add('pu-in');
  setInterval(tick, 15000);
})();</script>

<main>

${
  demoPath
    ? `<section aria-label="Live demo" class="pu-live-demo">
  <div class="pu-section-head">
    <h2>This is the actual product</h2>
    <p class="pu-muted">Not a screenshot — a real booking page, embedded with the same
      <code class="pu-time">&lt;script&gt;</code> tag anyone can drop into their own site.
      Pick a time; nothing about this demo is staged.</p>
  </div>
  <div class="pu-card pu-embed-frame">
    <script src="/embed.js" data-user="${escapeHtml(demoUser)}" data-event="${escapeHtml(demoEvent)}" data-height="560"></script>
  </div>
</section>`
    : ''
}

<section class="pu-card pu-pledge" aria-label="The pledge">
  <h2>The pledge</h2>
  <p>The open-source version is complete for a single team — forever. No seat
  limits, no gated scheduling features, no &ldquo;non-production use&rdquo; clauses.
  MIT makes this promise irrevocable: what we ship can never be taken back.</p>
</section>

<section aria-label="Why it's different">
  <div class="pu-section-head">
    <h2>Why it's different</h2>
  </div>
  <div class="pu-feature-grid">
    <div class="pu-card">
      <h3><span class="pu-stat">~0.14s TTFB, 3.8KB gzip</span>Renders at the edge</h3>
      <p class="pu-muted">Measured, not estimated. The booking page is a Cloudflare
        Worker answering from whichever edge is closest to your guest — not a
        Next.js app rendering in one region.</p>
    </div>
    <div class="pu-card">
      <h3>Self-host on Cloudflare</h3>
      <p class="pu-muted">Try the booking flow locally or follow the <a href="/docs/self-hosting">deployment guide</a> to run it on your own account.</p>
    </div>
    <div class="pu-card">
      <h3><span class="pu-stat">MIT, no CLA</span>Irrevocably open</h3>
      <p class="pu-muted">Nothing to sign away, nothing to relicense later.
        What ships under MIT today can't be taken back tomorrow.</p>
    </div>
    <div class="pu-card">
      <h3><span class="pu-stat">Built in</span>An MCP server for agents</h3>
      <p class="pu-muted">Your calendar as tools an AI agent can call — list
        event types, check availability, book, reschedule, cancel — with exactly
        your API key's authority, nothing more.</p>
    </div>
  </div>
</section>

<section aria-label="How it works">
  <div class="pu-section-head">
    <h2>How it works</h2>
  </div>
  <ol class="pu-steps">
    <li><h3>Connect your calendar</h3>
      <p class="pu-muted">Google Calendar or Microsoft 365, through your own
        OAuth app — so no one else ever sees your calendar data.</p></li>
    <li><h3>Share your link</h3>
      <p class="pu-muted">Every event type gets a page, like
        <span class="pu-time">${escapeHtml(example)}</span>.</p></li>
    <li><h3>Get booked</h3>
      <p class="pu-muted">Guests pick an open slot in their own timezone.
        A calendar invite goes out immediately; double-booking is impossible
        at the storage layer, not by convention.</p></li>
  </ol>
</section>

<section aria-label="Self-host Cadence">
  <div class="pu-section-head">
    <h2>Self-host Cadence</h2>
  </div>
  <div class="pu-compare">
    <div class="pu-card">
      <h3>Open source <span class="pu-badge">Free, forever</span></h3>
      <p class="pu-muted">Everything a single team needs to schedule meetings —
        run it yourself, on your own Cloudflare account.</p>
      <ul class="pu-muted">
        <li>Booking pages rendered and streamed from the edge</li>
        <li>Google Calendar and Microsoft 365 sync, your own OAuth app</li>
        <li>Event types — buffers, notice windows, horizons, daily caps, custom questions</li>
        <li>Teams — round-robin and collective scheduling</li>
        <li>Emails with .ics invites, reschedule/cancel links, reminders</li>
        <li>REST API, HMAC-signed webhooks, embed widget, MCP server</li>
      </ul>
    </div>

  </div>
</section>

</main>

${footer(githubUrl, opts.operator)}
</div>`

  return shell(
    {
      title: `${opts.brandName} — scheduling that shows up on time`,
      description:
        'Open, edge-native scheduling on Cloudflare Workers. Self-host with an MIT licence, with a built-in MCP server for AI agents.',
      baseUrl: opts.baseUrl,
      brandName: opts.brandName,
      path: '/',
      analyticsId: opts.analyticsId,
    },
    body,
  )
}

/**
 * A comparison page has one honesty rule the rest of the marketing site
 * doesn't: every row must be checkable by the reader, not just by us. So
 * this deliberately avoids specific competitor pricing figures, which drift
 * and would be the first thing a skeptical reader tries to catch us being
 * wrong about — the qualitative claims (closed-source, no self-host option,
 * seat-based pricing) are the ones that don't go stale.
 */
export function calendlyAlternativePage(opts: CalendlyAlternativePageOptions): string {
  const githubUrl = opts.githubUrl ?? DEFAULT_GITHUB_URL

  const rows: Array<[string, string, string]> = [
    ['License', 'MIT, open source', 'Proprietary, closed source'],
    ['Self-hosting', 'Yes — your own Cloudflare account', 'Not available'],
    ['Pricing model', 'Free, forever, for one team', 'Seat-based subscription'],
    ['Your calendar data', 'Stays in your own Google/Microsoft account', "Stored on the vendor's infrastructure"],
    ['Rendering', 'Server-rendered at the edge, no client framework', 'Client-rendered SPA'],
    ['AI agent access', 'Built-in MCP server', 'Not available'],
  ]

  const body = `<div class="pu-landing">
<header class="pu-hero">
  <p class="pu-mark"><a href="/" style="color:inherit;text-decoration:none">${CADENCE_LOGO}</a></p>
  <h1>The open-source Calendly alternative</h1>
  <p class="pu-hero-lede">A full single-team scheduler you can host on your own Cloudflare account under the MIT licence.</p>
  <div class="pu-hero-cta">
    <a class="pu-btn" href="${escapeHtml(githubUrl)}">View source</a>
    <a class="pu-btn pu-btn-ghost" href="/">See how it works</a>
  </div>
</header>

<main>

<section aria-label="Comparison">
  <div class="pu-section-head">
    <h2>How they compare</h2>
    <p class="pu-muted">Cadence is not a Calendly clone — it's an answer to a narrower
      question: what does a scheduler look like with no seat limits, no vendor
      lock-in on your calendar data, and a license that can't be revoked?</p>
  </div>
  <div class="pu-card pu-compare-table-wrap">
    <table class="pu-compare-table">
      <thead><tr><th scope="col"></th><th scope="col">Cadence</th><th scope="col">Calendly</th></tr></thead>
      <tbody>
        ${rows
          .map(
            ([label, cadence, calendly]) =>
              `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(cadence)}</td><td>${escapeHtml(calendly)}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>
  <p class="pu-muted pu-scroll-hint" style="font-size:.8125rem;margin:.5rem 0 0">Scroll to see the Calendly column &rarr;</p>
</section>

<section aria-label="Open source Calendly">
  <div class="pu-section-head">
    <h2>Looking for &ldquo;open source Calendly&rdquo;?</h2>
    <p class="pu-muted">Several projects have carried that label over the years, and more than
      one has since moved toward a closed-core or hosted-first model as it grew. Cadence's
      MIT license is not a marketing position that can quietly change later — the pledge
      above is the whole single-team product, and it stays that way by construction, not
      by promise.</p>
  </div>
</section>

<section class="pu-card pu-pledge" aria-label="The pledge">
  <h2>The pledge</h2>
  <p>The open-source version is complete for a single team — forever. No seat
  limits, no gated scheduling features, no &ldquo;non-production use&rdquo; clauses.
  MIT makes this promise irrevocable: what we ship can never be taken back.</p>
</section>

</main>

${footer(githubUrl, opts.operator)}
</div>`

  return shell(
    {
      title: `Open-source Calendly alternative · ${opts.brandName}`,
      description:
        'Cadence is a self-hosted, MIT-licensed alternative to Calendly — no seat limits, your calendar data stays yours, deployed on your own Cloudflare account.',
      baseUrl: opts.baseUrl,
      brandName: opts.brandName,
      path: '/calendly-alternative',
      analyticsId: opts.analyticsId,
    },
    body,
  )
}

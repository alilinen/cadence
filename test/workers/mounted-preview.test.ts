import { describe, expect, it } from 'vitest'
import { internalRequest, publicPath } from '../../src/mounted/mount.js'
import { previewData, renderPreview } from '../../src/mounted/preview-page.js'
import { confirmForm, shellFoot, shellHead } from '../../src/http/pages/booking.js'
import { formatQuestions, parseQuestions } from '../../src/http/pages/dashboard.js'
import previewWorker from '../../src/mounted/preview.js'

const now = Date.parse('2026-10-28T08:00:00Z')

describe('Cadence booking boundary', () => {
  it('keeps app paths mounted, company links external and upstream manage URLs distinct', () => {
    expect(publicPath('/auth/google/callback')).toBe('/book/auth/google/callback')
    expect(publicPath('/booking/id?token=signed')).toBe('/book/booking/id?token=signed')
    expect(publicPath('/book/brand/cadence.css')).toBe('/book/brand/cadence.css')
    expect(publicPath('https://organizer.example/')).toBe('https://organizer.example/')
    expect(publicPath('//external.example/path')).toBe('//external.example/path')
    expect(publicPath('#main')).toBe('#main')
  })

  it('preserves a form body and query while rejecting paths outside /book', async () => {
    const input = new Request('https://organizer.example/book/alex/demo/confirm?tz=Europe%2FLondon', { method: 'POST', body: 'name=Preview', headers: { referer: 'https://organizer.example/book/alex/demo' } })
    const internal = internalRequest(input)!
    expect(new URL(internal.url).pathname).toBe('/alex/demo/confirm')
    expect(new URL(internal.url).searchParams.get('tz')).toBe('Europe/London')
    expect(await internal.text()).toBe('name=Preview')
    expect(internal.headers.get('referer')).toBe('https://organizer.example/alex/demo')
    expect(internalRequest(new Request('https://organizer.example/bookings'))).toBeNull()
  })

  it('uses the current Cadence assets and removes visible software attribution without breaking embeds', () => {
    const head = shellHead({ title: 'Book a demo', brandName: 'Cadence' })
    expect(head).toContain('class="cadence-wordmark"')
    expect(head).toContain('role="img" aria-label="Cadence"')
    expect(head).toContain('href="/book/favicon.svg?v=common-time"')
    expect(publicPath('/book/favicon.svg?v=common-time')).toBe('/book/favicon.svg?v=common-time')
    expect(head).toContain('/book/brand/cadence.css')
    expect(head).not.toContain('rel="preload" href="/fonts/')
    expect(shellFoot(true)).toContain('href="/privacy"')
    expect(shellFoot(true, true)).toContain('postMessage')
  })

  it('keeps the installation name and host artwork in place of the default logo', () => {
    const custom = shellHead({ title: 'Book a demo', brandName: 'A & B' })
    expect(custom).toContain('<span data-instance-wordmark>A &amp; B</span>')
    const uploaded = shellHead({ title: 'Book a demo', brandName: 'Cadence', logoSrc: '/avatars/custom.png', ownerLabel: 'My team' })
    expect(uploaded).toContain('src="/avatars/custom.png" alt="My team"')
    expect(uploaded).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" class="cadence-wordmark"')
  })
})

describe('review-only booking flow', () => {
  it('opens the mounted demo from the URL printed by the local dev server', async () => {
    const origin = 'http://localhost:8891'
    const res = await previewWorker.fetch(new Request(origin), { ASSETS: {} as Fetcher })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(origin + '/book')
  })

  it('keeps one agenda textarea after the configured event is saved through the dashboard editor', () => {
    const data = previewData(new URL('https://organizer.example/alex/demo'), now)
    data.eventType = { ...data.eventType, questions: parseQuestions(formatQuestions(data.eventType.questions))! }
    const html = confirmForm(data, data.slots![0]!.start)
    expect(html.match(/<textarea\b[^>]*name="q_/g)).toHaveLength(1)
    expect(html.match(/<textarea\b[^>]*id="additionalGuests"/g)).toHaveLength(1)
  })

  it('keeps date links at the page top and enhances the calendar without focusing the times panel', async () => {
    const result = await renderPreview(new Request('https://organizer.example/alex/demo?date=2026-10-29'), now)
    const html = await result.text()
    expect(html).not.toContain('#cadence-times')
    expect(html).not.toContain('id="cadence-times" tabindex="-1"')
    expect(html).toContain('data-booking-calendar')
    expect(html).toContain('/book/brand/calendar-navigation.js')
  })

  it('submits through the Worker entry without routing a form to the static asset server', async () => {
    const data = previewData(new URL('https://organizer.example/alex/demo'), Date.now())
    const result = await previewWorker.fetch(new Request('https://organizer.example/book/alex/demo/confirm', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ start: String(data.slots![0]!.start), name: 'Demo Guest', email: 'guest@example.invalid', tz: data.guestTimezone }),
    }), { ASSETS: { fetch() { throw new Error('Static assets must not receive booking form submissions') } } as unknown as Fetcher })
    expect(result.status).toBe(200)
    expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(await result.text()).toContain('No booking was saved')
  })
  it('generates sample slots through the scheduling engine and validates timezone input', () => {
    const data = previewData(new URL('https://organizer.example/alex/demo?tz=Not%2FAZone'), now)
    expect(data.guestTimezone).toBe('Europe/London')
    expect(data.selectedDate).toBe('2026-10-28')
    expect(data.slots!.length).toBeGreaterThan(0)
    expect(data.slots!.every(slot => slot.start > now)).toBe(true)
  })

  it('walks from calendar to details to an explicit simulation, with no invitation claim', async () => {
    const data = previewData(new URL('https://organizer.example/alex/demo'), now)
    const start = data.slots![0]!.start
    const details = await renderPreview(new Request(`https://organizer.example/alex/demo/confirm?start=${start}`), now)
    expect(await details.text()).toContain('name="email"')
    const result = await renderPreview(new Request('https://organizer.example/alex/demo/confirm', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ start: String(start), tz: 'Europe/London', name: 'Demo Guest', email: 'guest@example.invalid' }) }), now)
    const html = await result.text()
    expect(result.status).toBe(200)
    expect(html).toContain('No booking was saved and no calendar invitation was sent')
    expect(html).not.toContain('A calendar invitation is on its way')
  })

  it('retains typed answers on validation errors and rejects made-up times', async () => {
    const data = previewData(new URL('https://organizer.example/alex/demo'), now)
    const result = await renderPreview(new Request('https://organizer.example/alex/demo/confirm', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ start: String(data.slots![0]!.start), tz: 'Europe/London', name: 'Demo Guest', email: 'invalid', q_company: 'Example Studio' }) }), now)
    expect(result.status).toBe(422)
    expect(await result.text()).toContain('value="Example Studio"')
    const forged = await renderPreview(new Request('https://organizer.example/alex/demo/confirm?start=1'), now)
    expect(forged.status).toBe(400)
  })
})


describe('dashboard design preview', () => {
  it('renders the actual dashboard templates under /book and rejects writes', async () => {
    const env = { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } as unknown as Fetcher }
    for (const path of ['', '/bookings', '/availability', '/connections', '/settings', '/api-keys', '/teams']) {
      const response = await previewWorker.fetch(new Request(`https://organizer.example/book/dashboard${path}`), env)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('cadence-dashboard')
      expect(html).toContain('href="/book/dashboard')
      expect(html).toContain('Design preview')
    }
    const response = await previewWorker.fetch(new Request('https://organizer.example/book/dashboard/settings', { method: 'POST', body: 'name=Changed' }), env)
    expect(response.status).toBe(405)
  })
})

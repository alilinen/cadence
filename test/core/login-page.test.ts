/**
 * The sign-in page's framing. A magic link is sign-in and sign-up at once,
 * so on an open instance the page has to say that a stranger is in the
 * right place — the alternative is a "Sign in" heading and a hunt for a
 * register button that does not exist.
 */

import { describe, expect, it } from 'vitest'
import { loginPage } from '../../src/http/pages/dashboard.js'

describe('loginPage', () => {
  it('carries the wordmark above the heading, in both states', () => {
    for (const data of [{ sent: false }, { sent: true }]) {
      const html = loginPage({ brandName: 'Cadence', providers: [], ...data })
      const mark = html.indexOf('<a class="pu-mark" href="/"')
      expect(html.slice(mark, html.indexOf('</a>', mark))).toContain('role="img" aria-label="Cadence"')
      expect(mark).toBeGreaterThan(-1)
      expect(mark).toBeLessThan(html.indexOf('<h1>'))
    }
  })

  it('says the link also creates an account when sign-ups are open', () => {
    const html = loginPage({ brandName: 'Cadence', providers: [], signupsOpen: true })
    expect(html).toContain('<h1>Sign in or create an account</h1>')
    expect(html).toContain('the same link creates your account if you are new')
  })

  it('says only "Sign in" on a closed or allowlisted instance, and when the caller passed nothing', () => {
    for (const signupsOpen of [false, undefined]) {
      const html = loginPage({ brandName: 'Cadence', providers: [], signupsOpen })
      expect(html).toContain('<h1>Sign in</h1>')
      expect(html).not.toContain('create an account')
      expect(html).not.toContain('creates your account')
    }
  })

  it('explains console sign-in only on local installs and keeps links out of the page', () => {
    const data = { brandName: 'Cadence', providers: [], sent: true }
    const local = loginPage({ ...data, mailMode: 'local-console' })
    expect(local).toContain('terminal running Wrangler')
    expect(local).not.toContain('token=')
    const hosted = loginPage({ ...data, mailMode: 'unavailable' })
    expect(hosted).toContain('Email sign-in is unavailable')
    expect(hosted.slice(hosted.indexOf('<body'))).not.toMatch(/terminal|inbox|token=/)
  })

  it('never lets the policy wording leak into the neutral "sent" state', () => {
    const html = loginPage({ brandName: 'Cadence', providers: [], signupsOpen: true, sent: true })
    expect(html).toContain('<h1>Check your inbox</h1>')
    expect(html).not.toContain('create an account')
  })
})

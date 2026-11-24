import { describe, expect, it } from 'vitest'
import { mountedResponse } from '../../src/mounted/mount.js'

describe('mounted Cadence responses in the Workers runtime', () => {
  const request = new Request('https://organizer.example/book/ali/demo')
  it('rewrites HTML URL attributes while preserving user content, external destinations and status', async () => {
    const source = '<html><body><a href="/ali/demo?date=2026-10-29">Day</a><form action="/ali/demo/confirm"></form><img src="/avatars/image"><a href="https://organizer.example/">Home</a><p>/this is user content</p></body></html>'
    const result = mountedResponse(new Response(source, { status: 422, headers: { 'content-type': 'text/html' } }), request, { mount: '/book', preview: true })
    const html = await result.text()
    expect(result.status).toBe(422)
    expect(html).toContain('href="/book/ali/demo?date=2026-10-29"')
    expect(html).toContain('action="/book/ali/demo/confirm"')
    expect(html).toContain('src="/book/avatars/image"')
    expect(html).toContain('href="https://organizer.example/"')
    expect(html).toContain('<p>/this is user content</p>')
    expect(html).toContain('No calendar invitations are sent')
    expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
  it('keeps separate authentication cookies scoped under /booking and mounts redirects', () => {
    const headers = new Headers({ location: '/dashboard' })
    headers.append('set-cookie', 'cadence_session=a; Path=/; Secure; HttpOnly; SameSite=Lax')
    headers.append('set-cookie', 'oauth_nonce=b; Path=/auth; HttpOnly; SameSite=Lax')
    const result = mountedResponse(new Response(null, { status: 302, headers }), request, { mount: '/book' })
    expect(result.headers.get('location')).toBe('/book/dashboard')
    expect(result.headers.getSetCookie()).toEqual([
      'cadence_session=a; Path=/book; Secure; HttpOnly; SameSite=Lax',
      'oauth_nonce=b; Path=/book/auth; HttpOnly; SameSite=Lax',
    ])
  })
})


it('mounts theme image sources while retaining the absolute main website link', async () => {
  const source = '<html><body><a data-brand-home href="https://company.example/">Home</a><img src="/avatars/light.png" data-theme-light-src="/avatars/light.png" data-theme-dark-src="/avatars/dark.png"><link rel="icon" href="/favicon.svg" data-theme-light-href="/favicon.svg" data-theme-dark-href="https://images.example/dark.ico"></body></html>'
  const result = mountedResponse(new Response(source,{headers:{'content-type':'text/html'}}),new Request('https://company.example/book/ali/demo'), { mount: '/book' })
  const html = await result.text()
  expect(html).toContain('data-theme-light-src="/book/avatars/light.png"')
  expect(html).toContain('data-theme-dark-src="/book/avatars/dark.png"')
  expect(html).toContain('data-theme-light-href="/book/favicon.svg"')
  expect(html).toContain('data-theme-dark-href="https://images.example/dark.ico"')
  expect(html).toContain('data-brand-home href="https://company.example/"')
})

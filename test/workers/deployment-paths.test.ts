import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import worker, { buildPorts, type Env } from '../../src/index.js'
import compatibilityWorker from '../../src/mounted/worker.js'
import { mountOptions, internalRequest, publicPath } from '../../src/mounted/mount.js'
import { createEnvOAuthCredentials } from '../../src/adapters/oauth.js'

const mounts = ['', '/book', '/booking', '/tools/calendar']

for (const mount of mounts) describe(`deployment at ${mount || '/'}`, () => {
  const base = 'https://calendar.example' + mount
  const assets = vi.fn(async (request: Request) => new Response(new URL(request.url).pathname, { headers: { 'content-type': 'text/css' } }))
  const config: Env = { ...env, BASE_URL: base + '/', ASSETS: { fetch: assets } as unknown as Fetcher,
    EMAIL_PROVIDER: 'cloudflare', EMAIL: { send: async () => { throw new Error('Live email is forbidden in this test') } } as unknown as SendEmail, TASKS: { send: async () => {} } as unknown as Queue,
    GOOGLE_CLIENT_ID: 'test-only', GOOGLE_CLIENT_SECRET: 'test-only' }
  async function fetch(path: string, init?: RequestInit) {
    const ctx = createExecutionContext()
    const response = await worker.fetch(new Request(base + path, init), config, ctx)
    await waitOnExecutionContext(ctx)
    return response
  }

  it('uses the same entry point and strips exactly the configured boundary', async () => {
    expect(compatibilityWorker).toBe(worker)
    expect(buildPorts(config).config.baseUrl).toBe(base)
    expect(publicPath('/booking/id?token=abc', mountOptions(base))).toBe(mount + '/booking/id?token=abc')
    expect((await fetch('/health')).status).toBe(200)
    const outside = internalRequest(new Request('https://calendar.example' + mount + '-outside/health'), mountOptions(base))
    if (mount) expect(outside).toBeNull()
  })

  it('serves static assets without forwarding forms or application routes to the asset binding', async () => {
    assets.mockClear()
    for (const path of ['/brand/cadence.css', '/brand/theme.js', '/brand/fonts.css', '/brand/favicon.svg?v=common-time', '/fonts/inter-variable.woff2', '/cadence-email.png']) {
      const response = await fetch(path)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(path.split('?')[0])
    }
    const count = assets.mock.calls.length
    expect((await fetch('/login')).status).toBe(200)
    expect((await fetch('/brand/cadence.css', { method: 'POST', body: 'test' })).status).not.toBe(200)
    expect(assets.mock.calls.length).toBe(count)
    const head = await fetch('/brand/cadence.css', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(assets.mock.lastCall?.[0].method).toBe('HEAD')
  })

  it('mounts login forms, dashboard redirects, favicon and OAuth cookies/callbacks', async () => {
    const login = await (await fetch('/login')).text()
    expect(login).toContain(`src="${mount}/brand/theme.js"`)
    expect(login).toContain(`href="${mount}/brand/fonts.css"`)
    expect(login).toContain(`action="${mount}/login"`)
    expect(login).not.toContain('url(/fonts/')
    expect((await fetch('/dashboard')).headers.get('location')).toBe(mount + '/login')
    expect((await fetch('/favicon.ico')).headers.get('location')).toBe(mount + '/brand/favicon.svg?v=common-time')
    const oauth = await fetch('/auth/google/start?purpose=identity')
    expect(oauth.status).toBe(302)
    expect(oauth.headers.get('set-cookie')).toContain('cadence_oauth=')
    expect(oauth.headers.get('set-cookie')).toContain(`Path=${mount}/auth`)
    const expected = createEnvOAuthCredentials(config, base).redirectUri('google', 'identity')
    expect(expected).toContain(base + '/auth/google/callback')
    expect(new URL(oauth.headers.get('location')!).searchParams.get('redirect_uri')).toBe(expected)
  })

  it('creates, moves and cancels a booking through the public mounted forms', async () => {
    const id = 'mount-' + (mount.replaceAll('/', '-') || 'root')
    const slug = id
    const now = Date.now()
    const start = Math.ceil((now + 3 * 86400000) / 1800000) * 1800000
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(id,email,name,tz,slug,created_at) VALUES(?,?,?,?,?,?)').bind(id, id + '@example.invalid', 'Host', 'UTC', slug, now),
      env.DB.prepare('INSERT INTO schedules(id,user_id,name,is_default,timezone,weekly_json,overrides_json,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(id, id, 'Working hours', 1, 'UTC', JSON.stringify(Array(7).fill([{ startMinute: 0, endMinute: 1440 }])), '[]', now),
      env.DB.prepare(`INSERT INTO event_types(id,owner_user_id,scheduling_type,slug,title,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,min_notice_minutes,max_horizon_days,location_type,questions_json,active,created_at)
        VALUES(?,?,'personal','demo','Demo','',30,0,0,0,60,'phone','[]',1,?)`).bind(id, id, now),
    ])
    const details = await (await fetch(`/${slug}/demo/confirm?start=${start}&tz=UTC`)).text()
    expect(details).toContain(`action="${mount}/${slug}/demo/confirm"`)
    const post = (path: string, body: Record<string, string>) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://calendar.example' }, body: new URLSearchParams(body) })
    const confirmed = await post(`/${slug}/demo/confirm`, { start: String(start), tz: 'UTC', name: 'Local test guest', email: id + '-guest@example.invalid' })
    expect(confirmed.status).toBe(200)
    const html = await confirmed.text()
    const manageHref = html.match(/href="([^"]*\/booking\/[^"?]+\?token=[^"]+)"/)?.[1]?.replaceAll('&amp;', '&')
    expect(manageHref).toBeTruthy()
    const manage = new URL(manageHref!)
    expect(manage.pathname.startsWith(mount + '/booking/')).toBe(true)
    const path = manage.pathname.slice(mount.length)
    const token = manage.searchParams.get('token')!
    const management = await (await fetch(path + manage.search)).text()
    expect(management).toContain(`action="${mount}${path}/cancel"`)
    const moved = await post(path + '/reschedule', { token, start: String(start + 3600000) })
    expect(moved.status).toBe(302)
    const next = new URL(moved.headers.get('location')!, base)
    expect(next.pathname.startsWith(mount + '/booking/')).toBe(true)
    const cancelled = await post(next.pathname.slice(mount.length) + '/cancel', { token: next.searchParams.get('token')! })
    expect(cancelled.status).toBe(200)
    const row = await env.DB.prepare('SELECT status,start_utc FROM bookings WHERE id=?').bind(next.pathname.split('/').pop()).first<{status:string;start_utc:number}>()
    expect(row).toEqual({ status: 'cancelled', start_utc: start + 3600000 })
    const ports = buildPorts(config)
    const tokenValue = ports.crypto.randomToken(32)
    await env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at,absolute_expires_at,created_at) VALUES(?,?,?,?,?)')
      .bind(await ports.crypto.hash(tokenValue), id, now + 86400000, now + 86400000, now).run()
    const cookie = 'cadence_session=' + tokenValue
    const dashboard = await fetch('/dashboard/appearance', { headers: { cookie } })
    expect(dashboard.status).toBe(200)
    const appearance = await dashboard.text()
    expect(appearance.includes(`src="${mount}/brand/appearance-editor.js"`)).toBe(true)
    expect(appearance.includes(`src="${mount}/dashboard/appearance?sample=1"`)).toBe(true)
    const csrf = appearance.match(/name="csrf" value="([^"]+)"/)?.[1]
    expect(csrf).toBeTruthy()
    const logout = await fetch('/logout', { method: 'POST', headers: { cookie, origin: 'https://calendar.example', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrf! }) })
    expect(logout.status).toBe(302)
    expect(logout.headers.get('location')).toBe(mount + '/login')
    expect(logout.headers.get('set-cookie')).toContain(`cadence_session=; Path=${mount || '/'};`)

  })
})

it('applies the asset CDN only to bundled assets, preserving app routes and custom branding', async () => {
  const base = 'https://calendar.example/tools/calendar'
  const config = { ...env, BASE_URL: base, ASSET_BASE_URL: 'https://cdn.example/release/', EMAIL_PROVIDER: 'cloudflare', EMAIL: {} as SendEmail }
  const response = await worker.fetch(new Request(base + '/login'), config, createExecutionContext())
  const html = await response.text()
  expect(html).toContain('src="https://cdn.example/release/brand/theme.js"')
  expect(html).toContain('href="https://cdn.example/release/brand/fonts.css"')
  expect(html).toContain('action="/tools/calendar/login"')
  const options = mountOptions(base, config.ASSET_BASE_URL)
  expect(publicPath('/avatars/my-logo.png', options)).toBe('/tools/calendar/avatars/my-logo.png')
  expect(publicPath('https://images.example/logo.svg', options)).toBe('https://images.example/logo.svg')
})


it('fails closed when retired identity settings have not been migrated', () => {
  for (const name of ['PROTOCOL_NAMESPACE', 'INVITATION_UID_DOMAIN']) {
    expect(() => buildPorts({ ...env, [name]: 'previous-app' })).toThrow('preserve existing invitation UIDs')
  }
})

it.each(['/book', '/booking'])('serves a locally linked static favicon at %s without shadowing later branding overrides', async (mount) => {
  const base = 'https://calendar.example' + mount
  const assetFetch = vi.fn(async (request: Request) => new Response(new URL(request.url).pathname, { headers: { 'content-type': 'image/x-icon' } }))
  const config = { ...env, BASE_URL: base, ASSETS: { fetch: assetFetch } as unknown as Fetcher }
  const fetch = () => worker.fetch(new Request(base + '/favicon.ico'), config, createExecutionContext())
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO instance_settings(key,value,updated_at) VALUES('favicon_key',?,0)").bind(base + '/favicon.ico').run()
    const local = await fetch()
    expect(local.status).toBe(200)
    expect(local.headers.has('location')).toBe(false)
    expect(await local.text()).toBe('/favicon.ico')
    await env.DB.prepare("UPDATE instance_settings SET value='https://images.example/new-icon.png' WHERE key='favicon_key'").run()
    const custom = await fetch()
    expect(custom.headers.get('location')).toBe('https://images.example/new-icon.png')
    expect(assetFetch).toHaveBeenCalledTimes(1)
  } finally {
    await env.DB.prepare("DELETE FROM instance_settings WHERE key='favicon_key'").run()
  }
})

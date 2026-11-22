/**
 * Logos for event types and teams, and team editing and serving, under the real Workers runtime — the
 * part that cannot be checked by reading the code: `@cf-wasm/photon` actually
 * decodes and resizes real bytes under workerd, and R2 (simulated by
 * `@cloudflare/vitest-plugin` from the `[[r2_buckets]]` binding in
 * wrangler.toml) actually round-trips them.
 */

import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRouter } from '../../src/http/router.js'
import { createD1Repositories } from '../../src/adapters/d1/repositories.js'
import { fitKeyFor, readImageDimensions } from '../../src/core/domain/media.js'
import { createR2BlobStorage } from '../../src/adapters/storage/r2-blob.js'
import { createWebCrypto } from '../../src/adapters/crypto/webcrypto.js'
import { createSlotService } from '../../src/engine.js'
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../../src/core/domain/auth-service.js'
import { createFakeEmailSender, createFakeRateLimiter, fakeConfig } from '../../src/testing/fakes.js'
import type {
  BlobCache,
  CalendarProviders,
  EnginePorts,
  HostCoordinator,
  QueuePort,
} from '../../src/ports.js'

const db = env.DB
const BASE = 'https://cadence.test'
const NOW = Date.now()
const HOST_ID = 'usr_avatar_host'
const HOST_EMAIL = 'avatarhost@example.test'

// A real 6x4 PNG (`magick -size 6x4 xc:'#3355ee' -depth 8 -strip`) — small
// enough to embed, real enough for photon to decode, crop and resize as an
// actual image rather than bytes that merely pass the content-type check.
// Deliberately NOT one of the well-known hand-minified "smallest possible
// PNG" byte strings that circulate online: several of those use encoding
// shortcuts that trip a decode panic in photon-rs's underlying `image`
// crate (verified directly — this is not a hypothetical), which a normal
// encoder's output does not.
const PNG_6X4_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAYAAAAEAQMAAACXytwAAAAAA1BMVEUzVe4BKQB9AAAAC0lEQVQI12NggAAAAAgAAS8g3TEAAAAASUVORK5CYII='
function pngBytes(): Uint8Array {
  const binary = atob(PNG_6X4_BASE64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}



const crypto_ = createWebCrypto({
  keys: { 1: 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy0hIQ==' },
  currentVersion: 1,
  signingKey: 'dGVzdC1zaWduaW5nLWtleS0zMi1ieXRlcy1sb25nLi4h',
})

const calendars: CalendarProviders = {
  get() {
    throw new Error('test: no calendar provider is configured')
  },
  available: () => [],
}
const blobCache: BlobCache = {
  async get() {
    return null
  },
  async put() {},
}
const queue: QueuePort = { async send() {}, async sendBatch() {} }
const coordinator = new Proxy({} as HostCoordinator, {
  get(_t, prop) {
    return () => {
      throw new Error(`test: coordinator.${String(prop)} is not stubbed`)
    }
  },
})

const email = createFakeEmailSender()
const ports: EnginePorts = {
  repositories: (scope) => createD1Repositories(db, scope),
  calendars,
  oauth: { forProvider: () => null, redirectUri: (name, purpose) => `${BASE}/auth/${name}/callback?purpose=${purpose}` },
  email,
  crypto: crypto_,
  cache: { async get() { return null }, async put() {}, async delete() {} },
  blobCache,
  blobStorage: createR2BlobStorage(env.AVATARS),
  clock: { now: () => Date.now() },
  queue,
  coordinator,
  rateLimiter: createFakeRateLimiter(),
  config: fakeConfig({ baseUrl: BASE }),
}

const slots = createSlotService(ports)
const app = buildRouter(ports, slots)

async function seedSession(userId: string): Promise<string> {
  const token = crypto_.randomToken(32)
  await db
    .prepare(
      `INSERT INTO sessions (id_hash,user_id,expires_at,absolute_expires_at,bookmark,created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(await crypto_.hash(token), userId, NOW + SESSION_TTL_MS, NOW + SESSION_ABSOLUTE_TTL_MS, null, NOW)
    .run()
  return `${SESSION_COOKIE_NAME}=${token}`
}

async function csrfFor(cookie: string): Promise<string> {
  const token = cookie.slice(`${SESSION_COOKIE_NAME}=`.length)
  const idHash = await crypto_.hash(token)
  return crypto_.hash(`csrf|${idHash}`)
}


beforeAll(async () => {
  await db
    .prepare('INSERT INTO users (id,email,name,tz,slug,created_at) VALUES (?,?,?,?,?,?)')
    .bind(HOST_ID, HOST_EMAIL, 'Avatar Host', 'UTC', 'avatar-host', NOW)
    .run()
})


async function multipart(path: string, cookie: string, csrf: string, field: string, bytes: Uint8Array, type = 'image/png'): Promise<Response> {
  const form = new FormData()
  form.append('csrf', csrf)
  form.append(field, new File([bytes], 'logo.png', { type }))
  return app.fetch(new Request(`${BASE}${path}`, { method: 'POST', body: form, headers: { cookie } }))
}

async function postForm(path: string, cookie: string, body: Record<string, string>): Promise<Response> {
  const form = new FormData()
  for (const [k, v] of Object.entries(body)) form.append(k, v)
  return app.fetch(new Request(`${BASE}${path}`, { method: 'POST', body: form, headers: { cookie } }))
}

const L_ALICE = 'usr_logo_alice'
const L_BOB = 'usr_logo_bob'
const L_TEAM = 'team_logo'
const L_ET = 'et_logo_team'
const L_PERSONAL = 'et_logo_personal'

beforeAll(async () => {
  const now = Date.now()
  const insertUser = 'INSERT INTO users (id,email,name,tz,slug,role,created_at) VALUES (?,?,?,?,?,?,?)'
  await db.batch([
    db.prepare(insertUser).bind(L_ALICE, 'logo-alice@example.test', 'Alice Logo', 'UTC', 'logo-alice', 'admin', now),
    db.prepare(insertUser).bind(L_BOB, 'logo-bob@example.test', 'Bob Logo', 'UTC', 'logo-bob', 'member', now),
    db.prepare('INSERT INTO slug_claims (slug,kind,owner_id,created_at) VALUES (?,?,?,?)').bind('logo-alice', 'user', L_ALICE, now),
    db.prepare('INSERT INTO slug_claims (slug,kind,owner_id,created_at) VALUES (?,?,?,?)').bind('logo-bob', 'user', L_BOB, now),
    db.prepare('INSERT INTO teams (id,name,slug,logo_key,created_at) VALUES (?,?,?,?,?)').bind(L_TEAM, 'Logo Crew', 'logo-crew', null, now),
    db.prepare('INSERT INTO slug_claims (slug,kind,owner_id,created_at) VALUES (?,?,?,?)').bind('logo-crew', 'team', L_TEAM, now),
    db.prepare('INSERT INTO team_members (team_id,user_id,role,rr_weight) VALUES (?,?,?,?)').bind(L_TEAM, L_ALICE, 'admin', 1),
    db.prepare('INSERT INTO team_members (team_id,user_id,role,rr_weight) VALUES (?,?,?,?)').bind(L_TEAM, L_BOB, 'member', 1),
    db.prepare(
      `INSERT INTO event_types (id,owner_user_id,owner_team_id,scheduling_type,slug,title,duration_minutes,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(L_ET, null, L_TEAM, 'collective', 'crew-call', 'Crew call', 30, now),
    db.prepare(
      `INSERT INTO event_types (id,owner_user_id,owner_team_id,scheduling_type,slug,title,duration_minutes,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(L_PERSONAL, L_ALICE, null, 'personal', 'intro', 'Intro', 30, now),
  ])
})

it('previews an uploaded appearance logo privately, then publishes the fitted image', async () => {
  const cookie = await seedSession(L_ALICE)
  const csrf = await csrfFor(cookie)
  const path = '/dashboard/appearance?team=' + L_TEAM
  const settings = createD1Repositories(db, { consistency: 'bookmark' }).teams
  const submit = (intent: string) => {
    const form = new FormData()
    for (const [key, value] of Object.entries({ csrf, intent, layout: 'agenda' })) form.set(key, value)
    form.set('logo', new File([pngBytes()], 'example.png', { type: 'image/png' }))
    return app.fetch(new Request(BASE + path, { method: 'POST', body: form, headers: { cookie } }))
  }
  const preview = await submit('preview')
  expect(preview.status).toBe(200)
  const html = await preview.text()
  expect(html).toContain('data:image/webp;base64,')
  expect(html).not.toMatch(/<(?:body|main)\b[^>]*\binert\b/)
  expect(html).toMatch(/<select\b[^>]*\binert\b/)
  expect(html).toContain('<time datetime=')
  expect(html).not.toMatch(/href="[^"]*\/confirm\?start=/)
  expect((await settings.byId(L_TEAM))?.appearance?.logoKey).toBeFalsy()
  expect((await submit('publish')).status).toBe(303)
  const key = (await settings.byId(L_TEAM))!.appearance!.logoKey!
  expect(await env.AVATARS.head(fitKeyFor(key))).toBeTruthy()
  const live = await app.fetch(new Request(BASE + '/logo-crew/crew-call'))
  expect(await live.text()).toContain('/avatars/' + fitKeyFor(key))
})

describe('event type logo', () => {
  it('uploads a logo from the edit form; the booking page is headed by it; remove clears it', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const res = await multipart(`/dashboard/event-types/${L_ET}/logo`, cookie, csrf, 'logo', pngBytes())
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Logo updated.')
    const row = await db.prepare('SELECT logo_key FROM event_types WHERE id = ?').bind(L_ET).first<{ logo_key: string | null }>()
    expect(row?.logo_key).toMatch(/-thumb\.webp$/)
    expect(html).toContain(`/avatars/${row!.logo_key}`)
    expect(html).toContain('Replace logo')

    // The public page shows the event's own logo, not the team's initial.
    const page = await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))
    const pageHtml = await page.text()
    expect(pageHtml).toContain(`/avatars/${row!.logo_key}`)
    // Served for real, as a WebP thumbnail.
    const img = await app.fetch(new Request(`${BASE}/avatars/${row!.logo_key}`))
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/webp')

    const removed = await postForm(`/dashboard/event-types/${L_ET}/logo/delete`, cookie, { csrf })
    expect(removed.status).toBe(200)
    expect(await removed.text()).toContain('Logo removed.')
    const after = await db.prepare('SELECT logo_key FROM event_types WHERE id = ?').bind(L_ET).first<{ logo_key: string | null }>()
    expect(after?.logo_key).toBeNull()
  })

  it('rejects a bad file with the same rules as the profile photo, and a non-admin cannot upload at all', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const bad = await multipart(`/dashboard/event-types/${L_ET}/logo`, cookie, csrf, 'logo', new Uint8Array([1, 2, 3]), 'text/plain')
    expect(bad.status).toBe(400)
    expect(await bad.text()).toContain('PNG, JPEG or WebP images only')

    const bob = await seedSession(L_BOB)
    const bobCsrf = await csrfFor(bob)
    expect((await multipart(`/dashboard/event-types/${L_ET}/logo`, bob, bobCsrf, 'logo', pngBytes())).status).toBe(404)
  })

  it('the create form has no logo panel; a personal event type gets one on edit', async () => {
    const cookie = await seedSession(L_ALICE)
    const fresh = await app.fetch(new Request(`${BASE}/dashboard/event-types/new`, { headers: { cookie } }))
    expect(await fresh.text()).not.toContain('Upload logo')
    const edit = await app.fetch(new Request(`${BASE}/dashboard/event-types/${L_PERSONAL}`, { headers: { cookie } }))
    expect(await edit.text()).toContain('Upload logo')
  })
})

describe('company logo', () => {
  const setting = (key: string) => db.prepare('SELECT value FROM instance_settings WHERE key = ?').bind(key).first<{ value: string }>()

  it('uses the admin-uploaded logo throughout the installation and keeps Settings attribution', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const res = await multipart('/dashboard/admin/logo', cookie, csrf, 'logo', pngBytes())
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Company logo updated.')
    const key = (await setting('company_logo_key'))?.value
    expect(key).toMatch(/-thumb\.webp$/)

    const teamPage = await (await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))).text()
    expect(teamPage).toContain(`/avatars/${key}`)
    // Beside a round logo: the brand, not the team. The team is a suffix after the hosts.
    expect(teamPage).toMatch(/<p class="pu-host-name">[^<]+<\/p>/)
    expect(teamPage).not.toContain('<p class="pu-host-name">Logo Crew</p>')
    expect(teamPage).toContain('<span class="pu-hosts-team">(Logo Crew)</span>')
    const personal = await (await app.fetch(new Request(`${BASE}/logo-alice/intro`))).text()
    expect(personal).toContain(`/avatars/${key}`)
    for (const path of ['/login', '/docs', '/', '/privacy', '/dashboard/settings']) {
      const html = await (await app.fetch(new Request(BASE + path, { headers: { cookie } }))).text()
      expect(html).toContain(`/avatars/${key}`)
      expect(html.match(/<svg[^>]+class="cadence-wordmark"/g) ?? []).toHaveLength(path === '/dashboard/settings' ? 1 : 0)
      if (path === '/dashboard/settings') expect(html).toContain('data-platform-credit')
    }
    await postForm('/login', '', { email: 'logo-alice@example.test' })
    const pngPath = '/avatars/' + key!.replace(/\.webp$/, '.png')
    expect(email.sent.at(-1)?.html).toContain(`src="${BASE}${pngPath}"`)
    expect(email.sent.at(-1)?.html).not.toContain('cadence-email.png')
    const card = await app.fetch(new Request(`${BASE}/og/logo-crew/crew-call.png`))
    expect(card.status).toBe(200)
    expect(card.headers.get('content-type')).toContain('image/png')

    const bob = await seedSession(L_BOB)
    expect((await multipart('/dashboard/admin/logo', bob, await csrfFor(bob), 'logo', pngBytes())).status).not.toBe(200)
  })

  it('uploads, serves and removes an independent instance favicon', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const member = await seedSession(L_BOB)
    expect((await multipart('/dashboard/admin/favicon', member, await csrfFor(member), 'favicon', pngBytes())).status).not.toBe(200)
    expect((await multipart('/dashboard/admin/favicon', cookie, 'invalid', 'favicon', pngBytes())).status).not.toBe(200)
    expect((await multipart('/dashboard/admin/favicon', cookie, csrf, 'favicon', pngBytes())).status).toBe(200)
    const key = (await setting('favicon_key'))!.value
    const path = '/avatars/' + key.replace(/\.webp$/, '.png')
    const html = await (await app.fetch(new Request(BASE + '/login'))).text()
    expect(html).toContain(`type="image/png" href="${path}"`)
    const icon = await app.fetch(new Request(BASE + path))
    expect(icon.headers.get('content-type')).toBe('image/png')
    expect(Array.from(new Uint8Array(await icon.arrayBuffer()).slice(0, 8))).toEqual([137,80,78,71,13,10,26,10])
    expect((await app.fetch(new Request(BASE + '/favicon.ico'))).headers.get('location')).toBe(path)
    expect((await postForm('/dashboard/admin/favicon/delete', cookie, { csrf })).status).toBe(200)
    expect((await app.fetch(new Request(BASE + '/favicon.ico'))).headers.get('location')).toContain('common-time')
    expect((await setting('company_logo_key'))?.value).toBeTruthy()
  })

  it('has the circle / own-proportions setting; natural heads the page with the fit image', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const res = await postForm('/dashboard/admin/logo-shape', cookie, { csrf, shape: 'natural' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Company logo shown in its own proportions.')
    expect((await setting('company_logo_shape'))?.value).toBe('natural')
    const key = (await setting('company_logo_key'))!.value
    const page = await (await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))).text()
    expect(page).toContain(`/avatars/${fitKeyFor(key)}`)
    // A wordmark says the name itself: nothing beside it.
    expect(page).not.toMatch(/<p class="pu-host-name">/)
    expect((await postForm('/dashboard/admin/logo-shape', cookie, { csrf, shape: 'square' })).status).toBe(400)
  })

  it('remove leaves an empty key, and the team page has no head row at all', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const res = await postForm('/dashboard/admin/logo/delete', cookie, { csrf })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Company logo removed.')
    expect((await setting('company_logo_key'))?.value).toBe('')
    const page = await (await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))).text()
    expect(page).not.toContain('class="pu-host"')
    expect((await postForm('/dashboard/admin/logo-shape', cookie, { csrf, shape: 'natural' })).status).toBe(400)
  })
})

describe('team editing', () => {
  it('a member sees no team settings and cannot edit', async () => {
    const bob = await seedSession(L_BOB)
    const bobPage = await app.fetch(new Request(`${BASE}/dashboard/teams`, { headers: { cookie: bob } }))
    expect(await bobPage.text()).not.toContain('Team settings')
    expect((await postForm(`/dashboard/teams/${L_TEAM}`, bob, { csrf: await csrfFor(bob), name: 'X', slug: 'logo-crew', show_name: '1' })).status).toBe(404)
  })

  it('the team name is a suffix after the hosts, and a switch hides it from guests entirely', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    // Shown by default.
    const shown = await (await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))).text()
    expect(shown).toContain('<span class="pu-hosts-team">(Logo Crew)</span>')
    expect(shown).toContain('<title>Crew call · Logo Crew</title>')

    // Unticked checkbox = the field is absent from the post.
    const res = await postForm(`/dashboard/teams/${L_TEAM}`, cookie, { csrf, name: 'Logo Crew', slug: 'logo-crew' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Team updated.')
    expect((await db.prepare('SELECT show_name FROM teams WHERE id = ?').bind(L_TEAM).first<{ show_name: number }>())?.show_name).toBe(0)
    const hidden = await (await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))).text()
    expect(hidden).not.toContain('<span class="pu-hosts-team">')
    expect(hidden).not.toContain('Logo Crew')
    expect(hidden).toContain('<title>Crew call · ')

    // Back on.
    expect((await postForm(`/dashboard/teams/${L_TEAM}`, cookie, { csrf, name: 'Logo Crew', slug: 'logo-crew', show_name: '1' })).status).toBe(200)
    expect((await db.prepare('SELECT show_name FROM teams WHERE id = ?').bind(L_TEAM).first<{ show_name: number }>())?.show_name).toBe(1)
  })

  it('renames and re-slugs a team; the claim moves; the old address stops resolving', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const res = await postForm(`/dashboard/teams/${L_TEAM}`, cookie, { csrf, name: 'Logo Crew Ltd', slug: 'logo-crew-ltd', show_name: '1' })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Its booking links now start with /logo-crew-ltd')
    const team = await db.prepare('SELECT name, slug FROM teams WHERE id = ?').bind(L_TEAM).first<{ name: string; slug: string }>()
    expect(team).toEqual({ name: 'Logo Crew Ltd', slug: 'logo-crew-ltd' })
    const claim = await db.prepare("SELECT slug FROM slug_claims WHERE kind = 'team' AND owner_id = ?").bind(L_TEAM).first<{ slug: string }>()
    expect(claim?.slug).toBe('logo-crew-ltd')
    expect((await app.fetch(new Request(`${BASE}/logo-crew-ltd/crew-call`))).status).toBe(200)
    expect((await app.fetch(new Request(`${BASE}/logo-crew/crew-call`))).status).toBe(404)
  })

  it("refuses a slug a user holds, naming them, and a reserved one; a member cannot edit", async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const taken = await postForm(`/dashboard/teams/${L_TEAM}`, cookie, { csrf, name: 'Logo Crew Ltd', slug: 'logo-bob' })
    expect(taken.status).toBe(400)
    expect(await taken.text()).toContain('That slug is already taken by Bob Logo')
    const reserved = await postForm(`/dashboard/teams/${L_TEAM}`, cookie, { csrf, name: 'Logo Crew Ltd', slug: 'api' })
    expect(reserved.status).toBe(400)
    expect(await reserved.text()).toContain('reserved')
    expect((await db.prepare('SELECT slug FROM teams WHERE id = ?').bind(L_TEAM).first<{ slug: string }>())?.slug).toBe('logo-crew-ltd')

    const bob = await seedSession(L_BOB)
    expect((await postForm(`/dashboard/teams/${L_TEAM}`, bob, { csrf: await csrfFor(bob), name: 'X', slug: 'x' })).status).toBe(404)
  })
})

describe('logo shape', () => {
  it('an upload stores the uncropped fit thumbnail too, at height 256 in the original proportions', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    expect((await multipart(`/dashboard/event-types/${L_ET}/logo`, cookie, csrf, 'logo', pngBytes())).status).toBe(200)
    const row = await db.prepare('SELECT logo_key, logo_shape FROM event_types WHERE id = ?').bind(L_ET).first<{ logo_key: string; logo_shape: string }>()
    expect(row?.logo_shape).toBe('circle')
    const fit = await env.AVATARS.get(fitKeyFor(row!.logo_key))
    expect(fit).not.toBeNull()
    const bytes = new Uint8Array(await fit!.arrayBuffer())
    // The fixture is 6×4: the fit variant is 256 tall and 384 wide, uncropped.
    expect(readImageDimensions(bytes, 'image/webp')).toEqual({ width: 384, height: 256 })
    const served = await app.fetch(new Request(`${BASE}/avatars/${fitKeyFor(row!.logo_key)}`))
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/webp')
  })

  it('switching to its own proportions renders the fit image aligned by height on the booking page and the card', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const res = await postForm(`/dashboard/event-types/${L_ET}/logo-shape`, cookie, { csrf, shape: 'natural' })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Logo shown in its own proportions.')
    expect(html).toContain('value="natural" checked')
    const row = await db.prepare('SELECT logo_key, logo_shape FROM event_types WHERE id = ?').bind(L_ET).first<{ logo_key: string; logo_shape: string }>()
    expect(row?.logo_shape).toBe('natural')

    const page = await (await app.fetch(new Request(`${BASE}/logo-crew-ltd/crew-call`))).text()
    expect(page).toContain(`/avatars/${fitKeyFor(row!.logo_key)}`)
    expect(page).toMatch(/style="height:56px;width:auto;max-width:168px/)
    expect(page).not.toContain(`/avatars/${row!.logo_key}"`)

    // Back to a circle: the square crop in the round mask.
    const back = await postForm(`/dashboard/event-types/${L_ET}/logo-shape`, cookie, { csrf, shape: 'circle' })
    expect(await back.text()).toContain('Logo shown as a circle.')
    const again = await (await app.fetch(new Request(`${BASE}/logo-crew-ltd/crew-call`))).text()
    expect(again).toContain(`/avatars/${row!.logo_key}"`)
    expect(again).toContain('border-radius:50%')
  })

  it('refuses an unknown shape, and a shape without a logo', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    expect((await postForm(`/dashboard/event-types/${L_ET}/logo-shape`, cookie, { csrf, shape: 'hexagon' })).status).toBe(400)
    expect((await postForm(`/dashboard/event-types/${L_PERSONAL}/logo-shape`, cookie, { csrf, shape: 'natural' })).status).toBe(400)
  })

  it('a logo uploaded before the fit variant existed gets it regenerated from the original on first switch', async () => {
    const cookie = await seedSession(L_ALICE)
    const csrf = await csrfFor(cookie)
    const row = await db.prepare('SELECT logo_key FROM event_types WHERE id = ?').bind(L_ET).first<{ logo_key: string }>()
    await env.AVATARS.delete(fitKeyFor(row!.logo_key))
    expect(await env.AVATARS.get(fitKeyFor(row!.logo_key))).toBeNull()
    const res = await postForm(`/dashboard/event-types/${L_ET}/logo-shape`, cookie, { csrf, shape: 'natural' })
    expect(res.status).toBe(200)
    expect(await env.AVATARS.get(fitKeyFor(row!.logo_key))).not.toBeNull()
  })

})

it('uses hosted branding without an R2 binding on pages, emails, previews and icon redirects', async () => {
  const { blobStorage: _unused, ...withoutR2 } = ports
  const linkedApp = buildRouter(withoutR2, slots)
  const cookie = await seedSession(L_ALICE)
  const csrf = await csrfFor(cookie)
  const get = (path: string) => linkedApp.fetch(new Request(BASE + path, { headers: { cookie } }))
  const post = (path: string, values: Record<string, string>) => linkedApp.fetch(new Request(BASE + path, {
    method: 'POST', body: new URLSearchParams({ csrf, ...values }), headers: { cookie },
  }))
  const logo = 'https://assets.example.test/mark.png'
  const icon = 'https://assets.example.test/favicon.svg'
  const admin = await (await get('/dashboard/admin')).text()
  expect(admin).toContain('Favicon URL')
  expect(admin).not.toContain('type="file"')
  expect((await post('/dashboard/admin/logo', { imageUrl: logo })).status).toBe(200)
  expect((await post('/dashboard/admin/favicon', { imageUrl: icon })).status).toBe(200)
  expect((await post('/dashboard/admin/logo-shape', { shape: 'natural' })).status).toBe(200)
  for (const invalid of ['http://example.com/x', 'javascript:alert(1)', '//example.com/x', 'https://user:pass@example.com/x']) {
    expect((await post('/dashboard/admin/logo', { imageUrl: invalid })).status).toBe(400)
  }
  const login = await (await get('/login')).text()
  expect(login).toContain('src="' + logo + '"')
  expect(login).toContain('href="' + icon + '"')
  expect((await get('/favicon.ico')).headers.get('location')).toBe(icon)
  await post('/login', { email: 'logo-alice@example.test' })
  expect(email.sent.at(-1)?.html).toContain('src="' + logo + '"')
  const personal = 'https://media.example.test/personal.png'
  const draft = { imageUrl: personal, layout: 'week', intent: 'preview' }
  const preview = await post('/dashboard/appearance', draft)
  expect(await preview.text()).toContain('src="' + personal + '"')
  expect(await (await get('/logo-alice/intro')).text()).not.toContain(personal)
  expect((await post('/dashboard/appearance', { ...draft, intent: 'publish' })).status).toBe(303)
  expect(await (await get('/logo-alice/intro')).text()).toContain('property="og:image" content="' + personal + '"')
  const meeting = 'https://media.example.test/meeting.png'
  expect((await post('/dashboard/event-types/' + L_PERSONAL + '/logo', { imageUrl: meeting })).status).toBe(200)
  expect(await (await get('/logo-alice/intro')).text()).toContain('property="og:image" content="' + meeting + '"')
  expect((await post('/dashboard/admin/logo/delete', {})).status).toBe(200)
  expect((await post('/dashboard/admin/favicon/delete', {})).status).toBe(200)
  expect(await (await get('/login')).text()).not.toContain(icon)
})


it('protects theme branding settings, links the header to the website, and renders dark variants', async () => {
  const admin = await seedSession(L_ALICE), member = await seedSession(L_BOB)
  const post = async (path: string, values: Record<string,string>, cookie = admin) => postForm(path, cookie, { csrf: await csrfFor(cookie), ...values })
  const light = 'https://assets.example.test/logo-light.png', dark = 'https://assets.example.test/logo-dark.png'
  const icon = 'https://assets.example.test/icon-light.svg', nightIcon = 'https://assets.example.test/icon-dark.svg'
  expect((await post('/dashboard/admin/brand-home',{website:'https://www.example.test/'})).status).toBe(200)
  expect((await post('/dashboard/admin/brand-home',{website:'javascript:alert(1)'})).status).toBe(400)
  expect((await post('/dashboard/admin/logo-dark',{imageUrl:dark},member)).status).toBe(302)
  expect((await postForm('/dashboard/admin/favicon-dark',admin,{csrf:'bad',imageUrl:nightIcon})).status).toBe(403)
  expect((await post('/dashboard/admin/logo-dark',{imageUrl:'http://example.test/image.png'})).status).toBe(400)
  for (const [path,url] of [['logo',light],['logo-dark',dark],['favicon',icon],['favicon-dark',nightIcon]]) {
    expect((await post('/dashboard/admin/'+path,{imageUrl:url!})).status).toBe(200)
  }
  const repos = createD1Repositories(db, { consistency:'unconstrained' })
  const before = (await repos.users.byId(L_ALICE))!.appearance
  await repos.users.update(L_ALICE,{appearance:{layout:'classic',accent:null,background:null,logoKey:null,themeBehaviour:'dark'}})
  const html = await (await app.fetch(new Request(BASE+'/logo-alice/intro'))).text()
  expect(html).toContain('data-brand-home href="https://www.example.test/"')
  expect(html).toContain('src="'+dark+'"')
  expect(html).toContain('data-theme-light-src="'+light+'"')
  expect(html).toContain('data-theme-dark-src="'+dark+'"')
  expect(html).toContain('href="'+nightIcon+'"')
  expect(html).toContain('data-theme-light-href="'+icon+'"')
  await repos.users.update(L_ALICE,{appearance:before})
  for (const field of ['logo-dark','favicon-dark']) expect((await post('/dashboard/admin/'+field+'/delete',{})).status).toBe(200)
  const fallback = await (await app.fetch(new Request(BASE+'/login'))).text()
  expect(fallback).not.toContain('data-theme-dark-href="'+nightIcon+'"')
  expect(fallback).toContain('data-theme-dark-src="'+light+'"')
  expect((await post('/dashboard/admin/brand-home',{website:''})).status).toBe(200)
  const root = await (await app.fetch(new Request(BASE+'/login'))).text()
  expect(root).toContain('data-brand-home href="'+new URL(BASE).origin+'/'+'"')
})

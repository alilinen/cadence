import { describe, expect, it } from 'vitest'
import { createMicrosoftProvider } from '../../src/adapters/microsoft/provider.js'
import { createGoogleProvider } from '../../src/adapters/google/provider.js'
import { createEnvOAuthCredentials } from '../../src/adapters/oauth.js'
import type { CalendarConnection } from '../../src/core/domain/types.js'
import { checkCalendars } from '../../src/engine.js'
import type { EnginePorts, Repositories } from '../../src/ports.js'

const range = { start: Date.UTC(2026, 10, 17, 10), end: Date.UTC(2026, 10, 17, 11) }
const connection: CalendarConnection = {
  id: 'sample',
  userId: 'host',
  provider: 'google',
  providerAccountEmail: 'host@example.test',
  encryptedTokens: 'fixture',
  keyVersion: 1,
  calendarIdsRead: ['work', 'other'],
  calendarIdWrite: null,
  syncStatus: 'ok',
  createdAt: 0,
}

async function check(calendars: Record<string, unknown>, strict: boolean) {
  const provider = createGoogleProvider({
    oauth: createEnvOAuthCredentials({}, 'https://example.test'),
    crypto: {
      decrypt: async () => JSON.stringify({ accessToken: 'fixture', expiresAt: Date.now() + 3_600_000 }),
      randomToken: () => '',
    },
    clock: { now: Date.now },
    onTokensRefreshed: async () => {},
    fetch: async () => Response.json({ calendars }),
  })
  return checkCalendars(
    { clock: { now: Date.now }, calendars: { get: () => provider } } as unknown as EnginePorts,
    {} as Repositories,
    [connection],
    range,
    strict,
    false,
  )
}
describe('partial calendar coverage', () => {
  it.each([false, true])('keeps a known conflict when another calendar fails=%s', async (fails) => {
    const work = {
      busy: [{ start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() }],
    }
    const result = await check(
      { work, other: fails ? { errors: [{ reason: 'notFound' }] } : { busy: [] } },
      false,
    )
    expect(result.busy).toContainEqual(range)
    expect(result.checks.some((c) => !c.ok)).toBe(fails)
  })
  it.each([false, true])('applies strict policy when a calendar is missing=%s', async (missing) => {
    const result = await check(
      missing ? { work: { busy: [] } } : { work: { busy: [] }, other: { busy: [] } },
      true,
    )
    expect(result.checks.every((c) => c.ok)).toBe(!missing)
    expect(result.busy.length > 0).toBe(missing)
  })
})

describe('Microsoft mailbox coverage', () => {
  it.each([false, true])(
    'checks mailbox identity and blocks an omitted schedule in strict mode=%s',
    async (strict) => {
      const work = { scheduleId: 'WORK', availabilityView: '222222222222' }
      const provider = createMicrosoftProvider({
        oauth: createEnvOAuthCredentials({}, 'https://example.test'),
        crypto: {
          decrypt: async () => JSON.stringify({ accessToken: 'fixture', expiresAt: Date.now() + 3_600_000 }),
          randomToken: () => '',
        },
        clock: { now: Date.now },
        onTokensRefreshed: async () => {},
        fetch: async () => Response.json({ value: [work] }),
      })
      const runtime = {
        clock: { now: Date.now },
        calendars: { get: () => provider },
      } as unknown as EnginePorts
      const result = await checkCalendars(
        runtime,
        {} as Repositories,
        [{ ...connection, provider: 'microsoft' }],
        range,
        strict,
        false,
      )
      expect(result.checks).toEqual([
        expect.objectContaining({ calendars: ['work'], ok: true }),
        expect.objectContaining({ calendars: ['other'], ok: false }),
      ])
      expect(result.confirmed).toContainEqual(range)
      expect(result.busy).toContainEqual(range)
    },
  )
})

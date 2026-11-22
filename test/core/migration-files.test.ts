import { readdirSync } from 'node:fs'
import { URL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('migration filenames', () => {
  it('keeps the initial schema identity and uses unique timestamps for later changes', () => {
    const files = readdirSync(new URL('../../migrations/', import.meta.url)).filter(name => name.endsWith('.sql'))
    expect(files).toContain('0001_initial.sql')
    const later = files.filter(name => name !== '0001_initial.sql')
    for (const name of later) expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/)
    expect(new Set(later.map(name => name.slice(0, 14))).size).toBe(later.length)
  })
})

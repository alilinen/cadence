import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'

describe('schema migration continuity', () => {
  afterEach(async () => {
    // This pool shares D1 between cases in a file, including schema changes.
    const columns = await env.DB.prepare('PRAGMA table_info(instance_settings)').all<{ name: string }>()
    if (columns.results.some(column => column.name === 'migration_probe')) {
      await env.DB.prepare('ALTER TABLE instance_settings DROP COLUMN migration_probe').run()
    }
    await env.DB.prepare("DELETE FROM instance_settings WHERE key='migration-probe'").run()
    await env.DB.prepare("DELETE FROM d1_migrations WHERE name IN ('0002_retired_change.sql','20990101000000_test_extension.sql')").run()
  })

  it.each([false, true])('applies the next change once while preserving records (extra history: %s)', async (extraHistory) => {
    // Setup has installed the public schema on an empty D1 database.
    await env.DB.prepare("INSERT INTO instance_settings(key,value,updated_at) VALUES ('migration-probe','keep me',123)").run()
    if (extraHistory) {
      // Applied files need not remain in the public migration directory.
      await env.DB.prepare("INSERT INTO d1_migrations(name) VALUES ('0002_retired_change.sql')").run()
    }
    const next = {
      name: '20990101000000_test_extension.sql',
      queries: ['ALTER TABLE instance_settings ADD COLUMN migration_probe TEXT'],
    }
    const migrations = [...env.TEST_MIGRATIONS, next]
    await applyD1Migrations(env.DB, migrations)
    await env.DB.prepare("UPDATE instance_settings SET migration_probe='next version' WHERE key='migration-probe'").run()
    // Replaying either baseline or ALTER would fail. Both must be skipped.
    await applyD1Migrations(env.DB, migrations)
    expect(await env.DB.prepare("SELECT value,updated_at,migration_probe FROM instance_settings WHERE key='migration-probe'").first()).toEqual({
      value: 'keep me', updated_at: 123, migration_probe: 'next version',
    })
    expect(await env.DB.prepare("SELECT count(*) AS n FROM d1_migrations WHERE name=?").bind(next.name).first('n')).toBe(1)
    if (extraHistory) expect(await env.DB.prepare("SELECT count(*) AS n FROM d1_migrations WHERE name='0002_retired_change.sql'").first('n')).toBe(1)
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  })
})

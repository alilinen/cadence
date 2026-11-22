/// <reference types="@cloudflare/vitest-plugin/types" />

import type { D1Migration } from '@cloudflare/vitest-plugin'
import type { Env as WorkerEnv } from '../../src/index.js'

// The pool types `env` as `Cloudflare.Env`, so the Worker's own bindings plus
// the config-time migrations are merged into that global namespace.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      AVATARS: R2Bucket
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}

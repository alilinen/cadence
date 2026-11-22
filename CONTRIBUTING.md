# Contributing

Clone the repository, run npm ci, and develop with local resources. Include regression coverage for changes to booking, permissions and scheduling behavior. Run npm run typecheck and npm test before submitting changes. Keep credentials, customer data and production configuration out of commits.

## Database changes

Keep `migrations/0001_initial.sql` unchanged after release. Add schema changes in new SQL files prefixed with a UTC timestamp (`YYYYMMDDHHmmss_description.sql`), ordered after all existing files. Never rename or reuse an applied filename. Test both an empty database and an existing database with records; keep stored data intact.

## Rendering dependencies

Satori uses the Workers-specific HarfBuzz adapter through an exact-module alias in Wrangler and Vitest. Keep those aliases aligned. Wrangler's `[define]` constants supply the script path expected by the CommonJS bootstrap; all WASM is statically imported, so it never reads that path. The small `callback-vi.wasm` module has its source alongside it in `callback-vi.wat`. The `fflate` override supplies the security patch missing from Satori's pinned dependency; remove it when Satori adopts a patched version. Run the Workers rendering tests and check an actual PNG from `wrangler dev` when changing these dependencies: the test runner and bundled Worker resolve CommonJS globals differently.

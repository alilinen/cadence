# Upgrading Cadence

This guide is for an existing Cadence installation. For a new installation, use [Self-host Cadence](DEPLOYMENT.md); Wrangler applies the initial schema and subsequent migrations automatically.

You can upgrade directly from 0.6.1 or 0.6.2 to 0.6.4. There is no need to deploy intermediate versions, but every pending migration must run. Read the [release notes](CHANGELOG.md) first.

## Before the upgrade

1. Keep your private Wrangler configuration, resource IDs and secrets. Do not replace them with the public template. Use the same config and Cloudflare account for every command below.
2. Record the current Worker version for a possible code rollback. Confirm access to D1 recovery and record a current server-side bookmark:

   ```sh
   npx wrangler whoami
   npx wrangler deployments list --config wrangler.production.toml
   npx wrangler d1 time-travel info DB --config wrangler.production.toml
   ```

   Time Travel has a limited retention window; a bookmark is not a permanent backup. See [Cloudflare's recovery guide](https://developers.cloudflare.com/d1/reference/time-travel/). A Worker rollback does not restore D1 data, sent emails or external calendar events.
3. Obtain the target release, run `npm ci`, and build with your configuration:

   ```sh
   npx wrangler deploy --dry-run --config wrangler.production.toml
   ```

4. Schedule a short maintenance window that prevents booking writes and scheduled jobs, and lets in-flight calendar/email work finish. If using Queues, ensure pending work has drained. Keep writes paused through migration, any identity preservation below and deployment.

Examples use an ignored `wrangler.production.toml`. Substitute your actual config path, or use `wrangler.toml` consistently if that is where you maintain your configuration.

## Database migrations

Inspect pending migrations, then apply them to the existing database before deploying:

```sh
npx wrangler d1 migrations list DB --remote --config wrangler.production.toml
npx wrangler d1 migrations apply DB --remote --config wrangler.production.toml
npx wrangler d1 migrations list DB --remote --config wrangler.production.toml
```

The final command should report no pending migrations. Do not delete migration files, reset the migration ledger or execute `0001_initial.sql` manually against an existing database. If Wrangler unexpectedly lists the initial schema for a populated installation, stop and reconcile its migration history before proceeding.

| Target release | Database change |
| --- | --- |
| 0.6.2 | None |
| 0.6.3 | `20261124190000_shared_invitation_identity.sql` adds `invitation_uid` and `invitation_organizer` to bookings. |
| 0.6.4 | No additional schema change; the 0.6.3 migration is required when upgrading from an earlier version. |

These new columns are nullable. Previously sent invitations continue using their existing identity. New Google bookings can share the calendar event's UID with the emailed invitation; rescheduling retains that identity and the meeting link. Upgrading does not remove duplicate invitations already present in recipients' calendars.

## Configuration for 0.6.4

- Set `BASE_URL` to the full public location, including any mount path, such as `https://example.com/calendar`. Keep existing paths unchanged unless you intend to change shared booking links.
- Use `src/index.ts` as the Worker entry point. `src/mounted/worker.ts` remains a compatibility alias. Remove old installation-specific source patches when switching to the standard entry point.
- Serve the contents of the release's `assets/` directory with the `ASSETS` binding and `run_worker_first = true`. Bundled files now use `brand/` rather than `book/brand/`. Retain any private artwork referenced by saved logo/favicon URLs at those URLs, or update the saved URLs deliberately.
- `ASSET_BASE_URL` is optional. If set, publish the matching release assets to that trusted HTTPS location. See [asset hosting](DEPLOYMENT.md#optional-asset-hosting).
- Keep the Satori `[alias]` and `[define]` sections from the release template in your custom config. Retain existing bindings, resource IDs, encryption/signing secrets and scheduled triggers.
- OAuth callback registrations must match `BASE_URL`. Keeping the same public base URL preserves the existing callback locations.

### Legacy namespace overrides

This section applies only if your configuration contains `PROTOCOL_NAMESPACE` or `INVITATION_UID_DOMAIN`. Standard public installations using the default Cadence namespace can skip it.

Version 0.6.4 refuses to start while either retired variable is present. **Do not simply remove a custom invitation UID domain:** changing already-issued UIDs can create duplicate calendar entries and break updates or cancellation.

After the schema migration, and while booking writes remain paused:

1. Determine the exact previous `INVITATION_UID_DOMAIN`. If it was unset, the public 0.6.x default was `cadence`. Do not infer it from the website hostname. If your fork changed UID generation, inspect its old implementation and issued invitations before continuing.
2. For bookings with a NULL `invitation_uid`, follow the full `reschedule_of` chain to its root. Preserve a root's already-saved UID if present; otherwise the historical fallback is `<root-booking-id>@<previous-domain>`. If the immediate predecessor is absent, the old fallback uses that missing predecessor's ID. Existing non-NULL UIDs and provider event IDs must remain unchanged. Check for cycles or unresolved lineages and stop if any exist.
3. Save those historical UIDs in `bookings.invitation_uid` using an installation-specific, reviewed SQL update. This can run entirely inside D1 without exporting booking records. Update only NULL IDs; do not rewrite organizer addresses or other booking fields. Verify every historical booking has a saved UID and that existing UIDs are untouched. Do not substitute a provider UID for an identity already sent by email.
4. Remove both retired variables from every deployed configuration/environment. Update any webhook consumers that still expect the former namespace: 0.6.4 emits Cadence headers only.
5. Deploy and verify before reopening booking writes. Users of an old session namespace must sign in again; accounts, calendar connections and existing booking-management tokens remain in place. Restart any in-flight OAuth login flow.

The UID preservation depends on the installation's old domain and booking lineage, so it is deliberately separate from the universal schema migration. Never run a SQL example copied from another installation with its domain unchanged.

## Deploy and verify

```sh
npx wrangler deploy --config wrangler.production.toml
```

Open `/health` under your configured base URL, verify the dashboard and version in Settings, and check branding and static assets. Reopen booking writes once those checks pass. With permission from the test recipients, create a clearly labelled test booking, reschedule it and cancel it. Check calendar updates, email activity, the stable invitation identity and the retained Meet link. Provider acceptance means the email was submitted successfully; check the inbox separately if delivery needs verifying.

If the upgrade fails, keep booking writes paused while investigating. The 0.6.3 schema additions are additive; avoid deleting columns or resetting data as a rollback shortcut. Restoring D1 does not undo notifications or Google/Microsoft calendar changes. Reconcile any external side effects before resuming service.

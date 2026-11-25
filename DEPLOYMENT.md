# Self-host Cadence

For a demo or local development, start with the [README](README.md). Hosting requires your own Cloudflare account, Node.js 22.12 or later and a public hostname.

## Upgrading

For an existing installation, follow [Upgrading Cadence](UPGRADING.md) before deploying. It covers database migrations, preserving calendar invitation identities and configuration changes. Fresh installations should continue below; they do not need the legacy upgrade procedure.

## Before publishing the Worker

1. Run `npm ci` and `npx wrangler login`. Copy `wrangler.toml` to an ignored `wrangler.production.toml` for a private deployment config, or edit the template in your own private checkout.
2. Create the resources below. Put the returned D1 and KV IDs in the matching bindings. Wrangler provisions the two SQLite-backed Durable Objects for booking coordination and rate limiting and installs the scheduled trigger for reminders.
3. Set `BASE_URL` to the full public URL, including any mount path. Set your brand, sender name, sender address and support email. **Before the first public deploy**, add the following to the existing `[vars]` section, replacing the example with the intended first administrator’s exact email address.

```toml
SIGNUPS = "admin@example.com"
```

4. Generate two independent secrets with `openssl rand -base64 32`. Store them using `npx wrangler secret put ENCRYPTION_KEY_V1` and `npx wrangler secret put SIGNING_KEY`. For a private config, append `--config wrangler.production.toml` to each Wrangler command that targets the Worker.
5. Configure email delivery before sign-in. Set a Resend or Brevo API key as a Worker secret, or configure the Cloudflare Email Service binding for a verified sender. The console sender is for local development. Calendar integration is optional for manual meeting locations. For automatic video, configure Google or Microsoft OAuth, connect a host calendar and select the calendar where bookings are written. The in-app guide at `/docs/self-hosting` lists the callback paths.

### Cloudflare resources

```sh
npx wrangler d1 create cadence
npx wrangler kv namespace create CACHE
npx wrangler queues create cadence-tasks
npx wrangler queues create cadence-tasks-dlq
```

D1 holds booking data and KV caches calendar availability and link previews. The supplied configuration uses Queues to process calendar sync and notifications with retries. Workers Free includes a daily operations allowance. The Analytics Engine binding records booking-page activity for Insights. R2 is optional for file uploads and requires a subscription checkout. Linking images from your own website skips that step. [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) · [R2 setup](https://developers.cloudflare.com/r2/get-started/)

## Deploy and sign in

For the supplied config, run `npm run migrate:remote` followed by `npm run deploy`. For a private config, use it for both steps:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.production.toml
npx wrangler deploy --config wrangler.production.toml
```

Open `/health` on the public URL and check the email delivery status. Open `/login` as the allowlisted address. The first account gets **Admin**. Keep the environment pin for a fixed policy. To manage signups in Admin, first set the stored policy to closed while the pin is still active:

```sh
npx wrangler d1 execute DB --remote --command "INSERT INTO instance_settings (key,value,updated_at) VALUES ('signups','closed',unixepoch()*1000) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
```

Use the same deployment config for that command. Remove `SIGNUPS` from the config and redeploy. Existing accounts can sign in. **Admin → Signups** can now admit other users. Before sharing a public link, confirm your timezone and hours, make a test booking, check its email and meeting location, then reschedule and cancel.

## Google Calendar OAuth

Create your own Google Cloud project, enable the Google Calendar API, and configure **Google Auth Platform → Branding, Audience and Clients**.

For calendars from different Google Workspace organisations or personal Gmail accounts, set **Audience → User type: External** and **Publishing status: In production**. **Internal** only allows accounts within the project's Google Workspace organisation; external accounts will see “Access blocked … can only be used within its organisation”. This applies to **Connect another calendar**, even when the person is already signed in to Cadence.

Complete Branding with your app name, support email, homepage, privacy policy, terms and authorised domain before publishing. If Google disables the production option, check for missing Branding fields. Cadence provides `/privacy` and `/terms` beneath your `BASE_URL`; review their contents for your installation before using them. Create a **Web application** OAuth client and register both exact callback URLs, including your mount path:

```text
<BASE_URL>/auth/google/callback?purpose=identity
<BASE_URL>/auth/google/callback?purpose=calendar
```

Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with `npx wrangler secret put`, using your deployment config. In Cadence, open **Calendars → Connect another calendar**, select which calendars to check for conflicts, and choose **Do not write events** for a connection used only for availability.

Use **External + Testing** for development with explicitly listed test users. For Calendar access, Testing normally gives refresh tokens a seven-day lifetime, so it is unsuitable for ongoing production connections. After changing to production, reconnect accounts whose testing credentials have expired.

**In production is not the same as verified.** Calendar permissions are sensitive. An unverified external app can still show Google's warning and is subject to a user cap; complete Google's verification requirements before offering it broadly. Workspace administrators can also restrict access. See [Google's OAuth production guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) and [refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

These Google settings do not change Cadence's signup policy. Keep your intended email/domain allowlist in **Admin → Signups** (or `SIGNUPS`). Existing users can connect an authorised external calendar without admitting that calendar account as a new Cadence user.

## Logos and favicons

In **Admin**, paste a direct HTTPS image URL for the company logo and a separate URL for the browser icon. Personal and team booking links can override the logo under **Appearance**; event types can also have their own logo. Use a stable, publicly accessible URL with no login or expiry. A PNG logo works well in email clients. Cadence stores the URL in D1. Visitors, email clients and social crawlers load the image from its host.

The default installation needs no R2 subscription. To additionally enable file uploads (including profile photos), create a bucket with `npx wrangler r2 bucket create cadence-avatars`, uncomment the `[[r2_buckets]]` section in your deployment config, and redeploy.

## Existing applications

The standard `src/index.ts` Worker supports a dedicated hostname or any URL-safe subpath, including nested paths. Set `BASE_URL` to the full public location. No source edits or asset-folder copies are needed. The older `src/mounted/worker.ts` entry remains an alias for existing configurations.

For example, merge these settings into your private Wrangler configuration:

```toml
main = "src/index.ts"
routes = [
  { pattern = "example.com/tools/calendar", zone_name = "example.com" },
  { pattern = "example.com/tools/calendar/*", zone_name = "example.com" }
]

[assets]
directory = "./assets"
binding = "ASSETS"
run_worker_first = true

[vars]
BASE_URL = "https://example.com/tools/calendar"
# Optional: open a particular event at the installation home.
BOOKING_HOME_PATH = "/team/intro"
```

Keep the other bindings, variables, secrets and triggers from the deployment template. Use both the exact route and the slash-prefixed wildcard so the home URL works without intercepting unrelated paths. Requests outside the configured mount return 404. For a dedicated hostname, omit the path from `BASE_URL` and use your normal domain or Workers URL configuration.

Routes, form actions, session cookies, assets, email links and embed URLs use this location. Register OAuth callback URLs using the same base, for example `https://example.com/tools/calendar/auth/google/callback?purpose=calendar` and `?purpose=identity`. For local development, set `BASE_URL` in `.dev.vars` to the local origin and desired path; local variables override Wrangler's `[vars]`.

### Optional asset hosting

By default, CSS, scripts, fonts and built-in images load from the same mount as the app. To host the bundle elsewhere, set `ASSET_BASE_URL = "https://cdn.example.com/cadence"` in `[vars]` and publish the **contents** of `assets/` there. That URL must serve `brand/`, `fonts/`, `og/default.png` and `cadence-email.png`. Keep the CDN bundle in step with the Worker release, serve the correct MIME types and allow cross-origin font requests. Use a trusted HTTPS host: these files include executable scripts.

The override affects only bundled assets. Uploaded images, custom logo/favicon URLs, authentication and booking routes stay at their configured locations. Linked images in Admin and Appearance continue to take priority over default branding.

Keep live resource IDs, domains and credentials in local deployment configuration. Initialize the database and deploy with the same configuration.

Keep the template's `[alias]` and `[define]` sections in custom configurations. They load Satori's font engine from bundled WebAssembly modules so social preview images render in Workers without runtime code generation or browser-only globals.

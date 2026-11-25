# Cadence changes

For existing installations, follow the [upgrade guide](UPGRADING.md). You can upgrade directly to the latest version; apply every pending database migration before deploying.

## 0.6.5 — 2026-11-25

- Explain how to configure Google OAuth as External and In production when connecting calendars from other organisations or personal Gmail accounts. Clarify testing-token expiry, verification requirements and the separate Cadence signup policy.
- Give dropdown carets consistent right padding across the app, with colours that follow light and dark themes. Preserve the booking timezone picker's existing layout and native high-contrast controls.

**Upgrade:** no database or configuration changes required. The Google OAuth guidance applies when you want to connect external calendar accounts; existing connections do not need to change.

## 0.6.4 — 2026-11-24

- Deploy at root or any URL-safe subpath using `BASE_URL`, without source patches. Forms, redirects, cookies, OAuth callbacks and bundled assets follow the configured path.
- Optionally host CSS, scripts, fonts and built-in images using `ASSET_BASE_URL`; saved installation branding retains priority.
- Resolve self-hosted favicon links without redirect loops.
- Use Cadence-only session/OAuth cookies, webhook headers and new fallback invitation IDs. Existing installations with namespace overrides must preserve issued invitation IDs before removing those settings; users sign in again after the upgrade.

**Upgrade:** no additional schema migration beyond 0.6.3. Review `BASE_URL`, the asset directory and any custom asset URLs. If configured, retire `PROTOCOL_NAMESPACE` and `INVITATION_UID_DOMAIN` using the [identity-preservation procedure](UPGRADING.md#legacy-namespace-overrides). Standard installations already using Cadence cookies do not need a session reset. Custom branding remains in place.

## 0.6.3 — 2026-11-24

- Show the installed app version beneath the Cadence credit in Settings, including on custom-branded installations.
- Use the Google Calendar event’s invitation identity in booking emails, preventing a second calendar entry when guests accept an emailed invite.
- Keep the existing calendar event, invitation identity and meeting link across reschedules. Previously sent invitations retain their original identity.

**Upgrade:** apply `20261124190000_shared_invitation_identity.sql` before deploying. It adds nullable `invitation_uid` and `invitation_organizer` columns without deleting booking data. Existing invitations keep their issued identity; this release does not merge duplicate calendar entries created by earlier versions. The version is visible in Settings even with custom branding.

## 0.6.2 — 2026-11-24

- Choose whether guest edits notify everyone or only newly added participants. Removed guests still receive cancellations, and linked calendars continue to update.

**Upgrade:** no database or configuration changes. Use the notification choice when editing a booking's guests. Updating the calendar's attendee list and sending email notifications are separate actions: selecting only new participants still updates the calendar.

## 0.6.1 — 2026-11-22

- Patch Satori, Hono, Zod and development-tooling security advisories, including Satori's pinned compression dependency.
- Load the font engine and its callback wrapper from bundled WebAssembly so social preview images render in Cloudflare Workers without runtime compilation.
- Move tests to the maintained Cloudflare Vitest plugin and update Wrangler. Node.js 22.12 or later is required.
- Prepare the public source and setup instructions, with clear credit to the original Punctual project.

## 0.6.0

Introduces the Cadence identity and portable deployment configuration. Booking pages, transactional emails, sample data and setup instructions work with each installation's own domain and sender.

## Earlier fork changes

Added team scheduling and access controls, guest and booker editing, Google Calendar reconciliation, invitation encoding and duplicate-host-invite fixes, named-teammate calendar sharing, configurable reminders and customizable booking layouts. See README.md for the current feature set.

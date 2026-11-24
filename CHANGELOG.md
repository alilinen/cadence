# Cadence changes

## 0.6.3 — 2026-11-24

- Show the installed app version beneath the Cadence credit in Settings, including on custom-branded installations.
- Use the Google Calendar event’s invitation identity in booking emails, preventing a second calendar entry when guests accept an emailed invite.
- Keep the existing calendar event, invitation identity and meeting link across reschedules. Previously sent invitations retain their original identity.

## 0.6.2 — 2026-11-24

- Choose whether guest edits notify everyone or only newly added participants. Removed guests still receive cancellations, and linked calendars continue to update.

## 0.6.1 — 2026-11-22

- Patch Satori, Hono, Zod and development-tooling security advisories, including Satori's pinned compression dependency.
- Load the font engine and its callback wrapper from bundled WebAssembly so social preview images render in Cloudflare Workers without runtime compilation.
- Move tests to the maintained Cloudflare Vitest plugin and update Wrangler. Node.js 22.12 or later is required.
- Prepare the public source and setup instructions, with clear credit to the original Punctual project.

## 0.6.0

Introduces the Cadence identity and portable deployment configuration. Booking pages, transactional emails, sample data and setup instructions work with each installation's own domain and sender.

## Earlier fork changes

Added team scheduling and access controls, guest and booker editing, Google Calendar reconciliation, invitation encoding and duplicate-host-invite fixes, named-teammate calendar sharing, configurable reminders and customizable booking layouts. See README.md for the current feature set.

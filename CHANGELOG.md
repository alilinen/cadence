# Cadence changes

## 0.6.1 — 2026-11-22

- Patch Satori, Hono, Zod and development-tooling security advisories, including Satori's pinned compression dependency.
- Load the font engine and its callback wrapper from bundled WebAssembly so social preview images render in Cloudflare Workers without runtime compilation.
- Move tests to the maintained Cloudflare Vitest plugin and update Wrangler. Node.js 22.12 or later is required.
- Prepare the public source and setup instructions, with clear credit to the original Punctual project.

## 0.6.0

Introduces the Cadence identity and portable deployment configuration. Booking pages, transactional emails, sample data and setup instructions work with each installation's own domain and sender.

## Earlier fork changes

Added team scheduling and access controls, guest and booker editing, Google Calendar reconciliation, invitation encoding and duplicate-host-invite fixes, named-teammate calendar sharing, configurable reminders and customizable booking layouts. See README.md for the current feature set.

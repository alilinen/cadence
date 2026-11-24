# Cadence

Cadence is an MIT-licensed scheduling app you can host on Cloudflare and embed in your own website. Each installation controls its branding, users, calendars, email delivery and booking data.

Cadence is a fork of [Punctual](https://github.com/CCCrafts/punctual), the original open-source scheduling project by Sergey Bulaev and the Punctual contributors. Punctual provided the initial codebase and inspiration. Cadence builds on that foundation with its own booking workflows, calendar sharing, editable reminders, appearance controls and booking activity tools. The original MIT copyright and permission notice are preserved in [LICENSE](LICENSE).

## Get the code

Install Node.js 22.12 or later, then clone the repository:

```sh
git clone https://github.com/alilinen/cadence.git
cd cadence
```

## Try the demo

From the repository directory, run:

```sh
npm ci
npm run preview
```

Open [the sample booking page](http://127.0.0.1:8790/book), choose a time and submit the form. **Preview complete** means you reached the end of the demo. It uses sample data and sends no email. To use another port, run `npm run preview -- --port 8791` and open that port instead. If you have set `BASE_URL` in `.dev.vars`, use its path instead of `/book`.

## Run locally

For a writable installation on your machine, run these commands from a fresh checkout:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run migrate:local
npm run dev
```

Open [Sign in](http://localhost:8787/login) and enter an email address. With the default local settings, Wrangler prints the one-time sign-in link in its terminal. Open that link to reach the dashboard. The first user can open **Admin**. Create an event type, set a meeting location and open its public booking link in a private browser window to try it as a guest.

## Deploy

Follow the [self-hosting guide](DEPLOYMENT.md) to configure your own Cloudflare resources, email provider and first administrator. **Before the first public deploy**, pin `SIGNUPS` to that administrator’s exact email address in your deployment config. Once the guide’s prerequisites are in place, run:

```sh
npm run migrate:remote
npm run deploy
```

Open `/login` on the deployed URL. Sign in as the intended administrator and check that **Admin** appears in the dashboard.

## Embed a booking page

Create an event type in the dashboard, then use its public booking URL in an iframe or load the auto-resizing widget from your own installation.

```html
<script async src="https://calendar.example/embed.js"
        data-url="https://calendar.example/team/intro"
        data-title="Book an introduction"></script>
```

Under **Appearance → Theme behaviour**, choose **Always light**, **Always dark**, **Follow website**, or **Independent**. Public booking pages default to light. Fixed themes and Follow website hide the calendar’s theme switcher; the dashboard keeps its own control.

For **Follow website**, the widget reads the website’s root `data-theme`, `data-bs-theme`, `dark` class or explicit CSS `color-scheme`, and updates when those root attributes change. Websites with a different theme mechanism can synchronise it to `document.documentElement.dataset.theme` (`light` or `dark`). The widget’s optional `data-theme="light"` or `data-theme="dark"` overrides detection; a calendar configured with a fixed theme always keeps that theme. Direct booking links default to light in Follow website mode. For a plain iframe, set its `theme=light` or `theme=dark` query parameter to match the website.

In **Admin**, set the main website URL for the top-left logo link. Its default is the installation’s main domain. The logo and browser icon each support an optional dark-theme image using either a hosted HTTPS URL or a file upload when image storage is enabled. Without a dark image, the default is used in both themes. Email and social previews continue to use the default logo.

For a subpath installation, include the path from `BASE_URL` in both URLs. The standard Worker supports root and nested paths without source edits; see [deployment configuration](DEPLOYMENT.md#existing-applications). Guests can book without an account. The dashboard, REST API and MCP server use the installation's own authentication.

## What's included

- Individual, collective and round-robin meetings, additional guests and optional hosts.
- Dashboard meeting creation, rescheduling, cancellation, guest editing and booker replacement while preserving the meeting link.
- When editing guests, notify everyone or only newly added participants. Removed guests always receive a cancellation; connected calendars still update.
- Google Calendar and Microsoft 365 connections, availability checks and calendar invitations. Edits to recorded Google organizer events can update the booking.
- Opt-in calendar sharing with named teammates. Owners select which calendars reveal titles. Private meetings and other availability conflicts appear as Busy.
- Per-event reminder timing, audiences, editable subjects and messages, placeholders and email previews.
- Under Admin, link a hosted company logo for pages, transactional emails and link previews, and a separate browser favicon. No R2 bucket is required. Optionally enable R2 for file uploads. Settings always credits Cadence.
- Classic, Week and Agenda layouts with personal and team logos, colours, mobile previews and editable event agendas.
- Restricted signup, role management, signed webhooks and stable calendar invitation updates.

Under **Availability → Check a time**, choose a personal or participating team event to inspect a start in your timezone. The checker is read-only. Participating team members see their own availability details. Calendar outages allow bookings by default. In the event type editor, use **Calendar outages → Exclude that host** to require successful checks on that event type.

Under **Bookings**, open a meeting and read **Booking activity** for each recipient or calendar. Use **Retry this step** on an eligible failure. A failed email gets one retry, shared between queue redelivery and the dashboard. Cadence rechecks the recipient and reminder settings before sending. A transport error with an unknown outcome cannot be safely replayed. **Check delivery** reads the provider’s receipt on Resend and Brevo. The Cloudflare sending binding reports acceptance. Console mode records a local send only.

Run `npm run typecheck` and `npm test` to check changes.

[Licence](LICENSE)

See the [product roadmap](ROADMAP.md) for planned improvements.

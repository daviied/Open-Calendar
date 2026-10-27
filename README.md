# Calendar (self-hosted)

A Google Calendar–style calendar you run yourself. It installs as an app on your phone and
laptop (PWA), syncs with **Google Calendar**, **Outlook / Microsoft 365** and **Canvas**, and
sends **push notifications** for event reminders even when the app is closed.

- Day, 3-day, week, month and schedule views, mini calendar, search, keyboard shortcuts
- Drag to create, move and resize events (mouse); tap to create on phones; swipe to change weeks
- Recurring events (daily / weekly / monthly / yearly / custom), with "this event / this and
  following / all events" editing
- Multiple calendars with colors, show/hide, per-calendar default reminders
- **Assignments:** due dates (with or without a time), courses, notes and reminders. Check them off, see them
  grouped as Overdue / Today / Tomorrow / This week / Later, and see them on the calendar. Canvas feed items can show
  up here too.
- **Boards:** Trello-style boards with lists and cards. Drag cards between lists (long-press on phones). Cards can
  have labels, descriptions and due dates, and cards with due dates also show on the calendar.
- Works offline with the last loaded data
- Single-user, password protected, data stored in one SQLite file

## Quick start

**Windows**

```powershell
.\run.ps1
```

**Linux / macOS**

```sh
./run.sh
```

**Docker**

```sh
cp .env.example .env
docker compose up -d
```

Open <http://localhost:8080> and create a password on first launch.

Settings live in `.env` (copy `.env.example`). Your data is in `data/calendar.db`. Back up that file.

## Using it on your phone (HTTPS)

Phones only install web apps and allow notifications over **HTTPS**. (`localhost` on your laptop
works without it.) Pick one:

1. **Tailscale (easiest, private).** Install Tailscale on the server and your phone, then on the server:
   `tailscale serve --bg 8080`. Open the `https://<machine>.<tailnet>.ts.net` address it prints.
2. **Your own domain + Caddy.** Point a domain at your server, put it in `Caddyfile`, set
   `CAL_BASE_URL=https://your.domain` in `.env`, then `docker compose --profile https up -d`.
3. **Cloudflare Tunnel.** `cloudflared tunnel --url http://localhost:8080` (or a named tunnel with your domain).

Set `CAL_BASE_URL` in `.env` to whatever HTTPS address you end up using. The Google and Outlook
sign-in redirects depend on it.

### Installing the app

- **Android (Chrome):** menu ⋮ → **Install app**
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**. iOS only allows notifications for
  apps opened from the Home Screen (iOS 16.4+).
- **Windows / Mac (Chrome or Edge):** the install icon in the address bar

### Notifications

Settings → **Notifications** → **Turn on notifications**. Do this on each device. Reminders are sent by the
server, so the server must be running. Each calendar has default reminder times (⋮ next to
the calendar), and each event can override them.

## Syncing

### Canvas

Canvas calendars come in as a feed. They're read-only, and that's all Canvas offers for personal calendars.

1. In Canvas: **Calendar** → **Calendar Feed** → copy the link.
2. Here: **+** next to *My calendars* → **Subscribe by URL** → **Canvas** → paste.

Feeds refresh every 15 minutes (`CAL_SYNC_INTERVAL`).

Leave **Show in Assignments** ticked when you subscribe. Canvas items then appear on the Assignments tab, with the
course name taken from the `[COURSE]` part of the title, and you can check them off there. You can turn this on
or off later for any calendar from the ⋮ menu next to it.

### Google Calendar

**Option A: two-way sync (recommended).** Events you add or edit show up in both places.

1. Go to <https://console.cloud.google.com/>, create a project, and enable the **Google Calendar API**.
2. **APIs & Services → OAuth consent screen**: choose *External*. Add yourself as a **test user**.
3. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   Under **Authorized redirect URIs**, add `<CAL_BASE_URL>/api/oauth/google/callback`
   (for example `https://calendar.example.com/api/oauth/google/callback`).
4. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart.
5. In the app: Settings → **Sync** → **Connect Google**.

> Google expires refresh tokens after 7 days while the app is in *Testing* mode. If you have to
> reconnect every week, click **Publish app** on the consent screen. For personal use you don't need
> Google's verification; you'll just see an "unverified app" warning when you sign in.

**Option B: read-only feed.** In Google Calendar → Settings → your calendar → *Integrate calendar* →
copy **Secret address in iCal format**. Then add it with **Subscribe by URL**.

### Outlook / Microsoft 365

**Option A: two-way sync.**

1. Go to <https://portal.azure.com/> → **App registrations** → **New registration**.
   - Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*
   - Redirect URI: platform **Web**, `<CAL_BASE_URL>/api/oauth/microsoft/callback`
2. **Certificates & secrets** → **New client secret**. Copy the *Value*.
3. **API permissions** → add Microsoft Graph delegated permissions `Calendars.ReadWrite`, `User.Read`
   and `offline_access`.
4. Set `MS_CLIENT_ID` (the *Application (client) ID*) and `MS_CLIENT_SECRET` in `.env`, then restart.
5. In the app: Settings → **Sync** → **Connect Outlook**.

School or work accounts may need an admin to approve the app. If yours does, use option B.

**Option B: read-only feed.** In Outlook on the web → Settings → Calendar → **Shared calendars** →
*Publish a calendar* → copy the **ICS** link. Then add it with **Subscribe by URL**.

### Seeing your calendar in other apps

Settings → **Sync** shows a private `.ics` link to your local calendars. You can subscribe to it from
Google Calendar (*Other calendars → From URL*), Outlook or Apple Calendar.

### How sync works

- Google and Outlook events are pulled for 90 days back and 400 days ahead every 15 minutes, and
  whenever you press *Sync now*. Changes you make here go to Google or Outlook right away.
- Recurring events from Google and Outlook appear as separate occurrences. Editing one changes only that
  occurrence. To change a whole remote series, edit it in Google or Outlook.
- Hide a calendar with its checkbox. Disconnecting an account removes its calendars from this app, but
  nothing is deleted from your account.

## Keyboard shortcuts

`T` today · `J`/`K` or `←`/`→` next/previous · `D` day · `X` 3 days · `W` week · `M` month ·
`A` schedule · `C` create · `/` search · `Esc` close

## Project layout

```
server/        FastAPI backend
  app.py       HTTP API, auth, static files
  events.py    event storage + recurrence expansion
  sync.py      ICS feeds, Google Calendar API, Microsoft Graph
  tasks.py     assignments and boards
  push.py      Web Push reminders
static/        the PWA (vanilla JS, no build step)
scripts/       icon generator
```

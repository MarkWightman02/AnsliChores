# Runtime, Notifications, and Operations

This document covers runtime behavior verified in `src/server.js`, `src/notifications.js`, `.env.example`, `package.json`, and the static frontend files.

## NPM Commands

`package.json` defines:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  }
}
```

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Run tests:

```bash
npm test
```

There is no build command and no frontend bundling step.

## Server Startup

When `src/server.js` is run directly:

- It opens the database with `openDatabase()`.
- It creates the Express app with `startNotifications: true`.
- It listens on `Number(process.env.PORT) || 80`.
- It logs `Ansli Chores is running at http://localhost:${port}`.
- On `SIGTERM` or `SIGINT`, it stops the notification scheduler if present, closes the HTTP server, closes the database, and exits.

PowerShell example:

```powershell
$env:PORT = "3000"
npm start
```

Bash example:

```bash
PORT=3000 npm start
```

## Environment Variables

The app reads environment variables from `process.env`. There is no `dotenv` dependency and no code that automatically reads `.env` or `.env.example`.

`.env.example` lists Discord-related variables:

```ini
DISCORD_WEBHOOK_URL=
DISCORD_USER_COREY=
DISCORD_USER_ANTHONY=
DISCORD_USER_SAM=
DISCORD_USER_MARK=
APP_PUBLIC_URL=http://localhost:8080
TZ=America/New_York
DISCORD_NOTIFICATIONS_ENABLED=true
DISCORD_MORNING_TIME=08:30
DISCORD_EVENING_ENABLED=false
DISCORD_EVENING_TIME=19:00
DISCORD_CATCHUP_WINDOW_MINUTES=180
```

Additional environment variables read by code:

| Variable | Used by | Behavior |
| --- | --- | --- |
| `PORT` | `src/server.js` | HTTP listen port. Defaults to `80`. |
| `DATABASE_FILE` | `src/db.js` | SQLite file path. Defaults to `data/chores.db`. |

## Discord Configuration

`loadNotificationConfig` reads and validates:

| Variable | Default | Validation/behavior |
| --- | --- | --- |
| `DISCORD_NOTIFICATIONS_ENABLED` | `true` | Boolean parser accepts `true`, `1`, `yes`, `on`, `false`, `0`, `no`, `off`; invalid values fall back to default. |
| `DISCORD_WEBHOOK_URL` | empty | Trimmed. If empty, scheduled reminders do not start and manual tests return not configured. |
| `APP_PUBLIC_URL` | `http://localhost:8080` | Trimmed and trailing slashes removed. This is only used in Discord messages. It is independent of the server's `PORT` default. |
| `TZ` | `America/New_York` | Validated with `Intl.DateTimeFormat`; invalid values fall back to default. |
| `DISCORD_MORNING_TIME` | `08:30` | Must match `HH:MM` in 24-hour time. |
| `DISCORD_EVENING_ENABLED` | `false` | Boolean parser. |
| `DISCORD_EVENING_TIME` | `19:00` | Must match `HH:MM` in 24-hour time. |
| `DISCORD_CATCHUP_WINDOW_MINUTES` | `180` | Integer from 0 through 1440. |
| `DISCORD_USER_COREY` | empty | Trimmed Discord user id for Corey. |
| `DISCORD_USER_ANTHONY` | empty | Trimmed Discord user id for Anthony. |
| `DISCORD_USER_SAM` | empty | Trimmed Discord user id for Sam. |
| `DISCORD_USER_MARK` | empty | Trimmed Discord user id for Mark. |

## Notification Scheduler

The scheduler starts only when:

- `createApp` is called with `startNotifications: true`; and
- notifications are enabled; and
- `DISCORD_WEBHOOK_URL` is configured.

`npm start` meets the first condition because `src/server.js` passes `{ startNotifications: true }`.

Tests and embedded uses of `createApp(db)` do not start notifications unless the option is passed.

Scheduler behavior:

- Runs every 60 seconds by default.
- Runs a startup catch-up tick after 1 second.
- Prevents overlapping scheduler ticks with an in-memory `running` flag.
- Morning reminders are checked every day at `DISCORD_MORNING_TIME`.
- Evening reminders are checked only when `DISCORD_EVENING_ENABLED=true`.
- On startup, a scheduled reminder is due if the scheduled time already passed and the current local time is within `DISCORD_CATCHUP_WINDOW_MINUTES`.

Duplicate scheduled sends are prevented in SQLite with `notification_deliveries`, keyed by `notification_type` and `local_date`.

## Scheduled Reminder Content

Scheduled reminders use `listDueNotificationChores(db, localDate)`.

Included chores:

- `archived = 0`
- `next_due <= localDate`

Sorting:

1. `nextDue`
2. `assignedName`
3. `name`

Grouping:

- Chores are grouped by `assignedName`.
- `All` chores mention all configured roommates once.
- Directly assigned chores mention only that assignee, and each configured Discord id is mentioned at most once per digest.

Message text:

- Morning heading: `Good morning! Here are the chores that need attention today (...)`
- Evening heading: `These chores are still outstanding this evening (...)`
- Due today chores use `due today`.
- Overdue chores use `overdue by N day(s) (due YYYY-MM-DD)`.
- A link to `APP_PUBLIC_URL` is appended.

Discord payloads:

- `allowed_mentions.parse` is always an empty array.
- `allowed_mentions.users` contains only the resolved Discord ids that should be allowed for that payload.
- Long digest content is split when the current chunk would exceed 1800 characters.
- User-created chore text is sanitized for `@`, `<`, `>`, whitespace, and maximum length.

If no due or overdue chores exist:

- No Discord webhook call is made.
- The delivery row is updated to `skipped_empty`.

## Discord Webhook Sending

`sendDiscordWebhook`:

- Appends `wait=true` to the webhook URL.
- Sends JSON with `Content-Type: application/json`.
- Uses `global.fetch` by default.
- Uses `AbortController` with a 10000 ms timeout by default.
- Retries HTTP `429` responses up to 3 attempts.
- Uses Discord `retry_after` when available, clamped between 250 ms and 3000 ms.
- Throws on non-2xx responses.

Scheduled notification failures:

- Are sanitized before storage and logging.
- Store status `failed`, the attempted chore count, and a safe error message in `notification_deliveries`.

## Manual Discord Test Notifications

The Manage view has a `Send Test Notification` dialog.

The API route is:

```text
POST /api/notifications/test
```

Allowed recipients:

- `mark`
- `sam`
- `corey`
- `anthony`
- `all`

Manual test behavior:

- The server resolves Discord ids from private environment config.
- Discord user ids are not returned to the browser by the status API.
- The test message includes the resolved mention line, a success line, local time, and `APP_PUBLIC_URL`.
- A successful manual test returns `{ ok: true, messageId }`.
- There is an in-memory 10000 ms cooldown between manual tests.
- Manual tests are not persisted to `notification_deliveries`.

## Frontend Pages

### `/`

Serves `public/index.html`, `public/styles.css`, and `public/app.js`.

Views implemented inside this page:

- Dashboard
- Manage
- History

Dashboard behavior:

- Loads active roommates.
- Stores selected roommate in `localStorage` as `ansli:selectedRoommate`.
- Shows summary cards.
- Supports filters: all chores, my chores, overdue, due today, upcoming, completed recently.
- Supports sorting by next due date, assignee, chore name, and status.
- Opens a completion dialog for chores.

Manage behavior:

- Lists chores including archived chores.
- Opens the add/edit chore dialog.
- Archives active chores.
- Restores archived chores.
- Permanently deletes archived chores after browser confirmation.
- Links to JSON export and SQLite backup endpoints.
- Displays safe Discord notification status.
- Opens the manual Discord test dialog.

History behavior:

- Filters by roommate, chore, from date, and to date.
- Opens a correction dialog for history records.
- Deletes history records after browser confirmation.

### `/calendar`

Serves `public/calendar.html`, shared `public/styles.css`, `public/calendar.css`, and `public/calendar.js`.

Calendar behavior:

- Supports month and week views.
- Stores view/filter preferences in `localStorage`.
- Uses URL query parameters `date` and `view` for navigation state.
- Has previous, today, and next period controls.
- Supports roommate filter, status filter, include-All toggle, and show-completed toggle.
- Displays overdue summary.
- Displays a calendar grid and an agenda.
- On mobile-sized layouts, the agenda is scoped to the selected day.
- Chore detail dialog supports mark-complete and edit.
- Completed-history entries open a read-only detail dialog.

The `Active only` checkbox exists in the calendar HTML but is disabled. Active-roommate behavior is enforced by server queries and validation.

## Browser Local Storage

Keys used by frontend code:

| Key | File | Purpose |
| --- | --- | --- |
| `ansli:selectedRoommate` | `public/app.js`, `public/calendar.js` | Dashboard selected roommate and calendar completion default. |
| `ansli:theme` | `public/app.js`, `public/calendar.js` | Light/dark theme. |
| `ansli:calendarView` | `public/calendar.js` | `month` or `week`. |
| `ansli:calendarRoommate` | `public/calendar.js` | Calendar roommate filter. |
| `ansli:calendarStatus` | `public/calendar.js` | Calendar status filter. |
| `ansli:calendarIncludeAll` | `public/calendar.js` | Calendar Include All toggle. |
| `ansli:calendarShowCompleted` | `public/calendar.js` | Calendar Show completed chores toggle. |

No application records are stored in browser local storage.

## Security-Relevant Runtime Behavior

Implemented:

- `x-powered-by` is disabled.
- Security headers are set for content type, frame ancestors, referrer policy, browser permissions, and Content Security Policy.
- JSON bodies are limited to 50 KB.
- Discord mentions are controlled with `allowed_mentions`.
- Discord webhook URLs are not returned by any API response.
- Notification errors stored in the database have URLs redacted.

Not implemented:

- User authentication.
- Authorization.
- CSRF tokens.
- Rate limiting except the in-memory manual Discord test cooldown.

If the app is exposed outside a trusted network, put authentication and TLS in front of it with a reverse proxy or hosting layer.

## Backup and Export

Manage view links:

- `/api/export`
- `/api/backup`

`/api/export` returns JSON containing inactive roommates, archived chores, and all history.

`/api/backup` creates a temporary SQLite backup using `db.backup`, downloads it as `ansli-chores.sqlite`, and removes the temporary file in the response callback.

## Testing Notes

The test suite creates temporary SQLite databases with `fs.mkdtempSync` and removes them after each test. Tests do not require the default `data/chores.db`.

Run:

```bash
npm test
```

The suite covers database behavior, server routes, calendar behavior, date utilities, static mobile shell checks, and notification behavior.

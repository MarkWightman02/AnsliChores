# Ansli Chores

A self-hosted roommate chore tracker for Sam, Corey, Anthony, and Mark. It uses Node.js, Express, SQLite, and vanilla HTML/CSS/JavaScript.

## Features

- Shared server-side SQLite storage
- Mobile-first dashboard with status summaries, filters, and sorting
- Separate `/calendar` page with month and week views, filters, overdue summary, and mobile agenda
- Phone-friendly bottom navigation, compact chore cards, mobile filter sheet, and sheet-style dialogs
- Chore completion workflow with notes, actual completion dates, and rotation advancement
- Add, edit, archive, restore, and permanently delete archived chores
- Custom chore rotations with ordering
- Completion history with filters, correction, and deletion
- Discord morning reminders for due and overdue chores, with optional evening follow-up
- JSON export, SQLite backup download, and `/api/health`
- Light/dark theme support and accessible modal dialogs

## Requirements

- Node.js 20 or newer
- npm

## Local Startup

```bash
npm install
npm start
```

The app defaults to [http://localhost:8080](http://localhost:8080). Set `PORT` to use another port:

```bash
PORT=3000 npm start
```

On PowerShell:

```powershell
$env:PORT = "3000"
npm start
```

## Database

The default SQLite database is created at `data/chores.db`. The initial chores are seeded only when the database is empty. To use a different database path:

```bash
DATABASE_FILE=/path/to/chores.db npm start
```

The app enables SQLite foreign keys, WAL mode, and transactional writes for completion changes.

## Discord Reminders

Discord reminders are configured entirely through server environment variables. Never commit real webhook URLs or Discord user IDs. Use [.env.example](C:/Users/Mark/Documents/AnsliChores/.env.example) only as a placeholder template.

Required for delivery:

```ini
DISCORD_WEBHOOK_URL=
DISCORD_USER_COREY=
DISCORD_USER_ANTHONY=
DISCORD_USER_SAM=
DISCORD_USER_MARK=
APP_PUBLIC_URL=http://localhost:8080
TZ=America/New_York
```

Optional scheduling values:

```ini
DISCORD_NOTIFICATIONS_ENABLED=true
DISCORD_MORNING_TIME=08:30
DISCORD_EVENING_ENABLED=false
DISCORD_EVENING_TIME=19:00
DISCORD_CATCHUP_WINDOW_MINUTES=180
```

The morning reminder sends one digest at 8:30 AM in the configured timezone. It includes active chores due today or overdue, grouped by assignee, and links back to `APP_PUBLIC_URL`. If no chores are due or overdue, no Discord message is sent. Evening reminders are disabled by default and, when enabled, send only chores still outstanding at 7:00 PM.

Duplicate prevention is persisted in SQLite in `notification_deliveries`, keyed by reminder type and local date. On restart, the app sends a catch-up reminder only if the scheduled time already passed, no successful/skipped delivery exists for that local date, and the restart is within `DISCORD_CATCHUP_WINDOW_MINUTES`.

The Manage screen shows safe Discord notification status and includes a `Send Test Notification` button. The test dialog accepts only Mark, Sam, Corey, Anthony, or All Roommates; Discord IDs are resolved only on the server and are never returned to the browser.

After changing systemd environment values:

```bash
systemctl daemon-reload
systemctl restart ansli-chores
journalctl -u ansli-chores -f
```

## Tests

```bash
npm test
```

The tests cover due-date calculations, monthly end-of-month behavior, first-run seeding, rotation advancement, deleting the most recent completion record, calendar route/API behavior, mobile shell checks, and Discord notification formatting/delivery behavior.

## API Overview

- `GET /api/health`
- `GET /api/roommates`
- `GET /api/dashboard`
- `GET /api/calendar`
- `GET /api/notifications/status`
- `POST /api/notifications/test`
- `GET /api/chores`
- `POST /api/chores`
- `PUT /api/chores/:id`
- `POST /api/chores/:id/archive`
- `POST /api/chores/:id/restore`
- `DELETE /api/chores/:id`
- `POST /api/chores/:id/complete`
- `GET /api/history`
- `PUT /api/history/:id`
- `DELETE /api/history/:id`
- `GET /api/export`
- `GET /api/backup`

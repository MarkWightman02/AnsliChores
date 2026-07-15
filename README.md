# Ansli Chores

Ansli Chores is a self-hosted roommate chore tracker for Sam, Corey, Anthony, and Mark. The application is implemented with Node.js, Express, SQLite through `better-sqlite3`, and static HTML/CSS/JavaScript.

This documentation describes what is implemented in this repository. It does not assume support for features that are not present in the codebase.

## Documentation

- [API reference](docs/API.md)
- [Database and data model](docs/DATABASE.md)
- [Runtime, notifications, and operations](docs/OPERATIONS.md)

## Implemented Features

- Dashboard page at `/` with status summaries, roommate selection, chore filters, sorting, completion dialogs, and mobile bottom navigation.
- Calendar page at `/calendar` with month/week views, overdue summary, agenda view, roommate/status filters, optional completed-history display, and chore detail dialogs.
- Manage view on `/` for creating, editing, archiving, restoring, and permanently deleting archived chores.
- History view on `/` for filtering, correcting, and deleting completion records.
- Server-side SQLite persistence, schema creation, seed data, and transactional writes for chore creation, updates, completion, history correction, history deletion, and notification reservation.
- Chore rotation support using per-chore ordered rotation members.
- Completion history that stores completed-by, previous/new assignee, previous/new last-done date, and previous/new due date.
- JSON export and SQLite backup download endpoints.
- Discord reminder support through environment variables, including morning reminders, optional evening reminders, manual test notifications, duplicate prevention, catch-up on restart, sanitized errors, and controlled `allowed_mentions`.
- Light/dark theme preference saved in browser `localStorage`.

## Not Implemented

These are intentionally documented as absences because they are not present in the repository:

- No user accounts, login, authorization, or CSRF protection.
- No roommate creation/edit/delete HTTP API or UI. Roommates are seeded into the database and can be listed by the API.
- No automatic `.env` file loader. Environment variables must be set by the shell, service manager, hosting environment, or another process wrapper.
- No schema migration framework beyond `CREATE TABLE IF NOT EXISTS`, indexes, and triggers in `src/db.js`.
- No frontend build step or bundler.

## Requirements

The repository does not declare an `engines` field in `package.json`.

The implementation uses:

- `node --test`
- global `fetch`
- CommonJS modules
- `better-sqlite3`

Use a Node.js version that provides the built-in test runner and global `fetch`. Node.js 18 or newer satisfies those code-level requirements.

## Install

```bash
npm install
```

Dependencies are:

- Runtime: `better-sqlite3`, `express`
- Development: none declared

## Start

```bash
npm start
```

`npm start` runs:

```bash
node src/server.js
```

When `src/server.js` is run directly, the server listens on `Number(process.env.PORT) || 80`.

Examples:

```bash
PORT=3000 npm start
```

PowerShell:

```powershell
$env:PORT = "3000"
npm start
```

On systems where binding to port `80` requires elevated privileges, set `PORT` to a non-privileged port such as `3000` or `8080`.

## Database

By default, the database file is:

```text
data/chores.db
```

Override it with:

```bash
DATABASE_FILE=/path/to/chores.db npm start
```

`openDatabase` creates the parent directory, enables SQLite foreign keys, sets WAL journal mode, sets a `busy_timeout` of 5000 milliseconds, creates tables/indexes/triggers if needed, and seeds default data only when both `roommates` and `chores` are empty.

See [Database and data model](docs/DATABASE.md) for the full schema and persistence behavior.

## Seed Data

The seed data in `src/seedData.js` creates:

- Four roommates: Sam, Corey, Anthony, Mark
- Seventeen chores
- Several configured rotations, including:
  - `Vacuum Living Room + Den`: Sam -> Corey -> Anthony -> Mark
  - `Mow Grass`: Sam -> Anthony
  - Bathroom chores with Sam -> Corey -> Anthony

Seed data is not reapplied after the database contains any roommate or chore rows.

## Chore Completion Behavior

Completing a chore:

- Requires an active `completedBy` roommate and a valid `YYYY-MM-DD` completion date.
- Updates `last_done` to the submitted completion date.
- Calculates the next due date from the submitted completion date, not from the old due date.
- Advances rotating chores from the chore's current `assigned_to` value, not from the roommate who clicked completion.
- Leaves non-rotating chores and `All` chores assigned to the same assignee.
- Inserts a completion-history record containing previous and new assignment/date state.
- Runs inside a SQLite transaction.

If a rotating chore has at least two configured rotation members and the current assignee is not in that rotation, completion is rejected with HTTP `409` and no history record is inserted.

Duplicate completion submissions with the same latest persisted state and same payload return the existing history record with `duplicate: true` instead of advancing the rotation again.

## Test

```bash
npm test
```

The test suite uses Node's built-in test runner and temporary SQLite databases. Current tests cover:

- Date validation and due-date calculations.
- First-run seed data.
- Rotating chore advancement for two-, three-, and four-person rotations.
- Completing a chore for another roommate.
- Invalid rotation rejection without partial writes.
- Non-rotating and `All` assignment completion behavior.
- Inactive rotation member skipping.
- History deletion rollback.
- Calendar route/API behavior.
- Duplicate completion submissions.
- Mobile static shell checks.
- Discord notification formatting, scheduling, duplicate prevention, retry behavior, sanitization, manual tests, and safe status output.

## Project Layout

```text
.
|-- public/
|   |-- index.html       # dashboard/manage/history shell
|   |-- app.js           # dashboard/manage/history browser logic
|   |-- styles.css       # shared styling
|   |-- calendar.html    # calendar shell
|   |-- calendar.js      # calendar browser logic
|   `-- calendar.css     # calendar-specific styling
|-- src/
|   |-- server.js        # Express app, API routes, validation, static hosting
|   |-- db.js            # SQLite setup, queries, transactions, data mapping
|   |-- dateUtils.js     # date-only validation and frequency calculations
|   |-- notifications.js # Discord configuration, scheduler, payloads, sender
|   `-- seedData.js      # initial roommates and chores
|-- test/                # node:test regression tests
|-- docs/                # detailed documentation
|-- package.json
|-- package-lock.json
`-- .env.example
```

## Browser State

The frontend stores only preferences in `localStorage`:

- `ansli:selectedRoommate`
- `ansli:theme`
- `ansli:calendarView`
- `ansli:calendarRoommate`
- `ansli:calendarStatus`
- `ansli:calendarIncludeAll`
- `ansli:calendarShowCompleted`

Application data is stored server-side in SQLite.

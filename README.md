# Ansli Chores

A self-hosted roommate chore tracker for Sam, Corey, Anthony, and Mark. It uses Node.js, Express, SQLite, and vanilla HTML/CSS/JavaScript.

## Features

- Shared server-side SQLite storage
- Mobile-first dashboard with status summaries, filters, and sorting
- Separate `/calendar` page with month and week views, filters, overdue summary, and mobile agenda
- Chore completion workflow with notes, actual completion dates, and rotation advancement
- Add, edit, archive, restore, and permanently delete archived chores
- Custom chore rotations with ordering
- Completion history with filters, correction, and deletion
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

## Tests

```bash
npm test
```

The tests cover due-date calculations, monthly end-of-month behavior, first-run seeding, rotation advancement, deleting the most recent completion record, and calendar route/API behavior.

## API Overview

- `GET /api/health`
- `GET /api/roommates`
- `GET /api/dashboard`
- `GET /api/calendar`
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

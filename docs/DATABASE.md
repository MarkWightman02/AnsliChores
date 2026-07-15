# Database and Data Model

The database layer is implemented in `src/db.js` with `better-sqlite3`.

## Database File

Default database path:

```text
data/chores.db
```

Override path:

```bash
DATABASE_FILE=/path/to/chores.db npm start
```

`openDatabase` creates the parent directory for the database file.

## SQLite Pragmas

`openDatabase` sets:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

## Schema Creation

The app creates tables, indexes, and triggers with `CREATE ... IF NOT EXISTS` in `migrate(db)`. There is no migration version table and no ALTER-based migration framework.

SQLite timestamps use `datetime('now')` where defaults or triggers define them.

## Tables

### `roommates`

```sql
CREATE TABLE IF NOT EXISTS roommates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Usage:

- Active roommates are returned by `GET /api/roommates`.
- Active roommates are required for chore assignment validation, rotation validation, completion `completedBy`, calendar roommate filters, and Discord test recipient mapping.
- `GET /api/export` includes inactive roommates because it calls `getRoommates(db, true)`.
- There is no implemented route or UI for managing roommates.

### `chores`

```sql
CREATE TABLE IF NOT EXISTS chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  assigned_to INTEGER REFERENCES roommates(id) ON DELETE SET NULL,
  frequency_count INTEGER NOT NULL,
  frequency_unit TEXT NOT NULL CHECK (frequency_unit IN ('week', 'month')),
  last_done TEXT,
  next_due TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  rotation_enabled INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Usage:

- `assigned_to` is nullable. A null assignee is displayed by the app as `All`.
- `frequency_unit` is restricted by SQLite to `week` or `month`.
- `archived = 1` hides chores from dashboard, calendar, and notifications.
- Archived chores remain visible in the Manage view because that view calls `GET /api/chores?includeArchived=true`.
- Deleting a non-archived chore is rejected by the API.

### `chore_rotation`

```sql
CREATE TABLE IF NOT EXISTS chore_rotation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  roommate_id INTEGER NOT NULL REFERENCES roommates(id) ON DELETE CASCADE,
  rotation_order INTEGER NOT NULL,
  UNIQUE (chore_id, roommate_id),
  UNIQUE (chore_id, rotation_order)
);
```

Usage:

- Rotation order is always read with `ORDER BY rotation_order`.
- Creating or updating a chore replaces all existing rotation rows for that chore.
- The API validates rotations as unique active roommate ids.
- If `rotationEnabled` is true through the API, at least two members are required.
- If `rotationEnabled` is false through the API, rotation rows are replaced with an empty list.
- Completion uses the configured rotation only. It does not insert every household roommate into an existing rotation.
- Inactive rotation members are skipped at completion time and the stored rotation order is preserved.

### `completion_history`

```sql
CREATE TABLE IF NOT EXISTS completion_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  completed_by INTEGER NOT NULL REFERENCES roommates(id),
  completed_date TEXT NOT NULL,
  completion_note TEXT NOT NULL DEFAULT '',
  previous_assignee INTEGER REFERENCES roommates(id),
  new_assignee INTEGER REFERENCES roommates(id),
  previous_last_done TEXT,
  new_last_done TEXT,
  previous_due_date TEXT,
  new_due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Usage:

- Completion inserts one history record unless the request is detected as a duplicate of the latest persisted completion state.
- The history record stores the previous/new assignment and date state for rollback.
- Deleting the latest history record restores the chore from `previous_assignee`, `previous_last_done`, and `previous_due_date`.
- Deleting a non-latest history record removes only that record.
- Correcting a history record updates `completed_by`, `completed_date`, `completion_note`, `new_last_done`, and `new_due_date`.
- Correcting the latest history record also updates the chore's `last_done` and `next_due`.
- Correcting history does not recalculate chore assignment.

### `notification_deliveries`

```sql
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('morning', 'evening', 'manual_test')),
  local_date TEXT NOT NULL,
  scheduled_time TEXT,
  status TEXT NOT NULL,
  chore_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  discord_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (notification_type, local_date)
);
```

Usage:

- Scheduled morning/evening reminders reserve one row per type and local date.
- The code writes statuses `processing`, `sent`, `skipped_empty`, and `failed`.
- Existing `sent` and `skipped_empty` rows prevent duplicate sends for the same type/date.
- Existing `processing` rows are treated as active unless `updated_at <= datetime('now', '-15 minutes')`.
- Manual Discord test notifications are not recorded by current code, although `manual_test` is allowed by the table check constraint.

## Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_chores_next_due ON chores(next_due);
CREATE INDEX IF NOT EXISTS idx_chores_archived ON chores(archived);
CREATE INDEX IF NOT EXISTS idx_history_chore ON completion_history(chore_id);
CREATE INDEX IF NOT EXISTS idx_history_completed_date ON completion_history(completed_date);
CREATE INDEX IF NOT EXISTS idx_notification_type_date ON notification_deliveries(notification_type, local_date);
```

## Triggers

```sql
CREATE TRIGGER IF NOT EXISTS trg_roommates_updated_at
AFTER UPDATE ON roommates
BEGIN
  UPDATE roommates SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_chores_updated_at
AFTER UPDATE ON chores
BEGIN
  UPDATE chores SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_notification_deliveries_updated_at
AFTER UPDATE ON notification_deliveries
BEGIN
  UPDATE notification_deliveries SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

There is no trigger for `completion_history.updated_at`; the table has only `created_at`.

## Seed Behavior

`seedIfEmpty(db)` checks:

```sql
SELECT COUNT(*) AS count FROM roommates;
SELECT COUNT(*) AS count FROM chores;
```

If either table has at least one row, seeding is skipped.

If both are empty, seeding runs inside one transaction:

- Inserts roommates from `ROOMMATES` with `display_order = index + 1`.
- Creates a map from roommate name to id.
- Inserts each chore from `CHORES`.
- Stores `All` assignments as `assigned_to = NULL`.
- Sets `rotation_enabled = 1` when the seed chore has one or more rotation members.
- Inserts rotation rows with `rotation_order = index + 1`.

Seeded roommates:

```text
Sam
Corey
Anthony
Mark
```

Seeded chores:

1. Vacuum Living Room + Den
2. Clean Stove
3. Clean Out Fridge
4. Mop Kitchen
5. Thoroughly Clean Kitchen Counters
6. Mow Grass
7. Sweep Kitchen
8. Clean Bathroom Floors
9. Wipe Down Shower, Sink, and Mirror
10. Clean Toilet
11. Take Trash and Recycling to the Road
12. Wash Kitchen Rug, Tablecloth, Throw Blankets, and Dish Drying Mat
13. Wipe Down Microwave
14. Vacuum Basement Stairs
15. Wash Bath Mats
16. Wash Out Trash and Recycling Bins
17. Clean Out Pantry

## Mapping Rows to API Objects

`hydrateChore(db, row)` maps database columns into camelCase fields:

| Database column | API field |
| --- | --- |
| `id` | `id` |
| `name` | `name` |
| `assigned_to` | `assignedTo` |
| joined roommate name or null | `assignedName`, with null displayed as `All` |
| `frequency_count` | `frequencyCount` |
| `frequency_unit` | `frequencyUnit` |
| derived from count/unit | `frequencyLabel` |
| `last_done` | `lastDone` |
| `next_due` | `nextDue` |
| `notes` | `notes` |
| `rotation_enabled` | `rotationEnabled` boolean |
| `archived` | `archived` boolean |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |

`mapHistory(row)` maps completion history into camelCase fields and displays null assignees as `All`.

## Date Storage and Calculations

- Date-only values are stored as `YYYY-MM-DD` text.
- `dateUtils.isValidDate` rejects invalid dates and non-`YYYY-MM-DD` formats.
- Weekly due dates add `frequency_count * 7` days to the completion date.
- Monthly due dates add calendar months and clamp to the last valid day of shorter months.
- `todayLocal()` uses the server's local timezone.
- Discord notification local dates use `Intl.DateTimeFormat` with the configured `TZ`.

## Completion Transaction

`completeChore(db, id, data)` runs inside one SQLite transaction.

Order of operations:

1. Load the active, non-archived chore row.
2. Detect whether the request is a duplicate of the latest persisted completion state.
3. Load the configured rotation ordered by `rotation_order`.
4. Store `previousAssignee` from the chore's current `assigned_to`.
5. Calculate `newAssignee`.
6. Calculate the new due date from the submitted completion date.
7. Update `chores.assigned_to`, `chores.last_done`, and `chores.next_due`.
8. Insert a `completion_history` row with previous/new state.
9. Return the updated chore and history record.

If invalid rotation state is detected, an `InvalidRotationError` is thrown inside the transaction. The API catches it and returns HTTP `409`.

## Other Transaction Boundaries

Explicit transactions are used for:

- Initial seed insert.
- Chore creation.
- Chore update.
- Chore completion.
- History correction.
- History deletion.
- Notification delivery reservation.

Single-statement writes are used for:

- Archive/restore.
- Archived chore deletion.
- Notification delivery update.

## Last Updated Calculation

`getLastUpdated(db)` reads:

```sql
SELECT MAX(updated_at) AS value FROM chores;
SELECT MAX(created_at) AS value FROM completion_history;
```

It returns the latest non-null string value from those two timestamps, or `null` when neither exists.

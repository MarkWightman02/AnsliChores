# API Reference

This file documents the HTTP API implemented in `src/server.js`.

## General Behavior

- JSON request bodies are parsed with `express.json({ limit: '50kb' })`.
- JSON endpoints return JSON.
- Error responses use:

```json
{ "error": "Message." }
```

- `/api/*` routes that are not implemented return `404` with `API endpoint not found.`.
- Unhandled server errors are logged server-side and returned as `500` with `Something went wrong.`.
- Static files are served from `public/` with extension fallback enabled, so `/calendar` serves `public/calendar.html`.

## Common Data Shapes

### Roommate

Returned by `GET /api/roommates` and calendar responses.

```json
{
  "id": 1,
  "name": "Sam",
  "active": 1,
  "displayOrder": 1
}
```

`active` is returned as the numeric SQLite value.

### Rotation Member

```json
{
  "id": 1,
  "name": "Sam",
  "rotationOrder": 1
}
```

### Hydrated Chore

Mutation endpoints return hydrated chores from `src/db.js`.

```json
{
  "id": 1,
  "name": "Vacuum Living Room + Den",
  "assignedTo": 1,
  "assignedName": "Sam",
  "frequencyCount": 2,
  "frequencyUnit": "week",
  "frequencyLabel": "Every 2 Weeks",
  "lastDone": null,
  "nextDue": "2026-07-10",
  "notes": "",
  "rotationEnabled": true,
  "rotation": [
    { "id": 1, "name": "Sam", "rotationOrder": 1 }
  ],
  "archived": false,
  "createdAt": "2026-07-10 00:00:00",
  "updatedAt": "2026-07-10 00:00:00"
}
```

Dashboard, calendar, and chore listing endpoints decorate chore objects with:

```json
{
  "status": "Due Today",
  "upcomingRotation": "Sam -> Corey -> Anthony -> Mark; next after completion: Corey"
}
```

`assignedTo: null` is displayed as `assignedName: "All"`.

### Completion History Record

```json
{
  "id": 1,
  "choreId": 1,
  "choreName": "Vacuum Living Room + Den",
  "completedBy": 1,
  "completedByName": "Sam",
  "completedDate": "2026-07-12",
  "completionNote": "",
  "previousAssignee": 1,
  "previousAssigneeName": "Sam",
  "newAssignee": 2,
  "newAssigneeName": "Corey",
  "previousLastDone": null,
  "newLastDone": "2026-07-12",
  "previousDueDate": "2026-07-10",
  "newDueDate": "2026-07-26",
  "createdAt": "2026-07-12 00:00:00"
}
```

Null assignee values are mapped to the display name `All`.

## Health

### `GET /api/health`

Returns a basic server/database status object.

Response:

```json
{
  "ok": true,
  "timestamp": "2026-07-15T14:00:00.000Z",
  "database": "ok"
}
```

## Roommates

### `GET /api/roommates`

Returns active roommates only, ordered by `display_order, name`.

Response:

```json
{
  "roommates": [
    { "id": 1, "name": "Sam", "active": 1, "displayOrder": 1 }
  ]
}
```

There is no implemented API route for creating, editing, disabling, or deleting roommates.

## Dashboard

### `GET /api/dashboard`

Returns dashboard summaries and decorated chores.

Query parameters:

| Name | Required | Behavior |
| --- | --- | --- |
| `today` | No | Valid `YYYY-MM-DD`; invalid or missing values fall back to server-local today. |
| `filter` | No | `all`, `my`, `overdue`, `today`, `upcoming`, or `recent`; unknown values behave like `all`. |
| `sort` | No | `next_due`, `assignee`, `name`, or `status`; unknown values use `next_due`. |
| `roommateId` | No | Positive integer. Invalid non-empty values return `400`. |

Filter behavior:

- `all`: all non-archived chores.
- `my`: chores assigned to `roommateId` plus `All` chores. If `roommateId` is missing, returns no chores.
- `overdue`: `nextDue < today`.
- `today`: `nextDue === today`.
- `upcoming`: `nextDue > today && nextDue <= today + 7 days`.
- `recent`: `lastDone` within the last 14 days, inclusive of `today - 14`.

Response:

```json
{
  "today": "2026-07-15",
  "summary": {
    "overdue": 1,
    "dueToday": 2,
    "dueNext7Days": 4,
    "completedThisMonth": 3
  },
  "chores": [],
  "lastUpdated": "2026-07-15 10:00:00"
}
```

## Calendar

### `GET /api/calendar`

Returns decorated chore due entries, optional completed-history entries, overdue entries, active roommates, and last-updated metadata.

Query parameters:

| Name | Required | Behavior |
| --- | --- | --- |
| `start` | Yes | Valid `YYYY-MM-DD`. |
| `end` | Yes | Valid `YYYY-MM-DD`; must be greater than or equal to `start`. |
| `today` | No | Valid `YYYY-MM-DD`; invalid non-empty value returns `400`; missing value uses server-local today. |
| `view` | No | `month` or `week`; default `month`. |
| `status` | No | `all` or `overdue`; default `all`. |
| `roommateId` | No | Active roommate id. Invalid or unknown non-empty values return `400`. |
| `includeAll` | No | Boolean query value; default `true`. Accepted values: `true`, `1`, `false`, `0`. |
| `showCompleted` | No | Boolean query value; default `false`. Accepted values: `true`, `1`, `false`, `0`. |

Validation:

- `start` and `end` are required.
- `start` must be before or equal to `end`.
- The range cannot exceed 370 days.
- `view`, `status`, `includeAll`, and `showCompleted` are validated.

Chore selection:

- Archived chores are excluded.
- With `status=all`, due entries include chores due between `start` and `end`, plus chores overdue before `today`.
- With `status=overdue`, due entries include only chores with `next_due < today`.
- If `roommateId` is set and `includeAll=true`, chores assigned to that roommate or `All` are included.
- If `roommateId` is set and `includeAll=false`, only chores assigned to that roommate are included.
- If `roommateId` is not set and `includeAll=false`, `All` chores are excluded.

Completed entries:

- Returned only when `showCompleted=true`.
- Completion dates must be within `start` and `end`.
- If `roommateId` is set, completed entries are filtered by `completed_by`.

Response:

```json
{
  "start": "2026-07-01",
  "end": "2026-07-31",
  "today": "2026-07-15",
  "view": "month",
  "roommates": [],
  "chores": [
    {
      "type": "due",
      "calendarDate": "2026-07-15"
    }
  ],
  "completed": [
    {
      "type": "completed",
      "status": "Completed",
      "calendarDate": "2026-07-12"
    }
  ],
  "overdue": [],
  "lastUpdated": "2026-07-15 10:00:00"
}
```

## Chores

### `GET /api/chores`

Returns decorated chores.

Query parameters:

| Name | Required | Behavior |
| --- | --- | --- |
| `includeArchived` | No | Only exact string `true` includes archived chores. |
| `today` | No | Valid `YYYY-MM-DD`; invalid or missing values fall back to server-local today. |

Response:

```json
{
  "chores": [],
  "lastUpdated": "2026-07-15 10:00:00"
}
```

### `POST /api/chores`

Creates a chore and returns `201`.

Request body:

```json
{
  "name": "Clean Windows",
  "assignedTo": 1,
  "frequencyCount": 2,
  "frequencyUnit": "week",
  "lastDone": null,
  "nextDue": "2026-07-20",
  "notes": "",
  "rotationEnabled": true,
  "rotationIds": [1, 2, 3]
}
```

Validation:

- `name` is required after trimming and is limited to 120 characters.
- `assignedTo` may be `null`, empty string, `"all"`, or an active roommate id.
- `frequencyCount` must be an integer from 1 through 24.
- `frequencyUnit` must be `week` or `month`.
- `lastDone`, when present, must be a valid `YYYY-MM-DD`.
- `nextDue` is required and must be a valid `YYYY-MM-DD`.
- `notes` is trimmed and limited to 1000 characters.
- `rotationIds` must be an array of unique active roommate ids.
- If `rotationEnabled` is true, at least two rotation ids are required.
- If `rotationEnabled` is false, the stored rotation is replaced with an empty rotation.

Response:

```json
{ "chore": {} }
```

### `PUT /api/chores/:id`

Updates an existing chore.

Path validation:

- Invalid ids return `400`.
- Missing chores return `404`.

Request body and validation are the same as `POST /api/chores`.

Response:

```json
{ "chore": {} }
```

### `POST /api/chores/:id/archive`

Sets `archived = 1`.

Path validation:

- Invalid ids return `400`.
- Missing chores return `404`.

Response:

```json
{ "chore": {} }
```

### `POST /api/chores/:id/restore`

Sets `archived = 0`.

Path validation:

- Invalid ids return `400`.
- Missing chores return `404`.

Response:

```json
{ "chore": {} }
```

### `DELETE /api/chores/:id`

Permanently deletes an archived chore.

Path validation and behavior:

- Invalid ids return `400`.
- Missing chores return `404`.
- Non-archived chores return `409` with `Archive the chore before permanently deleting it.`.
- Archived chores are deleted and return `{ "ok": true }`.

Deletion cascades through SQLite foreign keys for rotation rows and completion history.

## Completion

### `POST /api/chores/:id/complete`

Completes an active, non-archived chore and returns `201`.

Request body:

```json
{
  "completedBy": 1,
  "completedDate": "2026-07-12",
  "completionNote": "Done after brunch."
}
```

Validation:

- Invalid chore ids return `400`.
- Missing or archived chores return `404` with `Active chore not found.`.
- `completedBy` must be an active roommate id.
- `completedDate` is required and must be a valid `YYYY-MM-DD`.
- `completionNote` is trimmed and limited to 1000 characters.

Completion behavior:

- Runs in one SQLite transaction.
- Uses the chore's current `assigned_to` as the previous assignee.
- Calculates `newDueDate` from `completedDate`, `frequencyCount`, and `frequencyUnit`.
- Updates the chore's `assigned_to`, `last_done`, and `next_due`.
- Inserts a completion-history record with previous and new state.
- Returns the updated hydrated chore and inserted history record.

Rotation behavior:

- If rotation is disabled, no rotation exists, or the chore is assigned to `All`, the assignee is unchanged.
- If rotation is enabled, advancement starts from the chore's current assignee, not from `completedBy`.
- The next active member in the configured `rotation_order` is assigned.
- Inactive rotation members are skipped at completion time without reordering stored rotation rows.
- If rotation has at least two members and the current assignee is not present, completion is rejected with `409`.

Duplicate behavior:

- If the chore's current `last_done` equals the submitted `completedDate`, and the latest history record has the same `completedBy`, `completedDate`, `completionNote`, `new_last_done`, and `new_due_date`, the server returns the current chore, the existing history record, and `duplicate: true`.
- Duplicate responses still use HTTP `201`.

Response:

```json
{
  "chore": {},
  "history": {},
  "duplicate": true
}
```

`duplicate` is present only for duplicate completion submissions.

## History

### `GET /api/history`

Returns completion-history records ordered by `completed_date DESC, id DESC`.

Query parameters:

| Name | Required | Behavior |
| --- | --- | --- |
| `roommateId` | No | Positive integer; invalid non-empty values return `400`. Filters `completed_by`. |
| `choreId` | No | Positive integer; invalid non-empty values return `400`. Filters `chore_id`. |
| `from` | No | Valid `YYYY-MM-DD`; filters `completed_date >= from`. |
| `to` | No | Valid `YYYY-MM-DD`; filters `completed_date <= to`. |

The history filter does not check whether positive integer roommate or chore ids exist.

Response:

```json
{ "history": [] }
```

### `PUT /api/history/:id`

Corrects an existing history record's completed-by, completed date, note, `new_last_done`, and `new_due_date`.

Request body is the same as `POST /api/chores/:id/complete`.

Behavior:

- Invalid history ids return `400`.
- Missing history records return `404`.
- The related chore must exist; otherwise `404` is returned.
- `new_due_date` is recalculated from the submitted `completedDate` and the chore's current frequency.
- If this is the latest history record for its chore, the chore's `last_done` and `next_due` are updated.
- This endpoint does not recalculate chore assignment or history assignee fields other than `completed_by`.

Response:

```json
{ "history": {} }
```

### `DELETE /api/history/:id`

Deletes a history record.

Behavior:

- Invalid history ids return `400`.
- Missing history records return `404`.
- If the record is the latest history record for its chore, the chore is restored to `previous_assignee`, `previous_last_done`, and `previous_due_date` before the history record is deleted.
- If the record is not the latest for its chore, only the history record is deleted.

Response:

```json
{
  "ok": true,
  "restoredChore": {}
}
```

`restoredChore` is `null` when the deleted record was not the latest record for its chore.

## Notifications

### `GET /api/notifications/status`

Returns safe Discord notification status.

Response:

```json
{
  "configured": true,
  "enabled": true,
  "timezone": "America/New_York",
  "morningTime": "08:30",
  "eveningEnabled": false,
  "eveningTime": "19:00",
  "lastMorning": {
    "date": "2026-07-15",
    "status": "sent",
    "choreCount": 3,
    "scheduledTime": "08:30",
    "updatedAt": "2026-07-15 08:30:05"
  },
  "lastEvening": null
}
```

Discord webhook URLs and Discord user ids are not returned.

### `POST /api/notifications/test`

Sends a manual Discord test notification.

Request body:

```json
{ "recipient": "sam" }
```

Allowed recipients:

- `mark`
- `sam`
- `corey`
- `anthony`
- `all`

Behavior:

- If notifications are disabled, returns `409`.
- Invalid recipients return `400`.
- Missing webhook configuration returns `503`.
- Missing recipient mappings return `400`.
- A cooldown returns `429`.
- Discord send failures return `502`.
- Success returns `{ "ok": true, "messageId": "..." }`.

Manual test notifications are sent through the configured Discord webhook but are not recorded in `notification_deliveries`.

## Export and Backup

### `GET /api/export`

Downloads JSON with:

```json
{
  "exportedAt": "2026-07-15T14:00:00.000Z",
  "roommates": [],
  "chores": [],
  "history": []
}
```

The export includes inactive roommates, archived chores, and all completion history.

Response header:

```text
Content-Disposition: attachment; filename="ansli-chores-export.json"
```

### `GET /api/backup`

Creates a temporary SQLite backup with `db.backup`, downloads it as `ansli-chores.sqlite`, and removes the temporary file after the response callback.

If backup creation fails, the request is passed to Express error handling.

## Security Headers

Every request passes through `securityHeaders`, which sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`

The application does not implement authentication or authorization.

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { addFrequency } = require('./dateUtils');
const { CHORES, ROOMMATES } = require('./seedData');

function openDatabase(databaseFile = process.env.DATABASE_FILE) {
  const file = databaseFile || path.join(__dirname, '..', 'data', 'chores.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  seedIfEmpty(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roommates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

    CREATE TABLE IF NOT EXISTS chore_rotation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      roommate_id INTEGER NOT NULL REFERENCES roommates(id) ON DELETE CASCADE,
      rotation_order INTEGER NOT NULL,
      UNIQUE (chore_id, roommate_id),
      UNIQUE (chore_id, rotation_order)
    );

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

    CREATE INDEX IF NOT EXISTS idx_chores_next_due ON chores(next_due);
    CREATE INDEX IF NOT EXISTS idx_chores_archived ON chores(archived);
    CREATE INDEX IF NOT EXISTS idx_history_chore ON completion_history(chore_id);
    CREATE INDEX IF NOT EXISTS idx_history_completed_date ON completion_history(completed_date);

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
  `);
}

function seedIfEmpty(db) {
  const roommateCount = db.prepare('SELECT COUNT(*) AS count FROM roommates').get().count;
  const choreCount = db.prepare('SELECT COUNT(*) AS count FROM chores').get().count;
  if (roommateCount > 0 || choreCount > 0) return;

  const insert = db.transaction(() => {
    const insertRoommate = db.prepare(`
      INSERT INTO roommates (name, display_order)
      VALUES (?, ?)
    `);
    ROOMMATES.forEach((name, index) => insertRoommate.run(name, index + 1));

    const roommateMap = new Map(
      db.prepare('SELECT id, name FROM roommates').all().map((row) => [row.name, row.id])
    );

    const insertChore = db.prepare(`
      INSERT INTO chores (
        name, assigned_to, frequency_count, frequency_unit, last_done, next_due,
        notes, rotation_enabled, archived
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const insertRotation = db.prepare(`
      INSERT INTO chore_rotation (chore_id, roommate_id, rotation_order)
      VALUES (?, ?, ?)
    `);

    for (const chore of CHORES) {
      const assignedTo = chore.assigned === 'All' ? null : roommateMap.get(chore.assigned);
      const result = insertChore.run(
        chore.name,
        assignedTo,
        chore.frequency_count,
        chore.frequency_unit,
        chore.last_done,
        chore.next_due,
        chore.notes,
        chore.rotation.length > 0 ? 1 : 0
      );
      chore.rotation.forEach((name, index) => {
        insertRotation.run(result.lastInsertRowid, roommateMap.get(name), index + 1);
      });
    }
  });

  insert();
}

function getRoommates(db, includeInactive = false) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  return db.prepare(`
    SELECT id, name, active, display_order AS displayOrder
    FROM roommates
    ${where}
    ORDER BY display_order, name
  `).all();
}

function getRoommate(db, id) {
  return db.prepare('SELECT * FROM roommates WHERE id = ? AND active = 1').get(id);
}

function listChores(db, { includeArchived = false } = {}) {
  const rows = db.prepare(`
    SELECT
      c.*,
      r.name AS assigned_name
    FROM chores c
    LEFT JOIN roommates r ON r.id = c.assigned_to
    WHERE (? = 1 OR c.archived = 0)
    ORDER BY c.archived ASC, c.next_due ASC, c.name ASC
  `).all(includeArchived ? 1 : 0);

  return rows.map((row) => hydrateChore(db, row));
}

function getChore(db, id) {
  const row = db.prepare(`
    SELECT c.*, r.name AS assigned_name
    FROM chores c
    LEFT JOIN roommates r ON r.id = c.assigned_to
    WHERE c.id = ?
  `).get(id);
  return row ? hydrateChore(db, row) : null;
}

function hydrateChore(db, row) {
  const rotation = db.prepare(`
    SELECT cr.roommate_id AS id, r.name, cr.rotation_order AS rotationOrder
    FROM chore_rotation cr
    JOIN roommates r ON r.id = cr.roommate_id
    WHERE cr.chore_id = ?
    ORDER BY cr.rotation_order
  `).all(row.id);

  return {
    id: row.id,
    name: row.name,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_to ? row.assigned_name : 'All',
    frequencyCount: row.frequency_count,
    frequencyUnit: row.frequency_unit,
    frequencyLabel: formatFrequency(row.frequency_count, row.frequency_unit),
    lastDone: row.last_done,
    nextDue: row.next_due,
    notes: row.notes || '',
    rotationEnabled: Boolean(row.rotation_enabled),
    rotation,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatFrequency(count, unit) {
  if (unit === 'week') return count === 1 ? 'Every Week' : `Every ${count} Weeks`;
  return count === 1 ? 'Every Month' : `Every ${count} Months`;
}

function replaceRotation(db, choreId, rotationIds) {
  db.prepare('DELETE FROM chore_rotation WHERE chore_id = ?').run(choreId);
  const insert = db.prepare(`
    INSERT INTO chore_rotation (chore_id, roommate_id, rotation_order)
    VALUES (?, ?, ?)
  `);
  rotationIds.forEach((roommateId, index) => insert.run(choreId, roommateId, index + 1));
}

function createChore(db, data) {
  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO chores (
        name, assigned_to, frequency_count, frequency_unit, last_done,
        next_due, notes, rotation_enabled, archived
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      data.name,
      data.assignedTo,
      data.frequencyCount,
      data.frequencyUnit,
      data.lastDone,
      data.nextDue,
      data.notes,
      data.rotationEnabled ? 1 : 0
    );
    replaceRotation(db, result.lastInsertRowid, data.rotationIds || []);
    return getChore(db, result.lastInsertRowid);
  });
  return tx();
}

function updateChore(db, id, data) {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE chores
      SET name = ?,
          assigned_to = ?,
          frequency_count = ?,
          frequency_unit = ?,
          last_done = ?,
          next_due = ?,
          notes = ?,
          rotation_enabled = ?
      WHERE id = ?
    `).run(
      data.name,
      data.assignedTo,
      data.frequencyCount,
      data.frequencyUnit,
      data.lastDone,
      data.nextDue,
      data.notes,
      data.rotationEnabled ? 1 : 0,
      id
    );
    replaceRotation(db, id, data.rotationIds || []);
    return getChore(db, id);
  });
  return tx();
}

function setArchived(db, id, archived) {
  db.prepare('UPDATE chores SET archived = ? WHERE id = ?').run(archived ? 1 : 0, id);
  return getChore(db, id);
}

function deleteArchivedChore(db, id) {
  const chore = getChore(db, id);
  if (!chore) return { deleted: false, reason: 'not_found' };
  if (!chore.archived) return { deleted: false, reason: 'not_archived' };
  db.prepare('DELETE FROM chores WHERE id = ?').run(id);
  return { deleted: true };
}

function completeChore(db, id, data) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM chores WHERE id = ? AND archived = 0').get(id);
    if (!row) return null;

    const rotation = db.prepare(`
      SELECT roommate_id AS id
      FROM chore_rotation
      WHERE chore_id = ?
      ORDER BY rotation_order
    `).all(id).map((item) => item.id);

    const previousAssignee = row.assigned_to;
    const newAssignee = advanceAssignee(previousAssignee, Boolean(row.rotation_enabled), rotation);
    const newDueDate = addFrequency(data.completedDate, row.frequency_count, row.frequency_unit);

    db.prepare(`
      UPDATE chores
      SET assigned_to = ?,
          last_done = ?,
          next_due = ?
      WHERE id = ?
    `).run(newAssignee, data.completedDate, newDueDate, id);

    const historyResult = db.prepare(`
      INSERT INTO completion_history (
        chore_id, completed_by, completed_date, completion_note,
        previous_assignee, new_assignee, previous_last_done, new_last_done,
        previous_due_date, new_due_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.completedBy,
      data.completedDate,
      data.completionNote || '',
      previousAssignee,
      newAssignee,
      row.last_done,
      data.completedDate,
      row.next_due,
      newDueDate
    );

    return {
      chore: getChore(db, id),
      history: getHistoryRecord(db, historyResult.lastInsertRowid)
    };
  });
  return tx();
}

function advanceAssignee(currentAssignee, rotationEnabled, rotationIds) {
  if (!rotationEnabled || !currentAssignee || rotationIds.length === 0) return currentAssignee;
  const currentIndex = rotationIds.indexOf(currentAssignee);
  if (currentIndex === -1) return rotationIds[0];
  return rotationIds[(currentIndex + 1) % rotationIds.length];
}

function listHistory(db, filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.roommateId) {
    clauses.push('h.completed_by = ?');
    params.push(filters.roommateId);
  }
  if (filters.choreId) {
    clauses.push('h.chore_id = ?');
    params.push(filters.choreId);
  }
  if (filters.from) {
    clauses.push('h.completed_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('h.completed_date <= ?');
    params.push(filters.to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT
      h.*,
      c.name AS chore_name,
      completed.name AS completed_by_name,
      prev.name AS previous_assignee_name,
      next.name AS new_assignee_name
    FROM completion_history h
    JOIN chores c ON c.id = h.chore_id
    JOIN roommates completed ON completed.id = h.completed_by
    LEFT JOIN roommates prev ON prev.id = h.previous_assignee
    LEFT JOIN roommates next ON next.id = h.new_assignee
    ${where}
    ORDER BY h.completed_date DESC, h.id DESC
  `).all(...params).map(mapHistory);
}

function getHistoryRecord(db, id) {
  const row = db.prepare(`
    SELECT
      h.*,
      c.name AS chore_name,
      completed.name AS completed_by_name,
      prev.name AS previous_assignee_name,
      next.name AS new_assignee_name
    FROM completion_history h
    JOIN chores c ON c.id = h.chore_id
    JOIN roommates completed ON completed.id = h.completed_by
    LEFT JOIN roommates prev ON prev.id = h.previous_assignee
    LEFT JOIN roommates next ON next.id = h.new_assignee
    WHERE h.id = ?
  `).get(id);
  return row ? mapHistory(row) : null;
}

function mapHistory(row) {
  return {
    id: row.id,
    choreId: row.chore_id,
    choreName: row.chore_name,
    completedBy: row.completed_by,
    completedByName: row.completed_by_name,
    completedDate: row.completed_date,
    completionNote: row.completion_note || '',
    previousAssignee: row.previous_assignee,
    previousAssigneeName: row.previous_assignee ? row.previous_assignee_name : 'All',
    newAssignee: row.new_assignee,
    newAssigneeName: row.new_assignee ? row.new_assignee_name : 'All',
    previousLastDone: row.previous_last_done,
    newLastDone: row.new_last_done,
    previousDueDate: row.previous_due_date,
    newDueDate: row.new_due_date,
    createdAt: row.created_at
  };
}

function correctHistory(db, id, data) {
  const tx = db.transaction(() => {
    const record = db.prepare('SELECT * FROM completion_history WHERE id = ?').get(id);
    if (!record) return null;

    const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(record.chore_id);
    if (!chore) return null;

    const newDueDate = addFrequency(data.completedDate, chore.frequency_count, chore.frequency_unit);
    db.prepare(`
      UPDATE completion_history
      SET completed_by = ?,
          completed_date = ?,
          completion_note = ?,
          new_last_done = ?,
          new_due_date = ?
      WHERE id = ?
    `).run(
      data.completedBy,
      data.completedDate,
      data.completionNote || '',
      data.completedDate,
      newDueDate,
      id
    );

    if (isLatestHistoryForChore(db, record.chore_id, id)) {
      db.prepare(`
        UPDATE chores
        SET last_done = ?,
            next_due = ?
        WHERE id = ?
      `).run(data.completedDate, newDueDate, record.chore_id);
    }

    return getHistoryRecord(db, id);
  });
  return tx();
}

function deleteHistory(db, id) {
  const tx = db.transaction(() => {
    const record = db.prepare('SELECT * FROM completion_history WHERE id = ?').get(id);
    if (!record) return { deleted: false, reason: 'not_found' };

    const latest = isLatestHistoryForChore(db, record.chore_id, id);
    if (latest) {
      db.prepare(`
        UPDATE chores
        SET assigned_to = ?,
            last_done = ?,
            next_due = ?
        WHERE id = ?
      `).run(
        record.previous_assignee,
        record.previous_last_done,
        record.previous_due_date,
        record.chore_id
      );
    }

    db.prepare('DELETE FROM completion_history WHERE id = ?').run(id);
    return { deleted: true, restoredChore: latest ? getChore(db, record.chore_id) : null };
  });
  return tx();
}

function isLatestHistoryForChore(db, choreId, historyId) {
  const latest = db.prepare(`
    SELECT id
    FROM completion_history
    WHERE chore_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(choreId);
  return latest && latest.id === historyId;
}

function getLastUpdated(db) {
  const choreTime = db.prepare("SELECT MAX(updated_at) AS value FROM chores").get().value;
  const historyTime = db.prepare("SELECT MAX(created_at) AS value FROM completion_history").get().value;
  return [choreTime, historyTime].filter(Boolean).sort().at(-1) || null;
}

module.exports = {
  advanceAssignee,
  completeChore,
  correctHistory,
  createChore,
  deleteArchivedChore,
  deleteHistory,
  getChore,
  getHistoryRecord,
  getLastUpdated,
  getRoommate,
  getRoommates,
  listChores,
  listHistory,
  openDatabase,
  setArchived,
  updateChore
};

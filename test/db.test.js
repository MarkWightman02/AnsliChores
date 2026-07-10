'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  completeChore,
  deleteHistory,
  getChore,
  listChores,
  openDatabase
} = require('../src/db');

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ansli-chores-test-'));
  return {
    db: openDatabase(path.join(dir, 'test.sqlite')),
    dir
  };
}

test('database is seeded on first creation', () => {
  const { db, dir } = tempDatabase();
  try {
    const chores = listChores(db, { includeArchived: true });
    assert.equal(chores.length, 17);
    assert.ok(chores.some((chore) => chore.name === 'Vacuum Living Room + Den'));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('completing a rotating chore advances assignment from actual completion date', () => {
  const { db, dir } = tempDatabase();
  try {
    const vacuum = listChores(db).find((chore) => chore.name === 'Vacuum Living Room + Den');
    const sam = vacuum.rotation.find((person) => person.name === 'Sam');
    const result = completeChore(db, vacuum.id, {
      completedBy: sam.id,
      completedDate: '2026-07-12',
      completionNote: 'Done after brunch.'
    });

    assert.equal(result.chore.lastDone, '2026-07-12');
    assert.equal(result.chore.nextDue, '2026-07-26');
    assert.equal(result.chore.assignedName, 'Corey');
    assert.equal(result.history.previousDueDate, '2026-07-10');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting latest completion restores previous chore state', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = listChores(db).find((item) => item.name === 'Mow Grass');
    const before = getChore(db, chore.id);
    const completedBy = before.rotation.find((person) => person.name === 'Sam').id;
    const result = completeChore(db, chore.id, {
      completedBy,
      completedDate: '2026-07-14',
      completionNote: ''
    });

    assert.equal(result.chore.assignedName, 'Anthony');
    const deleteResult = deleteHistory(db, result.history.id);
    assert.equal(deleteResult.deleted, true);
    const restored = getChore(db, chore.id);
    assert.equal(restored.assignedName, before.assignedName);
    assert.equal(restored.lastDone, before.lastDone);
    assert.equal(restored.nextDue, before.nextDue);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

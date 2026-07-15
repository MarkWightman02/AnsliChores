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
  listHistory,
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

function choreByName(db, name) {
  return listChores(db).find((chore) => chore.name === name);
}

function personId(chore, name) {
  return chore.rotation.find((person) => person.name === name).id;
}

function completeAsAssigned(db, choreId, completedDate = '2026-07-12') {
  const chore = getChore(db, choreId);
  return completeChore(db, choreId, {
    completedBy: chore.assignedTo || chore.rotation[0]?.id || db.prepare('SELECT id FROM roommates ORDER BY id LIMIT 1').get().id,
    completedDate,
    completionNote: ''
  });
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
    const vacuum = choreByName(db, 'Vacuum Living Room + Den');
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

test('four-person rotation advances through every member before wrapping', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Vacuum Living Room + Den');
    const expected = ['Corey', 'Anthony', 'Mark', 'Sam'];
    const seen = [];

    for (const date of ['2026-07-12', '2026-07-26', '2026-08-09', '2026-08-23']) {
      const result = completeAsAssigned(db, chore.id, date);
      seen.push(result.chore.assignedName);
    }

    assert.deepEqual(seen, expected);
    assert.notEqual(seen[0], 'Sam');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('three-person rotation advances in configured order and wraps', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Clean Bathroom Floors');
    db.prepare('UPDATE chores SET assigned_to = ? WHERE id = ?').run(personId(chore, 'Sam'), chore.id);

    const expected = ['Corey', 'Anthony', 'Sam'];
    const seen = [];
    for (const date of ['2026-07-12', '2026-07-26', '2026-08-09']) {
      const result = completeAsAssigned(db, chore.id, date);
      seen.push(result.chore.assignedName);
    }

    assert.deepEqual(seen, expected);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two-person rotation advances in configured order and wraps', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Mow Grass');

    const first = completeAsAssigned(db, chore.id, '2026-07-14');
    const second = completeAsAssigned(db, chore.id, '2026-07-28');

    assert.equal(first.chore.assignedName, 'Anthony');
    assert.equal(second.chore.assignedName, 'Sam');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rotation advances from assigned roommate when another roommate completes it', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Vacuum Living Room + Den');
    const mark = chore.rotation.find((person) => person.name === 'Mark');
    const result = completeChore(db, chore.id, {
      completedBy: mark.id,
      completedDate: '2026-07-12',
      completionNote: 'Covered for Sam.'
    });

    assert.equal(result.history.completedByName, 'Mark');
    assert.equal(result.history.previousAssigneeName, 'Sam');
    assert.equal(result.history.newAssigneeName, 'Corey');
    assert.equal(result.chore.assignedName, 'Corey');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid current rotating assignee rejects completion without partial writes', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Clean Bathroom Floors');
    const markId = db.prepare('SELECT id FROM roommates WHERE name = ?').get('Mark').id;
    db.prepare('UPDATE chores SET assigned_to = ? WHERE id = ?').run(markId, chore.id);

    assert.throws(
      () => completeChore(db, chore.id, {
        completedBy: markId,
        completedDate: '2026-07-12',
        completionNote: ''
      }),
      /current assignee is not present/
    );

    const unchanged = getChore(db, chore.id);
    assert.equal(unchanged.assignedName, 'Mark');
    assert.equal(unchanged.lastDone, null);
    assert.equal(unchanged.nextDue, chore.nextDue);
    assert.equal(listHistory(db, { choreId: chore.id }).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('non-rotating completion preserves assignee', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Clean Stove');
    const markId = db.prepare('SELECT id FROM roommates WHERE name = ?').get('Mark').id;
    const result = completeChore(db, chore.id, {
      completedBy: markId,
      completedDate: '2026-07-12',
      completionNote: ''
    });

    assert.equal(result.chore.assignedName, 'Mark');
    assert.equal(result.history.previousAssigneeName, 'Mark');
    assert.equal(result.history.newAssigneeName, 'Mark');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('All-assigned completion preserves All assignee', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Clean Out Fridge');
    const samId = db.prepare('SELECT id FROM roommates WHERE name = ?').get('Sam').id;
    const result = completeChore(db, chore.id, {
      completedBy: samId,
      completedDate: '2026-07-12',
      completionNote: ''
    });

    assert.equal(result.chore.assignedName, 'All');
    assert.equal(result.history.previousAssigneeName, 'All');
    assert.equal(result.history.newAssigneeName, 'All');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inactive rotation members are skipped without reordering stored rotation', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Vacuum Living Room + Den');
    const coreyId = personId(chore, 'Corey');
    db.prepare('UPDATE roommates SET active = 0 WHERE id = ?').run(coreyId);

    const result = completeAsAssigned(db, chore.id, '2026-07-12');
    const storedRotation = db.prepare(`
      SELECT r.name
      FROM chore_rotation cr
      JOIN roommates r ON r.id = cr.roommate_id
      WHERE cr.chore_id = ?
      ORDER BY cr.rotation_order
    `).all(chore.id).map((row) => row.name);

    assert.equal(result.chore.assignedName, 'Anthony');
    assert.deepEqual(storedRotation, ['Sam', 'Corey', 'Anthony', 'Mark']);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting latest completion restores previous chore state', () => {
  const { db, dir } = tempDatabase();
  try {
    const chore = choreByName(db, 'Mow Grass');
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
    assert.equal(listHistory(db, { choreId: chore.id }).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

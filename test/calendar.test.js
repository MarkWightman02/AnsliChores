'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { listChores, openDatabase, setArchived } = require('../src/db');

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ansli-calendar-test-'));
  return {
    db: openDatabase(path.join(dir, 'test.sqlite')),
    dir
  };
}

async function withServer(callback) {
  const { db, dir } = tempDatabase();
  const server = createApp(db).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback({ baseUrl, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function getJson(baseUrl, pathName, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${pathName}`);
  assert.equal(response.status, expectedStatus);
  return response.json();
}

test('calendar route loads as a separate page', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/calendar`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Ansli Chores Calendar/);
    assert.match(html, /Back to Dashboard/);
  });
});

test('calendar API validates date ranges and filters', async () => {
  await withServer(async ({ baseUrl }) => {
    await getJson(baseUrl, '/api/calendar?start=nope&end=2026-07-31', 400);
    await getJson(baseUrl, '/api/calendar?start=2026-08-01&end=2026-07-01', 400);
    await getJson(baseUrl, '/api/calendar?start=2026-01-01&end=2027-03-01', 400);
    await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&view=year', 400);
    await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&includeAll=maybe', 400);
  });
});

test('chores appear on their exact date-only due date', async () => {
  await withServer(async ({ baseUrl }) => {
    const data = await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-10');
    const vacuum = data.chores.find((chore) => chore.name === 'Vacuum Living Room + Den');
    assert.equal(vacuum.nextDue, '2026-07-10');
    assert.equal(vacuum.calendarDate, '2026-07-10');
    assert.equal(vacuum.status, 'Due Today');
  });
});

test('overdue chores keep their original due date', async () => {
  await withServer(async ({ baseUrl }) => {
    const data = await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-12');
    const vacuum = data.chores.find((chore) => chore.name === 'Vacuum Living Room + Den');
    assert.equal(vacuum.status, 'Overdue');
    assert.equal(vacuum.calendarDate, '2026-07-10');
    assert.ok(data.overdue.some((chore) => chore.id === vacuum.id));
  });
});

test('roommate filters include optional All assignments', async () => {
  await withServer(async ({ baseUrl }) => {
    const allData = await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-10');
    const sam = allData.roommates.find((roommate) => roommate.name === 'Sam');

    const withAll = await getJson(baseUrl, `/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-10&roommateId=${sam.id}&includeAll=true`);
    const withAllNames = withAll.chores.map((chore) => chore.name);
    assert.ok(withAllNames.includes('Vacuum Living Room + Den'));
    assert.ok(withAllNames.includes('Clean Out Fridge'));
    assert.ok(!withAllNames.includes('Clean Stove'));

    const withoutAll = await getJson(baseUrl, `/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-10&roommateId=${sam.id}&includeAll=false`);
    const withoutAllNames = withoutAll.chores.map((chore) => chore.name);
    assert.ok(!withoutAllNames.includes('Clean Out Fridge'));
  });
});

test('archived chores are excluded from calendar results', async () => {
  await withServer(async ({ baseUrl, db }) => {
    const chore = listChores(db).find((item) => item.name === 'Vacuum Living Room + Den');
    setArchived(db, chore.id, true);
    const data = await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-10');
    assert.ok(!data.chores.some((item) => item.id === chore.id));
  });
});

test('calendar completion flow updates due date and advances rotation', async () => {
  await withServer(async ({ baseUrl }) => {
    const calendar = await getJson(baseUrl, '/api/calendar?start=2026-07-01&end=2026-07-31&today=2026-07-10');
    const vacuum = calendar.chores.find((chore) => chore.name === 'Vacuum Living Room + Den');
    const sam = calendar.roommates.find((roommate) => roommate.name === 'Sam');

    const completion = await fetch(`${baseUrl}/api/chores/${vacuum.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        completedBy: sam.id,
        completedDate: '2026-07-12',
        completionNote: 'Finished from calendar.'
      })
    });
    assert.equal(completion.status, 201);

    const refreshed = await getJson(baseUrl, '/api/calendar?start=2026-07-20&end=2026-07-31&today=2026-07-12');
    const updated = refreshed.chores.find((chore) => chore.name === 'Vacuum Living Room + Den');
    assert.equal(updated.nextDue, '2026-07-26');
    assert.equal(updated.calendarDate, '2026-07-26');
    assert.equal(updated.assignedName, 'Corey');
  });
});

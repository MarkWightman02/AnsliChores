'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const {
  getLatestNotificationDelivery,
  listChores,
  openDatabase,
  setArchived
} = require('../src/db');
const {
  buildDigestPayloads,
  duePhrase,
  getLocalDate,
  loadNotificationConfig,
  resetNotificationTestState,
  runDueNotifications,
  sendDiscordWebhook,
  sendManualTestNotification,
  sendScheduledNotification,
  startNotificationScheduler
} = require('../src/notifications');

function config(overrides = {}) {
  return {
    enabled: true,
    webhookUrl: 'https://discord.example/webhook',
    appPublicUrl: 'http://chores.example',
    timezone: 'America/New_York',
    morningTime: '08:30',
    eveningEnabled: true,
    eveningTime: '19:00',
    catchupWindowMinutes: 180,
    userIds: {
      Corey: '100',
      Anthony: '200',
      Sam: '300',
      Mark: '400'
    },
    ...overrides
  };
}

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ansli-notifications-test-'));
  return {
    db: openDatabase(path.join(dir, 'test.sqlite')),
    dir
  };
}

function cleanup(db, dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetNotificationTestState();
}

function captureSender() {
  const calls = [];
  return {
    calls,
    sender: async (payload) => {
      calls.push(payload);
      return { id: `message-${calls.length}` };
    }
  };
}

test('morning digest includes due-today and overdue chores while excluding future chores', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  try {
    const result = await sendScheduledNotification(db, config(), 'morning', {
      localDate: '2026-07-11',
      sender: sent.sender,
      logger: quietLogger()
    });
    assert.equal(result.status, 'sent');
    const content = sent.calls[0].content;
    assert.match(content, /Clean Stove - overdue by 1 day/);
    assert.match(content, /Mop Kitchen - due today/);
    assert.doesNotMatch(content, /Clean Toilet/);
  } finally {
    cleanup(db, dir);
  }
});

test('archived chores are excluded from reminders', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  try {
    const cleanStove = listChores(db).find((chore) => chore.name === 'Clean Stove');
    setArchived(db, cleanStove.id, true);
    await sendScheduledNotification(db, config(), 'morning', {
      localDate: '2026-07-10',
      sender: sent.sender,
      logger: quietLogger()
    });
    assert.doesNotMatch(sent.calls[0].content, /Clean Stove/);
  } finally {
    cleanup(db, dir);
  }
});

test('All assignments mention all configured roommates and allowed_mentions is controlled', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  try {
    await sendScheduledNotification(db, config(), 'morning', {
      localDate: '2026-07-10',
      sender: sent.sender,
      logger: quietLogger()
    });
    assert.match(sent.calls[0].content, /<@100>/);
    assert.match(sent.calls[0].content, /<@200>/);
    assert.match(sent.calls[0].content, /<@300>/);
    assert.match(sent.calls[0].content, /<@400>/);
    assert.deepEqual(sent.calls[0].allowed_mentions.parse, []);
    assert.deepEqual(new Set(sent.calls[0].allowed_mentions.users), new Set(['100', '200', '300', '400']));
  } finally {
    cleanup(db, dir);
  }
});

test('direct assignments mention only the correct roommate and remove duplicates', () => {
  const chore = {
    name: 'One-off',
    assignedName: 'Sam',
    nextDue: '2026-07-10'
  };
  const payloads = buildDigestPayloads({
    chores: [chore, { ...chore, name: 'Second Sam chore' }],
    config: config(),
    localDate: '2026-07-10',
    type: 'morning'
  });
  const content = payloads[0].content;
  assert.equal((content.match(/<@300>/g) || []).length, 1);
  assert.doesNotMatch(content, /<@100>|<@200>|<@400>/);
  assert.deepEqual(payloads[0].allowed_mentions.users, ['300']);
});

test('user-created chore text cannot create uncontrolled mentions', () => {
  const payloads = buildDigestPayloads({
    chores: [{
      name: '@everyone <@999> check this',
      assignedName: 'Mark',
      nextDue: '2026-07-10'
    }],
    config: config(),
    localDate: '2026-07-10',
    type: 'morning'
  });
  assert.doesNotMatch(payloads[0].content, /@everyone/);
  assert.doesNotMatch(payloads[0].content, /<@999>/);
  assert.match(payloads[0].content, /<@400>/);
});

test('empty digests do not call Discord and record skipped_empty', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  try {
    const result = await sendScheduledNotification(db, config(), 'morning', {
      localDate: '2026-01-01',
      sender: sent.sender,
      logger: quietLogger()
    });
    assert.equal(result.status, 'skipped_empty');
    assert.equal(sent.calls.length, 0);
    assert.equal(getLatestNotificationDelivery(db, 'morning').status, 'skipped_empty');
  } finally {
    cleanup(db, dir);
  }
});

test('morning and evening reminders send once per local date without conflicting', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  try {
    const firstMorning = await sendScheduledNotification(db, config(), 'morning', {
      localDate: '2026-07-10',
      sender: sent.sender,
      logger: quietLogger()
    });
    const duplicateMorning = await sendScheduledNotification(db, config(), 'morning', {
      localDate: '2026-07-10',
      sender: sent.sender,
      logger: quietLogger()
    });
    const evening = await sendScheduledNotification(db, config(), 'evening', {
      localDate: '2026-07-10',
      sender: sent.sender,
      logger: quietLogger()
    });
    assert.equal(firstMorning.status, 'sent');
    assert.equal(duplicateMorning.status, 'duplicate');
    assert.equal(evening.status, 'sent');
    assert.equal(sent.calls.length, 2);
  } finally {
    cleanup(db, dir);
  }
});

test('restart catch-up sends inside the window and not outside it or after success', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  try {
    await runDueNotifications(db, config(), {
      reason: 'startup',
      now: new Date('2026-07-10T13:10:00Z'),
      sender: sent.sender,
      logger: quietLogger()
    });
    await runDueNotifications(db, config(), {
      reason: 'startup',
      now: new Date('2026-07-10T13:20:00Z'),
      sender: sent.sender,
      logger: quietLogger()
    });
    await runDueNotifications(db, config(), {
      reason: 'startup',
      now: new Date('2026-07-11T16:00:00Z'),
      sender: sent.sender,
      logger: quietLogger()
    });
    assert.equal(sent.calls.length, 1);
  } finally {
    cleanup(db, dir);
  }
});

test('invalid schedule values fall back safely and missing webhook does not start scheduler', () => {
  const logger = quietLogger();
  const loaded = loadNotificationConfig({
    DISCORD_MORNING_TIME: '99:99',
    DISCORD_EVENING_TIME: 'nope',
    DISCORD_CATCHUP_WINDOW_MINUTES: 'not-a-number',
    TZ: 'Bad/Zone'
  }, logger);
  assert.equal(loaded.morningTime, '08:30');
  assert.equal(loaded.eveningTime, '19:00');
  assert.equal(loaded.catchupWindowMinutes, 180);
  assert.equal(loaded.timezone, 'America/New_York');

  const { db, dir } = tempDatabase();
  try {
    assert.equal(startNotificationScheduler(db, { ...config(), webhookUrl: '' }, { logger }), null);
  } finally {
    cleanup(db, dir);
  }
});

test('Discord HTTP failures are sanitized and 429 retries are limited', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return response(429, { retry_after: 0 });
    }
    return response(200, { id: 'ok' });
  };
  const result = await sendDiscordWebhook('https://discord.example/webhook/secret-token', {
    content: 'hello',
    allowed_mentions: { parse: [], users: [] }
  }, { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.id, 'ok');
  assert.equal(calls, 2);

  await assert.rejects(
    () => sendDiscordWebhook('https://discord.example/webhook/secret-token', {
      content: 'hello',
      allowed_mentions: { parse: [], users: [] }
    }, { fetchImpl: async () => response(500, { message: 'nope' }), timeoutMs: 1000 }),
    /status 500/
  );
});

test('manual tests resolve roommate IDs server-side, reject invalid recipients, and respect cooldown', async () => {
  resetNotificationTestState();
  const sent = captureSender();
  const result = await sendManualTestNotification(config(), 'sam', {
    sender: sent.sender,
    now: new Date('2026-07-10T14:00:00Z'),
    nowMs: 100000,
    logger: quietLogger()
  });
  assert.equal(result.ok, true);
  assert.match(sent.calls[0].content, /<@300>/);
  assert.deepEqual(sent.calls[0].allowed_mentions.users, ['300']);
  await assert.rejects(
    () => sendManualTestNotification(config(), 'sam', {
      sender: sent.sender,
      nowMs: 100001,
      logger: quietLogger()
    }),
    /Please wait/
  );
  resetNotificationTestState();
  await assert.rejects(
    () => sendManualTestNotification(config(), 'somebody', {
      sender: sent.sender,
      ignoreCooldown: true,
      logger: quietLogger()
    }),
    /Invalid/
  );
});

test('notification APIs return safe status and validate test recipients', async () => {
  const { db, dir } = tempDatabase();
  const sent = captureSender();
  const server = createApp(db, {
    notificationConfig: config(),
    notificationSender: sent.sender
  }).listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const statusResponse = await fetch(`${baseUrl}/api/notifications/status`);
    const status = await statusResponse.json();
    assert.equal(status.configured, true);
    assert.equal(status.enabled, true);
    assert.equal(JSON.stringify(status).includes('300'), false);

    const bad = await fetch(`${baseUrl}/api/notifications/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: 'hacker' })
    });
    assert.equal(bad.status, 400);

    const good = await fetch(`${baseUrl}/api/notifications/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: 'all' })
    });
    assert.equal(good.status, 200);
    assert.equal(sent.calls.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(db, dir);
  }
});

test('date-only calculations do not shift and overdue days cross daylight saving correctly', () => {
  assert.equal(getLocalDate(new Date('2026-07-10T03:30:00Z'), 'America/New_York'), '2026-07-09');
  assert.equal(duePhrase('2026-03-08', '2026-03-10'), 'overdue by 2 days (due 2026-03-08)');
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function quietLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

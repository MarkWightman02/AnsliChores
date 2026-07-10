'use strict';

const {
  getLatestNotificationDelivery,
  listDueNotificationChores,
  reserveNotificationDelivery,
  updateNotificationDelivery
} = require('./db');

const DEFAULTS = {
  timezone: 'America/New_York',
  enabled: true,
  morningTime: '08:30',
  eveningEnabled: false,
  eveningTime: '19:00',
  catchupWindowMinutes: 180,
  appPublicUrl: 'http://localhost:8080'
};

const RECIPIENTS = ['Corey', 'Anthony', 'Sam', 'Mark'];
const TEST_COOLDOWN_MS = 10000;
let lastManualTestAt = 0;
let activeScheduler = null;

function loadNotificationConfig(env = process.env, logger = console) {
  const timezone = validateTimezone(env.TZ || DEFAULTS.timezone, logger);
  return {
    enabled: parseBoolean(env.DISCORD_NOTIFICATIONS_ENABLED, DEFAULTS.enabled),
    webhookUrl: cleanEnv(env.DISCORD_WEBHOOK_URL),
    appPublicUrl: normalizePublicUrl(cleanEnv(env.APP_PUBLIC_URL) || DEFAULTS.appPublicUrl),
    timezone,
    morningTime: validateTime(env.DISCORD_MORNING_TIME, DEFAULTS.morningTime, 'DISCORD_MORNING_TIME', logger),
    eveningEnabled: parseBoolean(env.DISCORD_EVENING_ENABLED, DEFAULTS.eveningEnabled),
    eveningTime: validateTime(env.DISCORD_EVENING_TIME, DEFAULTS.eveningTime, 'DISCORD_EVENING_TIME', logger),
    catchupWindowMinutes: validateInteger(
      env.DISCORD_CATCHUP_WINDOW_MINUTES,
      DEFAULTS.catchupWindowMinutes,
      'DISCORD_CATCHUP_WINDOW_MINUTES',
      logger
    ),
    userIds: {
      Corey: cleanEnv(env.DISCORD_USER_COREY),
      Anthony: cleanEnv(env.DISCORD_USER_ANTHONY),
      Sam: cleanEnv(env.DISCORD_USER_SAM),
      Mark: cleanEnv(env.DISCORD_USER_MARK)
    }
  };
}

function getNotificationStatus(db, config) {
  return {
    configured: Boolean(config.webhookUrl),
    enabled: config.enabled,
    timezone: config.timezone,
    morningTime: config.morningTime,
    eveningEnabled: config.eveningEnabled,
    eveningTime: config.eveningTime,
    lastMorning: safeDeliveryStatus(getLatestNotificationDelivery(db, 'morning')),
    lastEvening: safeDeliveryStatus(getLatestNotificationDelivery(db, 'evening'))
  };
}

async function sendScheduledNotification(db, config, type, options = {}) {
  const logger = options.logger || console;
  if (!config.enabled) {
    logger.info(`Discord ${type} reminder skipped: notifications disabled.`);
    return { status: 'disabled' };
  }
  if (!config.webhookUrl) {
    logger.info(`Discord ${type} reminder skipped: webhook not configured.`);
    return { status: 'not_configured' };
  }

  const now = options.now || new Date();
  const localDate = options.localDate || getLocalDate(now, config.timezone);
  const scheduledTime = type === 'evening' ? config.eveningTime : config.morningTime;
  const reservation = reserveNotificationDelivery(db, type, localDate, scheduledTime);
  if (!reservation.reserved) {
    logger.info(`Discord ${type} reminder skipped: already recorded for ${localDate}.`);
    return { status: 'duplicate', record: reservation.record };
  }

  let choreCount = 0;
  try {
    const chores = listDueNotificationChores(db, localDate);
    choreCount = chores.length;
    if (chores.length === 0) {
      const record = updateNotificationDelivery(db, reservation.record.id, {
        status: 'skipped_empty',
        choreCount: 0
      });
      logger.info(`Discord ${type} reminder skipped: no due or overdue chores.`);
      return { status: 'skipped_empty', record };
    }

    const payloads = buildDigestPayloads({
      chores,
      config,
      localDate,
      type
    });
    const sender = options.sender || createDiscordSender(config, logger);
    let lastMessageId = null;
    for (const payload of payloads) {
      const sent = await sender(payload);
      lastMessageId = sent?.id || lastMessageId;
    }

    const record = updateNotificationDelivery(db, reservation.record.id, {
      status: 'sent',
      choreCount: chores.length,
      discordMessageId: lastMessageId
    });
    logger.info(`Discord ${type} reminder sent for ${localDate} with ${chores.length} chore(s).`);
    return { status: 'sent', record, payloads };
  } catch (error) {
    const safe = sanitizeError(error);
    const record = updateNotificationDelivery(db, reservation.record.id, {
      status: 'failed',
      choreCount,
      errorMessage: safe
    });
    logger.warn(`Discord ${type} reminder failed: ${safe}`);
    return { status: 'failed', record, error: safe };
  }
}

async function sendManualTestNotification(config, recipient, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - lastManualTestAt < TEST_COOLDOWN_MS && !options.ignoreCooldown) {
    const error = new Error('Please wait before sending another test notification.');
    error.code = 'COOLDOWN';
    throw error;
  }
  if (!config.webhookUrl) {
    const error = new Error('Discord webhook is not configured.');
    error.code = 'NOT_CONFIGURED';
    throw error;
  }

  const resolved = resolveRecipientMentions(recipient, config);
  if (!resolved.ok) {
    const error = new Error(resolved.message);
    error.code = 'BAD_RECIPIENT';
    throw error;
  }

  const localTime = formatLocalDateTime(options.now || new Date(), config.timezone);
  const content = [
    `${resolved.mentionLine}`,
    'Ansli Chores Discord notification test successful.',
    `Local time: ${localTime}`,
    `Open Ansli Chores:`,
    config.appPublicUrl
  ].join('\n');

  const payload = {
    content,
    allowed_mentions: {
      parse: [],
      users: resolved.userIds
    }
  };
  const sender = options.sender || createDiscordSender(config, options.logger || console);
  const result = await sender(payload);
  lastManualTestAt = nowMs;
  return { ok: true, messageId: result?.id || null };
}

function buildDigestPayloads({ chores, config, localDate, type }) {
  const sorted = [...chores].sort((a, b) => (
    a.nextDue.localeCompare(b.nextDue) ||
    a.assignedName.localeCompare(b.assignedName) ||
    a.name.localeCompare(b.name)
  ));
  const grouped = new Map();
  for (const chore of sorted) {
    const label = chore.assignedName || 'Unassigned';
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(chore);
  }

  const mentioned = new Set();
  const allAllowed = new Set();
  const heading = type === 'evening'
    ? `These chores are still outstanding this evening (${formatDisplayDate(localDate)}):`
    : `Good morning! Here are the chores that need attention today (${formatDisplayDate(localDate)}):`;
  const chunks = [[heading, '']];

  for (const [assignee, items] of grouped.entries()) {
    const mentionInfo = mentionsForAssignee(assignee, config, mentioned);
    mentionInfo.userIds.forEach((id) => allAllowed.add(id));
    const lines = [
      mentionInfo.line,
      ...items.map((chore) => `- ${sanitizeDiscordText(chore.name)} - ${duePhrase(chore.nextDue, localDate)}`)
    ];
    appendDigestBlock(chunks, lines.join('\n'));
  }

  appendDigestBlock(chunks, `Open Ansli Chores:\n${config.appPublicUrl}`);
  return chunks.map((lines) => ({
    content: lines.join('\n').trim(),
    allowed_mentions: {
      parse: [],
      users: [...allAllowed]
    }
  }));
}

function appendDigestBlock(chunks, block) {
  const current = chunks[chunks.length - 1];
  const nextLength = current.join('\n').length + block.length + 2;
  if (nextLength > 1800) {
    chunks.push([block, '']);
  } else {
    current.push(block, '');
  }
}

function mentionsForAssignee(assignee, config, mentioned) {
  if (assignee === 'All') {
    const ids = RECIPIENTS.map((name) => config.userIds[name]).filter(Boolean);
    const fresh = ids.filter((id) => !mentioned.has(id));
    fresh.forEach((id) => mentioned.add(id));
    return {
      line: fresh.length ? fresh.map((id) => `<@${id}>`).join(' ') : 'All Roommates',
      userIds: fresh
    };
  }

  const id = config.userIds[assignee];
  if (!id) {
    return {
      line: sanitizeDiscordText(assignee),
      userIds: []
    };
  }
  if (mentioned.has(id)) {
    return {
      line: sanitizeDiscordText(assignee),
      userIds: []
    };
  }
  mentioned.add(id);
  return {
    line: `<@${id}>`,
    userIds: [id]
  };
}

function duePhrase(dueDate, localDate) {
  if (dueDate === localDate) return 'due today';
  const days = daysBetween(dueDate, localDate);
  return `overdue by ${days} ${days === 1 ? 'day' : 'days'} (due ${dueDate})`;
}

function createDiscordSender(config, logger = console, fetchImpl = global.fetch) {
  return async (payload) => sendDiscordWebhook(config.webhookUrl, payload, { logger, fetchImpl });
}

async function sendDiscordWebhook(webhookUrl, payload, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
  const url = webhookUrl.includes('?') ? `${webhookUrl}&wait=true` : `${webhookUrl}?wait=true`;
  let attempt = 0;
  while (attempt < 3) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const text = await response.text();
      const data = parseJson(text);
      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(data?.retry_after || 1);
        await sleep(Math.min(Math.max(retryAfter * 1000, 250), 3000));
        continue;
      }
      if (!response.ok) {
        throw new Error(`Discord request failed with status ${response.status}.`);
      }
      return data || {};
    } catch (error) {
      if (attempt >= 3 || error.name === 'AbortError') {
        throw error.name === 'AbortError'
          ? new Error('Discord request timed out.')
          : error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Discord request failed.');
}

function startNotificationScheduler(db, config, options = {}) {
  const logger = options.logger || console;
  if (activeScheduler) return activeScheduler;
  if (!config.enabled) {
    logger.info('Discord reminders disabled by configuration.');
    return null;
  }
  if (!config.webhookUrl) {
    logger.info('Discord reminders unavailable: webhook not configured.');
    return null;
  }

  let running = false;
  const tick = async (reason = 'schedule') => {
    if (running) return;
    running = true;
    try {
      await runDueNotifications(db, config, { ...options, reason });
    } catch (error) {
      logger.warn(`Discord scheduler tick failed: ${sanitizeError(error)}`);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => tick('schedule'), options.intervalMs || 60000);
  activeScheduler = {
    stop() {
      clearInterval(interval);
      activeScheduler = null;
    },
    tick
  };
  setTimeout(() => tick('startup'), 1000).unref?.();
  return activeScheduler;
}

async function runDueNotifications(db, config, options = {}) {
  const now = options.now || new Date();
  const local = getLocalDateTimeParts(now, config.timezone);
  const sender = options.sender;
  const logger = options.logger || console;
  const checks = [
    { type: 'morning', enabled: true, time: config.morningTime },
    { type: 'evening', enabled: config.eveningEnabled, time: config.eveningTime }
  ];

  for (const check of checks) {
    if (!check.enabled) continue;
    const due = options.reason === 'startup'
      ? isWithinCatchupWindow(local.minutes, check.time, config.catchupWindowMinutes)
      : local.hhmm === check.time;
    if (!due) continue;
    await sendScheduledNotification(db, config, check.type, {
      sender,
      logger,
      now,
      localDate: local.date
    });
  }
}

function isWithinCatchupWindow(currentMinutes, time, windowMinutes) {
  const scheduled = timeToMinutes(time);
  return currentMinutes >= scheduled && currentMinutes <= scheduled + windowMinutes;
}

function resolveRecipientMentions(recipient, config) {
  if (recipient === 'all') {
    const ids = RECIPIENTS.map((name) => config.userIds[name]).filter(Boolean);
    if (ids.length !== RECIPIENTS.length) {
      return { ok: false, message: 'One or more roommate Discord mappings are not configured.' };
    }
    return {
      ok: true,
      mentionLine: ids.map((id) => `<@${id}>`).join(' '),
      userIds: ids
    };
  }

  const name = recipientName(recipient);
  if (!name) return { ok: false, message: 'Invalid notification test recipient.' };
  const id = config.userIds[name];
  if (!id) return { ok: false, message: `${name} Discord mapping is not configured.` };
  return {
    ok: true,
    mentionLine: `<@${id}>`,
    userIds: [id]
  };
}

function recipientName(value) {
  const normalized = String(value || '').toLowerCase();
  return RECIPIENTS.find((name) => name.toLowerCase() === normalized) || null;
}

function getLocalDate(date, timezone) {
  return getLocalDateTimeParts(date, timezone).date;
}

function getLocalDateTimeParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const dateOnly = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return {
    date: dateOnly,
    hhmm: `${parts.hour}:${parts.minute}`,
    minutes
  };
}

function formatLocalDateTime(date, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function validateTimezone(value, logger) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    logger.warn(`Invalid TZ; using ${DEFAULTS.timezone}.`);
    return DEFAULTS.timezone;
  }
}

function validateTime(value, fallback, name, logger) {
  if (!value) return fallback;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
  logger.warn(`Invalid ${name}; using ${fallback}.`);
  return fallback;
}

function validateInteger(value, fallback, name, logger) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 1440) return parsed;
  logger.warn(`Invalid ${name}; using ${fallback}.`);
  return fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
  if (['false', '0', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  return fallback;
}

function cleanEnv(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePublicUrl(value) {
  return value.replace(/\/+$/, '') || DEFAULTS.appPublicUrl;
}

function safeDeliveryStatus(record) {
  if (!record) return null;
  return {
    date: record.localDate,
    status: record.status,
    choreCount: record.choreCount,
    scheduledTime: record.scheduledTime,
    updatedAt: record.updatedAt
  };
}

function sanitizeDiscordText(value) {
  return String(value || '')
    .replace(/@/g, '@\u200b')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function sanitizeError(error) {
  return String(error?.message || error || 'Unknown notification error.')
    .replace(/https?:\/\/\S+/g, '[redacted-url]')
    .slice(0, 400);
}

function formatDisplayDate(dateOnly) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return `${month}/${day}/${year}`;
}

function daysBetween(start, end) {
  return Math.round((dateOnlyUtcMs(end) - dateOnlyUtcMs(start)) / 86400000);
}

function dateOnlyUtcMs(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetNotificationTestState() {
  lastManualTestAt = 0;
  activeScheduler?.stop();
  activeScheduler = null;
}

module.exports = {
  DEFAULTS,
  RECIPIENTS,
  TEST_COOLDOWN_MS,
  buildDigestPayloads,
  createDiscordSender,
  duePhrase,
  getLocalDate,
  getLocalDateTimeParts,
  getNotificationStatus,
  isWithinCatchupWindow,
  loadNotificationConfig,
  resetNotificationTestState,
  resolveRecipientMentions,
  runDueNotifications,
  sanitizeDiscordText,
  sendDiscordWebhook,
  sendManualTestNotification,
  sendScheduledNotification,
  startNotificationScheduler
};

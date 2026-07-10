'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  completeChore,
  correctHistory,
  createChore,
  deleteArchivedChore,
  deleteHistory,
  getChore,
  getLastUpdated,
  getRoommate,
  getRoommates,
  listCalendarChores,
  listCalendarHistory,
  listChores,
  listHistory,
  openDatabase,
  setArchived,
  updateChore
} = require('./db');
const { addDays, isValidDate, normalizeNullableDate, todayLocal } = require('./dateUtils');

function createApp(db = openDatabase()) {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    extensions: ['html'],
    maxAge: '1h'
  }));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      database: 'ok'
    });
  });

  app.get('/api/roommates', (req, res) => {
    res.json({ roommates: getRoommates(db) });
  });

  app.get('/api/dashboard', (req, res) => {
    const today = isValidDate(req.query.today) ? req.query.today : todayLocal();
    const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'next_due';
    const selectedRoommateId = parseOptionalId(req.query.roommateId);
    if (req.query.roommateId && !selectedRoommateId) {
      return sendError(res, 400, 'Invalid roommate id.');
    }

    const chores = listChores(db).map((chore) => decorateChore(chore, today));
    const filtered = filterChores(chores, filter, selectedRoommateId, today);
    sortChores(filtered, sort);

    res.json({
      today,
      summary: summarizeChores(chores, today),
      chores: filtered,
      lastUpdated: getLastUpdated(db)
    });
  });

  app.get('/api/calendar', (req, res) => {
    const parsed = validateCalendarQuery(db, req.query);
    if (!parsed.ok) return sendError(res, 400, parsed.message);

    const filters = parsed.filters;
    const chores = listCalendarChores(db, filters)
      .map((chore) => decorateChore(chore, filters.today))
      .map((chore) => ({
        ...chore,
        type: 'due',
        calendarDate: chore.nextDue
      }));

    const completed = filters.showCompleted
      ? listCalendarHistory(db, filters).map((record) => ({
          ...record,
          type: 'completed',
          status: 'Completed',
          calendarDate: record.completedDate
        }))
      : [];

    res.json({
      start: filters.start,
      end: filters.end,
      today: filters.today,
      view: filters.view,
      roommates: getRoommates(db),
      chores,
      completed,
      overdue: chores.filter((chore) => chore.nextDue < filters.today),
      lastUpdated: getLastUpdated(db)
    });
  });

  app.get('/api/chores', (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    const today = isValidDate(req.query.today) ? req.query.today : todayLocal();
    res.json({
      chores: listChores(db, { includeArchived }).map((chore) => decorateChore(chore, today)),
      lastUpdated: getLastUpdated(db)
    });
  });

  app.post('/api/chores', (req, res) => {
    const parsed = validateChorePayload(db, req.body);
    if (!parsed.ok) return sendError(res, 400, parsed.message);
    const chore = createChore(db, parsed.data);
    res.status(201).json({ chore });
  });

  app.put('/api/chores/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid chore id.');
    if (!getChore(db, id)) return sendError(res, 404, 'Chore not found.');

    const parsed = validateChorePayload(db, req.body);
    if (!parsed.ok) return sendError(res, 400, parsed.message);
    res.json({ chore: updateChore(db, id, parsed.data) });
  });

  app.post('/api/chores/:id/archive', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid chore id.');
    if (!getChore(db, id)) return sendError(res, 404, 'Chore not found.');
    res.json({ chore: setArchived(db, id, true) });
  });

  app.post('/api/chores/:id/restore', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid chore id.');
    if (!getChore(db, id)) return sendError(res, 404, 'Chore not found.');
    res.json({ chore: setArchived(db, id, false) });
  });

  app.delete('/api/chores/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid chore id.');
    const result = deleteArchivedChore(db, id);
    if (result.reason === 'not_found') return sendError(res, 404, 'Chore not found.');
    if (result.reason === 'not_archived') {
      return sendError(res, 409, 'Archive the chore before permanently deleting it.');
    }
    res.json({ ok: true });
  });

  app.post('/api/chores/:id/complete', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid chore id.');

    const parsed = validateCompletionPayload(db, req.body);
    if (!parsed.ok) return sendError(res, 400, parsed.message);

    const result = completeChore(db, id, parsed.data);
    if (!result) return sendError(res, 404, 'Active chore not found.');
    res.status(201).json(result);
  });

  app.get('/api/history', (req, res) => {
    const parsed = validateHistoryFilters(req.query);
    if (!parsed.ok) return sendError(res, 400, parsed.message);
    res.json({ history: listHistory(db, parsed.filters) });
  });

  app.put('/api/history/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid history id.');

    const parsed = validateCompletionPayload(db, req.body);
    if (!parsed.ok) return sendError(res, 400, parsed.message);
    const record = correctHistory(db, id, parsed.data);
    if (!record) return sendError(res, 404, 'History record not found.');
    res.json({ history: record });
  });

  app.delete('/api/history/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'Invalid history id.');
    const result = deleteHistory(db, id);
    if (result.reason === 'not_found') return sendError(res, 404, 'History record not found.');
    res.json({ ok: true, restoredChore: result.restoredChore });
  });

  app.get('/api/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="ansli-chores-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      roommates: getRoommates(db, true),
      chores: listChores(db, { includeArchived: true }),
      history: listHistory(db)
    });
  });

  app.get('/api/backup', async (req, res, next) => {
    const backupFile = path.join(os.tmpdir(), `ansli-chores-${Date.now()}.sqlite`);
    try {
      await db.backup(backupFile);
      res.download(backupFile, 'ansli-chores.sqlite', (error) => {
        fs.rm(backupFile, { force: true }, () => {});
        if (error) next(error);
      });
    } catch (error) {
      fs.rm(backupFile, { force: true }, () => {});
      next(error);
    }
  });

  app.use('/api', (req, res) => sendError(res, 404, 'API endpoint not found.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    sendError(res, 500, 'Something went wrong.');
  });

  return app;
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  next();
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseOptionalId(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseId(value);
}

function validateChorePayload(db, body) {
  if (!body || typeof body !== 'object') return invalid('Invalid chore payload.');

  const name = cleanText(body.name, 120);
  if (!name) return invalid('Chore name is required.');

  const assignedTo = body.assignedTo === null || body.assignedTo === '' || body.assignedTo === 'all'
    ? null
    : parseId(body.assignedTo);
  if (assignedTo !== null && !getRoommate(db, assignedTo)) return invalid('Assigned roommate is invalid.');

  const frequencyCount = Number(body.frequencyCount);
  if (!Number.isInteger(frequencyCount) || frequencyCount < 1 || frequencyCount > 24) {
    return invalid('Frequency count must be a positive integer no larger than 24.');
  }
  const frequencyUnit = body.frequencyUnit;
  if (!['week', 'month'].includes(frequencyUnit)) return invalid('Frequency unit must be week or month.');

  const lastDone = normalizeNullableDate(body.lastDone);
  if (body.lastDone && !lastDone) return invalid('Last completed date is invalid.');
  const nextDue = normalizeNullableDate(body.nextDue);
  if (!nextDue) return invalid('Next due date is required and must use YYYY-MM-DD.');

  const notes = cleanText(body.notes || '', 1000);
  const rotationEnabled = Boolean(body.rotationEnabled);
  const rotationIds = validateRotationIds(db, body.rotationIds || []);
  if (!rotationIds.ok) return invalid(rotationIds.message);
  if (rotationEnabled && rotationIds.ids.length < 2) {
    return invalid('Rotation requires at least two roommates.');
  }

  return {
    ok: true,
    data: {
      name,
      assignedTo,
      frequencyCount,
      frequencyUnit,
      lastDone,
      nextDue,
      notes,
      rotationEnabled,
      rotationIds: rotationEnabled ? rotationIds.ids : []
    }
  };
}

function validateRotationIds(db, ids) {
  if (!Array.isArray(ids)) return invalid('Rotation must be a list of roommates.');
  const parsed = ids.map(parseId);
  if (parsed.some((id) => !id)) return invalid('Rotation contains an invalid roommate.');
  if (new Set(parsed).size !== parsed.length) return invalid('Rotation cannot contain duplicates.');
  for (const id of parsed) {
    if (!getRoommate(db, id)) return invalid('Rotation contains an unknown roommate.');
  }
  return { ok: true, ids: parsed };
}

function validateCompletionPayload(db, body) {
  if (!body || typeof body !== 'object') return invalid('Invalid completion payload.');
  const completedBy = parseId(body.completedBy);
  if (!completedBy || !getRoommate(db, completedBy)) return invalid('Completed-by roommate is invalid.');
  const completedDate = normalizeNullableDate(body.completedDate);
  if (!completedDate) return invalid('Completion date is required and must use YYYY-MM-DD.');
  return {
    ok: true,
    data: {
      completedBy,
      completedDate,
      completionNote: cleanText(body.completionNote || '', 1000)
    }
  };
}

function validateHistoryFilters(query) {
  const roommateId = parseOptionalId(query.roommateId);
  const choreId = parseOptionalId(query.choreId);
  if (query.roommateId && !roommateId) return invalid('Invalid roommate filter.');
  if (query.choreId && !choreId) return invalid('Invalid chore filter.');
  if (query.from && !isValidDate(query.from)) return invalid('Invalid from date.');
  if (query.to && !isValidDate(query.to)) return invalid('Invalid to date.');
  return {
    ok: true,
    filters: {
      roommateId,
      choreId,
      from: query.from || null,
      to: query.to || null
    }
  };
}

function validateCalendarQuery(db, query) {
  const start = stringQueryValue(query.start);
  const end = stringQueryValue(query.end);
  if (!isValidDate(start)) return invalid('Start date is required and must use YYYY-MM-DD.');
  if (!isValidDate(end)) return invalid('End date is required and must use YYYY-MM-DD.');
  if (start > end) return invalid('Start date must be before or equal to end date.');
  if (daysBetween(start, end) > 370) return invalid('Calendar date range cannot exceed 370 days.');

  const todayValue = stringQueryValue(query.today);
  if (todayValue && !isValidDate(todayValue)) return invalid('Today must use YYYY-MM-DD.');

  const view = stringQueryValue(query.view) || 'month';
  if (!['month', 'week'].includes(view)) return invalid('Calendar view must be month or week.');

  const status = stringQueryValue(query.status) || 'all';
  if (!['all', 'overdue'].includes(status)) return invalid('Calendar status filter must be all or overdue.');

  const roommateRaw = stringQueryValue(query.roommateId);
  const roommateId = parseOptionalId(roommateRaw);
  if (roommateRaw && !roommateId) return invalid('Invalid roommate filter.');
  if (roommateId && !getRoommate(db, roommateId)) return invalid('Roommate filter was not found.');

  const includeAll = parseBooleanQuery(query.includeAll, true);
  if (includeAll === null) return invalid('includeAll must be true or false.');
  const showCompleted = parseBooleanQuery(query.showCompleted, false);
  if (showCompleted === null) return invalid('showCompleted must be true or false.');

  return {
    ok: true,
    filters: {
      start,
      end,
      today: todayValue || todayLocal(),
      view,
      status,
      roommateId,
      includeAll,
      showCompleted,
      overdueOnly: status === 'overdue'
    }
  };
}

function stringQueryValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parseBooleanQuery(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

function daysBetween(start, end) {
  return Math.round((dateOnlyUtcMs(end) - dateOnlyUtcMs(start)) / 86400000);
}

function dateOnlyUtcMs(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function invalid(message) {
  return { ok: false, message };
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

function decorateChore(chore, today) {
  const status = getStatus(chore.nextDue, today);
  return {
    ...chore,
    status,
    upcomingRotation: getUpcomingRotation(chore)
  };
}

function getStatus(nextDue, today) {
  if (nextDue < today) return 'Overdue';
  if (nextDue === today) return 'Due Today';
  if (nextDue <= addDays(today, 7)) return 'Due Soon';
  return 'Upcoming';
}

function getUpcomingRotation(chore) {
  if (!chore.rotationEnabled || chore.rotation.length === 0) return '';
  const names = chore.rotation.map((person) => person.name);
  const currentIndex = chore.rotation.findIndex((person) => person.id === chore.assignedTo);
  const nextName = currentIndex === -1 ? names[0] : names[(currentIndex + 1) % names.length];
  return `${names.join(' -> ')}; next after completion: ${nextName}`;
}

function summarizeChores(chores, today) {
  const monthStart = today.slice(0, 8) + '01';
  return {
    overdue: chores.filter((chore) => chore.nextDue < today).length,
    dueToday: chores.filter((chore) => chore.nextDue === today).length,
    dueNext7Days: chores.filter((chore) => chore.nextDue >= today && chore.nextDue <= addDays(today, 7)).length,
    completedThisMonth: chores.filter((chore) => chore.lastDone && chore.lastDone >= monthStart && chore.lastDone <= today).length
  };
}

function filterChores(chores, filter, roommateId, today) {
  const sevenDaysOut = addDays(today, 7);
  if (filter === 'my') {
    return chores.filter((chore) => roommateId && (chore.assignedTo === roommateId || chore.assignedTo === null));
  }
  if (filter === 'overdue') return chores.filter((chore) => chore.nextDue < today);
  if (filter === 'today') return chores.filter((chore) => chore.nextDue === today);
  if (filter === 'upcoming') return chores.filter((chore) => chore.nextDue > today && chore.nextDue <= sevenDaysOut);
  if (filter === 'recent') return chores.filter((chore) => chore.lastDone && chore.lastDone >= addDays(today, -14));
  return chores;
}

function sortChores(chores, sort) {
  const sorters = {
    next_due: (a, b) => a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name),
    assignee: (a, b) => a.assignedName.localeCompare(b.assignedName) || a.nextDue.localeCompare(b.nextDue),
    name: (a, b) => a.name.localeCompare(b.name),
    status: (a, b) => statusRank(a.status) - statusRank(b.status) || a.nextDue.localeCompare(b.nextDue)
  };
  chores.sort(sorters[sort] || sorters.next_due);
}

function statusRank(status) {
  return {
    Overdue: 0,
    'Due Today': 1,
    'Due Soon': 2,
    Upcoming: 3
  }[status] ?? 4;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 80;
  const app = createApp();
  app.listen(port, () => {
    console.log(`Ansli Chores is running at http://localhost:${port}`);
  });
}

module.exports = { createApp };

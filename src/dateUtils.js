'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (value === null || value === undefined || value === '') return false;
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function normalizeNullableDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!isValidDate(value)) return null;
  return value;
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function daysInMonth(year, monthOneBased) {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
}

function addCalendarMonths(dateString, count) {
  const [year, month, day] = dateString.split('-').map(Number);
  const zeroBasedTotal = (year * 12) + (month - 1) + count;
  const targetYear = Math.floor(zeroBasedTotal / 12);
  const targetMonthZero = zeroBasedTotal % 12;
  const targetMonth = targetMonthZero + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

function addFrequency(dateString, count, unit) {
  if (!isValidDate(dateString)) {
    throw new Error('A valid completion date is required.');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Frequency count must be a positive integer.');
  }
  if (unit === 'week') return addDays(dateString, count * 7);
  if (unit === 'month') return addCalendarMonths(dateString, count);
  throw new Error('Unsupported frequency unit.');
}

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function compareDates(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

module.exports = {
  addFrequency,
  addCalendarMonths,
  addDays,
  compareDates,
  isValidDate,
  normalizeNullableDate,
  todayLocal
};

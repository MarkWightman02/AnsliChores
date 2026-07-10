'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addFrequency, isValidDate } = require('../src/dateUtils');

test('weekly frequency adds seven-day intervals from completion date', () => {
  assert.equal(addFrequency('2026-07-10', 1, 'week'), '2026-07-17');
  assert.equal(addFrequency('2026-07-10', 2, 'week'), '2026-07-24');
});

test('monthly frequency clamps to the last day of shorter months', () => {
  assert.equal(addFrequency('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(addFrequency('2028-01-31', 1, 'month'), '2028-02-29');
});

test('date validation rejects impossible dates', () => {
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('07/10/2026'), false);
});

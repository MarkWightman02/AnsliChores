'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('dashboard and calendar pages include mobile viewport and theme metadata', () => {
  for (const file of ['public/index.html', 'public/calendar.html']) {
    const html = read(file);
    assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /name="apple-mobile-web-app-title"/);
  }
});

test('shared mobile bottom navigation is present on dashboard and calendar', () => {
  const dashboard = read('public/index.html');
  const calendar = read('public/calendar.html');
  for (const html of [dashboard, calendar]) {
    assert.match(html, /class="bottom-nav"/);
    assert.match(html, />Home</);
    assert.match(html, />Calendar</);
    assert.match(html, />Activity</);
    assert.match(html, />Manage</);
  }
});

test('dashboard exposes mobile filter sheet controls', () => {
  const html = read('public/index.html');
  assert.match(html, /id="filter-sheet-button"/);
  assert.match(html, /id="filter-dialog"/);
  assert.match(html, /id="mobile-filter-select"/);
  assert.match(html, /id="mobile-sort-select"/);
  assert.match(html, /Reset Filters/);
});

test('calendar script supports selected-day agenda behavior', () => {
  const js = read('public/calendar.js');
  const css = read('public/calendar.css');
  assert.match(js, /selectedDate/);
  assert.match(js, /function selectDate/);
  assert.match(js, /Agenda for/);
  assert.match(js, /agenda-complete-button/);
  assert.match(css, /selected-day/);
});

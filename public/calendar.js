'use strict';

const state = {
  roommates: [],
  chores: [],
  completed: [],
  overdue: [],
  selectedEntry: null,
  selectedChore: null,
  editingChoreId: null,
  completingChoreId: null,
  rotationDraft: [],
  view: localStorage.getItem('ansli:calendarView') || 'month',
  anchorDate: todayString(),
  selectedDate: todayString(),
  currentRange: null,
  roommateId: localStorage.getItem('ansli:calendarRoommate') || '',
  status: localStorage.getItem('ansli:calendarStatus') || 'all',
  includeAll: localStorage.getItem('ansli:calendarIncludeAll') !== 'false',
  showCompleted: localStorage.getItem('ansli:calendarShowCompleted') === 'true'
};

const $ = (selector) => document.querySelector(selector);
let lastFocusedElement = null;

document.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();
  hydrateStateFromUrl();
  bindEvents();
  loadInitialData();
});

function bindEvents() {
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#previous-period').addEventListener('click', () => movePeriod(-1));
  $('#next-period').addEventListener('click', () => movePeriod(1));
  $('#today-button').addEventListener('click', () => {
    state.anchorDate = todayString();
    state.selectedDate = state.anchorDate;
    loadCalendar(true);
  });
  document.querySelectorAll('[data-calendar-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.calendarView;
      localStorage.setItem('ansli:calendarView', state.view);
      loadCalendar(true);
    });
  });
  $('#roommate-filter').addEventListener('change', (event) => {
    state.roommateId = event.target.value;
    localStorage.setItem('ansli:calendarRoommate', state.roommateId);
    loadCalendar();
  });
  $('#status-filter').addEventListener('change', (event) => {
    state.status = event.target.value;
    localStorage.setItem('ansli:calendarStatus', state.status);
    loadCalendar();
  });
  $('#include-all-filter').addEventListener('change', (event) => {
    state.includeAll = event.target.checked;
    localStorage.setItem('ansli:calendarIncludeAll', String(state.includeAll));
    loadCalendar();
  });
  $('#show-completed-filter').addEventListener('change', (event) => {
    state.showCompleted = event.target.checked;
    localStorage.setItem('ansli:calendarShowCompleted', String(state.showCompleted));
    loadCalendar();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
  });
  $('#detail-complete').addEventListener('click', () => {
    if (!state.selectedChore) return;
    closeDialog('detail-dialog');
    openCompleteDialog(state.selectedChore.id);
  });
  $('#detail-edit').addEventListener('click', () => {
    if (!state.selectedChore) return;
    closeDialog('detail-dialog');
    openChoreDialog(state.selectedChore);
  });
  $('#complete-form').addEventListener('submit', submitCompletion);
  $('#chore-form').addEventListener('submit', submitChore);
  $('#rotation-enabled').addEventListener('change', renderRotationEditor);
  window.addEventListener('popstate', () => {
    hydrateStateFromUrl();
    syncControls();
    loadCalendar();
  });
}

async function loadInitialData() {
  setLoading(true);
  try {
    const data = await api('/api/roommates');
    state.roommates = data.roommates;
    renderRoommateOptions();
    syncControls();
    await loadCalendar();
  } catch (error) {
    showError(error.message);
    toast(error.message, true);
  } finally {
    setLoading(false);
  }
}

async function loadCalendar(pushUrl = false) {
  const range = getVisibleRange();
  updateUrl(pushUrl);
  setLoading(true);
  hideError();
  try {
    const params = new URLSearchParams({
      start: range.start,
      end: range.end,
      today: todayString(),
      view: state.view,
      status: state.status,
      includeAll: String(state.includeAll),
      showCompleted: String(state.showCompleted)
    });
    if (state.roommateId) params.set('roommateId', state.roommateId);

    const data = await api(`/api/calendar?${params}`);
    state.chores = data.chores;
    state.completed = data.completed;
    state.overdue = data.overdue;
    if (data.roommates?.length) {
      state.roommates = data.roommates;
      renderRoommateOptions();
    }
    renderCalendar(range, data);
  } catch (error) {
    showError(error.message);
    toast(error.message, true);
  } finally {
    setLoading(false);
  }
}

function renderCalendar(range, data) {
  state.currentRange = range;
  syncControls();
  $('#calendar-title').textContent = range.title;
  $('#calendar-updated').textContent = `Last updated: ${formatDateTime(data.lastUpdated)}`;
  renderOverdueSummary();
  renderGrid(range);
  renderAgenda(range);
}

function renderOverdueSummary() {
  const container = $('#overdue-summary');
  if (!state.overdue.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  const title = document.createElement('h2');
  title.textContent = `${state.overdue.length} overdue chore${state.overdue.length === 1 ? '' : 's'}`;
  const help = document.createElement('p');
  help.className = 'muted';
  help.textContent = 'Overdue chores stay on their original due dates.';

  const list = document.createElement('div');
  list.className = 'overdue-list';
  state.overdue.slice(0, 5).forEach((chore) => {
    const button = el('button', `${chore.name} - due ${formatDate(chore.nextDue)} - ${chore.assignedName}`, 'secondary-button');
    button.type = 'button';
    button.addEventListener('click', () => openChoreDetail(chore));
    list.append(button);
  });
  if (state.overdue.length > 5) {
    list.append(el('p', `${state.overdue.length - 5} more overdue chores are visible in the calendar or agenda.`, 'muted'));
  }

  container.replaceChildren(title, help, list);
  container.hidden = false;
}

function renderGrid(range) {
  const grid = $('#calendar-grid');
  grid.classList.toggle('week-view', state.view === 'week');
  const dates = daysInRange(range.start, range.end);
  const periodMonth = parseDateOnly(state.anchorDate).getMonth();
  grid.replaceChildren(...dates.map((dateKey) => renderDayCell(dateKey, periodMonth)));
}

function renderDayCell(dateKey, periodMonth) {
  const dayDate = parseDateOnly(dateKey);
  const cell = document.createElement('section');
  cell.className = 'calendar-day';
  if (dateKey === todayString()) cell.classList.add('today');
  if (dateKey === state.selectedDate) cell.classList.add('selected-day');
  if (state.view === 'month' && dayDate.getMonth() !== periodMonth) cell.classList.add('outside-period');
  cell.setAttribute('aria-label', formatLongDate(dateKey));

  const header = document.createElement('div');
  header.className = 'date-header';
  const dateButton = el('button', String(dayDate.getDate()), 'date-button');
  dateButton.type = 'button';
  dateButton.setAttribute('aria-label', `Select ${formatLongDate(dateKey)}`);
  if (dateKey === state.selectedDate) dateButton.setAttribute('aria-current', 'date');
  dateButton.addEventListener('click', () => selectDate(dateKey));
  header.append(dateButton);
  if (dateKey === todayString()) header.append(el('span', 'Today', 'today-label'));

  const entryList = document.createElement('div');
  entryList.className = 'entry-list';
  const entries = entriesForDate(dateKey);
  const visible = entries.slice(0, 3);
  visible.forEach((entry) => entryList.append(renderCalendarEntry(entry)));
  if (entries.length > visible.length) {
    const more = el('button', `+${entries.length - visible.length} more`, 'more-indicator');
    more.type = 'button';
    more.addEventListener('click', () => $('#agenda-title').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    entryList.append(more);
  }

  cell.append(header, entryList);
  return cell;
}

function renderCalendarEntry(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `calendar-entry ${entryClass(entry)}`;
  button.append(el('strong', entryTitle(entry)), el('span', entrySubtitle(entry)));
  button.addEventListener('click', () => openEntryDetail(entry));
  return button;
}

function renderAgenda(range) {
  const list = $('#agenda-list');
  const mobile = isMobileCalendar();
  const entries = allEntries()
    .filter((entry) => {
      if (mobile) return entry.calendarDate === state.selectedDate;
      return entry.calendarDate >= range.start && entry.calendarDate <= range.end;
    })
    .sort((a, b) => a.calendarDate.localeCompare(b.calendarDate) || entryTitle(a).localeCompare(entryTitle(b)));

  $('#agenda-title').textContent = mobile
    ? `Agenda for ${formatLongDate(state.selectedDate)}`
    : 'Agenda';

  if (!entries.length) {
    renderEmpty(list, mobile ? 'No chores are scheduled for this date.' : 'No chores are scheduled for this period.');
    return;
  }

  const grouped = new Map();
  entries.forEach((entry) => {
    if (!grouped.has(entry.calendarDate)) grouped.set(entry.calendarDate, []);
    grouped.get(entry.calendarDate).push(entry);
  });

  const groups = [];
  grouped.forEach((items, dateKey) => {
    const section = document.createElement('article');
    section.className = 'agenda-day';
    section.append(el('h3', formatLongDate(dateKey)));
    items.forEach((entry) => section.append(renderAgendaEntry(entry)));
    groups.push(section);
  });
  list.replaceChildren(...groups);
}

function renderAgendaEntry(entry) {
  const card = document.createElement('article');
  card.className = `agenda-entry ${entryClass(entry)}`;

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'agenda-entry-main';
  main.append(el('strong', entryTitle(entry)), el('span', entrySubtitle(entry)));
  main.addEventListener('click', () => openEntryDetail(entry));
  card.append(main);

  if (entry.type !== 'completed') {
    const complete = el('button', 'Mark Complete', 'primary-button agenda-complete-button');
    complete.type = 'button';
    complete.addEventListener('click', () => openCompleteDialog(entry.id));
    card.append(complete);
  }

  return card;
}

function openEntryDetail(entry) {
  state.selectedEntry = entry;
  if (entry.type === 'completed') {
    openCompletedDetail(entry);
    return;
  }
  openChoreDetail(entry);
}

function openChoreDetail(chore) {
  state.selectedChore = chore;
  $('#detail-title').textContent = chore.name;
  $('#detail-content').replaceChildren(
    detailItem('Assigned', chore.assignedName),
    detailItem('Status', chore.status),
    detailItem('Last completed', formatDate(chore.lastDone)),
    detailItem('Next due', formatDate(chore.nextDue)),
    detailItem('Frequency', chore.frequencyLabel)
  );
  $('#detail-notes').textContent = chore.notes || '';
  $('#detail-notes').hidden = !chore.notes;
  $('#detail-rotation').textContent = chore.upcomingRotation || '';
  $('#detail-rotation').hidden = !chore.upcomingRotation;
  $('#detail-complete').hidden = false;
  $('#detail-edit').hidden = false;
  openDialog('detail-dialog');
}

function openCompletedDetail(record) {
  state.selectedChore = null;
  $('#detail-title').textContent = record.choreName;
  $('#detail-content').replaceChildren(
    detailItem('Type', 'Completed'),
    detailItem('Completed by', record.completedByName),
    detailItem('Completed date', formatDate(record.completedDate)),
    detailItem('Recorded', formatDateTime(record.createdAt))
  );
  $('#detail-notes').textContent = record.completionNote || '';
  $('#detail-notes').hidden = !record.completionNote;
  $('#detail-rotation').hidden = true;
  $('#detail-complete').hidden = true;
  $('#detail-edit').hidden = true;
  openDialog('detail-dialog');
}

function detailItem(label, value) {
  const item = document.createElement('div');
  item.className = 'detail-row';
  item.append(el('span', label), el('strong', value || 'Not set'));
  return item;
}

function openCompleteDialog(choreId) {
  const chore = state.chores.find((item) => item.id === choreId);
  state.completingChoreId = choreId;
  $('#complete-chore-name').textContent = chore ? chore.name : '';
  $('#complete-date').value = todayString();
  $('#complete-by').value = preferredRoommateId();
  $('#complete-note').value = '';
  openDialog('complete-dialog');
}

async function submitCompletion(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonBusy(button, true);
  try {
    await api(`/api/chores/${state.completingChoreId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        completedDate: $('#complete-date').value,
        completedBy: Number($('#complete-by').value),
        completionNote: $('#complete-note').value
      })
    });
    closeDialog('complete-dialog');
    toast('Completion saved.');
    await loadCalendar();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false);
  }
}

function openChoreDialog(chore) {
  if (!chore) return;
  state.editingChoreId = chore.id;
  $('#chore-name').value = chore.name || '';
  $('#chore-assigned').value = chore.assignedTo ? String(chore.assignedTo) : 'all';
  ensureFrequencyOption(chore.frequencyCount, chore.frequencyUnit);
  $('#chore-frequency').value = `${chore.frequencyCount}:${chore.frequencyUnit}`;
  $('#chore-last-done').value = chore.lastDone || '';
  $('#chore-next-due').value = chore.nextDue || todayString();
  $('#chore-notes').value = chore.notes || '';
  $('#rotation-enabled').checked = Boolean(chore.rotationEnabled);
  state.rotationDraft = chore.rotation?.length
    ? chore.rotation.map((person) => person.id)
    : state.roommates.map((person) => person.id);
  renderRotationEditor();
  openDialog('chore-dialog');
}

function renderRotationEditor() {
  const list = $('#rotation-list');
  const enabled = $('#rotation-enabled').checked;
  list.hidden = !enabled;
  if (!enabled) {
    list.replaceChildren();
    return;
  }

  const idsInDraft = new Set(state.rotationDraft);
  const ordered = [
    ...state.rotationDraft.map((id) => state.roommates.find((person) => person.id === id)).filter(Boolean),
    ...state.roommates.filter((person) => !idsInDraft.has(person.id))
  ];

  list.replaceChildren(...ordered.map((person, index) => {
    const row = document.createElement('div');
    row.className = 'rotation-row';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.rotationDraft.includes(person.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.rotationDraft.push(person.id);
      else state.rotationDraft = state.rotationDraft.filter((id) => id !== person.id);
      renderRotationEditor();
    });
    label.append(checkbox, el('span', person.name));

    const actions = document.createElement('div');
    actions.className = 'mini-actions';
    const up = el('button', 'Up');
    up.type = 'button';
    up.disabled = index === 0 || !state.rotationDraft.includes(person.id);
    up.addEventListener('click', () => moveRotation(person.id, -1));
    const down = el('button', 'Down');
    down.type = 'button';
    down.disabled = index >= state.rotationDraft.length - 1 || !state.rotationDraft.includes(person.id);
    down.addEventListener('click', () => moveRotation(person.id, 1));
    actions.append(up, down);
    row.append(label, actions);
    return row;
  }));
}

function moveRotation(id, direction) {
  const index = state.rotationDraft.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.rotationDraft.length) return;
  [state.rotationDraft[index], state.rotationDraft[target]] = [state.rotationDraft[target], state.rotationDraft[index]];
  renderRotationEditor();
}

async function submitChore(event) {
  event.preventDefault();
  const [frequencyCount, frequencyUnit] = $('#chore-frequency').value.split(':');
  const payload = {
    name: $('#chore-name').value,
    assignedTo: $('#chore-assigned').value === 'all' ? null : Number($('#chore-assigned').value),
    frequencyCount: Number(frequencyCount),
    frequencyUnit,
    lastDone: $('#chore-last-done').value || null,
    nextDue: $('#chore-next-due').value,
    notes: $('#chore-notes').value,
    rotationEnabled: $('#rotation-enabled').checked,
    rotationIds: $('#rotation-enabled').checked ? state.rotationDraft : []
  };
  const button = event.submitter;
  setButtonBusy(button, true);
  try {
    await api(`/api/chores/${state.editingChoreId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    closeDialog('chore-dialog');
    toast('Chore saved.');
    await loadCalendar();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false);
  }
}

function renderRoommateOptions() {
  const options = [
    { value: '', label: 'All roommates' },
    ...state.roommates.map((person) => ({ value: String(person.id), label: person.name }))
  ];
  fillSelect($('#roommate-filter'), options);
  fillSelect($('#complete-by'), state.roommates.map((person) => ({ value: String(person.id), label: person.name })));
  fillSelect($('#chore-assigned'), [
    { value: 'all', label: 'All' },
    ...state.roommates.map((person) => ({ value: String(person.id), label: person.name }))
  ]);
  if (state.roommateId && !state.roommates.some((person) => String(person.id) === state.roommateId)) {
    state.roommateId = '';
  }
}

function syncControls() {
  document.querySelectorAll('[data-calendar-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.calendarView === state.view);
  });
  $('#roommate-filter').value = state.roommateId;
  $('#status-filter').value = state.status;
  $('#include-all-filter').checked = state.includeAll;
  $('#show-completed-filter').checked = state.showCompleted;
}

function fillSelect(select, options) {
  const previous = select.value;
  select.replaceChildren();
  options.forEach((option) => {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  });
  if (options.some((option) => option.value === previous)) select.value = previous;
}

function ensureFrequencyOption(count, unit) {
  const select = $('#chore-frequency');
  const value = `${count}:${unit}`;
  if ([...select.options].some((option) => option.value === value)) return;
  const option = document.createElement('option');
  option.value = value;
  option.textContent = unit === 'week'
    ? `Every ${count} Weeks`
    : `Every ${count} Months`;
  select.append(option);
}

function preferredRoommateId() {
  const dashboardPreference = localStorage.getItem('ansli:selectedRoommate');
  if (state.roommateId) return state.roommateId;
  if (dashboardPreference && state.roommates.some((person) => String(person.id) === dashboardPreference)) {
    return dashboardPreference;
  }
  return String(state.roommates[0]?.id || '');
}

function allEntries() {
  return [
    ...state.chores,
    ...(state.showCompleted ? state.completed : [])
  ];
}

function entriesForDate(dateKey) {
  return allEntries()
    .filter((entry) => entry.calendarDate === dateKey)
    .sort((a, b) => entrySortRank(a) - entrySortRank(b) || entryTitle(a).localeCompare(entryTitle(b)));
}

function entrySortRank(entry) {
  if (entry.type === 'completed') return 4;
  return {
    Overdue: 0,
    'Due Today': 1,
    'Due Soon': 2,
    Upcoming: 3
  }[entry.status] ?? 5;
}

function entryTitle(entry) {
  return entry.type === 'completed' ? entry.choreName : entry.name;
}

function entrySubtitle(entry) {
  if (entry.type === 'completed') {
    const note = entry.completionNote ? ` - ${entry.completionNote}` : '';
    return `Completed by ${entry.completedByName}${note}`;
  }
  return `${entry.assignedName} - ${entry.status} - ${entry.frequencyLabel}`;
}

function entryClass(entry) {
  return entry.type === 'completed' ? 'completed' : slug(entry.status);
}

function movePeriod(direction) {
  state.anchorDate = state.view === 'month'
    ? addMonths(state.anchorDate, direction)
    : addDays(state.anchorDate, direction * 7);
  state.selectedDate = state.anchorDate;
  loadCalendar(true);
}

function selectDate(dateKey) {
  state.anchorDate = dateKey;
  state.selectedDate = dateKey;
  if (!state.currentRange || dateKey < state.currentRange.start || dateKey > state.currentRange.end) {
    loadCalendar(true);
    return;
  }
  updateUrl(true);
  renderGrid(state.currentRange);
  renderAgenda(state.currentRange);
  if (isMobileCalendar()) {
    $('#agenda-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#agenda-title').focus?.();
  }
}

function getVisibleRange() {
  if (state.view === 'week') return getWeekRange(state.anchorDate);
  return getMonthRange(state.anchorDate);
}

function getMonthRange(dateKey) {
  const date = parseDateOnly(dateKey);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const gridStart = addDaysToDate(monthStart, -monthStart.getDay());
  const gridEnd = addDaysToDate(monthEnd, 6 - monthEnd.getDay());
  return {
    start: formatDateKey(gridStart),
    end: formatDateKey(gridEnd),
    title: monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' })
  };
}

function getWeekRange(dateKey) {
  const date = parseDateOnly(dateKey);
  const start = addDaysToDate(date, -date.getDay());
  const end = addDaysToDate(start, 6);
  return {
    start: formatDateKey(start),
    end: formatDateKey(end),
    title: `${formatDate(start)} - ${formatDate(formatDateKey(end))}`
  };
}

function daysInRange(start, end) {
  const days = [];
  let cursor = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  while (cursor <= endDate) {
    days.push(formatDateKey(cursor));
    cursor = addDaysToDate(cursor, 1);
  }
  return days;
}

function hydrateStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const date = params.get('date');
  const view = params.get('view');
  if (isValidDate(date)) {
    state.anchorDate = date;
    state.selectedDate = date;
  }
  if (view === 'month' || view === 'week') state.view = view;
}

function updateUrl(pushUrl) {
  const params = new URLSearchParams({
    date: state.selectedDate,
    view: state.view
  });
  const nextUrl = `/calendar?${params}`;
  if (window.location.pathname + window.location.search === nextUrl) return;
  const method = pushUrl ? 'pushState' : 'replaceState';
  window.history[method](null, '', nextUrl);
}

function parseDateOnly(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateKey, amount) {
  return formatDateKey(addDaysToDate(parseDateOnly(dateKey), amount));
}

function addDaysToDate(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(dateKey, amount) {
  const date = parseDateOnly(dateKey);
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return formatDateKey(target);
}

function todayString() {
  return formatDateKey(new Date());
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = parseDateOnly(value);
  return formatDateKey(date) === value;
}

function formatDate(value) {
  if (!value) return 'Not set';
  if (typeof value === 'string') {
    const [year, month, day] = value.split('-');
    return `${month}/${day}/${year}`;
  }
  return formatDate(formatDateKey(value));
}

function formatLongDate(value) {
  return parseDateOnly(value).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatDateTime(value) {
  if (!value) return 'never';
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function isMobileCalendar() {
  return window.matchMedia('(max-width: 720px)').matches;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || 'Request failed.');
  return data;
}

function openDialog(id) {
  const dialog = $(`#${id}`);
  lastFocusedElement = document.activeElement;
  document.body.classList.add('modal-open');
  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
    }
  }, { once: true });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(id) {
  const dialog = $(`#${id}`);
  if (typeof dialog.close === 'function') dialog.close();
  else {
    dialog.removeAttribute('open');
    document.body.classList.remove('modal-open');
  }
}

function renderEmpty(container, message) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = message;
  container.replaceChildren(empty);
}

function showError(message) {
  const error = $('#calendar-error');
  error.textContent = message;
  error.hidden = false;
}

function hideError() {
  const error = $('#calendar-error');
  error.hidden = true;
  error.textContent = '';
}

function el(tag, text, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text ?? '';
  return node;
}

function slug(value) {
  return String(value).toLowerCase().replace(/\s+/g, '-');
}

function toast(message, isError = false) {
  const toastNode = el('div', message, `toast${isError ? ' error' : ''}`);
  $('#toast-region').append(toastNode);
  window.setTimeout(() => toastNode.remove(), 4200);
}

function setLoading(isLoading) {
  document.body.classList.toggle('loading', isLoading);
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function applySavedTheme() {
  const theme = localStorage.getItem('ansli:theme');
  if (theme) document.documentElement.dataset.theme = theme;
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ansli:theme', next);
}

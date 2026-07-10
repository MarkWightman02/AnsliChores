'use strict';

const state = {
  roommates: [],
  chores: [],
  dashboardChores: [],
  history: [],
  selectedRoommateId: localStorage.getItem('ansli:selectedRoommate') || '',
  filter: 'all',
  sort: 'next_due',
  currentView: 'dashboard',
  editingChoreId: null,
  completingChoreId: null,
  editingHistoryId: null,
  rotationDraft: []
};

const $ = (selector) => document.querySelector(selector);
let lastFocusedElement = null;

document.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();
  hydrateInitialView();
  bindEvents();
  switchView(state.currentView, false);
  loadInitialData();
});

function bindEvents() {
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#refresh-button').addEventListener('click', refreshAll);
  $('#current-roommate').addEventListener('change', (event) => {
    state.selectedRoommateId = event.target.value;
    localStorage.setItem('ansli:selectedRoommate', state.selectedRoommateId);
    loadDashboard();
  });
  $('#sort-select').addEventListener('change', (event) => {
    setSort(event.target.value);
  });
  document.querySelectorAll('.tab[data-view], .bottom-nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  document.querySelectorAll('.chip').forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });
  $('#filter-sheet-button').addEventListener('click', () => openDialog('filter-dialog'));
  $('#filter-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.filter = $('#mobile-filter-select').value;
    state.sort = $('#mobile-sort-select').value;
    $('#sort-select').value = state.sort;
    closeDialog('filter-dialog');
    updateFilterControls();
    loadDashboard();
  });
  $('#reset-filters-button').addEventListener('click', () => {
    state.filter = 'all';
    state.sort = 'next_due';
    $('#sort-select').value = state.sort;
    $('#mobile-filter-select').value = state.filter;
    $('#mobile-sort-select').value = state.sort;
    updateFilterControls();
    loadDashboard();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
  });
  $('#complete-form').addEventListener('submit', submitCompletion);
  $('#chore-form').addEventListener('submit', submitChore);
  $('#history-form').addEventListener('submit', submitHistoryCorrection);
  $('#history-filters').addEventListener('submit', (event) => {
    event.preventDefault();
    loadHistory();
  });
  $('#add-chore-button').addEventListener('click', () => openChoreDialog());
  $('#rotation-enabled').addEventListener('change', renderRotationEditor);
}

async function loadInitialData() {
  setLoading(true);
  try {
    const roommates = await api('/api/roommates');
    state.roommates = roommates.roommates;
    renderRoommateOptions();
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setLoading(false);
  }
}

async function refreshAll() {
  await Promise.all([loadDashboard(), loadChores(), loadHistory()]);
}

async function loadDashboard() {
  const params = new URLSearchParams({
    filter: state.filter,
    sort: state.sort,
    today: todayString()
  });
  if (state.selectedRoommateId) params.set('roommateId', state.selectedRoommateId);
  const data = await api(`/api/dashboard?${params}`);
  state.dashboardChores = data.chores;
  renderSummary(data.summary);
  renderDashboardChores(data.chores);
  $('#last-updated').textContent = `Last updated: ${formatDateTime(data.lastUpdated)}`;
  updateFilterControls();
}

async function loadChores() {
  const data = await api(`/api/chores?includeArchived=true&today=${todayString()}`);
  state.chores = data.chores;
  renderManageList();
  renderHistoryChoreOptions();
}

async function loadHistory() {
  const params = new URLSearchParams();
  const roommateId = $('#history-roommate').value;
  const choreId = $('#history-chore').value;
  const from = $('#history-from').value;
  const to = $('#history-to').value;
  if (roommateId) params.set('roommateId', roommateId);
  if (choreId) params.set('choreId', choreId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const data = await api(`/api/history?${params}`);
  state.history = data.history;
  renderHistory();
}

function renderRoommateOptions() {
  fillSelect($('#current-roommate'), state.roommates.map(optionFromRoommate));
  fillSelect($('#complete-by'), state.roommates.map(optionFromRoommate));
  fillSelect($('#history-completed-by'), state.roommates.map(optionFromRoommate));
  fillSelect($('#history-roommate'), [
    { value: '', label: 'Everyone' },
    ...state.roommates.map(optionFromRoommate)
  ]);
  fillSelect($('#chore-assigned'), [
    { value: 'all', label: 'All' },
    ...state.roommates.map(optionFromRoommate)
  ]);

  if (!state.selectedRoommateId && state.roommates.length > 0) {
    state.selectedRoommateId = String(state.roommates[0].id);
    localStorage.setItem('ansli:selectedRoommate', state.selectedRoommateId);
  }
  $('#current-roommate').value = state.selectedRoommateId;
}

function renderHistoryChoreOptions() {
  const active = state.chores.filter((chore) => !chore.archived);
  fillSelect($('#history-chore'), [
    { value: '', label: 'All chores' },
    ...active.map((chore) => ({ value: String(chore.id), label: chore.name }))
  ]);
}

function optionFromRoommate(roommate) {
  return { value: String(roommate.id), label: roommate.name };
}

function fillSelect(select, options) {
  const previousValue = select.value;
  select.replaceChildren();
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    select.append(item);
  }
  if (options.some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

function renderSummary(summary) {
  const cards = [
    ['Overdue', summary.overdue],
    ['Due today', summary.dueToday],
    ['Due within 7 days', summary.dueNext7Days],
    ['Completed this month', summary.completedThisMonth]
  ];
  $('#summary-grid').replaceChildren(...cards.map(([label, value]) => {
    const card = document.createElement('article');
    card.className = 'summary-card';
    card.append(el('strong', value), el('span', label));
    return card;
  }));
}

function renderDashboardChores(chores) {
  const list = $('#chores-list');
  if (!chores.length) {
    renderEmpty(list, 'No chores match this view.');
    return;
  }

  list.replaceChildren(...chores.map((chore) => {
    const card = document.createElement('article');
    card.className = `chore-card ${slug(chore.status)}`;
    const extra = document.createElement('details');
    extra.className = 'card-extra';
    extra.open = window.matchMedia('(min-width: 680px)').matches;
    extra.append(
      el('summary', 'Details'),
      detailsGrid([
        ['Last completed', formatDate(chore.lastDone)],
        ['Frequency', chore.frequencyLabel]
      ]),
      noteBlock(chore.notes, 'notes'),
      noteBlock(chore.upcomingRotation, 'rotation-note')
    );

    card.append(
      cardTop(chore),
      detailsGrid([
        ['Assigned', chore.assignedName],
        ['Due', formatDate(chore.nextDue)]
      ], 'chore-primary-meta'),
      extra
    );

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const complete = el('button', 'Mark Complete', 'primary-button');
    complete.type = 'button';
    complete.addEventListener('click', () => openCompleteDialog(chore.id));
    const edit = el('button', 'Edit', 'secondary-button');
    edit.type = 'button';
    edit.addEventListener('click', () => openChoreDialog(chore));
    actions.append(complete, edit);
    card.append(actions);
    return card;
  }));
}

function cardTop(chore) {
  const top = document.createElement('div');
  top.className = 'card-top';
  const badge = el('span', chore.status, `badge ${slug(chore.status)}`);
  top.append(badge, el('h3', chore.name));
  return top;
}

function detailsGrid(details, className = 'details-grid') {
  const grid = document.createElement('div');
  grid.className = className;
  grid.replaceChildren(...details.map(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'detail';
    item.append(el('span', label), el('strong', value || 'Not set'));
    return item;
  }));
  return grid;
}

function noteBlock(value, className) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = value || '';
  paragraph.hidden = !value;
  return paragraph;
}

function renderManageList() {
  const list = $('#manage-list');
  if (!state.chores.length) {
    renderEmpty(list, 'No chores have been added yet.');
    return;
  }

  list.replaceChildren(...state.chores.map((chore) => {
    const card = document.createElement('article');
    card.className = 'manage-card';
    card.append(cardTop({ ...chore, status: chore.archived ? 'Archived' : chore.status }), detailsGrid([
      ['Assigned', chore.assignedName],
      ['Last completed', formatDate(chore.lastDone)],
      ['Next due', formatDate(chore.nextDue)],
      ['Frequency', chore.frequencyLabel]
    ]));

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const edit = el('button', 'Edit', 'secondary-button');
    edit.type = 'button';
    edit.addEventListener('click', () => openChoreDialog(chore));
    actions.append(edit);

    if (chore.archived) {
      const restore = el('button', 'Restore', 'secondary-button');
      restore.type = 'button';
      restore.addEventListener('click', () => mutate(`/api/chores/${chore.id}/restore`, { method: 'POST' }, 'Chore restored.'));
      const remove = el('button', 'Delete', 'danger-button');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteChore(chore));
      actions.append(restore, remove);
    } else {
      const archive = el('button', 'Archive', 'danger-button');
      archive.type = 'button';
      archive.addEventListener('click', () => archiveChore(chore));
      actions.append(archive);
    }
    card.append(actions);
    return card;
  }));
}

function renderHistory() {
  const list = $('#history-list');
  if (!state.history.length) {
    renderEmpty(list, 'No completion history found.');
    return;
  }

  list.replaceChildren(...state.history.map((record) => {
    const card = document.createElement('article');
    card.className = 'history-card';
    const top = document.createElement('div');
    top.className = 'card-top';
    top.append(el('h3', record.choreName), el('span', formatDate(record.completedDate), 'badge'));
    card.append(top);
    card.append(noteBlock(`${record.completedByName} completed this chore.`, 'notes'));

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    [
      `Assignee: ${record.previousAssigneeName} -> ${record.newAssigneeName}`,
      `Due date: ${formatDate(record.previousDueDate)} -> ${formatDate(record.newDueDate)}`,
      `Last done: ${formatDate(record.previousLastDone)} -> ${formatDate(record.newLastDone)}`,
      `Recorded: ${formatDateTime(record.createdAt)}`
    ].forEach((line) => meta.append(el('span', line)));
    if (record.completionNote) meta.append(el('span', `Note: ${record.completionNote}`));
    card.append(meta);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const edit = el('button', 'Correct', 'secondary-button');
    edit.type = 'button';
    edit.addEventListener('click', () => openHistoryDialog(record));
    const remove = el('button', 'Delete', 'danger-button');
    remove.type = 'button';
    remove.addEventListener('click', () => deleteHistoryRecord(record));
    actions.append(edit, remove);
    card.append(actions);
    return card;
  }));
}

function openCompleteDialog(choreId) {
  const chore = state.dashboardChores.find((item) => item.id === choreId) || state.chores.find((item) => item.id === choreId);
  state.completingChoreId = choreId;
  $('#complete-chore-name').textContent = chore ? chore.name : '';
  $('#complete-date').value = todayString();
  $('#complete-by').value = state.selectedRoommateId || String(state.roommates[0]?.id || '');
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
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false);
  }
}

function openChoreDialog(chore = null) {
  state.editingChoreId = chore ? chore.id : null;
  $('#chore-dialog-title').textContent = chore ? 'Edit chore' : 'Add chore';
  $('#chore-name').value = chore?.name || '';
  $('#chore-assigned').value = chore?.assignedTo ? String(chore.assignedTo) : 'all';
  $('#chore-frequency').value = `${chore?.frequencyCount || 1}:${chore?.frequencyUnit || 'week'}`;
  $('#chore-last-done').value = chore?.lastDone || '';
  $('#chore-next-due').value = chore?.nextDue || todayString();
  $('#chore-notes').value = chore?.notes || '';
  $('#rotation-enabled').checked = Boolean(chore?.rotationEnabled);
  state.rotationDraft = chore?.rotation?.map((person) => person.id) || state.roommates.map((person) => person.id);
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
    const url = state.editingChoreId ? `/api/chores/${state.editingChoreId}` : '/api/chores';
    await api(url, {
      method: state.editingChoreId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    closeDialog('chore-dialog');
    toast('Chore saved.');
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false);
  }
}

function openHistoryDialog(record) {
  state.editingHistoryId = record.id;
  $('#history-record-title').textContent = record.choreName;
  $('#history-completed-date').value = record.completedDate;
  $('#history-completed-by').value = String(record.completedBy);
  $('#history-note').value = record.completionNote || '';
  openDialog('history-dialog');
}

async function submitHistoryCorrection(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonBusy(button, true);
  try {
    await api(`/api/history/${state.editingHistoryId}`, {
      method: 'PUT',
      body: JSON.stringify({
        completedDate: $('#history-completed-date').value,
        completedBy: Number($('#history-completed-by').value),
        completionNote: $('#history-note').value
      })
    });
    closeDialog('history-dialog');
    toast('History corrected.');
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  } finally {
    setButtonBusy(button, false);
  }
}

async function archiveChore(chore) {
  if (!window.confirm(`Archive "${chore.name}"?`)) return;
  await mutate(`/api/chores/${chore.id}/archive`, { method: 'POST' }, 'Chore archived.');
}

async function deleteChore(chore) {
  if (!window.confirm(`Permanently delete "${chore.name}" and its history?`)) return;
  await mutate(`/api/chores/${chore.id}`, { method: 'DELETE' }, 'Chore deleted.');
}

async function deleteHistoryRecord(record) {
  if (!window.confirm(`Delete the completion record for "${record.choreName}"?`)) return;
  await mutate(`/api/history/${record.id}`, { method: 'DELETE' }, 'History record deleted.');
}

async function mutate(url, options, message) {
  try {
    await api(url, options);
    toast(message);
    await refreshAll();
  } catch (error) {
    toast(error.message, true);
  }
}

function hydrateInitialView() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (['dashboard', 'history', 'manage'].includes(view)) state.currentView = view;
}

function setFilter(filter) {
  state.filter = filter;
  $('#mobile-filter-select').value = state.filter;
  updateFilterControls();
  loadDashboard();
}

function setSort(sort) {
  state.sort = sort;
  $('#mobile-sort-select').value = state.sort;
  loadDashboard();
}

function updateFilterControls() {
  document.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === state.filter));
  $('#mobile-filter-select').value = state.filter;
  $('#mobile-sort-select').value = state.sort;
  $('#sort-select').value = state.sort;
  const active = state.filter !== 'all' || state.sort !== 'next_due';
  $('#filter-sheet-button').textContent = active ? 'Filters active' : 'Filters';
}

function switchView(view, updateUrl = true) {
  if (!['dashboard', 'history', 'manage'].includes(view)) return;
  state.currentView = view;
  document.querySelectorAll('.tab[data-view], .bottom-nav-item[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `${view}-view`));
  if (updateUrl) {
    const nextUrl = view === 'dashboard' ? '/' : `/?view=${view}`;
    window.history.replaceState(null, '', nextUrl);
  }
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
  if (!response.ok) {
    throw new Error(data?.error || 'Request failed.');
  }
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

function el(tag, text, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text ?? '';
  return node;
}

function slug(value) {
  return String(value).toLowerCase().replace(/\s+/g, '-');
}

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return 'Not set';
  const [year, month, day] = value.split('-');
  return `${month}/${day}/${year}`;
}

function formatDateTime(value) {
  if (!value) return 'never';
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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

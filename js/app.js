'use strict';

// ============================================================
// Storage Module
// Centralised localStorage read/write with graceful fallback.
// ============================================================
const Storage = (() => {
  let _available = true;

  /** Show a non-blocking warning when localStorage is unavailable. */
  function _showStorageWarning() {
    // Inject a simple toast if it does not already exist.
    if (document.getElementById('storage-warning')) return;
    const el = document.createElement('div');
    el.id = 'storage-warning';
    el.setAttribute('role', 'alert');
    el.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
      'background:#d32f2f;color:#fff;padding:8px 20px;border-radius:6px;' +
      'font-size:0.9rem;z-index:9999;pointer-events:none;';
    el.textContent =
      'Storage unavailable — data will not be saved this session.';
    document.body.appendChild(el);
  }

  /**
   * Load a value from localStorage.
   * @param {string} key
   * @param {*} fallback  Returned when the key is missing or storage fails.
   * @returns {*}
   */
  function load(key, fallback) {
    if (!_available) return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      _available = false;
      _showStorageWarning();
      return fallback;
    }
  }

  /**
   * Persist a value to localStorage as JSON.
   * @param {string} key
   * @param {*} value
   */
  function save(key, value) {
    if (!_available) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      _available = false;
      _showStorageWarning();
    }
  }

  return { load, save };
})();

// ============================================================
// Application State  (single in-memory truth)
// ============================================================
const State = {
  /** @type {Array<{id:string, title:string, complete:boolean, createdAt:number}>} */
  tasks: [],

  /** @type {Array<{id:string, label:string, url:string}>} */
  links: [],

  timer: {
    /** Duration in seconds (default 25 × 60 = 1500). */
    durationSeconds: 1500,
    remainingSeconds: 1500,
    /** @type {'IDLE'|'RUNNING'|'PAUSED'} */
    status: 'IDLE',
    /** @type {number|null} */
    intervalId: null,
  },

  /** @type {'light'|'dark'} */
  theme: 'light',

  /** @type {string} */
  userName: '',

  /** @type {'all'|'incomplete-first'|'complete-first'} */
  sortOrder: 'all',
};

// localStorage key constants (tdld_ prefix for namespacing).
const KEYS = {
  TASKS:    'tdld_tasks',
  LINKS:    'tdld_links',
  THEME:    'tdld_theme',
  USERNAME: 'tdld_username',
  DURATION: 'tdld_duration',
  SORT:     'tdld_sort',
};

// ============================================================
// Utility Helpers
// ============================================================

/**
 * Generate a unique ID.
 * Prefers crypto.randomUUID when available.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

/**
 * Derive time-of-day greeting string from an hour value.
 * @param {number} hour  0–23
 * @returns {string}
 */
function deriveGreeting(hour) {
  if (hour >= 5 && hour <= 11) return 'Good Morning';
  if (hour >= 12 && hour <= 17) return 'Good Afternoon';
  if (hour >= 18 && hour <= 21) return 'Good Evening';
  return 'Good Night';
}

/**
 * Build the full greeting string, optionally including the user name.
 *
 * Pure function — no side effects, no DOM access.
 *
 * @param {number} hour  0–23
 * @param {string} name  Any string; whitespace-only values produce no name suffix.
 * @returns {string}
 */
function buildGreeting(hour, name) {
  const base = deriveGreeting(hour);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed.length > 0 ? base + ', ' + trimmed : base;
}

/**
 * Format a total-seconds integer as MM:SS.
 * @param {number} totalSeconds  0–7200
 * @returns {string}
 */
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return mm + ':' + ss;
}

/**
 * Validate a URL string.
 * Returns true only for http:// or https:// URLs with a non-empty hostname.
 * @param {string} raw
 * @returns {boolean}
 */
function isValidUrl(raw) {

  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Return a new sorted array of tasks according to the specified order.
 * The original array is never mutated (pure function — no side effects,
 * no access to State or the DOM).
 *
 * - 'all'              → ascending createdAt
 * - 'incomplete-first' → incomplete tasks first, then complete;
 *                        each group sorted by ascending createdAt
 * - 'complete-first'   → complete tasks first, then incomplete;
 *                        each group sorted by ascending createdAt
 *
 * @param {Array<{id:string, title:string, complete:boolean, createdAt:number}>} tasks
 * @param {'all'|'incomplete-first'|'complete-first'} order
 * @returns {Array<{id:string, title:string, complete:boolean, createdAt:number}>}
 */
function sortTasks(tasks, order) {
  const copy = [...tasks];
  const byDate = (a, b) => a.createdAt - b.createdAt;

  if (order === 'incomplete-first') {
    return copy.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return byDate(a, b);
    });
  }

  if (order === 'complete-first') {
    return copy.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      return byDate(a, b);
    });
  }

  // Default: 'all' — ascending createdAt.
  return copy.sort(byDate);
}

// ============================================================
// Greeting Widget
// ============================================================
const GreetingWidget = {
  /**
   * Write the current time, date, and greeting to the DOM.
   * Returns `true` on success, `false` if the Date API threw an exception.
   * @returns {boolean}
   */
  render() {
    try {
      const now = new Date();
      const hours   = now.getHours();
      const minutes = now.getMinutes();
      const seconds = now.getSeconds();

      // HH:MM:SS (24-hour)
      const hh = String(hours).padStart(2, '0');
      const mm = String(minutes).padStart(2, '0');
      const ss = String(seconds).padStart(2, '0');
      const clockEl = document.getElementById('clock');
      if (clockEl) clockEl.textContent = hh + ':' + mm + ':' + ss;

      // Weekday, Day Month Year
      const dateEl = document.getElementById('date-display');
      if (dateEl) {
        dateEl.textContent = now.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }

      // Greeting
      const greetingEl = document.getElementById('greeting');
      if (greetingEl) {
        greetingEl.textContent = buildGreeting(hours, State.userName);
      }
      return true;
    } catch (err) {
      // Date API unavailable — write static fallback; interval will be skipped/stopped.
      const clockEl = document.getElementById('clock');
      if (clockEl) clockEl.textContent = '--:--:--';
      const greetingEl = document.getElementById('greeting');
      if (greetingEl) greetingEl.textContent = 'Welcome';
      this.stopClock();
      return false;
    }
  },

  /** @type {number|null} */
  _intervalId: null,

  /**
   * Perform the first render, then start the 1-second update interval.
   * If the Date API throws on the first render the interval is NOT started.
   */
  startClock() {
    const ok = this.render();
    // Only start the interval when the Date API is working (req 1.7).
    if (ok) {
      this._intervalId = setInterval(() => this.render(), 1000);
    }
  },

  /** Stop the clock interval (used on Date API failure). */
  stopClock() {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  },
};

// ============================================================
// Focus Timer
// ============================================================
const Timer = {
  /**
   * Start (or resume) the countdown.
   * No-op if already RUNNING (req 2.8).
   */
  start() {
    if (State.timer.status === 'RUNNING') return;

    State.timer.status = 'RUNNING';
    State.timer.intervalId = setInterval(() => this.tick(), 1000);
    this._render();
  },

  /**
   * Pause the countdown and retain remaining time.
   */
  stop() {
    if (State.timer.status !== 'RUNNING') return;
    clearInterval(State.timer.intervalId);
    State.timer.intervalId = null;
    State.timer.status = 'PAUSED';
    this._render();
  },

  /**
   * Stop countdown and restore to the configured duration.
   */
  reset() {
    if (State.timer.intervalId !== null) {
      clearInterval(State.timer.intervalId);
      State.timer.intervalId = null;
    }
    State.timer.remainingSeconds = State.timer.durationSeconds;
    State.timer.status = 'IDLE';
    this._hideAlert();
    this._render();
  },

  /**
   * Decrement remaining time by one second.
   * Called by the running interval.
   */
  tick() {
    if (State.timer.remainingSeconds <= 0) return;
    State.timer.remainingSeconds -= 1;
    this._render();
    if (State.timer.remainingSeconds === 0) {
      clearInterval(State.timer.intervalId);
      State.timer.intervalId = null;
      State.timer.status = 'IDLE';
      this._showAlert();
    }
  },

  /**
   * Set a new duration (in minutes), then reset.
   * Validates that minutes is an integer in [1, 120].
   * Stops any running or paused timer before applying the new duration.
   * Persists the new duration to localStorage under tdld_duration.
   * @param {number} minutes  1–120
   */
  setDuration(minutes) {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > 120) {
      // Req 13.5: show validation message, retain input value, do NOT update state.
      const errorEl = document.getElementById('duration-error');
      if (errorEl) errorEl.textContent = 'Please enter a value between 1 and 120 minutes.';
      return;
    }

    // Valid input — clear any previous error.
    const errorEl = document.getElementById('duration-error');
    if (errorEl) errorEl.textContent = '';

    // Req 13.3: stop any running countdown (also handles PAUSED state).
    if (State.timer.intervalId !== null) {
      clearInterval(State.timer.intervalId);
      State.timer.intervalId = null;
    }
    State.timer.status = 'IDLE';

    // Req 13.2 / 13.3: update duration, reset remaining, persist, update display.
    State.timer.durationSeconds  = m * 60;
    State.timer.remainingSeconds = m * 60;
    Storage.save(KEYS.DURATION, m);
    this._render();
  },

  /** Update the timer display element. */
  _render() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(State.timer.remainingSeconds);
  },

  /** Show the time-up alert. */
  _showAlert() {
    const el = document.getElementById('timer-alert');
    if (el) el.hidden = false;
  },

  /** Hide the time-up alert. */
  _hideAlert() {
    const el = document.getElementById('timer-alert');
    if (el) el.hidden = true;
  },
};

// ============================================================
// Task List
// ============================================================
const TaskList = {
  /**
   * Add a new task.
   * Validates non-empty input and optional duplicate check.
   * @param {string} title
   */
  addTask(title) {
    const errorEl = document.getElementById('task-input-error');
    const trimmed = title.trim();

    if (trimmed.length === 0) {
      if (errorEl) errorEl.textContent = 'Task title cannot be empty.';
      return;
    }

    // Duplicate check (req 14 — case-insensitive).
    const lower = trimmed.toLowerCase();
    const duplicate = State.tasks.some(t => t.title.toLowerCase() === lower);
    if (duplicate) {
      if (errorEl) errorEl.textContent = 'A task with this title already exists.';
      return;
    }

    if (errorEl) errorEl.textContent = '';

    /** @type {{id:string, title:string, complete:boolean, createdAt:number}} */
    const task = {
      id: generateId(),
      title: trimmed,
      complete: false,
      createdAt: Date.now(),
    };

    State.tasks.push(task);
    Storage.save(KEYS.TASKS, State.tasks);
    this.renderList();
  },

  /**
   * Update the title of an existing task.
   * @param {string} id
   * @param {string} newTitle
   */
  editTask(id, newTitle) {
    const trimmed = newTitle.trim();
    const task = State.tasks.find(t => t.id === id);
    if (!task) return;

    if (trimmed.length === 0) {
      // Keep edit mode — rejection handled by caller.
      return false;
    }

    // Duplicate check excluding the task being edited.
    const lower = trimmed.toLowerCase();
    const duplicate = State.tasks.some(
      t => t.id !== id && t.title.toLowerCase() === lower
    );
    if (duplicate) {
      return false;
    }

    task.title = trimmed;
    Storage.save(KEYS.TASKS, State.tasks);
    this.renderList();
    return true;
  },

  /**
   * Remove a task by ID.
   * @param {string} id
   */
  deleteTask(id) {
    State.tasks = State.tasks.filter(t => t.id !== id);
    Storage.save(KEYS.TASKS, State.tasks);
    this.renderList();
  },

  /**
   * Toggle the complete flag on a task.
   * Reverts if the subsequent save fails (req 5.1).
   * @param {string} id
   */
  toggleComplete(id) {
    const task = State.tasks.find(t => t.id === id);
    if (!task) return;

    const previous = task.complete;
    task.complete = !previous;

    try {
      Storage.save(KEYS.TASKS, State.tasks);
    } catch {
      task.complete = previous;
    }
    this.renderList();
  },

  /**
   * Rebuild the task <ul> from State.tasks.
   */
  renderList() {
    const ul = document.getElementById('task-ul');
    if (!ul) return;
    ul.innerHTML = '';

    const sorted = this._sortedTasks();

    sorted.forEach(task => {
      const li = document.createElement('li');
      li.dataset.id = task.id;
      if (task.complete) li.classList.add('complete');

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-toggle';
      checkbox.checked = task.complete;
      checkbox.setAttribute('aria-label', 'Mark task complete');
      checkbox.addEventListener('change', () => this.toggleComplete(task.id));

      // Title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'task-title';
      titleSpan.textContent = task.title;

      // Double-click on title triggers edit mode (req 4.1).
      titleSpan.addEventListener('dblclick', () => this._enterEditMode(li, task));

      // Edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'task-edit-btn btn-icon btn-secondary';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('aria-label', 'Edit task: ' + task.title);
      editBtn.addEventListener('click', () => this._enterEditMode(li, task));

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'task-delete-btn btn-icon btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.setAttribute('aria-label', 'Delete task: ' + task.title);
      deleteBtn.addEventListener('click', () => this.deleteTask(task.id));

      li.appendChild(checkbox);
      li.appendChild(titleSpan);
      li.appendChild(editBtn);
      li.appendChild(deleteBtn);
      ul.appendChild(li);
    });
  },

  /**
   * Switch a task row into edit mode.
   * @param {HTMLLIElement} li
   * @param {{id:string, title:string, complete:boolean, createdAt:number}} task
   */
  _enterEditMode(li, task) {
    li.classList.add('editing');
    li.innerHTML = '';

    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'task-edit-input';
    editInput.value = task.title;
    editInput.maxLength = 255;
    editInput.setAttribute('aria-label', 'Edit task title');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'task-save-edit-btn btn-icon';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'task-cancel-edit-btn btn-icon btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const errorSpan = document.createElement('span');
    errorSpan.setAttribute('role', 'alert');
    errorSpan.style.color = 'var(--error)';
    errorSpan.style.fontSize = '0.85rem';
    errorSpan.style.flexBasis = '100%';

    const confirmEdit = () => {
      const result = this.editTask(task.id, editInput.value);
      if (result === false) {
        const val = editInput.value.trim();
        if (val.length === 0) {
          errorSpan.textContent = 'Title cannot be empty.';
        } else {
          errorSpan.textContent = 'A task with this title already exists.';
        }
        editInput.focus();
      }
    };

    const cancelEdit = () => this.renderList();

    saveBtn.addEventListener('click', confirmEdit);
    cancelBtn.addEventListener('click', cancelEdit);

    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmEdit();
      if (e.key === 'Escape') cancelEdit();
    });

    // Blur = cancel (req 4.5).
    editInput.addEventListener('blur', () => {
      // Small delay so Save/Cancel click fires first.
      setTimeout(cancelEdit, 150);
    });

    li.appendChild(editInput);
    li.appendChild(saveBtn);
    li.appendChild(cancelBtn);
    li.appendChild(errorSpan);
    editInput.focus();
  },

  /**
   * Return the task array sorted by the current State.sortOrder.
   * The original State.tasks array is not mutated.
   * @returns {Array}
   */
  _sortedTasks() {
    return sortTasks(State.tasks, State.sortOrder);
  },
};

// ============================================================
// Quick Links
// ============================================================
const QuickLinks = {
  /**
   * Add a new link.
   * @param {string} label
   * @param {string} url
   */
  addLink(label, url) {
    const labelErrorEl = document.getElementById('link-label-error');
    const urlErrorEl   = document.getElementById('link-url-error');

    const trimmedLabel = label.trim();
    const trimmedUrl   = url.trim();
    let valid = true;

    if (trimmedLabel.length === 0) {
      if (labelErrorEl) labelErrorEl.textContent = 'Label cannot be empty.';
      valid = false;
    } else {
      if (labelErrorEl) labelErrorEl.textContent = '';
    }

    if (!isValidUrl(trimmedUrl)) {
      if (urlErrorEl) urlErrorEl.textContent =
        'URL must start with http:// or https:// and include a valid host.';
      valid = false;
    } else {
      if (urlErrorEl) urlErrorEl.textContent = '';
    }

    if (!valid) return;

    /** @type {{id:string, label:string, url:string}} */
    const link = {
      id: generateId(),
      label: trimmedLabel,
      url: trimmedUrl,
    };

    State.links.push(link);
    Storage.save(KEYS.LINKS, State.links);
    this.renderLinks();
  },

  /**
   * Remove a link by ID.
   * @param {string} id
   */
  deleteLink(id) {
    State.links = State.links.filter(l => l.id !== id);
    Storage.save(KEYS.LINKS, State.links);
    this.renderLinks();
  },

  /**
   * Rebuild the links list from State.links.
   */
  renderLinks() {
    const ul  = document.getElementById('links-ul');
    const msg = document.getElementById('links-empty-msg');
    if (!ul) return;

    ul.innerHTML = '';

    if (State.links.length === 0) {
      if (msg) msg.hidden = false;
      return;
    }

    if (msg) msg.hidden = true;

    State.links.forEach(link => {
      const li = document.createElement('li');

      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = link.label;
      anchor.className = 'link-anchor';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'link-delete-btn btn-icon btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.setAttribute('aria-label', 'Delete link: ' + link.label);
      deleteBtn.addEventListener('click', () => this.deleteLink(link.id));

      li.appendChild(anchor);
      li.appendChild(deleteBtn);
      ul.appendChild(li);
    });
  },
};

// ============================================================
// Greeting Name
// ============================================================

/**
 * Read the value from #name-input, trim it, persist to localStorage
 * under the key `tdld_username`, update State.userName with the trimmed
 * value, then re-render the greeting.
 *
 * Implements Requirements 12.1, 12.2, 12.3, 12.4.
 */
function saveName() {
  const input = document.getElementById('name-input');
  const trimmed = (input?.value ?? '').trim();
  State.userName = trimmed;
  Storage.save(KEYS.USERNAME, trimmed);
  GreetingWidget.render();
}

// ============================================================
// Theme Toggle
// ============================================================
const ThemeToggle = {
  /**
   * Apply a theme by setting data-theme on <html>.
   * @param {'light'|'dark'} theme
   */
  applyTheme(theme) {
    State.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      if (theme === 'dark') {
        btn.textContent = '☀️';
        btn.setAttribute('aria-label', 'Switch to light mode');
      } else {
        btn.textContent = '🌙';
        btn.setAttribute('aria-label', 'Switch to dark mode');
      }
    }
  },

  /**
   * Toggle between light and dark, then persist.
   */
  toggle() {
    const next = State.theme === 'light' ? 'dark' : 'light';
    this.applyTheme(next);
    Storage.save(KEYS.THEME, next);
  },
};

// ============================================================
// Bootstrap — init
// ============================================================

/**
 * Restore all persisted state, render all widgets, and attach event listeners.
 * Called once on DOMContentLoaded.
 */
function init() {
  // --- Restore persisted state ---

  // Theme (req 11.4 / 11.5 — default light).
  const savedTheme = Storage.load(KEYS.THEME, 'light');
  ThemeToggle.applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

  // User name.
  State.userName = Storage.load(KEYS.USERNAME, '');

  // Pomodoro duration (stored in minutes) — Req 13.4.
  // Use setDuration() to apply the saved value so the display is updated correctly.
  // The stored value is always valid (saved by setDuration), so no error will appear.
  const savedMinutes = Storage.load(KEYS.DURATION, 25);
  Timer.setDuration(savedMinutes);

  // Tasks.
  State.tasks = Storage.load(KEYS.TASKS, []);

  // Links.
  State.links = Storage.load(KEYS.LINKS, []);

  // Sort order.
  const savedSort = Storage.load(KEYS.SORT, 'all');
  if (['all', 'incomplete-first', 'complete-first'].includes(savedSort)) {
    State.sortOrder = savedSort;
  }

  // --- Render initial UI ---
  GreetingWidget.startClock();
  Timer._render();
  TaskList.renderList();
  QuickLinks.renderLinks();

  // Populate saved name into input.
  const nameInput = document.getElementById('name-input');
  if (nameInput && State.userName) nameInput.value = State.userName;

  // Populate sort select.
  const sortSelect = document.getElementById('task-sort');
  if (sortSelect) sortSelect.value = State.sortOrder;

  // Populate duration input.
  const durationInput = document.getElementById('duration-input');
  if (durationInput) {
    durationInput.value = Math.round(State.timer.durationSeconds / 60);
  }

  // --- Event listeners ---

  // Theme toggle.
  document.getElementById('theme-toggle')
    ?.addEventListener('click', () => ThemeToggle.toggle());

  // Name save.
  document.getElementById('name-save-btn')
    ?.addEventListener('click', () => saveName());

  // Timer controls.
  document.getElementById('timer-start')
    ?.addEventListener('click', () => Timer.start());

  document.getElementById('timer-stop')
    ?.addEventListener('click', () => Timer.stop());

  document.getElementById('timer-reset')
    ?.addEventListener('click', () => Timer.reset());

  // Timer dismiss alert.
  document.getElementById('timer-dismiss')
    ?.addEventListener('click', () => Timer._hideAlert());

  // Duration set (Req 13.1–13.5).
  document.getElementById('duration-save-btn')
    ?.addEventListener('click', () => {
      const durationInput = document.getElementById('duration-input');
      Timer.setDuration(parseInt(durationInput?.value ?? '', 10));
    });

  // Clear duration error on input change.
  document.getElementById('duration-input')
    ?.addEventListener('input', () => {
      const errorEl = document.getElementById('duration-error');
      if (errorEl) errorEl.textContent = '';
    });

  // Task add.
  document.getElementById('task-add-btn')
    ?.addEventListener('click', () => {
      const input = document.getElementById('task-input');
      TaskList.addTask(input?.value ?? '');
      if (input) input.value = '';
    });

  document.getElementById('task-input')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const input = document.getElementById('task-input');
        TaskList.addTask(input?.value ?? '');
        if (input) input.value = '';
      }
    });

  // Clear task error on input.
  document.getElementById('task-input')
    ?.addEventListener('input', () => {
      const errorEl = document.getElementById('task-input-error');
      if (errorEl) errorEl.textContent = '';
    });

  // Task sort.
  document.getElementById('task-sort')
    ?.addEventListener('change', e => {
      State.sortOrder = e.target.value;
      Storage.save(KEYS.SORT, State.sortOrder);
      TaskList.renderList();
    });

  // Link add.
  document.getElementById('link-add-btn')
    ?.addEventListener('click', () => {
      const labelInput = document.getElementById('link-label-input');
      const urlInput   = document.getElementById('link-url-input');
      QuickLinks.addLink(labelInput?.value ?? '', urlInput?.value ?? '');
      // Clear inputs only on success (when errors are absent).
      const labelErr = document.getElementById('link-label-error');
      const urlErr   = document.getElementById('link-url-error');
      if (labelErr?.textContent === '' && urlErr?.textContent === '') {
        if (labelInput) labelInput.value = '';
        if (urlInput)   urlInput.value   = '';
      }
    });

  // Clear link field errors on input.
  document.getElementById('link-label-input')
    ?.addEventListener('input', () => {
      const el = document.getElementById('link-label-error');
      if (el) el.textContent = '';
    });

  document.getElementById('link-url-input')
    ?.addEventListener('input', () => {
      const el = document.getElementById('link-url-error');
      if (el) el.textContent = '';
    });
}

document.addEventListener('DOMContentLoaded', init);

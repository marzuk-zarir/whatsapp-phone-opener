import { countries, filterCountries } from '../data/countries.js';
import { buildWhatsAppUrl, parseNational } from '../lib/phone-number-parser.js';

const PENDING_KEY = 'pendingSelection';
const SUCCESS_KEY = 'whatsappOpener:lastSuccess';
const COUNTRY_KEY = 'whatsappOpener:selectedCountry';
const DEFAULT_ISO = 'US';
const MAX_AGE_MS = 10 * 60 * 1000;
const WHATSAPP_URL = /^https:\/\/wa\.me\/\d{6,15}$/;

const countryByIso = new Map(countries.map((country) => [country.isoCode, country]));

const el = {
  loadingPanel: document.getElementById('state-loading'),
  formPanel: document.getElementById('state-form'),
  emptyPanel: document.getElementById('state-empty'),
  invalidPanel: document.getElementById('state-invalid'),
  successPanel: document.getElementById('state-success'),
  form: document.getElementById('open-form'),
  selectedNumber: document.getElementById('selected-number'),
  search: document.getElementById('country-search'),
  list: document.getElementById('country-listbox'),
  listEmpty: document.getElementById('list-empty'),
  selectedNote: document.getElementById('selected-country-note'),
  openButton: document.getElementById('open-button'),
  errorRegion: document.getElementById('error-region'),
  emptyTitle: document.getElementById('empty-title'),
  emptyBody: document.getElementById('empty-body'),
  invalidNumber: document.getElementById('invalid-number'),
  successLink: document.getElementById('success-link'),
  openAgain: document.getElementById('open-again')
};

/** @type {'loading' | 'needs-country' | 'invalid' | 'empty' | 'converting' | 'success' | 'error'} */
let state = 'loading';
/** @type {{ id: string, rawText?: string, extracted?: string, status: string, createdAt: number } | null} */
let pending = null;
/** @type {{ url: string, createdAt: number } | null} */
let lastSuccess = null;
let selectedIso = readStoredCountry();
let activeIso = selectedIso;
/** @type {typeof countries} */
let visibleCountries = [];
let converting = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let expiryTimer = null;

/** @returns {string} */
function readStoredCountry() {
  try {
    const saved = sessionStorage.getItem(COUNTRY_KEY);
    if (saved && countryByIso.has(saved)) return saved;
  } catch {
    // Session storage can be unavailable; fall back to the default.
  }
  return DEFAULT_ISO;
}

/** @param {string} iso */
function storeCountry(iso) {
  try {
    sessionStorage.setItem(COUNTRY_KEY, iso);
  } catch {
    // Selection still works for this page load.
  }
}

/** @returns {{ url: string, createdAt: number } | null} */
function readLastSuccess() {
  try {
    const raw = sessionStorage.getItem(SUCCESS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value && typeof value.url === 'string' && WHATSAPP_URL.test(value.url)) {
      return { url: value.url, createdAt: Number(value.createdAt) || Date.now() };
    }
  } catch {
    // Ignore malformed session state.
  }
  return null;
}

/** @param {{ url: string, createdAt: number }} value */
function storeLastSuccess(value) {
  try {
    sessionStorage.setItem(SUCCESS_KEY, JSON.stringify(value));
  } catch {
    // Success is still shown for this page load.
  }
}

function clearLastSuccess() {
  lastSuccess = null;
  try {
    sessionStorage.removeItem(SUCCESS_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/** @returns {Promise<void>} */
async function removePending() {
  try {
    await chrome.storage.session.remove(PENDING_KEY);
  } catch {
    // Nothing else to do; the UI is already updated.
  }
}

/** @param {unknown} value */
function normalizePending(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'none' };
  }

  const record = /** @type {Record<string, unknown>} */ (value);

  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) {
    return { kind: 'none' };
  }

  if (Date.now() - record.createdAt > MAX_AGE_MS) {
    return { kind: 'expired' };
  }

  if (record.status === 'invalid') {
    return { kind: 'invalid', value: record };
  }

  if (record.status !== 'needs-country' || typeof record.extracted !== 'string') {
    return { kind: 'none' };
  }

  const digits = record.extracted.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) {
    return { kind: 'invalid', value: record };
  }

  return { kind: 'needs-country', value: record };
}

/**
 * @param {string} next
 */
function setState(next) {
  state = /** @type {typeof state} */ (next);
  el.loadingPanel.hidden = next !== 'loading';
  el.formPanel.hidden = next !== 'needs-country' && next !== 'converting' && next !== 'error';
  el.emptyPanel.hidden = next !== 'empty';
  el.invalidPanel.hidden = next !== 'invalid';
  el.successPanel.hidden = next !== 'success';
}

/** @param {string} message */
function showError(message) {
  el.errorRegion.textContent = message;
}

function clearError() {
  el.errorRegion.textContent = '';
}

/** @param {unknown} value */
function displayValue(value) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '—';
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

function clearExpiry() {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

/** @param {number} createdAt */
function scheduleExpiry(createdAt) {
  clearExpiry();
  const remaining = createdAt + MAX_AGE_MS - Date.now();

  if (remaining <= 0) {
    void removePending();
    showEmpty(true);
    return;
  }

  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (state === 'success') return;
    void removePending();
    showEmpty(true);
  }, Math.min(remaining, 2147483647));
}

/** @param {boolean} expired */
function showEmpty(expired) {
  clearExpiry();
  pending = null;
  el.emptyTitle.textContent = expired ? 'The selected number has expired.' : 'No number selected yet.';
  el.emptyBody.textContent = expired
    ? 'Please select it again.'
    : 'Select a phone number on a webpage, right-click it, and choose “Open in WhatsApp”.';
  setState('empty');
}

/** @param {{ url: string, createdAt: number }} success */
function renderSuccess(success) {
  lastSuccess = success;
  clearExpiry();
  pending = null;
  el.successLink.textContent = success.url;
  el.successLink.href = success.url;
  setState('success');
}

/** @param {unknown} value */
function applyPending(value) {
  const result = normalizePending(value);

  if (result.kind === 'expired') {
    clearLastSuccess();
    void removePending();
    showEmpty(true);
    return;
  }

  if (result.kind === 'invalid') {
    clearLastSuccess();
    const record = /** @type {Record<string, unknown>} */ (result.value);
    pending = /** @type {typeof pending} */ (record);
    el.invalidNumber.textContent = displayValue(record.extracted || record.rawText);
    setState('invalid');
    scheduleExpiry(Number(record.createdAt));
    return;
  }

  if (result.kind === 'needs-country') {
    clearLastSuccess();
    const record = /** @type {Record<string, unknown>} */ (result.value);
    pending = /** @type {typeof pending} */ (record);
    el.selectedNumber.textContent = displayValue(record.extracted);
    clearError();
    renderList();
    setState('needs-country');
    scheduleExpiry(Number(record.createdAt));
    return;
  }

  showEmpty(false);
}

/** @param {typeof countries[number]} country */
function groupFor(country) {
  if (country.priorityGroup <= 2) return 'Popular';
  if (country.priorityGroup === 3) return 'Europe';
  return 'Other countries';
}

/** @param {typeof countries[number]} country */
function createOption(country) {
  const option = document.createElement('li');
  option.id = `country-option-${country.isoCode}`;
  option.className = 'country-option';
  option.dataset.iso = country.isoCode;
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', String(country.isoCode === selectedIso));
  if (country.isoCode === activeIso) option.classList.add('is-active');
  if (country.isoCode === selectedIso) option.classList.add('is-selected');

  const flag = document.createElement('span');
  flag.className = 'flag';
  flag.setAttribute('aria-hidden', 'true');
  flag.textContent = country.flag;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = country.name;

  const code = document.createElement('span');
  code.className = 'code';
  code.textContent = `+${country.callingCode}`;

  const check = document.createElement('span');
  check.className = 'check';
  check.setAttribute('aria-hidden', 'true');

  option.append(flag, name, code, check);
  option.addEventListener('click', () => selectCountry(country.isoCode));

  return option;
}

function renderList() {
  const query = el.search.value;
  visibleCountries = filterCountries(countries, query);

  const fragment = document.createDocumentFragment();
  let currentGroup = '';

  for (const country of visibleCountries) {
    const group = groupFor(country);
    if (group !== currentGroup) {
      const heading = document.createElement('li');
      heading.className = 'country-group';
      heading.setAttribute('role', 'presentation');
      heading.textContent = group;
      fragment.append(heading);
      currentGroup = group;
    }
    fragment.append(createOption(country));
  }

  el.list.replaceChildren(fragment);

  el.listEmpty.hidden = visibleCountries.length > 0;
  if (visibleCountries.length === 0) {
    const trimmed = query.trim();
    el.listEmpty.textContent = trimmed ? `No country matches “${trimmed}”.` : 'No countries available.';
  }

  el.search.setAttribute('aria-expanded', String(visibleCountries.length > 0));

  if (!visibleCountries.some((country) => country.isoCode === activeIso)) {
    activeIso = visibleCountries[0]?.isoCode ?? null;
  }

  for (const option of el.list.querySelectorAll('[role="option"]')) {
    option.classList.toggle('is-active', option.dataset.iso === activeIso);
  }

  updateActiveDescendant();
  updateSelectedUI();
}

function updateSelectedUI() {
  for (const option of el.list.querySelectorAll('[role="option"]')) {
    const isSelected = option.dataset.iso === selectedIso;
    option.classList.toggle('is-selected', isSelected);
    option.setAttribute('aria-selected', String(isSelected));
  }

  const country = countryByIso.get(selectedIso);
  el.selectedNote.textContent = country ? `${country.name} (+${country.callingCode})` : '';
}

function updateActiveDescendant() {
  if (activeIso && visibleCountries.some((country) => country.isoCode === activeIso)) {
    el.search.setAttribute('aria-activedescendant', `country-option-${activeIso}`);
  } else {
    el.search.removeAttribute('aria-activedescendant');
  }
}

/** @param {string} iso */
function setActive(iso) {
  activeIso = iso;

  for (const option of el.list.querySelectorAll('[role="option"]')) {
    option.classList.toggle('is-active', option.dataset.iso === iso);
  }

  updateActiveDescendant();
  document.getElementById(`country-option-${iso}`)?.scrollIntoView({ block: 'nearest' });
}

/** @param {number} delta */
function moveActive(delta) {
  if (!visibleCountries.length) return;

  const currentIndex = visibleCountries.findIndex((country) => country.isoCode === activeIso);
  const start = currentIndex === -1 ? (delta > 0 ? -1 : 0) : currentIndex;
  const nextIndex = Math.min(Math.max(start + delta, 0), visibleCountries.length - 1);

  setActive(visibleCountries[nextIndex].isoCode);
}

/** @param {string} iso */
function selectCountry(iso) {
  if (!countryByIso.has(iso)) return;

  selectedIso = iso;
  storeCountry(iso);
  setActive(iso);
  updateSelectedUI();
  clearError();
}

async function openWhatsApp() {
  if (converting || !pending) return;

  const country = countryByIso.get(selectedIso);
  if (!country) {
    showError('Please select a country.');
    return;
  }

  converting = true;
  clearError();
  setState('converting');
  el.openButton.disabled = true;
  el.openButton.textContent = 'Opening WhatsApp…';
  el.form.setAttribute('aria-busy', 'true');

  let failure = 'Unable to create WhatsApp link.';

  try {
    const parsed = parseNational(pending.extracted ?? '', country.isoCode);

    if (!parsed) {
      failure = 'This number could not be converted to an international phone number.';
      throw new Error('conversion failed');
    }

    const url = buildWhatsAppUrl(parsed.digits);
    if (!WHATSAPP_URL.test(url)) {
      throw new Error('invalid WhatsApp URL');
    }

    await chrome.tabs.create({ url });

    const success = { url, createdAt: Date.now() };
    storeLastSuccess(success);
    await removePending();
    renderSuccess(success);
  } catch {
    setState('error');
    showError(failure);
  } finally {
    converting = false;
    el.openButton.disabled = false;
    el.openButton.textContent = 'Open in WhatsApp';
    el.form.removeAttribute('aria-busy');
  }
}

async function openAgain() {
  if (!lastSuccess) return;

  el.openAgain.disabled = true;
  try {
    await chrome.tabs.create({ url: lastSuccess.url });
  } catch {
    // The existing success state can be retried.
  } finally {
    el.openAgain.disabled = false;
  }
}

/** @param {HTMLElement} target */
function isTypingTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

function bindEvents() {
  el.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void openWhatsApp();
  });

  el.search.addEventListener('input', () => {
    activeIso = null;
    renderList();
    clearError();
  });

  el.search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      if (visibleCountries[0]) setActive(visibleCountries[0].isoCode);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const last = visibleCountries[visibleCountries.length - 1];
      if (last) setActive(last.isoCode);
      return;
    }

    if (event.key === 'Enter') {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (activeIso) selectCountry(activeIso);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (el.search.value) {
        el.search.value = '';
        activeIso = null;
        renderList();
      } else {
        el.search.blur();
      }
      clearError();
    }
  });

  el.openAgain.addEventListener('click', () => {
    void openAgain();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (isTypingTarget(/** @type {HTMLElement} */ (event.target)) || el.formPanel.hidden) return;
      event.preventDefault();
      el.search.focus();
      el.search.select();
      return;
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (el.formPanel.hidden || el.openButton.disabled) return;
      event.preventDefault();
      el.form.requestSubmit();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !(PENDING_KEY in changes)) return;
    if (converting) return;

    const next = changes[PENDING_KEY].newValue;

    if (next === undefined) {
      if (state === 'empty' || state === 'success') return;
      showEmpty(false);
      return;
    }

    el.search.value = '';
    activeIso = selectedIso;
    applyPending(next);
  });
}

async function init() {
  bindEvents();
  renderList();

  let storedPending = null;
  try {
    const stored = await chrome.storage.session.get(PENDING_KEY);
    storedPending = stored[PENDING_KEY] ?? null;
  } catch {
    // Fall through to the success or empty state.
  }

  if (normalizePending(storedPending).kind !== 'none') {
    applyPending(storedPending);
    return;
  }

  const success = readLastSuccess();
  if (success) {
    renderSuccess(success);
    return;
  }

  showEmpty(false);
}

void init();

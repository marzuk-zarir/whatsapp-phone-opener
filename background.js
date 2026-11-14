import {
  buildWhatsAppUrl,
  extractPhoneCandidate,
  parseInternational
} from './lib/phone-number-parser.js';

const MENU_ID = 'open-in-whatsapp';
const PENDING_KEY = 'pendingSelection';
const PICKER_PATH = 'picker/picker.html';
const STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_RAW_TEXT = 500;
const BADGE_DURATION_MS = 4000;

/** @type {ReturnType<typeof setTimeout> | null} */
let badgeTimer = null;

/** Create the context menu, replacing any previous registration. */
function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: 'Open in WhatsApp',
        contexts: ['selection']
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  });
}

/** @returns {Promise<void>} */
async function showInvalidBadge() {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
    await chrome.action.setBadgeText({ text: '!' });

    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, BADGE_DURATION_MS);
  } catch {
    // Badge feedback is best-effort.
  }
}

/**
 * Remove a pending selection older than the allowed window.
 * @returns {Promise<void>}
 */
async function clearStalePending() {
  try {
    const stored = await chrome.storage.session.get(PENDING_KEY);
    const pending = stored[PENDING_KEY];
    if (!pending) return;
    if (typeof pending.createdAt !== 'number' || Date.now() - pending.createdAt > STALE_AFTER_MS) {
      await chrome.storage.session.remove(PENDING_KEY);
    }
  } catch {
    // Ignore storage failures; the picker has its own guards.
  }
}

/**
 * Write the pending selection for the picker page.
 * @param {{ id: string, rawText: string, extracted: string, status: 'needs-country' | 'invalid', createdAt: number }} pending
 * @returns {Promise<void>}
 */
async function writePending(pending) {
  await chrome.storage.session.set({ [PENDING_KEY]: pending });
}

/** @returns {Promise<chrome.tabs.Tab | null>} */
async function findPickerTab() {
  try {
    const url = chrome.runtime.getURL(PICKER_PATH);
    const tabs = await chrome.tabs.query({ url });
    return tabs.find((tab) => typeof tab.id === 'number') ?? null;
  } catch {
    return null;
  }
}

/**
 * Focus an existing picker tab or open a new one in a normal browser tab.
 * @returns {Promise<void>}
 */
async function openOrFocusPicker() {
  const existing = await findPickerTab();

  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === 'number') {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: chrome.runtime.getURL(PICKER_PATH) });
}

/**
 * Report an invalid selection through the badge and, if open, the picker page.
 * @param {string} rawText
 * @param {string | null} extracted
 * @returns {Promise<void>}
 */
async function reportInvalid(rawText, extracted) {
  await showInvalidBadge();

  const pickerTab = await findPickerTab();
  if (!pickerTab) return;

  try {
    await writePending({
      id: crypto.randomUUID(),
      rawText: rawText.slice(0, MAX_RAW_TEXT),
      extracted: extracted ?? '',
      status: 'invalid',
      createdAt: Date.now()
    });
  } catch {
    // The badge already reported the failure.
  }
}

/**
 * Handle a context-menu selection.
 * @param {string} selectionText
 * @returns {Promise<void>}
 */
async function handleSelection(selectionText) {
  const rawText = typeof selectionText === 'string' ? selectionText : '';

  try {
    const international = parseInternational(rawText);
    if (international) {
      const url = buildWhatsAppUrl(international.digits);
      await chrome.tabs.create({ url });
      return;
    }

    const candidate = extractPhoneCandidate(rawText);
    if (!candidate || candidate.startsWith('+') || candidate.startsWith('00')) {
      await reportInvalid(rawText, candidate);
      return;
    }

    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) {
      await reportInvalid(rawText, candidate);
      return;
    }

    await clearStalePending();
    await writePending({
      id: crypto.randomUUID(),
      rawText: rawText.slice(0, MAX_RAW_TEXT),
      extracted: candidate,
      status: 'needs-country',
      createdAt: Date.now()
    });

    await openOrFocusPicker();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('WhatsApp opener failed:', message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  void clearStalePending();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
  void clearStalePending();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  void handleSelection(info.selectionText ?? '');
});

chrome.action.onClicked.addListener(() => {
  void openOrFocusPicker().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('Unable to open picker:', message);
  });
});

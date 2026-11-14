# Chrome Extension Specification: WhatsApp Phone Number Opener

A lightweight Google Chrome extension built with **Manifest V3**.

> **Architecture note:** the country picker is a full extension page opened in a normal browser tab.
> It is not a popup window and not the small toolbar popup.

---

# 0. Key Design Decisions

| Area | Decision |
| --- | --- |
| Country selection surface | Full extension page (`picker/picker.html`) in a regular Chrome tab |
| How it is opened | `chrome.tabs.create({ url: chrome.runtime.getURL('picker/picker.html') })` |
| Data hand-off | Selection stored in `chrome.storage.session`; the picker page reads it |
| Permissions | `contextMenus`, `tabs`, `storage` |
| UI layout | Responsive full-page layout with a centered card |
| Invalid selections | Toolbar badge + picker page error state; no popup exists |
| After opening WhatsApp | New tab; picker page stays open with a success state |
| Extension pages | `picker/` |
| Phone parsing | Local `libphonenumber-js`; no network calls |

**Explicitly forbidden:**

- `chrome.windows.create({ type: 'popup' })`
- `"default_popup"` in the `action` manifest key
- Any separate small popup window for country selection

---

# 1. Goal

Build a lightweight Google Chrome extension using **Manifest V3**.

The extension allows users to select a phone number on any webpage, right-click the selected text,
and open the corresponding WhatsApp chat using:

```text
https://wa.me/{normalized_phone_number}
```

The extension must intelligently detect whether the selected phone number already contains an
international country code.

**If the country code is missing, the extension must open a dedicated full page in a new browser tab
where the user can choose the country code**, then continue to WhatsApp from that page.

---

# 2. Core User Flow

## Case A: Phone number already contains a country code

Example selected text:

```text
+1 (415) 555-1234
```

When the user:

1. Selects the phone number on any webpage.
2. Right-clicks the selection.
3. Chooses `Open in WhatsApp`.

The extension should:

1. Detect that the number already contains an international country code.
2. Normalize the number.
3. Open WhatsApp in a **new browser tab**.

For the example above, the resulting URL must be:

```text
https://wa.me/14155551234
```

No picker page is opened in this case.

---

## Case B: Country code is missing

Example selected text:

```text
01712345678
```

The extension must **not** open WhatsApp immediately and must **not** open a popup window.

Instead it must:

1. Store the extracted number in session storage.
2. Open the extension's full picker page in a **new browser tab**:

```text
chrome-extension://<extension-id>/picker/picker.html
```

3. The page displays the selected number and a searchable country selector.
4. The default country is `🇺🇸🇨🇦 USA/CANADA (+1)`.
5. The user picks a country and presses `[ Open in WhatsApp ]`.
6. The page converts the number and opens `https://wa.me/{digits}` in **another new tab**.
7. The original webpage tab remains untouched.

The picker page stays open and shows a success confirmation with the generated link.

---

## Case C: Selection is not a valid phone number

Examples:

```text
hello
abc@example.com
123
2026-09-23
```

The extension must:

1. Not open WhatsApp.
2. Not open the picker page (avoid a full tab for an obvious non-number).
3. Show brief feedback using the toolbar badge (`!` for ~4 seconds) and log the reason.
4. If the picker page is already open, it may display the last error in its error area.

There is no popup in this design, so invalid selections are reported through the toolbar badge. The
picker page shows an inline error area only when it is already open.

---

# 3. Phone Number Normalization

Before generating the WhatsApp URL, normalize the number.

Remove:

- spaces
- `-`
- `(`
- `)`
- `+`
- dots `.` (common formatting)
- leading `00` international prefix (convert to international form first)

Example:

```text
+1 (415) 555-1234
```

becomes:

```text
14155551234
```

Another example:

```text
+44 20 7946 0958
```

becomes:

```text
442079460958
```

The final URL:

```text
https://wa.me/442079460958
```

The final WhatsApp number must contain digits only.

---

# 4. Detecting Existing Country Codes

The extension should detect international numbers such as:

```text
+8801712345678
+1 415 555 1234
+44 20 7946 0958
+49 (30) 123456
+91 9876543210
```

Numbers beginning with `+` are international numbers.

Also support common international prefix notation:

```text
008801712345678
0014155551234
00442079460958
```

Normalize these into international digits (`00` → `+`) and validate.

Prefer:

```text
libphonenumber-js
```

instead of manually implementing international numbering rules.

**Detection rule used by the background worker:**

1. Trim and extract the phone-like substring from the selection.
2. If it starts with `+` (or `00`), parse without a default country.
3. If parsing yields a valid international number, open WhatsApp immediately.
4. Otherwise treat it as a local number and hand it to the picker page.

---

# 5. Local Number Conversion

If the selected number does not contain an international country code:

1. Open the picker page (full tab).
2. Page loads the pending selection from `chrome.storage.session`.
3. User selects a country (default: USA/CANADA).
4. Parse the national number using that country's numbering rules.
5. Convert it to international format (E.164).
6. Remove the leading `+`.
7. Generate the WhatsApp URL.
8. Open it in a new tab.

Example:

```text
Selected number:
01712345678

Country:
🇧🇩 Bangladesh (+880)

International:
+8801712345678

Final:
https://wa.me/8801712345678
```

---

# 6. Picker Page (Full Tab)

## 6.1 What it is

A **normal extension page** (`picker/picker.html`) rendered in a regular browser tab.
It is not a browser-action popup, not a panel, and not a separate popup window.

## 6.2 How it is opened

From the background service worker:

```javascript
await chrome.storage.session.set({
  pendingSelection: {
    id: crypto.randomUUID(),
    rawText: info.selectionText,
    extracted: extractedNumber,
    status: 'needs-country',
    createdAt: Date.now()
  }
});

const pickerUrl = chrome.runtime.getURL('picker/picker.html');
const existing = await chrome.tabs.query({ url: pickerUrl });

if (existing.length > 0) {
  await chrome.tabs.update(existing[0].id, { active: true });
  await chrome.windows.update(existing[0].windowId, { focused: true });
} else {
  await chrome.tabs.create({ url: pickerUrl });
}
```

**Rules:**

- Reuse an already-open picker tab when one exists; otherwise create a new tab.
- Never use `chrome.windows.create`.
- Never put the phone number in the page URL/query string (it would leak into browser history).
- Hand off data only through `chrome.storage.session`.

## 6.3 Page states

The page must handle these states explicitly:

| State | Trigger | UI |
| --- | --- | --- |
| `loading` | First paint while reading storage | Skeleton / spinner |
| `needs-country` | Pending selection exists | Number + country selector + Open button |
| `invalid` | Pending selection exists but fails validation | Error banner, number shown, no Open button |
| `empty` | No pending selection (refresh, stale, direct visit) | Instructions: select a number on a page, right-click, choose `Open in WhatsApp` |
| `converting` | Open button pressed | Button disabled with progress label |
| `success` | WhatsApp URL built and tab opened | Confirmation + generated link + `Open again` |
| `error` | Conversion or URL generation failed | Inline error message, retry allowed |

## 6.4 Lifecycle

- Read `pendingSelection` once on `DOMContentLoaded`.
- Subscribe to `chrome.storage.onChanged` (area `session`) so a second context-menu action updates
  the already-open page live instead of leaving stale data.
- Keep the pending entry after page load so refreshing the page still works.
- After a successful WhatsApp open, mark it consumed and remove it from `chrome.storage.session`.
- Ignore entries older than **10 minutes** and treat them as `empty`.
- On `success`, keep the result in the tab's own `sessionStorage` so a refresh still shows the last link.

## 6.5 Multiple selections

There is exactly one `pendingSelection` key. Last write wins. This is acceptable because the picker
reuses a single tab. If several numbers are selected quickly, only the newest is shown.

---

# 7. Default Country

When the country code is missing, the country selector must default to:

```text
🇺🇸🇨🇦 USA/CANADA (+1)
```

USA and Canada share the same international calling code (`+1`), so they appear as **one option**:

```text
🇺🇸🇨🇦 USA/CANADA (+1)
```

Do not display USA and Canada as separate options.

---

# 8. Country List Priority and Ordering

The country selector must **not simply display countries alphabetically**.

Use these groups:

## Group 1: USA / Canada

```text
🇺🇸🇨🇦 USA/CANADA (+1)
```

Always first, and the default selection.

## Group 2: Oceania

```text
🇦🇺 Australia (+61)
🇳🇿 New Zealand (+64)
```

## Group 3: Developed European Countries

```text
🇬🇧 United Kingdom (+44)
🇩🇪 Germany (+49)
🇫🇷 France (+33)
🇳🇱 Netherlands (+31)
🇧🇪 Belgium (+32)
🇨🇭 Switzerland (+41)
🇦🇹 Austria (+43)
🇸🇪 Sweden (+46)
🇳🇴 Norway (+47)
🇩🇰 Denmark (+45)
🇫🇮 Finland (+358)
🇮🇪 Ireland (+353)
🇮🇸 Iceland (+354)
🇱🇺 Luxembourg (+352)
```

Additional European countries follow according to the priority dataset.

## Group 4: Other Developed / High-Income Countries

```text
🇯🇵 Japan (+81)
🇰🇷 South Korea (+82)
🇸🇬 Singapore (+65)
🇮🇱 Israel (+972)
```

## Group 5: Remaining Countries

All remaining countries, alphabetically by country name.

```text
🇧🇩 Bangladesh (+880)
🇮🇳 India (+91)
🇵🇰 Pakistan (+92)
🇳🇵 Nepal (+977)
...
```

---

# 9. Country Ordering Rule

Ordering is explicit in the country dataset. Do **not** dynamically determine "developed" status
using GDP, economic data, or external APIs. Use static fields:

```javascript
{
  name: "USA/CANADA",
  isoCode: "US-CA",
  callingCode: "1",
  flag: "🇺🇸🇨🇦",
  priorityGroup: 1,
  priorityOrder: 1
}
```

```javascript
{
  name: "Australia",
  isoCode: "AU",
  callingCode: "61",
  flag: "🇦🇺",
  priorityGroup: 2,
  priorityOrder: 1
}
```

```javascript
{
  name: "Bangladesh",
  isoCode: "BD",
  callingCode: "880",
  flag: "🇧🇩",
  priorityGroup: 5,
  priorityOrder: 1
}
```

Sort using:

```text
priorityGroup → priorityOrder → country name
```

---

# 10. Country Dataset

Use a local dataset with this shape:

```javascript
{
  name: "United Kingdom",
  isoCode: "GB",
  callingCode: "44",
  flag: "🇬🇧",
  priorityGroup: 3,
  priorityOrder: 1
}
```

The dataset must cover all countries/regions with an international calling code, including
Group 5 entries. It remains local to the extension; no network fetch.

---

# 11. Same Calling Code Grouping

Countries/regions that share a calling code should be grouped where appropriate, e.g.
`🇺🇸🇨🇦 USA/CANADA (+1)`.

The dataset must support: country name, ISO code, calling code, flag, priority group, priority order.

Do not merge countries solely because their numbers use similar formatting.

---

# 12. Picker Page UI

The picker page is a full page. Suggested layout:

```text
┌────────────────────────────────────────────────────────────────────┐
│  WhatsApp Number Opener                                            │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Open in WhatsApp                                            │  │
│  │                                                              │  │
│  │  Selected number                                             │  │
│  │  01712345678                                                 │  │
│  │                                                              │  │
│  │  Country                                                     │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ 🔍 Search country...                                   │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │  POPULAR                                                     │  │
│  │  🇺🇸🇨🇦 USA/CANADA (+1)              ✓ selected              │  │
│  │  🇦🇺 Australia (+61)                                         │  │
│  │  🇳🇿 New Zealand (+64)                                       │  │
│  │  EUROPE                                                      │  │
│  │  🇬🇧 United Kingdom (+44)                                    │  │
│  │  🇩🇪 Germany (+49)                                           │  │
│  │  ...                                                         │  │
│  │                                                              │  │
│  │  [ Open in WhatsApp ]                                        │  │
│  │  Error message area                                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

Requirements:

- Responsive full-page layout; works from ~360px mobile width to wide desktop.
- Centered content card, max-width around 640–760px.
- System font stack; no remote fonts.
- Light and dark mode via `prefers-color-scheme`.
- Country selector is a searchable listbox/combobox, not a native `<select>`.
- Group headings (`POPULAR`, `EUROPE`, `OTHER COUNTRIES`) are visually separated.
- Each option shows `FLAG + COUNTRY NAME (+CALLING CODE)`.
- Selected option is clearly indicated.
- Keyboard accessible:
  - `/` focuses search
  - `↑` / `↓` moves the active option
  - `Enter` selects
  - `Esc` clears search
  - `Ctrl/Cmd + Enter` triggers Open
- Explicit `Open in WhatsApp` button.
- USA/CANADA selected by default.
- Priority countries appear first.
- Success state shows the final `https://wa.me/{digits}` link (clickable) and an `Open again` button.
- Empty state explains how to use the extension from the context menu.

---

# 13. Country Search

The selector supports searching.

Examples:

```text
bang   → 🇧🇩 Bangladesh (+880)
usa    → 🇺🇸🇨🇦 USA/CANADA (+1)
+880   → 🇧🇩 Bangladesh (+880)
gb     → 🇬🇧 United Kingdom (+44)
```

Search matches:

- country name
- ISO code
- calling code (with or without `+`)

Search results must preserve the underlying priority ordering; do not reorder by fuzzy score in a way
that breaks priority groups. Filtering is acceptable; ranking within a group follows the dataset.

---

# 14. Context Menu

Create a Chrome context-menu entry:

```text
Open in WhatsApp
```

It appears when text is selected.

```javascript
chrome.contextMenus.create({
  id: 'open-in-whatsapp',
  title: 'Open in WhatsApp',
  contexts: ['selection']
});
```

Flow:

```text
Selected text
      ↓
Extract phone number
      ↓
Parse with libphonenumber-js
      ↓
Valid? ── no ──→ toolbar badge "!" (no tab)
      │ yes
      ↓
International country code?
      │
 ┌────┴─────┐
 YES        NO
  ↓          ↓
Normalize   Store pending selection
  ↓          ↓
WhatsApp    Open picker page in new tab
URL          ↓
  ↓         Select country (default USA/CANADA)
New tab      ↓
            Convert number
             ↓
            WhatsApp URL
             ↓
            New tab
```

Context-menu creation must be registered in `chrome.runtime.onInstalled` (and guarded for service
worker restarts).

---

# 15. Input Validation

Reject clearly invalid selections such as:

```text
hello
abc@example.com
123
2026-09-23
```

Show the invalid state (badge + picker page error if open). The page error text:

```text
Invalid phone number.
Please select a valid phone number.
```

The parser tolerates common formatting:

```text
+880-1712-345678
+1 (415) 555-1234
+44 (20) 7946-0958
01712-345678
```

---

# 16. Selected Text Extraction

Selected text may contain surrounding text:

```text
Call us at +880 1712-345678 today
```

```text
Phone: (415) 555-1234
```

Extract the phone-number-like portion. Avoid interpreting arbitrary numeric strings as phone numbers:

```text
Order #123456
Invoice 2026-12345
Product 12345
```

Use `libphonenumber-js` validation plus reasonable extraction logic (regex candidates, then validate
each candidate with the library).

---

# 17. Page UX Requirements

- Fast first paint; no remote resources.
- No layout shift when the country list renders.
- Visible focus rings.
- Semantic HTML (`<main>`, `<h1>`, `<form>`, `<ul role="listbox">`, etc.).
- Accessible labels for search and listbox.
- Errors announced via `aria-live="polite"`.
- No framework required; plain HTML/CSS/JS.
- The page must never crash on malformed storage state; fall back to `empty`.

These requirements apply to the full-page picker. All layout decisions assume a normal browser tab,
not a compact popup.

---

# 18. New Tab Behavior

After successful parsing:

```text
https://wa.me/{normalized_phone_number}
```

Open it in a **new Chrome tab**:

```javascript
chrome.tabs.create({ url: `https://wa.me/${phoneNumber}` });
```

Rules:

- Do not replace the current webpage.
- The picker page is a separate tab; opening WhatsApp must not navigate the original webpage.
- The picker tab itself stays open on its `success` state.
- Do not use `window.open` with popup features; use `chrome.tabs.create`.
- Only digits after `wa.me/`.

---

# 19. Architecture

```text
whatsapp-number-opener/
│
├── manifest.json
├── background.js              # service worker (ES module)
│
├── picker/
│   ├── picker.html            # full-page country selector
│   ├── picker.css
│   └── picker.js
│
├── lib/
│   ├── phone-number-parser.js # wrapper around libphonenumber-js
│   └── libphonenumber-js.min.mjs  # vendored library (no CDN)
│
├── data/
│   └── countries.js           # ES module exporting the country array
│
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
│
└── README.md
```

Use plain HTML, CSS, JavaScript, and Manifest V3. No framework unless there is a clear technical
benefit.

`background.js` must declare `"type": "module"` in the manifest so it can import the parser and
country data.

---

# 20. Manifest V3

```json
{
  "manifest_version": 3,
  "name": "WhatsApp Number Opener",
  "version": "1.0.0",
  "description": "Open selected phone numbers directly in WhatsApp.",
  "permissions": ["contextMenus", "tabs", "storage"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_title": "WhatsApp Number Opener"
  },
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

Notes:

- **No `default_popup`** on `action`.
- **No `windows` popup creation.**
- `storage` is required for `chrome.storage.session`.
- No host permissions, no `scripting`, no `notifications`, no remote code.
- Clicking the toolbar icon opens the picker page in `empty` state (help text), not a popup.

---

# 21. State Contract (`chrome.storage.session`)

Key: `pendingSelection`

```javascript
{
  id: "uuid",
  rawText: "Call us at 01712345678",
  extracted: "01712345678",
  status: "needs-country",   // "needs-country" | "invalid"
  createdAt: 1760000000000   // epoch ms
}
```

Rules:

- Written by `background.js` before opening/focusing the picker tab.
- Read by `picker.js` on load and on `chrome.storage.onChanged`.
- Removed after a successful WhatsApp open.
- Entries older than 10 minutes are treated as stale and cleared.
- Never store the number in `localStorage`, sync storage, analytics, or a server.
- `session` storage is cleared automatically when the browser session ends.

---

# 22. Security and Privacy

The extension must:

- process phone numbers locally
- never send selected numbers to external servers
- not collect analytics
- not store phone numbers beyond the active session
- not require an account, API key, or backend
- not load remote JavaScript, CSS, or fonts
- bundle `libphonenumber-js` locally
- avoid putting phone numbers in URLs, logs, or browser history
- clear the pending selection after use

`chrome.storage.session` is used specifically because it is memory-backed and not persisted to disk.

---

# 23. Error Handling

Handle these messages inside the picker page:

```text
Invalid phone number.
Please select a valid phone number.
```

```text
Please select a country.
```

```text
This number could not be converted to an international phone number.
```

```text
Unable to create WhatsApp link.
```

Additional page states:

```text
No number selected yet.
Select a phone number on a webpage, right-click it, and choose "Open in WhatsApp".
```

```text
The selected number has expired. Please select it again.
```

Errors must not crash the extension. All async storage/tabs calls are wrapped in `try/catch`.

---

# 24. WhatsApp URL Requirements

The final URL must always be:

```text
https://wa.me/{digits}
```

Valid:

```text
https://wa.me/8801712345678
```

Invalid:

```text
https://wa.me/+8801712345678
https://wa.me/880 1712 345678
https://wa.me/01712345678   (when the selected country is Bangladesh)
```

Only digits after `wa.me/`.

Build the URL in one place (`lib/phone-number-parser.js` or a small helper) and validate with a
regex such as `/^https:\/\/wa\.me\/\d{6,15}$/` before opening.

---

# 25. Preferred Technical Library

Use:

```text
libphonenumber-js
```

for:

- phone-number validation
- country detection
- international conversion
- national-number parsing
- international numbering rules

Bundle it locally (vendored `.mjs` build) rather than loading from a CDN.

Suggested wrapper API (`lib/phone-number-parser.js`):

```javascript
export function extractPhoneCandidate(text) {}
export function parseInternational(text) {}   // returns E.164 digits or null
export function parseNational(text, isoCode) {} // returns E.164 digits or null
export function buildWhatsAppUrl(digits) {}   // returns validated URL or throws
```

---

# 26. Expected Examples

## Example 1: International Bangladesh

```text
Selected: +8801712345678
Result:   https://wa.me/8801712345678
```

No picker page opened.

## Example 2: International USA

```text
Selected: +1 (415) 555-1234
Result:   https://wa.me/14155551234
```

No picker page opened.

## Example 3: Local Bangladesh

```text
Selected: 01712345678
```

Picker page opens in a **new tab** (`chrome-extension://.../picker/picker.html`).

Default: `🇺🇸🇨🇦 USA/CANADA (+1)`

User selects `🇧🇩 Bangladesh (+880)` and presses Open.

```text
Result: https://wa.me/8801712345678
```

## Example 4: Local United Kingdom

```text
Selected: 020 7946 0958
User selects: 🇬🇧 United Kingdom (+44)
Result: https://wa.me/442079460958
```

## Example 5: Picker page opened directly

```text
User visits the picker page with no pending selection.
```

Page shows the `empty` state with instructions. No error dialog, no crash.

---

# 27. Priority Ordering Test

The first entries in the picker page should follow the configured dataset:

```text
🇺🇸🇨🇦 USA/CANADA (+1)

🇦🇺 Australia (+61)
🇳🇿 New Zealand (+64)

🇬🇧 United Kingdom (+44)
🇩🇪 Germany (+49)
🇫🇷 France (+33)
🇳🇱 Netherlands (+31)
🇧🇪 Belgium (+32)
🇨🇭 Switzerland (+41)
🇦🇹 Austria (+43)
🇸🇪 Sweden (+46)
🇳🇴 Norway (+47)
🇩🇰 Denmark (+45)
🇫🇮 Finland (+358)
🇮🇪 Ireland (+353)
🇮🇸 Iceland (+354)
🇱🇺 Luxembourg (+352)

🇯🇵 Japan (+81)
🇰🇷 South Korea (+82)
🇸🇬 Singapore (+65)
🇮🇱 Israel (+972)

...
```

Ordering comes only from `priorityGroup` and `priorityOrder`, not hardcoded UI positions.

---

# 28. Testing Requirements

## International numbers

```text
+8801712345678
+1 415 555 1234
+44 20 7946 0958
+49 30 123456
+91 9876543210
```

## Local numbers

```text
01712345678
4155551234
02079460958
030123456
```

## Formatted numbers

```text
+880-1712-345678
+1 (415) 555-1234
+44 (20) 7946-0958
```

## Invalid selections

```text
hello
abc123
123
2026-09-23
```

## Page and tab behavior

- [ ] Selecting an international number opens `wa.me` directly with **no picker tab**.
- [ ] Selecting a local number opens the picker as a **normal tab**, not a popup window.
- [ ] No `chrome.windows.create` call exists in the codebase.
- [ ] No `default_popup` exists in `manifest.json`.
- [ ] Triggering the context menu again focuses/reuses the existing picker tab.
- [ ] An open picker tab updates live when a new selection arrives.
- [ ] Refreshing the picker tab still shows the pending number.
- [ ] After >10 minutes the pending number is treated as expired.
- [ ] After opening WhatsApp, the pending selection is removed from session storage.
- [ ] The original webpage is never replaced or scrolled.
- [ ] The toolbar icon opens the picker page in `empty` state, not a popup.
- [ ] Invalid selections do not open a tab.
- [ ] Deep-linking the picker page without state shows the empty state.

## General

- [ ] context menu works on normal webpages
- [ ] USA/CANADA is the default
- [ ] priority countries appear first
- [ ] country groups are correctly ordered
- [ ] flags are displayed
- [ ] country search works (name, ISO, calling code)
- [ ] calling codes are displayed
- [ ] shared calling codes are grouped appropriately
- [ ] local numbers are converted correctly
- [ ] final WhatsApp URLs contain digits only
- [ ] links open in a new tab
- [ ] phone numbers never leave the user's device

---

# 29. Implementation Task List (What To Build)

Ordered by dependency. Each task maps to a section above.

## Phase 1 — Scaffold

1. Create the directory structure from §19.
2. Create `manifest.json` per §20 (MV3, `storage`, no `default_popup`, module service worker).
3. Generate the four PNG icons (16/32/48/128).
4. Create a minimal `README.md` describing install and usage.

## Phase 2 — Data and phone logic

5. Build `data/countries.js` with all countries, flags, ISO codes, calling codes,
   `priorityGroup`, and `priorityOrder` (§8–§11).
6. Vendor `libphonenumber-js` locally as an `.mjs` browser build (§25).
7. Implement `lib/phone-number-parser.js`:
   - candidate extraction from free text
   - international parsing (`+`, `00`)
   - national parsing with a selected country
   - E.164 digit output
   - WhatsApp URL builder + validation regex
8. Add unit-level sanity tests (plain Node script or browser console fixture) for the §28 number
   lists.

## Phase 3 — Background service worker

9. Register the `Open in WhatsApp` context menu on install (§14).
10. Handle `chrome.contextMenus.onClicked`:
    - extract + validate
    - invalid → badge `!` for ~4s, no tab
    - international → open `wa.me` in a new tab
    - local → write `pendingSelection` to `chrome.storage.session`, open/focus picker tab
11. Implement picker-tab reuse (`tabs.query` by extension URL, else `tabs.create`) (§6.2).
12. Add stale-entry cleanup (>10 min) and defensive `try/catch`.
13. Make the toolbar action open the picker page in `empty` state (§20).

## Phase 4 — Picker page

14. Build `picker/picker.html` semantic structure: header, selected number, search, listbox,
    Open button, error/success regions (§12).
15. Build `picker.css`: responsive centered card, light/dark mode, group headings, focus states.
16. Build `picker.js`:
    - read `pendingSelection` and implement all states from §6.3
    - render the sorted country list with group headings
    - implement search over name/ISO/calling code (§13)
    - implement keyboard interactions (§12)
    - default USA/CANADA; preserve selection across searches
    - convert local number with the selected country
    - build URL, `chrome.tabs.create`, clear pending state, show success state
    - handle storage changes and expiry
    - show errors via `aria-live`
17. Persist the last success result in `sessionStorage` for refresh resilience.

## Phase 5 — Validation and polish

18. Run the full test matrix in §28, including the new page-behavior checklist.
19. Verify all flow examples in §26 manually.
20. Verify the priority ordering in §27.
21. Confirm zero remote requests (DevTools Network tab) and no phone numbers in logs/history.
22. Update `README.md` with architecture, permissions rationale, and the popup-free behavior.

## Phase 6 — Package

23. Load unpacked in `chrome://extensions` and smoke-test.
24. Optionally zip the folder for distribution.
25. Tag version `1.0.0`.

**Definition of done:** every checklist item in §28 passes, no popup window or toolbar popup is
used for country selection, and all WhatsApp URLs are digits-only.

---

# 30. Development Priority

1. Correct phone-number parsing.
2. Correct country-code detection.
3. Correct international conversion.
4. Correct WhatsApp URL generation.
5. Context-menu functionality.
6. Full-page picker and state hand-off.
7. Priority country ordering.
8. Country flags and search.
9. UI polish and accessibility.
10. Minimal permissions.
11. Documentation.

Do not sacrifice phone-number correctness for UI features.

---

# 31. Out of Scope

- Popup windows of any kind for country selection.
- Injected content scripts or in-page overlays.
- Backend services, analytics, accounts, API keys.
- Remote configuration or remote country data.
- Manual number entry on the picker page (possible future enhancement; not required here).
- Syncing pending selections across devices.

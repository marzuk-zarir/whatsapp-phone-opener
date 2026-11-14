# AGENTS.md — Build Guide: WhatsApp Phone Number Opener

## 0. Read This First

This file is the build guide for coding agents working in this repository.

**Source of truth:**

1. `SPEC.md` — the approved functional spec (full-page country picker, no popup window).
2. `AGENTS.md` — implementation order, design rules, and acceptance criteria.

`SPEC.md` is the single current specification. Do not modify it.

If the spec and this file conflict on **behavior**, follow the spec. If they conflict on **visual
design**, follow this file.

---

## 1. What We Are Building

A minimal Chrome Manifest V3 extension:

- User selects a phone number on a webpage → right-click → `Open in WhatsApp`.
- If the number is international (`+…` / `00…`), WhatsApp opens immediately in a new tab.
- If the country code is missing, a **full extension page opens in a normal tab** (`picker/picker.html`)
  where the user picks a country and continues to WhatsApp.
- No browser-action popup. No separate popup window. No content script overlay.

### Hard constraints

- Vanilla HTML, CSS, JavaScript. **No framework** (no React, Vue, Svelte, Tailwind, Bootstrap).
- Manifest V3, ES modules, `chrome.storage.session` for hand-off.
- No remote scripts, styles, fonts, or country data in the shipped extension.
- No host permissions. Permissions stay exactly: `contextMenus`, `tabs`, `storage`.
- `wa.me` URLs contain **digits only**.
- Phone numbers never leave the device, are never logged in full, and are never put in URLs.
- Do **not** call `chrome.windows.create()`.
- Do **not** add `"default_popup"` to `action`.
- Do not modify `SPEC.md`.

---

## 2. Non-Negotiable Architecture

```text
whatsapp-number-opener/
├── manifest.json
├── background.js                  # MV3 module service worker
├── picker/
│   ├── picker.html                 # full-page UI
│   ├── picker.css                  # custom styles (simple.css base)
│   └── picker.js                   # page logic
├── lib/
│   └── phone-number-parser.js      # generated bundle: wrapper + libphonenumber-js (ESM)
├── data/
│   └── countries.js                # exported country array
├── vendor/
│   └── simple.css                  # vendored copy of Simple.css (no CDN at runtime)
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── tests/
│   └── phone.test.mjs              # node-run parser tests
├── src/
│   └── phone.js                    # parser source, bundled into lib/
├── build.mjs                       # esbuild bundle script
├── package.json
└── README.md
```

The spec shows `lib/libphonenumber-js.min.mjs` separately. The approved implementation bundles the
library **inside** `lib/phone-number-parser.js` so the service worker and the picker both import one
local ESM file. Keep the public exports listed in §6.

### Data flow

```text
selection ──► background.js
                 ├─ international → chrome.tabs.create(wa.me/…)
                 ├─ invalid → toolbar badge "!" (no tab)
                 └─ local → chrome.storage.session.pendingSelection
                              → open/focus picker tab
                                    → picker.js reads state
                                    → user selects country
                                    → chrome.tabs.create(wa.me/…)
                                    → clear pendingSelection
```

---

## 3. Design Direction — Modern, Simple, Not "AI Slop"

The page should look like a **small, well-made utility** — closer to a settings panel in a desktop app
than a marketing landing page. Think: Linear, Things, Stripe dashboard, browser settings. Calm,
utilitarian, confident.

### 3.1 Do

- One clear task per screen: confirm the number → choose a country → open.
- Neutral surfaces, generous whitespace, strong typographic hierarchy.
- A single restrained accent color: WhatsApp green, used only for the primary button, selected
  state, and success indicator.
- 1px borders and flat surfaces. Subtle elevation only if it clarifies layering.
- Short, literal labels: `Selected number`, `Country`, `Open in WhatsApp`.
- Sentence case. No exclamation marks. No jokes. No "Oops!".
- System font stack. Fast, native, no font download.
- Motion only for feedback (hover, focus, pressed, list open): 120–160 ms, ease-out.
- Country flags are content, not decoration. Emoji flags are fine; everything else uses text or a
  simple inline SVG.
- Empty, error, and success states are plain and informative.
- Responsive from 360px to desktop.

### 3.2 Don't (explicit "AI slop" ban list)

- ❌ Purple/blue gradients, neon glows, "aurora" blobs, mesh backgrounds.
- ❌ Glassmorphism, frosted cards, heavy blur, translucent panels.
- ❌ Giant rounded cards (24px+ radius), floating drop shadows everywhere.
- ❌ Emoji as UI icons (✨ 🚀 🔥 💬 ✅). Letters are not icons either.
- ❌ Marketing copy: "Seamlessly connect!", "Supercharge your chats", "Effortless…".
- ❌ Hero sections, illustrations, decorative avatars, sparkle SVGs.
- ❌ Animated entrances, bouncing buttons, confetti, parallax.
- ❌ More than 2 font weights (use 400 and 600).
- ❌ More than one accent color.
- ❌ Center-aligned paragraphs and oversized headings.
- ❌ Fake browser chrome, fake chat bubbles, fake screenshots inside the page.
- ❌ Dark patterns: pre-selected paid option, hidden actions, unclear states.

### 3.3 Visual tokens

Use Simple.css as the base, then **override its variables** in `picker.css`. Do not fight it with
high-specificity hacks.

Simple.css exposes these variables; override them by name so the base styles follow automatically.
Add a few app-only tokens for surfaces and spacing.

```css
:root {
  /* Simple.css variable overrides */
  --sans-font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --standard-border-radius: 8px;

  --bg: #f7f7f5;
  --accent-bg: #eef4f1;
  --text: #1c1d1b;
  --text-light: #666a64;
  --border: #d7d9d4;

  --accent: #128c7e;          /* WhatsApp deep green */
  --accent-hover: #0e7266;
  --accent-text: #ffffff;

  /* App tokens */
  --surface: #ffffff;
  --muted: var(--text-light);
  --border-strong: #c9cbc5;
  --focus: #128c7e;
  --danger: #b42318;

  --radius-sm: 8px;
  --radius-md: 12px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121413;
    --accent-bg: #1c2320;
    --text: #eceeeb;
    --text-light: #9aa09a;
    --border: #2b302d;

    --accent: #25a99a;
    --accent-hover: #2cbdb0;
    --accent-text: #08201d;

    --surface: #191c1a;
    --muted: var(--text-light);
    --border-strong: #3c423e;
    --focus: #25a99a;
    --danger: #f97066;
  }
}
```

**Layout:**

- Page background: `--bg`. Content card: `--surface`, 1px `--border`, radius 12px, no shadow.
- Card width: `min(100%, 680px)`, centered with `margin-inline: auto`.
- Card padding: 32px desktop, 20px mobile.
- Vertical rhythm: label → content gap 8px; sections gap 24px.
- List rows: 44px min height, 8px horizontal padding, radius 8px on hover/selected.
- Inputs and buttons: 40px height, radius 8px, 1px border.
- Body text 15–16px, line-height 1.5. Number display 22–24px mono.
- Page title 18px / 600. Section labels 12px / 600 / uppercase / `letter-spacing: .04em` /
  `--muted`. Group headings same treatment.
- Focus ring: `outline: 2px solid var(--focus); outline-offset: 2px;` never remove focus styles.
- Primary button: solid `--accent`, white/contrast text, no gradient, no shadow. Hover darkens.
- Secondary/ghost button: transparent, 1px border.
- Disabled: 45% opacity, `cursor: not-allowed`.

**Copy tone:** direct, specific, calm. `No number selected yet.` not `Oops! Nothing here 😅`.

### 3.4 Reference wireframe (desktop)

```text
┌──────────────────────────────────────────────────────────────┐
│  WhatsApp Number Opener                                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Open in WhatsApp                                      │  │
│  │                                                        │  │
│  │  SELECTED NUMBER                                       │  │
│  │  01712345678                                           │  │
│  │                                                        │  │
│  │  COUNTRY                                    [ Search ] │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ 🇺🇸🇨🇦 USA/CANADA                    +1        ✓  │  │  │
│  │  │ 🇦🇺 Australia                        +61         │  │  │
│  │  │ 🇳🇿 New Zealand                      +64         │  │  │
│  │  │ ── EUROPE ────────────────────────────────────── │  │  │
│  │  │ 🇬🇧 United Kingdom                   +44         │  │  │
│  │  │ 🇩🇪 Germany                          +49         │  │  │
│  │  │ …                                                │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                        │  │
│  │  [ Open in WhatsApp ]                                  │  │
│  │  Error text appears here, only when needed.            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

No popup frame, no fake window, no floating toolbar.

### 3.5 Simple.css usage

- **Vendor it once:** download
  `https://raw.githubusercontent.com/kevquirk/simple.css/main/simple.css`
  (or `https://cdn.simplecss.org/simple.css`) into `vendor/simple.css`. Commit the file.
- Do **not** ship a remote `<link href="https://…">`. Remote CSS violates the spec's privacy/offline
  rules and can change without warning.
- Load order: `vendor/simple.css` → `picker/picker.css`.
- Keep custom CSS focused: tokens, layout, listbox, states. Override Simple.css variables where
  possible; reset individual elements only where necessary. Do not fork the whole file.
- Expected Simple.css defaults to neutralise in `picker.css`:
  - `body` is a 3-column grid with a `45rem` content column. For this page, set
    `body { display: block; }` and constrain the card yourself.
  - `body` font-size is `1.15rem`; set `16px` on `body` and size components from there.
  - `h1` is `3rem`; use an 18px page title.
  - `section` adds top/bottom borders; reset or avoid `<section>` for layout.
  - Inputs/buttons get `margin-bottom: .5rem`; remove it and control spacing explicitly.
  - Links use the accent color; that is fine.
- The country listbox is custom; Simple.css will not style it. Build it with a `<ul role="listbox">`
  and explicit CSS.
- Keep the vendored file unmodified so it can be updated by replacing one file.

---

## 4. Product Behavior Contract

### Context menu

- ID: `open-in-whatsapp`, title: `Open in WhatsApp`, context: `selection`.
- Registered in `chrome.runtime.onInstalled`, guarded so it isn't duplicated on worker restarts.

### Background rules

1. Extract candidate phone text.
2. Invalid → `chrome.action.setBadgeText({ text: "!" })`, clear after ~4s. Do not open a tab.
3. International → normalize → `chrome.tabs.create({ url })`.
4. Local → write `pendingSelection` to `chrome.storage.session` → reuse or open picker tab.

### Pending state

```js
{
  id: crypto.randomUUID(),
  rawText: "Call us at 01712345678",
  extracted: "01712345678",
  status: "needs-country", // or "invalid"
  createdAt: Date.now()
}
```

- Key: `pendingSelection`.
- Ignore entries older than 10 minutes.
- Remove after a successful WhatsApp open.
- Never store in `localStorage` or `storage.local`.

### Picker rules

- Normal tab at `chrome-extension://<id>/picker/picker.html`.
- States: `loading`, `needs-country`, `invalid`, `empty`, `converting`, `success`, `error`.
- Default country: `USA/CANADA (+1)`.
- Search by name, ISO, calling code (with or without `+`).
- Convert with libphonenumber using the selected country's ISO code.
- Validate the final URL against `/^https:\/\/wa\.me\/\d{6,15}$/`.
- WhatsApp opens in another new tab; the picker stays with a success state.
- Refresh keeps pending data (storage) and last success (tab's `sessionStorage`).
- Listen to `chrome.storage.onChanged` to update a reused tab live.

### Country dataset rules

- Sorting: `priorityGroup` → `priorityOrder` → name (case-insensitive).
- USA/Canada is one entry: `name: "USA/CANADA"`, `isoCode: "US"`, `secondaryIsoCode: "CA"`,
  `callingCode: "1"`, `flag: "🇺🇸🇨🇦"`, `priorityGroup: 1`, `priorityOrder: 1`.
- For parsing, always pass a **valid ISO 3166-1 alpha-2** code to libphonenumber. `US-CA` is a display
  concept, not a parse code. Store it as `name`, not `isoCode`.
- Groups 1–5 exactly as defined in `SPEC.md` §8–§11.
- No GDP / external "developed country" logic.

---

## 5. Build Setup

No framework. A tiny esbuild step exists only to bundle `libphonenumber-js` locally.

```bash
npm init -y
npm pkg set type=module
npm install libphonenumber-js
npm install --save-dev esbuild
```

`package.json` scripts:

```json
{
  "scripts": {
    "build": "node build.mjs",
    "test": "node tests/phone.test.mjs"
  }
}
```

`build.mjs`:

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/phone.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome102',
  minify: true,
  outfile: 'lib/phone-number-parser.js'
});
```

If npm is unavailable in the environment, download the package tarball from npm (not a CDN) and
vendor the ESM files it needs, or vendor a prebuilt UMD bundle and adjust loading. Either way the
shipped extension must contain **local** files only and must not fetch anything at runtime.

---

## 6. Parser Module Contract (`lib/phone-number-parser.js`)

```js
// Extract a plausible phone candidate from arbitrary selected text.
export function extractPhoneCandidate(text) {}

// Parse an international number (+… or 00…). Returns { digits, isoCode } or null.
export function parseInternational(text) {}

// Parse a national number with a country ISO. Returns { digits, isoCode } or null.
export function parseNational(text, isoCode) {}

// Build and validate a wa.me URL. Throws on invalid digits.
export function buildWhatsAppUrl(digits) {}
```

Rules:

- Return digits only; strip `+`, spaces, dashes, parentheses, dots.
- `00` prefix → international.
- Reject `<6` or `>15` digits.
- Never return a raw `+` in `buildWhatsAppUrl` output.
- Keep extraction conservative; validate every candidate with the library.
- Unit-testable without `chrome.*` APIs.

---

## 7. Task List

Work in order. Each task is done only when its acceptance line passes.

### Phase 1 — Scaffold

- [ ] **1.1** Create the directory tree from §2.
- [ ] **1.2** Create `manifest.json`:
  - MV3, name/description/version `1.0.0`
  - `permissions`: `contextMenus`, `tabs`, `storage`
  - `background.service_worker`: `background.js`, `type: module`
  - `action`: `default_title` only — no `default_popup`
  - icons 16/32/48/128
  - **Accept:** loads unpacked in `chrome://extensions` with no errors.
- [ ] **1.3** Add four PNG icons. Simple flat mark, readable at 16px. No gradients.
- [ ] **1.4** Vendor `vendor/simple.css`. **Accept:** no `https://` links in any HTML.
- [ ] **1.5** Create `README.md` skeleton: install steps, permissions explained, behavior.

### Phase 2 — Parser and dataset

- [ ] **2.1** Implement `src/phone.js` with the exports in §6 using `libphonenumber-js/min`.
- [ ] **2.2** Run `npm run build` to produce `lib/phone-number-parser.js`.
  - **Accept:** file is self-contained ESM, no CDN imports, no `eval`.
- [ ] **2.3** Implement `data/countries.js`:
  - every country/region with an international code
  - flags, ISO codes, calling codes
  - `priorityGroup` + `priorityOrder` for groups 1–5
  - USA/Canada merged
  - **Accept:** sorted output starts with the §27 order in the spec.
- [ ] **2.4** Implement `tests/phone.test.mjs` with Node `assert` for:
  - all international, local, formatted, and invalid examples in the spec
  - URL is digits-only
  - USA/Canada merges correctly
  - country sort order and search matching
  - **Accept:** `npm test` passes.

### Phase 3 — Background worker

- [ ] **3.1** Register the context menu on install; guard against duplicates.
- [ ] **3.2** Handle `contextMenus.onClicked`:
  - extract → parse → branch per §4
  - badge for invalid, clear after ~4s
  - wrap all async work in `try/catch`
- [ ] **3.3** Implement picker-tab reuse:
  ```js
  const url = chrome.runtime.getURL('picker/picker.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  ```
  **Accept:** second selection focuses the existing tab; no duplicate picker tabs.
- [ ] **3.4** Toolbar icon opens the picker page in `empty` state.
- [ ] **3.5** Add stale pending cleanup (10 min) and `storage.onChanged` compatibility.

### Phase 4 — Picker page (design-critical)

- [ ] **4.1** `picker/picker.html`: semantic structure only, no inline styles, no inline scripts.
  - `<main>` → title → card → form
  - number display with `<output>` or `<p>` and mono style
  - search input with `<label class="sr-only">` or visible label
  - `<ul role="listbox">` for countries
  - primary button, error region with `aria-live="polite"`
  - empty/success panels
- [ ] **4.2** `picker/picker.css`:
  - tokens from §3.3, light + dark
  - centered card, responsive padding
  - clean listbox with sticky group headings
  - selected row: subtle `--accent` tint, check mark via CSS or inline SVG
  - focus-visible, hover, disabled
  - **Accept:** screenshot at 360px and 1280px looks intentional, not stretched.
- [ ] **4.3** `picker/picker.js` — render and state machine:
  - load pending state, handle all 7 states
  - sort + render countries with headings
  - default to USA/Canada if no prior selection in this tab
  - search filter (name, ISO, secondary ISO, calling code)
  - keyboard: `/`, arrows, Enter, Esc, Ctrl/Cmd+Enter
  - convert + build URL + open new tab + clear pending + success state
  - keep last success in `sessionStorage`
  - handle storage updates, expiry, and errors without crashing
  - **Accept:** every state reachable and visually correct.
- [ ] **4.4** Copy pass: remove filler, exclamation marks, emoji icons, or marketing tone.
- [ ] **4.5** Accessibility pass: labels, `aria-expanded`/`aria-activedescendant`, contrast ≥ 4.5:1,
  visible focus, reduced motion respected.

### Phase 5 — Verification

- [ ] **5.1** Run the full test matrix from `SPEC.md` §28.
- [ ] **5.2** Verify no popup:
  ```bash
  grep -R "windows.create" . --exclude-dir=node_modules
  grep -R "default_popup" manifest.json
  ```
  Both must return nothing.
- [ ] **5.3** Verify zero remote requests in DevTools → Network while using the picker.
- [ ] **5.4** Verify no full phone number is written to `console.*` or the address bar.
- [ ] **5.5** Manual flows:
  - `+1 (415) 555-1234` → direct WhatsApp, no picker
  - `01712345678` → picker tab → Bangladesh → `wa.me/8801712345678`
  - refresh picker → number persists; after success → success state
  - second selection → existing tab focuses and updates
  - direct visit to picker URL → empty state
  - `hello` → badge only, no tab

### Phase 6 — Ship

- [ ] **6.1** Update `README.md` with architecture, permissions, and no-popup rationale.
- [ ] **6.2** Bump version, zip the extension folder (exclude `node_modules`, `src`, tests if desired).
- [ ] **6.3** Final check: `manifest.json` valid, icons present, no remote assets, tests pass.

---

## 8. Definition of Done

- All Phase 1–6 boxes checked.
- Country selection happens on a **full page in a normal tab**.
- No popup window, no toolbar popup, no `windows.create`, no `default_popup`.
- International numbers open directly; local numbers go through the picker.
- URLs are `https://wa.me/<digits>` only.
- Design passes the §3 review: neutral palette, one accent, flat surfaces, literal copy, no AI-slop
  patterns.
- Works in Chrome stable with only `contextMenus`, `tabs`, and `storage` permissions.
- `npm test` passes; manual checklist in `SPEC.md` §28 passes.
- Phone numbers never leave the device or persist beyond the session.

---

## 9. Working Rules for Agents

- Make the smallest change that satisfies the task. Do not refactor unrelated files.
- Keep modules small and named exactly as in §2.
- Add JSDoc to exported functions; no dead code, no commented-out blocks.
- Use `const`/`let`, strict equality, early returns.
- Prefer `async/await`; wrap `chrome.*` calls in `try/catch`.
- Never log full phone numbers. Log `"parse failed"`, not the number.
- Do not add dependencies beyond `libphonenumber-js` and `esbuild` (dev only).
- Do not add analytics, telemetry, remote config, or "loading" spinners that never resolve.
- Do not rename the extension or change the context-menu label.
- When unsure, choose the simplest option that keeps the spec's behavior and §3's visual rules.
- Verify in Chrome after each phase; do not claim completion from reading code alone.

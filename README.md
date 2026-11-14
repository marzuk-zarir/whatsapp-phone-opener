# WhatsApp Number Opener

A Chrome extension that opens a selected phone number in WhatsApp. International numbers open
immediately. Numbers without a country code open a full-page picker in a normal tab.

## Tech overview

- Manifest V3, plain HTML, CSS, and JavaScript. No framework.
- `background.js` is a module service worker. It registers the context menu, parses the selected
  text, and either opens `https://wa.me/<digits>` directly or hands a local number to the picker.
- `picker/picker.html` is a normal extension page, not a popup. It reads the pending number from
  `chrome.storage.session`, renders the country list, converts the number, and opens WhatsApp in a
  new tab.
- `data/countries.js` contains the local country dataset with static priority ordering. USA and
  Canada share one `USA/CANADA (+1)` entry.
- `lib/phone-number-parser.js` is a self-contained ESM bundle of `src/phone.js` and
  `libphonenumber-js/min`. It is built with esbuild and loaded locally by both the worker and picker.
- Country flags are emoji. `vendor/simple.css` is a vendored base stylesheet. There are no remote
  scripts, styles, fonts, or country data.

Data flow:

```text
selection ──► background.js ──► wa.me tab                    (international)
                            ├──► chrome.storage.session ──► picker tab ──► wa.me tab
                            └──► toolbar badge "!"           (invalid)
```

## Build

Requires Node.js 18 or newer and npm. Chrome 102 or newer is required at runtime.

```bash
npm ci
npm run build
npm test
```

`npm run build` regenerates `lib/phone-number-parser.js` from `src/phone.js`. The generated file is
committed, so the extension can also be loaded without building.

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin the extension from the toolbar puzzle menu if needed.

To package it, zip the runtime files: `manifest.json`, `background.js`, `picker/`, `lib/`, `data/`,
`vendor/`, `icons/`, `README.md`, and `LICENSE`. Do not include `node_modules/`, `src/`, or `tests/`.

## Use

1. Select a phone number on a webpage.
2. Right-click it and choose **Open in WhatsApp**.
3. An international number opens WhatsApp directly. A local number opens the picker; choose the
   country and press **Open in WhatsApp**.
4. Invalid selections show a `!` badge and open no tab.

The picker defaults to USA/CANADA (+1). Search accepts a country name, ISO code, or calling code.
Keyboard shortcuts: `/` focuses search, arrow keys move, `Enter` selects, `Esc` clears search, and
`Ctrl/Cmd + Enter` opens WhatsApp.

## File structure

```text
whatsapp-phone-opener/
├── manifest.json               MV3 manifest and permissions
├── background.js               service worker and context-menu flow
├── picker/
│   ├── picker.html             full-page picker markup
│   ├── picker.css              layout, states, light/dark theme
│   └── picker.js               picker state machine
├── lib/
│   └── phone-number-parser.js  generated parser bundle
├── src/
│   └── phone.js                parser source
├── data/
│   └── countries.js            local country and priority dataset
├── vendor/
│   └── simple.css              vendored base styles
├── icons/                      icon16/32/48/128.png
├── tests/
│   └── phone.test.mjs          parser and dataset tests
├── build.mjs                   esbuild bundle script
├── package.json
├── package-lock.json
├── LICENSE                     AGPL-3.0-only
└── README.md
```

## Security and privacy

| Permission | Reason |
| --- | --- |
| `contextMenus` | Adds the **Open in WhatsApp** selection action. |
| `tabs` | Opens WhatsApp and picker tabs, and finds an existing picker tab. |
| `storage` | Passes the pending number through `chrome.storage.session`. |

- No host permissions, content scripts, or page injection. Chrome passes only the text the user
  explicitly selects to the context-menu handler.
- Parsing happens locally. `libphonenumber-js` is bundled; no number is sent to a server.
- The pending number lives in memory-backed `chrome.storage.session`, not `localStorage` or sync
  storage. It expires after 10 minutes and is removed after a successful open or when the browser
  session ends.
- The number is never placed in the picker page URL or query string and is never logged.
- WhatsApp URLs are built in one place, validated against `/^https:\/\/wa\.me\/\d{6,15}$/`, and
  contain digits only.
- Extension pages run under Chrome's default MV3 content security policy. The picker has no inline
  scripts or inline styles.
- No analytics, telemetry, backend, remote configuration, or `chrome.windows.create()` calls.

## Tests

```bash
npm test
```

The tests cover the spec number lists, formatted and invalid input, URL validation, the USA/Canada
merge, priority ordering, and country search. For manual checks, verify that an international
selection opens no picker, a local selection reuses the picker tab, invalid text opens no tab, and
the picker makes no network requests other than the final WhatsApp tab.

## License

Licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See
[`LICENSE`](LICENSE).

# Browser

A minimal desktop browser with a midnight interface, vertical tabs on the left,
pinned tabs and one editable JSON config. Windows 11 x64 and macOS on Apple Silicon
are the distribution targets. This is an early desktop prototype.

## Start

Install Node.js 24, then:

```sh
npm ci
npm start
```

## The essentials

- Vertical tabs, compact sidebar, pinned tabs, drag to reorder, mute, duplicate,
  close and reopen. Right-click a tab for its actions.
- Search from the address bar or new tab. `y майнкрафт` opens YouTube results;
  `g query`, `d query`, `gh query` and `w query` select other search providers.
- Bookmark the current page with the star. Add/remove bookmark entries in config.
- Load your own unpacked Chrome extensions from the Extensions panel. Extract
  archives first, select the directory containing `manifest.json`, review its
  requested permissions, and keep the folder in place. Loaded extensions persist.
- Downloads ask where to save each file. The Downloads panel lists this session.
- Inactive tabs unload after 15 minutes. Pinned tabs and tabs playing media stay
  awake. Only pinned tabs restore by default; set `tabs.restore` to `all` for all.

No built-in password manager, account, sync, AI assistant, scraping server,
telemetry service or cloud dependency is included. Sites can still use their own
cookies and storage. There is no private/incognito mode in this prototype.

## Configuration

Open Settings with **Ctrl+,** (Windows) or **⌘+,** (Mac). Edit JSON and save,
or open `config.json` in a text editor. External changes reload automatically;
invalid changes show an error and leave the current valid settings active.
An invalid config at startup uses defaults without overwriting your file.

The config is created in Electron's per-user application data directory:

- Windows: `%APPDATA%/Browser/config.json`
- macOS: `~/Library/Application Support/Browser/config.json`

[config/default.json](config/default.json) lists every setting. Partial configs
are supported; missing keys use defaults and unknown keys are rejected.
Arrays replace the full default list. The Settings editor shows the effective
config, including defaults. Reset creates a `.bak` copy first.

```json
{
  "appearance": {
    "background": "#101827",
    "accent": "#adbded",
    "sidebarWidth": 250,
    "cornerRadius": 12
  },
  "tabs": { "restore": "all", "sleepAfterMinutes": 10 },
  "search": {
    "default": "youtube",
    "engines": [
      { "id": "youtube", "name": "YouTube", "keyword": "y", "url": "https://www.youtube.com/results?search_query={query}" },
      { "id": "google", "name": "Google", "keyword": "g", "url": "https://www.google.com/search?q={query}" }
    ]
  }
}
```

Customize theme colors, font, sidebar and toolbar dimensions, tab spacing, corner
radius, bookmark visibility, hints, animation, search providers, tab limits,
restoration, sleep timeout, extension paths, tracker domains, permission rules
and keyboard shortcuts. Security boundaries such as the sandbox and TLS
verification are deliberately fixed. Cookie policy changes also require restart
for Chromium's native startup preference; network cookie filtering updates live.

Default shortcuts (use ⌘ in place of Ctrl on Mac, except Ctrl+Tab):

| Action | Shortcut |
| --- | --- |
| Address bar | Ctrl+L |
| New / close / reopen tab | Ctrl+T / Ctrl+W / Ctrl+Shift+T |
| Pin tab | Ctrl+Shift+P |
| Collapse sidebar | Ctrl+B |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Settings / downloads | Ctrl+, / Ctrl+J |
| Reload | Ctrl+R |

## Privacy and compatibility

Remote pages use isolated, sandboxed Chromium renderers with Node.js disabled.
Only the local UI gets a small IPC bridge, checked against its main frame and
exact URL. Web content cannot navigate to local files or privileged schemes.
TLS certificate errors retain Chromium's default rejection; no bypass is added.

The app sends DNT and Sec-GPC headers by default. These are signals to websites,
not guarantees. A small configurable domain list blocks known tracker requests;
it is not a full ad blocker. Third-party Cookie/Set-Cookie headers are filtered
using schemeful registrable sites (including private suffixes). Chromium's native
third-party cookie phaseout is enabled at startup as an additional restriction.
This does not prevent every tracking mechanism or promise anonymity.

Camera/microphone requests prompt for approval per request; location and
notifications are blocked by default. Hardware devices and screen capture are
blocked. Clear browsing data removes website cookies, storage and cache.
Tab URLs and config remain local in the application data directory.

Electron implements a **subset** of the Chrome extension APIs. A working content
script does not establish support for all Manifest V2/V3 extensions, background
services, password-manager integrations or store installation. Extensions run
third-party code and can access sites within their granted manifest permissions.
Browser includes no extension marketplace or automatic extension updater.
DRM-protected streaming, passkeys, OS default-browser registration and automatic
application updates are not implemented or guaranteed in this prototype.

## Build and verify

```sh
npm run check
npm test
npm run test:desktop
npm run pack
npm run dist:win   # run on Windows, x64 NSIS installer + ZIP
npm run dist:mac   # run on macOS, native arm64 DMG + ZIP
```

Linux GUI tests need an X11 display (for example `xvfb-run -a npm run test:desktop`).
Do not disable the Chromium sandbox to run tests. `BROWSER_PROFILE` selects an
isolated profile directory for development/tests. The desktop suite uses local
fixtures for navigation, IPC isolation, config changes, restoration, extension
content scripts and downloads.

[GitHub Actions](../../actions) tests and packages both platforms on pushes to
main. Download installers from each run's artifacts. Current builds are unsigned;
Windows SmartScreen and macOS Gatekeeper may restrict them. Public distribution
needs your signing certificates, Apple notarization and testing on actual target
hardware. CI on Windows Server is not a substitute for a Windows 11 hardware test.
No performance or memory advantage over other browsers has been measured.

## Origin

The requested starting snapshot is [h4ckf0r0day/obscura](https://github.com/h4ckf0r0day/obscura),
commit `3bae60909615ed5a2ca263a12c300a4a545ed3ce`. Its source and history are preserved
on the [`prototype/obscura`](https://github.com/orcspace/Browser/tree/prototype/obscura)
branch. Obscura is a headless Rust automation engine, without a desktop interface
or Chrome extension runtime. The desktop product uses Electron/Chromium for
interactive websites and extension support; Obscura's headless engine, automation
servers, proxy integrations and rendering tools are removed from the main tree.
Its speed/memory claims do not apply to Browser. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

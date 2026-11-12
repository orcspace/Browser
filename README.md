# Browser

A minimal **Firefox-based desktop browser**, with native Firefox tabs, web
extensions and security boundaries. Electron and Node.js are absent from this
implementation. The old prototype is preserved on `prototype/electron`.

This is a development distribution of Firefox ESR, not a new rendering engine:
Firefox itself uses Gecko. This repository packages verified Mozilla binaries
and installs Browser's chrome modules, branding and two guarded upstream JS fixes; it does not compile Mozilla's source tree.

## Architecture

- `firefox/modules/Core.sys.mjs`: pure JSON validation and search rules.
- `firefox/modules/Browser.sys.mjs`: profile config, Firefox preferences/search, window lifecycle.
- `firefox/modules/Interface.sys.mjs`: chrome styling and configuration editor.
- `firefox/default-prefs.js`, `policies.json`: minimal defaults and disabled services.
- `config/default.json`: editable appearance, search, privacy and tab settings.
- `config/runtime.json`: pinned Mozilla archives and SHA-512 checksums.
- `native/launcher.c`: small native launcher with a separate Browser application profile.
- `tools/`: Python packaging and branding, without npm.
- `tests/`: packaging tests and real Firefox integration checks.

Use the ◉ toolbar button to edit JSON, save it or reload an externally edited
file. It also opens native extension management. Invalid settings are rejected;
a malformed startup file is preserved and defaults are used. `customCSS` styles
the browser chrome, and `cssVariables` overrides arbitrary chrome CSS variables.
Website content remains in Firefox's sandbox and has no configuration bridge.

The default search is DuckDuckGo: enter `10 сом в долларах` directly. Enter
`y майнкрафт` for YouTube, `g` for Google, `gh` for GitHub, or `w` for Wikipedia.
Change `search.default` and engine URLs/aliases in the config. Currency answers
come from the search provider; Browser does not implement an exchange-rate API.

Native vertical tabs are enabled on the left. Pin tabs using their context menu.
Install Firefox extensions through `about:addons`, including signed local XPI
files. Chrome extensions are incompatible. Unsigned extensions require explicit
`extensions.allowUnsigned` on ESR; keep the default for normal browsing.

Glass styling uses translucent chrome and backdrop blur, with the Windows Mica
preference. The visible result depends on OS/compositor support. This does not
yet guarantee full desktop transparency on every platform. `windowOpacity`
currently affects the navigation chrome, not web content. Use `tabs.restore=pinned` or `all` to select the native startup mode.

## Development

Python 3.12+, a native C compiler (MSVC on Windows, Apple Clang on macOS), and
7-Zip on Windows are required to build. End users need none of these.

```
python -m unittest discover -s tests -p 'test_*.py'
python tools/build.py
python -m pip install marionette_driver
python tests/browser_test.py --binary /absolute/path/to/Browser
```

Build targets are Windows x64 and macOS Apple Silicon; Linux supports local
validation. CI builds and exercises each native target. CI artifacts are
**development builds**, not signed/notarized installers. macOS artifacts must
preserve executable permissions and app symlinks when transferred.

Password saving, account sync, recommendations and telemetry are disabled by
preferences/policies. Their compiled Mozilla code is still present. Firefox's
content sandbox, Fission and certificate validation are retained.

Mozilla's automatic binary updater is disabled because upstream patches cannot
safely update this modified distribution. Maintainers must update the pinned ESR
runtime and rebuild for security releases. Do not treat this prototype as a
maintained production browser until that update process is operational.

See [AUDIT.md](AUDIT.md) for tested scope and remaining work. Mozilla source for
the pinned engine is available at
https://archive.mozilla.org/pub/firefox/releases/153.7.0esr/source/ . Firefox is
a Mozilla trademark; Browser is an independent project without Mozilla endorsement.

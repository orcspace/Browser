# Browser

The desktop product is Electron/Chromium. Obscura's original source is retained
in Git history and on `prototype/obscura`; it is not shipped in the app.
See NOTICE for provenance. No Rust engine code remains in the active tree.

Use Node 24 and `npm ci`. Run `npm run check`, `npm test`, and
`npm run test:desktop` (on Linux, `xvfb-run -a npm run test:desktop`).
Use `npm run pack` to validate packaging. Native distribution jobs run on
Windows and macOS; never describe those artifacts as tested until CI passes.

Keep remote web content sandboxed with Node disabled and context isolation on.
Only the local chrome renderer gets the small, sender-validated preload API.
Never disable Chromium's sandbox, TLS checks, web security, or site isolation.
Use WebContentsView rather than webview tags. Never persist passwords.
All user configuration passes through src/core/config.cjs validation.
Keep the product small: no accounts, sync, AI assistant, or automation server.

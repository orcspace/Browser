# Firefox migration audit — 2026-11-12

This report supersedes the Electron prototype's audit. It covers the new Firefox
integration, not Mozilla's complete source tree. No claim of zero browser bugs.

## Review 1: startup and native API compatibility

Found and corrected:
- SearchService moved out of `Services` in the pinned ESR.
- Alias lookup is asynchronous.
- IOUtils `mode` is a write strategy, not Unix permissions.
- `-app` after automation flags was ignored: the native launcher now supplies
  `XUL_APP_FILE` before starting Firefox.

## Review 2: configuration and lifecycle

Found and corrected:
- Concurrent saves could race; writes are serialized.
- Removed CSS variables and custom preferences stayed active; overrides are cleared.
- Removed managed search engines remained registered; obsolete engines are removed.
- Arbitrary preferences could disable TLS or sandbox protections; protected groups
  are rejected, with signed 32-bit integer validation for native preferences.
- `restore=none` had no implementation; it is now rejected rather than accepted silently.
- Vertical-tab defaults did not survive initial Firefox startup; the controller
  explicitly applies them before window attachment.

## Review 3: visual UI, native packaging and runtime logs

Found and corrected:
- A raw toolbar node vanished during Firefox toolbar reconstruction; use a native
  CustomizableUI widget, initialized after the window's toolbar is restored.
- Sidebar element selectors did not match current Firefox markup; fix selectors
  and tab text contrast, checked against a rendered chrome screenshot.
- Windows arguments containing spaces needed explicit native CRT quoting.
- Raw artifact uploads lost macOS executable metadata; package bundles with ditto.
- macOS nested signatures retained incompatible Mozilla requirements; sign code
  inside out while preserving engine entitlements and verify the complete bundle.
- Pinned ESR proxy-policy handling incorrectly called `.filter` on an object, and
  user search engines read an uninitialized icon map. Guarded MPL-source fixes in
  `tools/compatibility.py` support both policy forms and absent icons. Packaging
  rejects a changed upstream source instead of silently applying stale edits.

## Validation and open gates

Python packaging tests cover archive tampering and separate application identity.
Native Marionette tests exercise actual Browser startup, Unicode search routing,
invalid JSON preservation, custom style apply/reset, pinning, vertical tabs,
signature verification and the enabled content sandbox. A temporary native
Firefox XPI runs a content script on a local test page; chrome globals remain
absent from that page. Pinned tabs survive a normal quit and fresh launch. A
profile path containing spaces is exercised. Linux runtime logs are free of
JavaScript errors in this tested flow (the headless renderer logs a framebuffer
warning).

Windows 11 and Apple Silicon runtime behavior, headed UI layout/accessibility,
OS glass effects, broader session restoration and signed-extension coverage, and
performance profiling remain required release gates. CI is configured for native
Windows and macOS checks. This is a development distribution, not a signed release.

Known limitations: no Browser security updater yet; only chrome translucency is
implemented; packaged upstream features are disabled rather than removed from
Mozilla binaries. A broader audit must continue before declaring the requested
complete review cycle finished.

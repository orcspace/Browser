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

## Validation and open gates

Python packaging tests cover archive tampering and separate application identity.
Native Marionette tests exercise actual Browser startup, Unicode search routing,
invalid JSON preservation, custom style apply/reset, pinning, vertical tabs,
signature verification and the enabled content sandbox.

Windows 11 and Apple Silicon runtime behavior, headed UI layout/accessibility,
OS glass effects, repeated session restoration, extension installation, and
performance profiling remain required release gates. CI is configured for native
Windows and macOS checks. This is a development distribution, not a signed release.

Known limitations: no Browser security updater yet; only chrome translucency is
implemented; packaged upstream features are disabled rather than removed from
Mozilla binaries. A broader audit must continue before declaring the requested
complete review cycle finished.

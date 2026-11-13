# Browser (Firefox / Gecko)

The shipping application uses pinned Mozilla Firefox ESR binaries, native Firefox
chrome, and our privileged AutoConfig modules. It contains no Electron, Chromium
or Node runtime. The previous Electron prototype is archived on prototype/electron.
Mozilla's engine is not compiled by this repository; tools/build.py produces a
branded development distribution from SHA-512-pinned official archives.

Use Python 3.12+ for packaging and tests. Build with `python tools/build.py`.
Run `python -m unittest discover -s tests -p 'test_*.py'` and the native Marionette
integration suite with `python tests/browser_test.py --binary <built executable>`.
Marionette and system access are enabled only by the test launcher, never by the
shipping app. Never disable Gecko's content sandbox, Fission, or TLS validation.

AutoConfig's JavaScript sandbox setting enables our installed chrome controller;
it is separate from Gecko's content sandbox. Never evaluate config text as code.
Config is JSON, custom styling is CSS, and remote pages get no privileged bridge.
Keep native navigation/security UI and native Firefox extension verification.
Do not claim that disabled Firefox features were removed from the compiled engine.

Review and fix bugs in repeated passes until a pass has no new findings in its
stated scope. Record limits honestly, run regression tests before packaging, and
verify target-platform CI before claiming artifacts are ready.

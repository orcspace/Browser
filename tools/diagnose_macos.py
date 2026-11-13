"""Print development-runner startup diagnostics; no user profile is opened."""
import subprocess
from pathlib import Path

bundle = Path('dist/Darwin/Browser.app').resolve()
for name in ('Browser', 'firefox'):
    binary = bundle / 'Contents/MacOS' / name
    result = subprocess.run([str(binary), '--version'], capture_output=True, text=True, timeout=20)
    print(name, 'exit:', result.returncode, 'stdout:', result.stdout, 'stderr:', result.stderr, flush=True)
    subprocess.run(['codesign', '-d', '--entitlements', ':-', str(binary)], check=False)
reports = Path.home() / 'Library/Logs/DiagnosticReports'
for path in sorted(reports.glob('*'), key=lambda p: p.stat().st_mtime, reverse=True)[:5]:
    if path.is_file() and ('Browser' in path.name or 'firefox' in path.name):
        print(path.name, path.read_text(errors='replace')[:16000], flush=True)

"""Preserve native executable permissions and macOS bundle symlinks in artifacts."""
import platform
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
system = platform.system()
artifacts = root / 'artifacts'
artifacts.mkdir(exist_ok=True)
if system == 'Darwin':
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent',
                    str(root / 'dist/Darwin/Browser.app'),
                    str(artifacts / 'Browser-macOS-arm64.zip')], check=True)
else:
    shutil.make_archive(str(artifacts / ('Browser-' + system)), 'zip', root / 'dist' / system)

"""Ad-hoc sign development bundles inside out, preserving engine entitlements."""
import subprocess
from pathlib import Path

MACHO = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf',
         b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca',
         b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def sign_bundle(bundle):
    bundle = Path(bundle)
    def sign(path):
        subprocess.run(['codesign', '--force', '--sign', '-',
                        '--preserve-metadata=entitlements,flags,runtime', str(path)], check=True)
    for path in sorted(bundle.rglob('*')):
        if path.is_file() and not path.is_symlink():
            with path.open('rb') as stream:
                magic = stream.read(4)
            if magic in MACHO:
                sign(path)
    nested = [p for p in bundle.rglob('*') if p.is_dir() and not p.is_symlink()
              and p.suffix in {'.app', '.framework', '.xpc'}]
    for path in sorted(nested, key=lambda p: len(p.parts), reverse=True):
        sign(path)
    sign(bundle)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', str(bundle)], check=True)

"""Ad-hoc sign development bundles inside out, preserving engine entitlements."""
import subprocess
import plistlib
import tempfile
from pathlib import Path

MACHO = {b'\xfe\xed\xfa\xce', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xcf',
         b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca',
         b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def sign_bundle(bundle):
    bundle = Path(bundle)
    def sign(path):
        original = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(path)],
                                  capture_output=True, check=False)
        raw = original.stdout
        start = raw.find(b'<?xml')
        entitlements = plistlib.loads(raw[start:]) if start >= 0 else {}
        # Mozilla's restricted signing grants cannot be used by our ad-hoc
        # development identity. Keep JIT and the engine's sandbox entitlements.
        for key in list(entitlements):
            if key in {'com.apple.application-identifier', 'application-identifier',
                       'keychain-access-groups', 'com.apple.security.application-groups'} or key.startswith('com.apple.developer.'):
                del entitlements[key]
        with tempfile.NamedTemporaryFile(suffix='.plist') as grant:
            grant.write(plistlib.dumps(entitlements))
            grant.flush()
            subprocess.run(['codesign', '--force', '--sign', '-',
                            '--preserve-metadata=flags,runtime', '--entitlements', grant.name,
                            str(path)], check=True)
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

import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build import verify
from overlay import install

class PackagingTests(unittest.TestCase):
    def test_integrity_rejects_modified_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'archive'
            archive.write_bytes(b'official')
            digest = hashlib.sha512(b'official').hexdigest()
            verify(archive, digest)
            archive.write_bytes(b'modified')
            with self.assertRaises(ValueError):
                verify(archive, digest)

    def test_overlay_separates_application_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'browser').mkdir()
            (root / 'application.ini').write_text('[App]\nName=Firefox\nVendor=Mozilla\nID=unchanged\nVersion=153.7.0\n')
            result = install(root).read_text()
            self.assertIn('Name=Browser', result)
            self.assertIn('ID=unchanged', result)
            self.assertIn('Name=Firefox', (root / 'application.ini').read_text())
            self.assertTrue((root / 'browser-custom/modules/Browser.sys.mjs').exists())

if __name__ == '__main__':
    unittest.main()

"""Build a Browser development distribution from a verified Firefox archive."""
import argparse
import hashlib
import json
import platform
import plistlib
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from overlay import ROOT, install
from branding import brand
from compatibility import patch_runtime
from macos_sign import sign_bundle


def run(*args):
    subprocess.run([str(x) for x in args], check=True)


def verify(path, expected):
    with Path(path).open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha512').hexdigest()
    if digest != expected:
        raise ValueError('Firefox archive SHA-512 mismatch')


def build(archive=None):
    system = platform.system()
    manifest = json.loads((ROOT / 'config/runtime.json').read_text())
    spec = manifest['archives'][system]
    cache = ROOT / '.cache'
    cache.mkdir(exist_ok=True)
    if archive is None:
        archive = cache / Path(spec['path']).name
        if not archive.exists():
            url = 'https://archive.mozilla.org/pub/firefox/releases/' + manifest['version'] + '/' + urllib.parse.quote(spec['path'])
            temporary = archive.with_suffix('.download')
            urllib.request.urlretrieve(url, temporary)
            verify(temporary, spec['sha512'])
            temporary.replace(archive)
    verify(archive, spec['sha512'])
    output = ROOT / 'dist' / system
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as temporary:
        temp = Path(temporary)
        if system == 'Linux':
            with tarfile.open(archive) as tar:
                tar.extractall(temp, filter='data')
            runtime = output / 'runtime'
            shutil.move(temp / 'firefox', runtime)
            install(runtime)
            brand(runtime)
            patch_runtime(runtime)
            executable = output / 'Browser'
            run('cc', '-O2', '-Wall', '-Wextra', ROOT / 'native/launcher.c', '-o', executable)
        elif system == 'Windows':
            run('7z', 'x', archive, '-o' + str(temp), '-y')
            runtime = output / 'runtime'
            shutil.move(temp / 'core', runtime)
            install(runtime)
            brand(runtime)
            patch_runtime(runtime)
            executable = output / 'Browser.exe'
            resource = temp / 'browser.rc'
            resource.write_text('1 ICON "' + (ROOT / 'assets/icon.ico').as_posix() + '"\n')
            run('rc', '/fo', temp / 'browser.res', resource)
            run('cl', '/O2', '/W4', '/DUNICODE', '/D_UNICODE', ROOT / 'native/launcher.c', temp / 'browser.res', '/Fe:' + str(executable), '/Fo:' + str(temp / 'launcher.obj'), '/link', '/SUBSYSTEM:WINDOWS', '/ENTRY:wmainCRTStartup')
        elif system == 'Darwin':
            mount = temp / 'mounted'
            run('hdiutil', 'attach', archive, '-readonly', '-nobrowse', '-mountpoint', mount)
            bundle = output / 'Browser.app'
            try:
                run('ditto', mount / 'Firefox.app', bundle)
            finally:
                run('hdiutil', 'detach', mount)
            runtime = bundle / 'Contents/Resources'
            install(runtime)
            brand(runtime)
            patch_runtime(runtime)
            executable = bundle / 'Contents/MacOS/Browser'
            run('clang', '-O2', '-Wall', '-arch', 'arm64', ROOT / 'native/launcher.c', '-o', executable)
            iconset = temp / 'Browser.iconset'
            iconset.mkdir()
            for size in (16, 32, 128, 256, 512):
                for scale in (1, 2):
                    name = f'icon_{size}x{size}' + ('@2x' if scale == 2 else '') + '.png'
                    run('sips', '-z', size * scale, size * scale, ROOT / 'assets/icon.png', '--out', iconset / name)
            run('iconutil', '-c', 'icns', iconset, '-o', runtime / 'Browser.icns')
            info = bundle / 'Contents/Info.plist'
            data = plistlib.loads(info.read_bytes())
            data.update(CFBundleName='Browser', CFBundleDisplayName='Browser', CFBundleIdentifier='space.orc.browser', CFBundleExecutable='Browser', CFBundleIconFile='Browser.icns')
            info.write_bytes(plistlib.dumps(data))
            sign_bundle(bundle)
        else:
            raise ValueError('Unsupported platform')
    print(executable)
    return executable

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    build(parser.parse_args().archive)

"""Small, guarded fixes for observed JavaScript errors in the pinned ESR.

Modified Mozilla files retain their MPL-2.0 headers. This file records the exact
source transformations; changing the runtime requires revalidating these fixes.
"""
import zipfile
from pathlib import Path
from branding import open_omni

FIXES = {
    'ServiceRequest.sys.mjs': (
        'let policies = Services.policies.getActivePolicies()?.filter(p => p.Proxy);',
        '''const activePolicies = Services.policies.getActivePolicies();
    let policies = Array.isArray(activePolicies)
      ? activePolicies.filter(p => p.Proxy)
      : activePolicies?.Proxy ? [activePolicies] : [];'''),
    'UserSearchEngine.sys.mjs': (
        'Object.keys(this._iconMapObj).length',
        'Object.keys(this._iconMapObj || {}).length'),
}


def patch_runtime(runtime):
    archive = Path(runtime) / 'omni.ja'
    temporary = archive.with_suffix('.tmp')
    found = set()
    with open_omni(archive) as source, zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            data = source.read(item.filename)
            name = Path(item.filename).name
            if name in FIXES:
                old, new = FIXES[name]
                text = data.decode()
                if text.count(old) != 1:
                    raise ValueError(f'Revalidate Firefox compatibility patch: {name}')
                data = text.replace(old, new).encode()
                found.add(name)
            target.writestr(item, data)
    if found != FIXES.keys():
        temporary.unlink()
        raise ValueError('Firefox compatibility patch targets missing')
    temporary.replace(archive)

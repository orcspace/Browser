"""Replace product branding, retaining Mozilla license and trademark attribution."""
import io
import struct
import zipfile
from pathlib import Path


def open_omni(path):
    data = Path(path).read_bytes()
    if data.startswith(b'PK\x03\x04'):
        return zipfile.ZipFile(io.BytesIO(data))
    end = data.rfind(b'PK\x05\x06')
    if end < 0:
        raise ValueError('Missing omni ZIP directory')
    size = struct.unpack_from('<I', data, end + 12)[0]
    start = data.find(b'PK\x01\x02')
    if start < 0 or start + size > len(data):
        raise ValueError('Invalid optimized ZIP')
    trailer = bytearray(data[end:])
    struct.pack_into('<I', trailer, 16, end)
    return zipfile.ZipFile(io.BytesIO(data[:end] + data[start:start + size] + trailer))


def brand(runtime):
    archive = Path(runtime) / 'browser/omni.ja'
    temporary = archive.with_suffix('.tmp')
    with open_omni(archive) as source, zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename.endswith('/branding/brand.ftl'):
                text = data.decode()
                for key in ('shorter-name', 'short-name', 'shortcut-name', 'full-name', 'product-name'):
                    import re
                    text = re.sub(r'(?m)^-brand-' + key + r' = .*$', '-brand-' + key + ' = Browser', text)
                data = text.encode()
            elif '/branding/' in item.filename and item.filename.endswith('.png') and '/icon' in item.filename:
                data = (Path(__file__).resolve().parents[1] / 'assets/icon.png').read_bytes()
            elif item.filename.endswith('/branding/brand.properties'):
                import re
                data = re.sub(r'(?m)^(brandShorterName|brandShortName|brandFullName)=.*$', r'\1=Browser', data.decode()).encode()
            target.writestr(item, data)
    temporary.replace(archive)

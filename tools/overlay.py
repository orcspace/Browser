"""Install Browser chrome into a dedicated Firefox distribution (never a user's installation)."""
import argparse
import configparser
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def install(runtime):
    runtime = Path(runtime).resolve()
    if not (runtime / 'application.ini').is_file():
        raise ValueError('Expected an extracted Firefox runtime')
    custom = runtime / 'browser-custom'
    shutil.copytree(ROOT / 'firefox/modules', custom / 'modules', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'config/default.json', custom / 'default.json')
    shutil.copy2(ROOT / 'firefox/browser.cfg', runtime / 'browser.cfg')
    (runtime / 'defaults/pref').mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / 'firefox/default-prefs.js', runtime / 'defaults/pref/browser.js')
    (runtime / 'distribution').mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'firefox/policies.json', runtime / 'distribution/policies.json')
    ini = configparser.ConfigParser()
    ini.optionxform = str
    ini.read(runtime / 'application.ini')
    ini['App'].update(Vendor='orcspace', Name='Browser', RemotingName='browser')
    with (runtime / 'browser/application.ini').open('w') as output:
        ini.write(output, space_around_delimiters=False)
    return runtime / 'browser/application.ini'

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runtime', type=Path)
    print(install(parser.parse_args().runtime))

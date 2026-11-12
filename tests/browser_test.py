"""Native Firefox smoke tests; automation privileges are test-only."""
import argparse
import json
import os
import gc
from pathlib import Path
from marionette_driver.marionette import Marionette

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True)
parser.add_argument('--app')
parser.add_argument('--screenshot')
args = parser.parse_args()
flags = ['--remote-allow-system-access']
if args.app:
    os.environ['XUL_APP_FILE'] = args.app
m = Marionette(app='fxdesktop', bin=args.binary, headless=True, app_args=flags)
try:
    m.start_session()
    m.set_context('chrome')
    result = m.execute_async_script('''
      const done = arguments[arguments.length - 1];
      const { SearchService } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
      const { Browser } = ChromeUtils.importESModule('resource://browser-custom/modules/Browser.sys.mjs');
      (async () => {
        await Browser.ready;
        done({name:Services.appinfo.name, config:Browser.config, error:Browser.error,
          button:!!document.getElementById('browser-config-button'),
          search:SearchService.defaultEngine.getSubmission('10 сом в долларах').uri.spec,
          youtube:(await SearchService.getEngineByAlias('y'))?.getSubmission('майнкрафт').uri.spec});
      })().catch(e => done({failure:String(e)}));
    ''')
    print(json.dumps({k:v for k,v in result.items() if k != 'config'}, ensure_ascii=False, indent=2))
    assert result['name'] == 'Browser'
    assert not result.get('error'), result.get('error')
    assert result['button']
    assert result['search'].startswith('https://duckduckgo.com/?q=')
    assert result['youtube'].startswith('https://www.youtube.com/results?search_query=')
    checks = m.execute_async_script("""
      const done = arguments[arguments.length - 1];
      const { Browser } = ChromeUtils.importESModule('resource://browser-custom/modules/Browser.sys.mjs');
      const { validateConfig, searchURL } = ChromeUtils.importESModule('resource://browser-custom/modules/Core.sys.mjs');
      (async () => {
        const original = JSON.stringify(Browser.config);
        let rejected = 0;
        for (const patch of [{appearance:{blur:-1}}, {search:{default:'missing'}},
          {preferences:{'security.sandbox.content.level':0}}, {unknown:true},
          {preferences:{'security.tls.version.min':0}}]) {
          try { validateConfig(Browser.defaults, patch); } catch { rejected++; }
        }
        try { await Browser.save('{broken'); } catch { rejected++; }
        const unchanged = JSON.stringify(await IOUtils.readJSON(Browser.path)) === original;
        const next = JSON.parse(original); next.appearance.accent = '#123456';
        next.appearance.cssVariables = {'--test-browser-variable':'42px'};
        await Browser.save(JSON.stringify(next));
        const applied = document.documentElement.style.getPropertyValue('--test-browser-variable') === '42px';
        await Browser.save(original);
        const removed = document.documentElement.style.getPropertyValue('--test-browser-variable') === '';
        const tab = gBrowser.addTab('about:blank', {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
        gBrowser.pinTab(tab); const pinned = tab.pinned; gBrowser.removeTab(tab);
        done({rejected, unchanged, applied, removed, pinned,
          vertical:Services.prefs.getBoolPref('sidebar.verticalTabs'),
          signatures:Services.prefs.getBoolPref('xpinstall.signatures.required'),
          sandbox:Services.prefs.getIntPref('security.sandbox.content.level') > 0,
          defaultSearch:searchURL('10 сом в долларах', Browser.config.search).startsWith('https://duckduckgo.com/'),
          shortcut:searchURL('y майнкрафт', Browser.config.search).startsWith('https://www.youtube.com/results?')});
      })().catch(e => done({failure:String(e)}));
    """)
    print(json.dumps(checks, indent=2))
    assert checks.pop('rejected') == 6
    assert all(value is True for value in checks.values()), checks
    if args.screenshot:
        Path(args.screenshot).write_bytes(m.screenshot(format='binary'))
finally:
    m.cleanup()
    del m
    gc.collect()

"""Native Firefox smoke tests; automation privileges are test-only."""
import argparse
import json
import os
import gc
import tempfile
import zipfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from marionette_driver.addons import Addons
from marionette_driver.wait import Wait
from marionette_driver.by import By
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
profile_seed = tempfile.TemporaryDirectory(prefix='Browser test ')
m = Marionette(app='fxdesktop', bin=args.binary, headless=True, app_args=flags, profile=profile_seed.name)
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
        const { SearchService } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
        const personal = await SearchService.addUserEngine({name:'Personal [Browser]', url:'https://example.org/?q={searchTerms}'});
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
          personalSearchPreserved:!!SearchService.getEngineById(personal.id),
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
    class Page(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/favicon.ico':
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<!doctype html><title>Browser extension test</title><body>Local test<input id="note"></body>')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory() as directory:
            xpi = Path(directory) / 'test.xpi'
            manifest = {'manifest_version':2, 'name':'Browser integration test', 'version':'1.0',
                'browser_specific_settings':{'gecko':{'id':'browser-integration@example.invalid'}},
                'content_scripts':[{'matches':['http://127.0.0.1/*'], 'js':['content.js']}]}
            with zipfile.ZipFile(xpi, 'w') as archive:
                archive.writestr('manifest.json', json.dumps(manifest))
                archive.writestr('content.js', "document.body.dataset.browserExtension = 'active';")
            addons = Addons(m)
            addon_id = addons.install(str(xpi), temp=True)
            try:
                m.set_context('content')
                m.navigate(f'http://127.0.0.1:{server.server_port}/')
                Wait(m, timeout=15).until(lambda driver: driver.execute_script("return document.body.dataset.browserExtension === 'active'"))
                assert m.execute_script("return typeof window.Browser === 'undefined' && typeof window.ChromeUtils === 'undefined'")
                print('Native Firefox extension: passed; privileged chrome globals absent from content.')
                m.find_element(By.ID, 'note').send_keys('Preserve this draft')
                m.set_context('chrome')
                discarded = m.execute_async_script("""
                  const done = arguments[arguments.length - 1];
                  const { sleepIdleTabs } = ChromeUtils.importESModule('resource://browser-custom/modules/Tabs.sys.mjs');
                  window.__sleepTestTab = gBrowser.selectedTab;
                  window.__sleepTestOther = gBrowser.addTab('about:blank', {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
                  gBrowser.selectedTab = window.__sleepTestOther;
                  const activity = new WeakMap([[window.__sleepTestTab, Date.now() - 120000]]);
                  sleepIdleTabs(window, activity, 1).then(() => {
                    const pending = window.__sleepTestTab.hasAttribute('pending');
                    gBrowser.selectedTab = window.__sleepTestTab;
                    gBrowser.removeTab(window.__sleepTestOther);
                    done(pending);
                  }).catch(e => done(String(e)));
                """)
                assert discarded is True, discarded
                m.set_context('content')
                Wait(m, timeout=15).until(lambda driver: driver.execute_script("return document.getElementById('note')?.value === 'Preserve this draft'"))
                print('Inactive tab discarded and form draft restored.')
            finally:
                addons.uninstall(addon_id)
                del addons
                m.set_context('chrome')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    m.execute_script("""
      const tab = gBrowser.addTab('about:blank#browser-pin', {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
      gBrowser.pinTab(tab);
    """)
    Wait(m, timeout=15).until(lambda driver: driver.execute_script("return [...gBrowser.tabs].some(t => t.pinned && !t.hasAttribute('busy') && t.linkedBrowser.currentURI.spec === 'about:blank#browser-pin')"))
    m.quit(in_app=True)
    m.start_session()
    m.set_context('chrome')
    Wait(m, timeout=15).until(lambda driver: driver.execute_script("return [...gBrowser.tabs].some(t => t.pinned && t.linkedBrowser.currentURI.spec === 'about:blank#browser-pin')"))
    print('Pinned tab survived a normal quit and fresh launch.')
    if args.screenshot:
        Path(args.screenshot).write_bytes(m.screenshot(format='binary'))
finally:
    m.cleanup()
    del m
    gc.collect()
    profile_seed.cleanup()

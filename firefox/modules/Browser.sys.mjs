import { SearchService } from 'moz-src:///toolkit/components/search/SearchService.sys.mjs';
import { validateConfig } from './Core.sys.mjs';
import { applyTheme, openSettings } from './Interface.sys.mjs';
export const Browser = {
  async start() {
    this.path = PathUtils.join(PathUtils.profileDir, 'browser-config.json');
    this.defaults = await (await fetch('resource://browser-custom/default.json')).json();
    try {
      if (await IOUtils.exists(this.path) && (await IOUtils.stat(this.path)).size > 1000000) throw new Error('Config exceeds 1 MB.');
      this.config = validateConfig(this.defaults, await IOUtils.exists(this.path) ? await IOUtils.readJSON(this.path) : {});
      if (!(await IOUtils.exists(this.path))) await this.write(this.config);
    } catch (error) { this.error = String(error); this.config = validateConfig(this.defaults, {}); Cu.reportError(error); }
    this.applyPreferences();
    Services.obs.addObserver(this, 'browser-delayed-startup-finished');
    for (const win of Services.wm.getEnumerator('navigator:browser')) if (win.gBrowserInit?.delayedStartupFinished) this.attach(win);
    this.ready = this.applySearch().catch(error => { this.error = String(error); Cu.reportError(error); });
  },
  observe(win) { this.attach(win); },
  write(config) { return IOUtils.writeJSON(this.path, config, { tmpPath: this.path + '.tmp' }); },
  save(text) {
    this.pending = (this.pending || Promise.resolve()).catch(() => {}).then(() => this.saveNow(text));
    return this.pending;
  },
  async saveNow(text) {
    await this.ready;
    if (text.length > 1000000) throw new Error('Config exceeds 1 MB.');
    const next = validateConfig(this.defaults, JSON.parse(text));
    await this.write(next); this.config = next; this.applyPreferences();
    await this.applySearch();
    for (const win of Services.wm.getEnumerator('navigator:browser')) applyTheme(win, next.appearance);
    this.error = null;
  },
  applyPreferences() {
    const c = this.config;
    for (const key of this.previousPreferences || []) if (!Object.hasOwn(c.preferences, key)) Services.prefs.clearUserPref(key);
    this.previousPreferences = Object.keys(c.preferences);
    const prefs = {
      'sidebar.revamp': true,
      'sidebar.verticalTabs': true,
      'sidebar.position_start': true,
      'sidebar.main.tools': '',
      'browser.startup.page': c.tabs.restore === 'all' ? 3 : 1,
      'privacy.donottrackheader.enabled': c.privacy.doNotTrack,
      'privacy.globalprivacycontrol.enabled': c.privacy.globalPrivacyControl,
      'browser.contentblocking.category': c.privacy.trackingProtection,
      'privacy.trackingprotection.enabled': c.privacy.trackingProtection === 'strict',
      'permissions.default.desktop-notification': c.privacy.blockNotifications ? 2 : 0,
      'permissions.default.geo': c.privacy.blockLocation ? 2 : 0,
      'xpinstall.signatures.required': !c.extensions.allowUnsigned,
      'widget.windows.mica': c.appearance.material === 'glass',
    };
    for (const [key, value] of Object.entries({ ...prefs, ...c.preferences })) {
      Services.prefs[typeof value === 'boolean' ? 'setBoolPref' : typeof value === 'number' ? 'setIntPref' : 'setStringPref'](key, value);
    }
  },
  async applySearch() {
    await SearchService.init();
    const managed = new Set(this.config.search.engines.map(item => `${item.name} [Browser]`));
    for (const engine of await SearchService.getEngines()) {
      if (engine.name.endsWith(' [Browser]') && !managed.has(engine.name)) await SearchService.removeEngine(engine);
    }
    for (const item of this.config.search.engines) {
      const name = `${item.name} [Browser]`;
      let engine = await SearchService.getEngineByName(name);
      if (engine && engine.getSubmission('browser-config-probe').uri.spec !== item.url.replace('{query}', 'browser-config-probe')) {
        await SearchService.removeEngine(engine); engine = null;
      }
      if (!engine) engine = await SearchService.addUserEngine({ name, url: item.url.replace('{query}', '{searchTerms}'), alias: item.keyword });
      engine.alias = item.keyword;
      if (item.id === this.config.search.default) await SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER);
    }
  },
  attach(win) {
    if (win.document.getElementById('browser-config-button')) return;
    applyTheme(win, this.config.appearance);
    const button = win.document.createXULElement('toolbarbutton');
    button.id = 'browser-config-button'; button.className = 'toolbarbutton-1';
    button.setAttribute('label', '◉'); button.setAttribute('tooltiptext', 'Browser settings');
    button.addEventListener('command', () => openSettings(win, this));
    win.document.getElementById('nav-bar-customization-target').append(button);
    const activity = new WeakMap();
    let previous = win.gBrowser.selectedTab;
    win.gBrowser.tabContainer.addEventListener('TabSelect', () => {
      if (previous) activity.set(previous, Date.now());
      previous = win.gBrowser.selectedTab;
    });
    const timer = win.setInterval(() => {
      const minutes = this.config.tabs.sleepAfterMinutes;
      if (!minutes) return;
      for (const tab of win.gBrowser.tabs) {
        if (tab.selected || tab.pinned || tab.hasAttribute('soundplaying') || tab.hasAttribute('sharing') || tab.linkedBrowser?.isNavigating) continue;
        if (!activity.has(tab)) activity.set(tab, Date.now());
        if (Date.now() - activity.get(tab) > minutes * 60000) win.gBrowser.discardBrowser(tab);
      }
    }, 30000);
    win.addEventListener('unload', () => win.clearInterval(timer), { once: true });
  },
};

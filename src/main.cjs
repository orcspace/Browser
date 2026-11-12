const { app, BrowserWindow, WebContentsView, session, ipcMain, Menu, dialog, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { defaults, readConfig, validateConfig, writeJSON } = require('./core/config.cjs');
const { resolveInput, safeWebURL } = require('./core/navigation.cjs');
const { matches } = require('./core/shortcuts.cjs');
const { configureSession } = require('./security.cjs');
const { Extensions } = require('./extensions.cjs');

app.setName('Browser');
app.enableSandbox();
if (process.env.BROWSER_PROFILE) app.setPath('userData', path.resolve(process.env.BROWSER_PROFILE));
const root = app.getPath('userData');
const configFile = path.join(root, 'config.json');
const stateFile = path.join(root, 'tabs.json');
let config;
let configError = '';
try { config = readConfig(configFile); } catch (error) { config = structuredClone(defaults); configError = error.message; }
// Chromium applies this preference at startup. Updating it requires a restart.
if (config.privacy.blockThirdPartyCookies) app.commandLine.appendSwitch('test-third-party-cookie-phaseout');

const chromeURL = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const tabs = [];
const closedTabs = [];
const downloads = [];
let window, webSession, extensions, activeId, panel = null, ready = false, quitting = false, restartRequired = false;
let saveTimer, updateTimer;

function snapshot() {
  return {
    config, configPath: configFile, configError, restartRequired, platform: process.platform,
    tabs: tabs.map(({ view, ...tab }) => ({ ...tab, canGoBack: !!view?.webContents.navigationHistory.canGoBack(), canGoForward: !!view?.webContents.navigationHistory.canGoForward() })),
    activeId, panel, downloads, extensions: extensions?.list() || []
  };
}
function notify() {
  if (!ready || !window || window.isDestroyed()) return;
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => { if (!window?.isDestroyed()) window.webContents.send('browser:update', snapshot()); }, 20);
}
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
function saveNow() {
  try { writeJSON(stateFile, { tabs: tabs.filter(t => t.url).map(t => ({ url: t.url, title: t.title, pinned: t.pinned })), activeURL: active()?.url || null }); } catch (error) { console.error('Could not save tabs:', error.message); }
}
function active() { return tabs.find(tab => tab.id === activeId); }
function layout() {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const a = config.appearance;
  const left = a.sidebarCollapsed ? a.sidebarCollapsedWidth : a.sidebarWidth;
  for (const tab of tabs) if (tab.view) {
    const visible = tab.id === activeId && !panel && !tab.error;
    tab.view.setVisible(visible);
    if (visible) tab.view.setBounds({ x: left + 1, y: a.toolbarHeight, width: Math.max(1, width - left - 9), height: Math.max(1, height - a.toolbarHeight - 8) });
  }
}
function applyConfig(next) {
  next = validateConfig(next);
  if (next.privacy.blockThirdPartyCookies !== config.privacy.blockThirdPartyCookies) restartRequired = true;
  writeJSON(configFile, next); config = next; configError = '';
  layout(); notify();
  return config;
}
function routeShortcut(contents) {
  contents.on('before-input-event', (event, input) => {
    for (const [name, binding] of Object.entries(config.shortcuts)) {
      if (matches(binding, input)) { event.preventDefault(); Promise.resolve(action(name)).catch(error => showError(error)); return; }
    }
    if (input.type === 'keyDown' && input.key === 'Escape' && panel) { event.preventDefault(); setPanel(null); }
  });
}
function showError(error) {
  if (window && !window.isDestroyed()) window.webContents.send('browser:update', { ...snapshot(), message: error.message });
}
function setPanel(value) {
  panel = value; layout(); notify();
  if (panel) window.webContents.focus(); else active()?.view?.webContents.focus();
}
function createView(tab) {
  const view = new WebContentsView({ webPreferences: {
    session: webSession, nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false,
    spellcheck: false, autoplayPolicy: 'document-user-activation-required', safeDialogs: true
  } });
  tab.view = view; tab.sleeping = false;
  window.contentView.addChildView(view);
  view.setBackgroundColor(config.appearance.background);
  const wc = view.webContents;
  wc.setAudioMuted(tab.muted);
  routeShortcut(wc);
  const guardNavigation = (event, url) => { if (!safeWebURL(url) && url !== 'about:blank') event.preventDefault(); };
  wc.on('will-navigate', guardNavigation);
  wc.on('will-redirect', guardNavigation);
  wc.setWindowOpenHandler(({ url }) => {
    if (safeWebURL(url)) { try { newTab(url); } catch (error) { showError(error); } }
    return { action: 'deny' };
  });
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = ''; layout(); notify(); });
  wc.on('did-stop-loading', () => { tab.loading = false; notify(); });
  wc.on('page-title-updated', (_event, title) => { tab.title = title.slice(0, 250); persist(); notify(); });
  wc.on('did-navigate', (_event, url) => { if (safeWebURL(url)) tab.url = url; tab.secure = url.startsWith('https:'); persist(); notify(); });
  wc.on('did-navigate-in-page', (_event, url, main) => { if (main && safeWebURL(url)) { tab.url = url; persist(); notify(); } });
  wc.on('did-fail-load', (_event, code, description, _url, main) => {
    if (main && code !== -3) { tab.error = `${description} (${code})`; tab.loading = false; layout(); notify(); }
  });
  wc.on('render-process-gone', (_event, details) => {
    tab.error = `Page stopped: ${details.reason}. Reload to try again.`; tab.loading = false; detachView(tab); layout(); notify();
  });
  wc.on('media-started-playing', () => { tab.playing = true; notify(); });
  wc.on('media-paused', () => { tab.playing = false; notify(); });
  wc.on('context-menu', (_event, params) => {
    const items = [];
    if (safeWebURL(params.linkURL)) items.push({ label: 'Open link in new tab', click: () => newTab(params.linkURL) }, { label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) items.push({ role: 'copy' }, { label: 'Search selection', click: () => newTab(resolveInput(params.selectionText, config.search).url) });
    items.push({ type: 'separator' }, { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: 'Reload', click: () => wc.reload() }, { label: 'Save page…', click: async () => { const result = await dialog.showSaveDialog(window, { defaultPath: 'page.html' }); if (!result.canceled) wc.savePage(result.filePath, 'HTMLComplete').catch(showError); } });
    Menu.buildFromTemplate(items).popup({ window });
  });
  if (tab.url) wc.loadURL(tab.url).catch(() => {});
  layout();
}
function detachView(tab) {
  if (!tab.view) return;
  const view = tab.view; tab.view = null;
  window.contentView.removeChildView(view);
  if (!view.webContents.isDestroyed()) view.webContents.close();
}
function newTab(url = null, pinned = false, focus = true) {
  if (tabs.length >= config.tabs.maxOpen) throw new Error(`Tab limit reached (${config.tabs.maxOpen}). Close a tab or increase tabs.maxOpen.`);
  if (url && !safeWebURL(url)) throw new Error('Unsupported address.');
  const tab = { id: randomUUID(), url, title: url ? new URL(url).hostname : 'New tab', pinned, sleeping: false, loading: false, muted: false, playing: false, secure: url?.startsWith('https:') || false, blocked: 0, error: '', lastActive: Date.now(), view: null };
  tabs.push(tab);
  if (focus) activate(tab.id); else notify();
  persist(); return tab;
}
function activate(id) {
  const tab = tabs.find(t => t.id === id); if (!tab) return;
  activeId = id; panel = null; tab.lastActive = Date.now();
  if (tab.url && !tab.view) createView(tab);
  layout(); persist(); notify();
  if (tab.url) tab.view?.webContents.focus(); else window.webContents.focus();
}
function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id); if (index < 0) return;
  const tab = tabs[index];
  closedTabs.push({ url: tab.url, pinned: tab.pinned }); if (closedTabs.length > 20) closedTabs.shift();
  detachView(tab); tabs.splice(index, 1);
  if (!tabs.length) newTab(); else if (id === activeId) activate(tabs[Math.min(index, tabs.length - 1)].id);
  persist(); notify();
}
function navigate(input) {
  const result = resolveInput(input, config.search);
  const tab = active() || newTab();
  tab.url = result.url; tab.title = result.url ? new URL(result.url).hostname : 'New tab'; tab.error = ''; tab.blocked = 0;
  panel = null;
  if (!result.url) detachView(tab);
  else if (!tab.view) createView(tab);
  else tab.view.webContents.loadURL(result.url).catch(() => {});
  layout(); persist(); notify();
}
function tabMenu(id) {
  const tab = tabs.find(t => t.id === id); if (!tab) return;
  Menu.buildFromTemplate([
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', click: () => { tab.pinned = !tab.pinned; persist(); notify(); } },
    { label: 'Duplicate', click: () => newTab(tab.url) },
    { label: tab.muted ? 'Unmute' : 'Mute', click: () => { tab.muted = !tab.muted; tab.view?.webContents.setAudioMuted(tab.muted); notify(); } },
    { label: 'Put tab to sleep', enabled: tab.id !== activeId && !!tab.view && !tab.playing, click: () => { detachView(tab); tab.sleeping = true; notify(); } },
    { type: 'separator' }, { label: 'Close tab', click: () => closeTab(id) }
  ]).popup({ window });
}
async function action(name, data) {
  switch (name) {
    case 'newTab': newTab(); break;
    case 'activate': activate(String(data)); break;
    case 'closeTab': closeTab(typeof data === 'string' ? data : activeId); break;
    case 'reopenTab': { const tab = closedTabs.pop(); if (tab) newTab(tab.url, tab.pinned); break; }
    case 'navigate': if (typeof data !== 'string' || data.length > 16000) throw new Error('Invalid address.'); navigate(data); break;
    case 'focusAddress': window.webContents.focus(); window.webContents.send('browser:update', { ...snapshot(), focusAddress: true }); break;
    case 'toggleSidebar': { const next = structuredClone(config); next.appearance.sidebarCollapsed = !next.appearance.sidebarCollapsed; applyConfig(next); break; }
    case 'pinTab': { const tab = tabs.find(t => t.id === (data || activeId)); if (tab) { tab.pinned = !tab.pinned; persist(); notify(); } break; }
    case 'tabMenu': tabMenu(String(data)); break;
    case 'reorder': {
      const source = tabs.findIndex(t => t.id === data?.source), target = tabs.findIndex(t => t.id === data?.target);
      if (source >= 0 && target >= 0) { const [tab] = tabs.splice(source, 1); tabs.splice(target, 0, tab); persist(); notify(); } break;
    }
    case 'nextTab': case 'previousTab': { const index = tabs.findIndex(t => t.id === activeId); activate(tabs[(index + tabs.length + (name === 'nextTab' ? 1 : -1)) % tabs.length].id); break; }
    case 'back': if (active()?.view?.webContents.navigationHistory.canGoBack()) active().view.webContents.navigationHistory.goBack(); break;
    case 'forward': if (active()?.view?.webContents.navigationHistory.canGoForward()) active().view.webContents.navigationHistory.goForward(); break;
    case 'reload': { const tab = active(); if (tab?.url) { tab.error = ''; if (!tab.view) createView(tab); else tab.view.webContents.reload(); notify(); } break; }
    case 'stop': active()?.view?.webContents.stop(); break;
    case 'settings': case 'extensions': case 'downloads': setPanel(name); break;
    case 'closePanel': setPanel(null); break;
    case 'saveConfig': if (typeof data !== 'string' || data.length > 1024 * 1024) throw new Error('Config exceeds 1 MB.'); applyConfig(JSON.parse(data)); await extensions.sync(); break;
    case 'openConfig': await shell.openPath(configFile); break;
    case 'resetConfig': {
      const answer = await dialog.showMessageBox(window, { message: 'Reset Browser settings?', detail: 'A backup of the current config will be saved next to config.json.', buttons: ['Cancel', 'Reset'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) { fs.copyFileSync(configFile, `${configFile}.${Date.now()}.bak`); applyConfig(defaults); await extensions.sync(); } break;
    }
    case 'installExtension': await extensions.install(); break;
    case 'removeExtension': await extensions.remove(String(data)); break;
    case 'extensionPopup': {
      const extension = webSession.extensions.getExtension(String(data));
      const popup = extension?.manifest?.action?.default_popup || extension?.manifest?.browser_action?.default_popup;
      if (!popup) throw new Error('This extension has no popup. It can still run on websites.');
      const url = new URL(popup, `chrome-extension://${extension.id}/`);
      if (url.protocol !== 'chrome-extension:' || url.hostname !== extension.id) throw new Error('Invalid extension popup.');
      const popupWindow = new BrowserWindow({ parent: window, width: 420, height: 560, title: extension.name, autoHideMenuBar: true, webPreferences: { session: webSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      popupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      popupWindow.webContents.on('will-navigate', (event, destination) => { if (!destination.startsWith(`chrome-extension://${extension.id}/`)) event.preventDefault(); });
      await popupWindow.loadURL(url.href); break;
    }
    case 'bookmark': {
      const tab = active(); if (!tab?.url) break;
      const next = structuredClone(config), index = next.bookmarks.findIndex(item => item.url === tab.url);
      if (index < 0) next.bookmarks.push({ title: tab.title.slice(0, 80), url: tab.url }); else next.bookmarks.splice(index, 1);
      applyConfig(next); break;
    }
    case 'clearData': {
      const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Clear cookies, site storage and cache?', detail: 'This signs you out of websites. Tabs and config stay saved.', buttons: ['Cancel', 'Clear data'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) { await webSession.clearStorageData(); await webSession.clearCache(); } break;
    }
    case 'revealDownload': { const item = downloads.find(d => d.id === data && d.state === 'completed'); if (item) shell.showItemInFolder(item.path); break; }
    case 'minimize': window.minimize(); break;
    case 'maximize': if (window.isMaximized()) window.unmaximize(); else window.maximize(); break;
    case 'closeWindow': window.close(); break;
    default: throw new Error('Unknown action.');
  }
  return { ok: true };
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Browser', submenu: [{ role: 'about' }, { label: 'Settings…', click: () => action('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ label: 'New tab', click: () => action('newTab') }, { label: 'Reopen closed tab', click: () => action('reopenTab') }, { label: 'Settings…', click: () => action('settings') }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ label: 'Toggle sidebar', click: () => action('toggleSidebar') }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
}
async function createWindow() {
  window = new BrowserWindow({ width: 1320, height: 880, minWidth: 760, minHeight: 520, title: 'Browser', backgroundColor: config.appearance.background,
    icon: path.join(__dirname, '../assets/icon.png'), frame: process.platform === 'darwin', titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    trafficLightPosition: { x: 18, y: 18 }, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false }
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.on('resize', layout);
  window.on('close', async event => {
    if (!quitting && config.tabs.confirmCloseWindow && tabs.length > 1) {
      event.preventDefault();
      const result = await dialog.showMessageBox(window, { message: `Close ${tabs.length} tabs?`, buttons: ['Cancel', 'Close Browser'], defaultId: 0, cancelId: 0 });
      if (result.response === 1) { quitting = true; window.close(); }
    } else { saveNow(); for (const tab of tabs) detachView(tab); }
  });
  window.on('closed', () => { ready = false; window = null; tabs.length = 0; });
  routeShortcut(window.webContents);
  extensions = new Extensions(webSession, () => window, () => config, applyConfig, notify);
  await extensions.sync();
  await window.loadURL(chromeURL); ready = true;
  let restoredActiveURL;
  try {
    if (config.tabs.restore !== 'none' && fs.existsSync(stateFile) && fs.statSync(stateFile).size < 1024 * 1024) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      restoredActiveURL = saved.activeURL;
      for (const tab of saved.tabs || []) if (safeWebURL(tab.url) && (config.tabs.restore === 'all' || tab.pinned) && tabs.length < config.tabs.maxOpen) newTab(tab.url, !!tab.pinned, false);
    }
  } catch (error) { console.error('Could not restore tabs:', error.message); }
  if (!tabs.length) newTab(); else activate((tabs.find(tab => tab.url === restoredActiveURL) || tabs[0]).id);
  window.show(); notify();
}

app.whenReady().then(async () => {
  webSession = session.fromPartition('persist:browser', { cache: true });
  configureSession(webSession, () => config, () => window, id => { const tab = tabs.find(t => t.view?.webContents.id === id); if (tab) { tab.blocked++; notify(); } });
  webSession.on('will-download', (_event, item) => {
    const download = { id: randomUUID(), name: item.getFilename(), received: 0, total: item.getTotalBytes(), state: 'progressing', path: '' };
    downloads.unshift(download); if (downloads.length > 100) downloads.pop(); notify();
    item.on('updated', (_e, state) => { download.received = item.getReceivedBytes(); download.total = item.getTotalBytes(); download.state = state; notify(); });
    item.once('done', (_e, state) => { download.state = state; download.path = item.getSavePath(); notify(); });
  });
  function assertChrome(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== chromeURL) throw new Error('Untrusted IPC sender.');
  }
  ipcMain.handle('browser:state', event => { assertChrome(event); return snapshot(); });
  ipcMain.handle('browser:action', async (event, name, data) => {
    assertChrome(event);
    try { return await action(name, data); } catch (error) { return { ok: false, error: error.message }; }
  });
  buildMenu(); await createWindow();
  fs.watchFile(configFile, { interval: 1000 }, () => {
    try {
      const next = readConfig(configFile);
      if (JSON.stringify(next) === JSON.stringify(config)) return;
      if (next.privacy.blockThirdPartyCookies !== config.privacy.blockThirdPartyCookies) restartRequired = true;
      config = next; configError = ''; layout(); extensions.sync().catch(showError); notify();
    } catch (error) { configError = error.message; notify(); }
  });
  setInterval(() => {
    const timeout = config.tabs.sleepAfterMinutes * 60_000;
    if (!timeout) return;
    for (const tab of tabs) if (tab.id !== activeId && tab.view && !tab.playing && !tab.pinned && Date.now() - tab.lastActive > timeout) { detachView(tab); tab.sleeping = true; }
    notify();
  }, 30_000).unref();
}).catch(error => { console.error(error); app.quit(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { fs.unwatchFile(configFile); clearTimeout(saveTimer); clearTimeout(updateTimer); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!window && webSession) createWindow().catch(console.error); });

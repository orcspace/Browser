/* The local browser chrome. Remote pages never receive this API. */
const $ = selector => document.querySelector(selector);
let state;
let renderedPanel;
let toastTimer;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const short = binding => binding.replace('CommandOrControl', state?.platform === 'darwin' ? '⌘' : 'Ctrl').replaceAll('Control', 'Ctrl').replaceAll('Shift', '⇧').replaceAll('+', ' ');

async function send(name, data) {
  const result = await window.browser.action(name, data);
  if (!result.ok) toast(result.error);
  return result;
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
function tabMarkup(tab) {
  return `<div class="tab ${tab.id === state.activeId ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${tab.sleeping ? 'sleeping' : ''} ${tab.loading ? 'loading' : ''}" data-tab="${tab.id}" role="button" tabindex="0" draggable="true" aria-label="${escapeHTML(tab.title)}${tab.pinned ? ', pinned' : ''}" title="${escapeHTML(tab.title)}${tab.sleeping ? ' · Sleeping' : ''}\n${escapeHTML(tab.url || '')}"><span class="tab-icon">${tab.playing ? icon('volume') : tab.sleeping ? icon('moon') : escapeHTML(tab.url ? new URL(tab.url).hostname.replace(/^www\./, '')[0].toUpperCase() : '○')}</span>${tab.pinned ? '' : `<span class="tab-name">${escapeHTML(tab.title)}</span><button class="icon-button close-tab" data-close="${tab.id}" aria-label="Close ${escapeHTML(tab.title)}">${icon('close')}</button>`}</div>`;
}
function update(next) {
  state = next;
  const config = state.config;
  const appearance = config.appearance;
  for (const key of ['background', 'surface', 'text', 'muted', 'accent']) document.documentElement.style.setProperty(`--${key}`, appearance[key]);
  for (const [variable, value] of Object.entries({ sidebar: appearance.sidebarCollapsed ? appearance.sidebarCollapsedWidth : appearance.sidebarWidth, toolbar: appearance.toolbarHeight, 'tab-height': appearance.tabHeight, radius: appearance.cornerRadius })) document.documentElement.style.setProperty(`--${variable}`, `${value}px`);
  document.body.style.fontFamily = appearance.fontFamily;
  document.body.style.fontSize = `${appearance.fontSize}px`;
  document.documentElement.style.setProperty('--font-scale', appearance.fontSize / 13);
  document.body.classList.toggle('collapsed', appearance.sidebarCollapsed);
  document.body.classList.toggle('mac', state.platform === 'darwin');
  document.body.classList.toggle('reduce-motion', appearance.reduceMotion);
  const active = state.tabs.find(tab => tab.id === state.activeId);
  $('#pinned-tabs').innerHTML = state.tabs.filter(tab => tab.pinned).map(tabMarkup).join('');
  $('#regular-tabs').innerHTML = state.tabs.filter(tab => !tab.pinned).map(tabMarkup).join('');
  $('#pinned-label').hidden = !state.tabs.some(tab => tab.pinned);
  $('#tab-count').textContent = state.tabs.length;
  $('#new-shortcut').textContent = short(config.shortcuts.newTab);
  $('#bookmarks').hidden = !appearance.showBookmarks || !config.bookmarks.length;
  $('#bookmarks').innerHTML = `<div class="section-label">BOOKMARKS</div>${config.bookmarks.map(item => `<button class="bookmark-link" data-url="${escapeHTML(item.url)}">${icon('star')}<span>${escapeHTML(item.title)}</span></button>`).join('')}`;
  $('#protection').innerHTML = `${icon('shield')}<span>${config.privacy.blockTrackers ? `Protection on${active?.blocked ? ` · ${active.blocked} blocked` : ''}` : 'Protection paused'}</span>`;
  if (document.activeElement !== $('#address')) $('#address').value = active?.url || '';
  $('#address-icon').innerHTML = icon(active?.secure ? 'lock' : 'search');
  $('#back').disabled = !active?.canGoBack; $('#forward').disabled = !active?.canGoForward;
  $('#reload').innerHTML = icon(active?.loading ? 'close' : 'reload');
  $('#reload').dataset.action = active?.loading ? 'stop' : 'reload';
  $('#bookmark').classList.toggle('saved', config.bookmarks.some(item => item.url === active?.url));
  $('#newtab').hidden = !!active?.url || !!state.panel;
  $('#error-page').hidden = !active?.error || !!state.panel;
  $('#page-error').textContent = active?.error || '';
  $('#panel').hidden = !state.panel;
  $('#search-hints').hidden = !appearance.showSearchHints;
  $('#search-hints').innerHTML = config.search.engines.slice(0, 5).map(engine => `<button class="engine-chip" data-keyword="${escapeHTML(engine.keyword)}"><kbd>${escapeHTML(engine.keyword)}</kbd>${escapeHTML(engine.name)}</button>`).join('');
  $('#default-engine').textContent = config.search.engines.find(engine => engine.id === config.search.default)?.name;
  $('#keyboard-hint').textContent = `${short(config.shortcuts.focusAddress)} to search · ${short(config.shortcuts.newTab)} for a new tab`;
  if (state.panel !== renderedPanel) { renderPanel(); renderedPanel = state.panel; }
  if (state.panel === 'extensions' || state.panel === 'downloads') renderPanel();
  if (state.panel === 'settings') {
    $('#config-warning').textContent = [state.configError && `Config error: ${state.configError}`, state.restartRequired && 'Restart Browser to apply the cookie policy.'].filter(Boolean).join(' ');
    if (document.activeElement !== $('#config-editor') && !$('#config-editor').dataset.dirty) $('#config-editor').value = JSON.stringify(config, null, 2);
  }
  if (state.focusAddress) { $('#address').focus(); $('#address').select(); }
  if (state.message) toast(state.message);
  if (state.configError && !state.panel) toast(`Config error: ${state.configError}. Using the last valid settings.`);
  updateEngine();
}
function panelHeader(title, description) {
  return `<div class="panel-top"><h2>${title}</h2><button class="icon-button" data-action="closePanel" aria-label="Close panel">${icon('close')}</button></div><p class="panel-description">${description}</p>`;
}
function renderPanel() {
  const panel = $('#panel');
  if (state.panel === 'settings') {
    panel.innerHTML = panelHeader('Make it yours.', 'One config. Your browser. Change colors, spacing, search engines, shortcuts and privacy settings below. Changes apply when you save. You can also edit the file in your own editor.') +
      `<div class="config-location">${escapeHTML(state.configPath)}</div><div class="warning" id="config-warning"></div><textarea id="config-editor" aria-label="Browser configuration" spellcheck="false"></textarea><div class="panel-actions"><button class="primary" id="save-config">Save changes</button><button class="secondary" data-action="openConfig">Open config file</button><button class="secondary" data-action="resetConfig">Reset settings</button><button class="secondary" data-action="clearData">Clear browsing data</button></div><p class="panel-description">Quick search: <code>y minecraft</code> → YouTube · <code>gh browser</code> → GitHub. Add any HTTPS search URL with <code>{query}</code>. Permission values: <code>ask</code> or <code>block</code>.</p>`;
    $('#config-editor').value = JSON.stringify(state.config, null, 2);
    $('#config-editor').addEventListener('input', () => { $('#config-editor').dataset.dirty = 'true'; });
    $('#config-editor').addEventListener('keydown', event => {
      if (event.key === 'Tab') { event.preventDefault(); const textarea = event.target; textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end'); textarea.dataset.dirty = 'true'; }
    });
    $('#save-config').onclick = async () => { const result = await send('saveConfig', $('#config-editor').value); if (result.ok) { delete $('#config-editor').dataset.dirty; toast('Configuration saved.'); } };
  } else if (state.panel === 'extensions') {
    panel.innerHTML = panelHeader('Your extensions.', 'Load an unpacked extension folder containing manifest.json. Keep that folder in place. Electron supports a subset of Chrome APIs; some extensions and Chrome Web Store installation are not supported.') +
      '<div class="panel-actions"><button class="primary" data-action="installExtension">Load unpacked extension</button></div>' +
      (state.extensions.length ? state.extensions.map(extension => `<div class="row">${icon('extension')}<div class="row-content"><div class="row-title">${escapeHTML(extension.name)} <span class="row-detail">${escapeHTML(extension.version)}</span></div><div class="row-detail">${escapeHTML(extension.path)}</div>${extension.error ? `<div class="warning">${escapeHTML(extension.error)}</div>` : ''}</div>${extension.id ? `<button class="secondary" data-popup="${escapeHTML(extension.id)}">Open</button>` : ''}<button class="secondary" data-remove="${escapeHTML(extension.id || extension.path)}">Remove</button></div>`).join('') : '<div class="empty">A clean slate. Add only what you need.</div>');
  } else if (state.panel === 'downloads') {
    panel.innerHTML = panelHeader('Downloads.', 'Files downloaded during this session. Choose where each file is saved.') +
      (state.downloads.length ? state.downloads.map(item => `<div class="row">${icon('download')}<div class="row-content"><div class="row-title">${escapeHTML(item.name)}</div><div class="row-detail">${escapeHTML(item.state)} · ${(item.received / 1048576).toFixed(1)}${item.total ? ` / ${(item.total / 1048576).toFixed(1)}` : ''} MB</div></div>${item.state === 'completed' ? `<button class="secondary" data-download="${item.id}">Show in folder</button>` : ''}</div>`).join('') : '<div class="empty">Nothing downloaded yet.</div>');
  }
}
function updateEngine() {
  if (!state) return;
  const keyword = $('#address').value.trim().split(/\s/)[0].toLowerCase();
  const engine = state.config.search.engines.find(item => item.keyword.toLowerCase() === keyword);
  $('#engine-indicator').textContent = engine ? engine.name : '';
}
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]'); if (close) { send('closeTab', close.dataset.close); return; }
  const action = event.target.closest('[data-action]'); if (action) { send(action.dataset.action); return; }
  const tab = event.target.closest('[data-tab]'); if (tab) { send('activate', tab.dataset.tab); return; }
  const link = event.target.closest('[data-url]'); if (link) { send('navigate', link.dataset.url); return; }
  const chip = event.target.closest('[data-keyword]'); if (chip) { $('#search').value = `${chip.dataset.keyword} `; $('#search').focus(); return; }
  const remove = event.target.closest('[data-remove]'); if (remove) send('removeExtension', remove.dataset.remove);
  const popup = event.target.closest('[data-popup]'); if (popup) send('extensionPopup', popup.dataset.popup);
  const download = event.target.closest('[data-download]'); if (download) send('revealDownload', download.dataset.download);
});
document.addEventListener('contextmenu', event => { const tab = event.target.closest('[data-tab]'); if (tab) { event.preventDefault(); send('tabMenu', tab.dataset.tab); } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (state.panel) send('closePanel'); else $('#address').blur(); }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-tab]')) { event.preventDefault(); send('activate', event.target.dataset.tab); }
});
let dragged;
document.addEventListener('dragstart', event => { dragged = event.target.closest('[data-tab]')?.dataset.tab; });
document.addEventListener('dragover', event => { if (event.target.closest('[data-tab]')) event.preventDefault(); });
document.addEventListener('drop', event => { const tab = event.target.closest('[data-tab]'); if (dragged && tab) { event.preventDefault(); send('reorder', { source: dragged, target: tab.dataset.tab }); } dragged = null; });
$('#address-form').addEventListener('submit', event => { event.preventDefault(); send('navigate', $('#address').value); $('#address').blur(); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); send('navigate', $('#search').value); $('#search').value = ''; });
$('#address').addEventListener('focus', () => $('#address').select());
$('#address').addEventListener('input', updateEngine);
for (const [selector, name] of Object.entries({ '.collapse':'sidebar', '#new-icon':'plus', '#back':'back', '#forward':'forward', '#reload':'reload', '#bookmark':'star', '#search-icon':'search', '#search-submit':'forward' })) $(selector).innerHTML = icon(name);
for (const name of ['downloads', 'extensions', 'settings', 'minimize', 'maximize', 'closeWindow']) $(`[data-action="${name}"]`).innerHTML = icon({ downloads:'download', extensions:'extension', settings:'settings', minimize:'min', maximize:'max', closeWindow:'close' }[name]);
window.browser.subscribe(update);
window.browser.state().then(update);

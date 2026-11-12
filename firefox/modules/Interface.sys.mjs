const HTML = 'http://www.w3.org/1999/xhtml';
export function applyTheme(win, a) {
  const doc = win.document;
  let style = doc.getElementById('browser-custom-theme');
  if (!style) { style = doc.createElementNS(HTML, 'style'); style.id = 'browser-custom-theme'; doc.documentElement.append(style); }
  style.textContent = `
    :root { color-scheme: dark !important; --background-color-box: ${a.background}; --text-color: ${a.text}; --toolbar-bgcolor: ${a.background}; --toolbar-color: ${a.text};
      --lwt-accent-color: ${a.background}; --lwt-text-color: ${a.text};
      --tab-selected-bgcolor: ${a.surface}; --tab-min-height: ${a.tabHeight}px;
      --tab-border-radius: ${a.cornerRadius}px; --sidebar-background-color: ${a.background};
      --sidebar-text-color: ${a.text}; --sidebar-width: ${a.sidebarWidth}px;
      --toolbar-field-background-color: color-mix(in srgb, ${a.surface} ${a.surfaceOpacity * 100}%, transparent); --toolbar-field-color: ${a.text};
      --focus-outline-color: ${a.accent}; --toolbar-field-placeholder-color: ${a.muted}; font-size: ${a.fontSize}px !important; }
    #navigator-toolbox { opacity: ${a.windowOpacity}; }
    #navigator-toolbox, sidebar-main { color: ${a.text}; background-color: ${a.background}; }
    sidebar-main { min-width: ${a.sidebarWidth}px; }
    #sidebar-container, #vertical-tabs { background: ${a.background} !important; color: ${a.text} !important; }
    #tabbrowser-tabs, .tabbrowser-tab { color: ${a.text} !important; --tab-selected-textcolor: ${a.text}; }
    .tab-label { color: ${a.text} !important; }
    .tab-background[selected] { background: ${a.surface} !important; }
    #browser-config-button .toolbarbutton-icon { width: 16px; height: 16px; border: 2px solid ${a.text}; border-radius: 50%; padding: 0 !important; margin: 8px; }
    #firefox-view-button, #fxa-toolbar-menu-button { display: none !important; }
    ${a.reduceMotion ? '* { animation-duration: 0s !important; transition-duration: 0s !important; }' : ''}
    ${a.material === 'glass' ? `#navigator-toolbox, sidebar-main { background: color-mix(in srgb, ${a.background} ${a.backgroundOpacity * 100}%, transparent) !important; backdrop-filter: blur(${a.blur}px); }` : ''}
  `;
  doc.documentElement.style.setProperty('font-family', a.fontFamily);
  for (const key of win.__browserCSSVariables || []) doc.documentElement.style.removeProperty(key);
  for (const [key, value] of Object.entries(a.cssVariables)) doc.documentElement.style.setProperty(key, value);
  win.__browserCSSVariables = Object.keys(a.cssVariables);
  let custom = doc.getElementById('browser-user-theme');
  if (!custom) { custom = doc.createElementNS(HTML, 'style'); custom.id = 'browser-user-theme'; doc.documentElement.append(custom); }
  custom.textContent = a.customCSS;
}
export function openSettings(win, browser) {
  const doc = win.document;
  let panel = doc.getElementById('browser-settings-panel');
  if (panel) { panel.openPopup(doc.getElementById('browser-config-button'), 'after_end'); return; }
  panel = doc.createXULElement('panel'); panel.id = 'browser-settings-panel'; panel.setAttribute('noautohide', 'true');
  const box = doc.createElementNS(HTML, 'div'); box.style.cssText = 'padding:20px;width:min(680px,80vw);color:var(--toolbar-color);background:var(--toolbar-bgcolor);';
  const heading = doc.createElementNS(HTML, 'h2'); heading.textContent = 'Browser settings';
  const path = doc.createElementNS(HTML, 'p'); path.textContent = browser.path;
  const editor = doc.createElementNS(HTML, 'textarea'); editor.setAttribute('aria-label', 'Browser JSON configuration'); editor.spellcheck = false;
  editor.style.cssText = 'width:100%;height:50vh;box-sizing:border-box;font:13px monospace;'; editor.value = JSON.stringify(browser.config, null, 2);
  const status = doc.createElementNS(HTML, 'p'); status.setAttribute('role', 'status'); status.textContent = browser.error || '';
  box.append(heading, path, editor, status);
  const action = (label, handler) => { const b = doc.createElementNS(HTML, 'button'); b.textContent = label; b.addEventListener('click', handler); box.append(b); return b; };
  const save = action('Save', async () => {
    save.disabled = true;
    try { await browser.save(editor.value); status.textContent = 'Saved. Some preferences require a restart.'; }
    catch (error) { status.textContent = String(error); }
    finally { save.disabled = false; }
  });
  action('Reload file', async () => { try { editor.value = JSON.stringify(await IOUtils.readJSON(browser.path), null, 2); status.textContent = 'Loaded. Save to apply.'; } catch (error) { status.textContent = String(error); } });
  action('Extensions', () => { win.switchToTabHavingURI('about:addons', true); panel.hidePopup(); });
  action('Close', () => panel.hidePopup());
  panel.append(box); doc.getElementById('mainPopupSet').append(panel); panel.openPopup(doc.getElementById('browser-config-button'), 'after_end');
}

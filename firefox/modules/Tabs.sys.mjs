const eligible = tab => !tab.selected && !tab.pinned && !tab.closing &&
  !['pending', 'busy', 'soundplaying', 'sharing', 'pictureinpicture'].some(name => tab.hasAttribute(name)) &&
  !tab.linkedBrowser?.isNavigating;

export async function sleepIdleTabs(win, activity, minutes, now = Date.now()) {
  if (!minutes || win.closed) return;
  for (const tab of win.gBrowser.tabs) {
    if (!eligible(tab)) continue;
    if (!activity.has(tab)) activity.set(tab, now);
    if (now - activity.get(tab) <= minutes * 60000) continue;
    // Flush native session state before discarding, so form/scroll state is kept.
    await win.gBrowser.prepareDiscardBrowser(tab);
    if (!win.closed && eligible(tab)) win.gBrowser.discardBrowser(tab);
  }
}

export function trackTabs(win, getMinutes) {
  const activity = new WeakMap();
  let previous = win.gBrowser.selectedTab;
  let scanning = false;
  win.gBrowser.tabContainer.addEventListener('TabSelect', () => {
    if (previous) activity.set(previous, Date.now());
    previous = win.gBrowser.selectedTab;
  });
  const timer = win.setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try { await sleepIdleTabs(win, activity, getMinutes()); }
    catch (error) { if (!win.closed) Cu.reportError(error); }
    finally { scanning = false; }
  }, 30000);
  win.addEventListener('unload', () => win.clearInterval(timer), { once: true });
}

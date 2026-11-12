const { WebContentsView, Menu, clipboard } = require("electron");
const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { safeWebURL, resolveInput } = require("../core/navigation.cjs");

class Tabs extends EventEmitter {
  constructor(window, session, store, wireShortcuts) {
    super();
    Object.assign(this, { window, session, store, wireShortcuts });
    this.items = [];
    this.closed = [];
    this.activeId = null;
    this.panel = null;
    this.sleepTimer = setInterval(() => this.sleepInactive(), 30_000);
    this.sleepTimer.unref();
  }
  get config() {
    return this.store.value;
  }
  get active() {
    return this.items.find((tab) => tab.id === this.activeId);
  }
  snapshot() {
    return this.items.map(({ view, committedURL, ...tab }) => ({
      ...tab,
      canGoBack: !!view?.webContents.navigationHistory.canGoBack(),
      canGoForward: !!view?.webContents.navigationHistory.canGoForward(),
    }));
  }
  change(persist = false) {
    if (persist) this.persist();
    this.emit("change");
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.saveTimer);
    const tabs = this.items
      .filter((t) => t.url)
      .map((t) => ({
        url: t.url,
        title: t.title,
        pinned: t.pinned,
        muted: t.muted,
      }));
    try {
      this.store.saveTabs({ tabs, activeURL: this.active?.url || null });
    } catch (error) {
      this.emit("error-message", error.message);
    }
  }
  restore() {
    const saved = this.store.readTabs();
    if (this.config.tabs.restore !== "none") {
      for (const tab of saved.tabs || []) {
        if (
          safeWebURL(tab.url) &&
          (this.config.tabs.restore === "all" || tab.pinned) &&
          this.items.length < this.config.tabs.maxOpen
        ) {
          const restored = this.create(tab.url, !!tab.pinned, false);
          if (typeof tab.title === "string" && tab.title)
            restored.title = tab.title.slice(0, 250);
          restored.muted = tab.muted === true;
        }
      }
    }
    if (!this.items.length) this.create();
    else
      this.activate(
        (this.items.find((t) => t.url === saved.activeURL) || this.items[0]).id,
      );
  }
  create(url = null, pinned = false, focus = true) {
    if (this.items.length >= this.config.tabs.maxOpen)
      throw new Error(`Tab limit reached (${this.config.tabs.maxOpen}).`);
    if (url && !safeWebURL(url)) throw new Error("Unsupported address.");
    const tab = {
      id: randomUUID(),
      url,
      committedURL: null,
      title: url ? new URL(url).hostname : "New tab",
      pinned,
      sleeping: !!url && !focus,
      loading: false,
      muted: false,
      playing: false,
      secure: false,
      blocked: 0,
      error: "",
      lastActive: Date.now(),
      view: null,
    };
    this.items.push(tab);
    if (focus) this.activate(tab.id);
    else this.change();
    this.persist();
    return tab;
  }
  activate(id) {
    const tab = this.items.find((t) => t.id === id);
    if (!tab) return;
    if (this.active && this.activeId !== id)
      this.active.lastActive = Date.now();
    this.activeId = id;
    this.panel = null;
    tab.lastActive = Date.now();
    if (tab.url && !tab.view) this.attach(tab);
    this.layout();
    this.change(true);
    this.focus();
  }
  focus() {
    if (this.panel || !this.active?.view) this.window.webContents.focus();
    else this.active.view.webContents.focus();
  }
  setPanel(panel) {
    this.panel = panel;
    this.layout();
    this.change();
    this.focus();
  }
  layout() {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const a = this.config.appearance;
    const left = a.sidebarCollapsed ? a.sidebarCollapsedWidth : a.sidebarWidth;
    for (const tab of this.items)
      if (tab.view) {
        const visible =
          !!tab.url &&
          tab.id === this.activeId &&
          !this.panel &&
          !tab.error &&
          this.viewport?.width !== 0 &&
          this.viewport?.height !== 0;
        tab.view.setVisible(visible);
        tab.view.setBorderRadius(a.cornerRadius);
        if (visible) {
          const bounds = this.viewport || {
            x: left + 1,
            y: a.toolbarHeight,
            width: width - left - 9,
            height: height - a.toolbarHeight - 8,
          };
          const x = Math.max(0, Math.min(bounds.x, width - 1));
          const y = Math.max(0, Math.min(bounds.y, height - 1));
          tab.view.setBounds({
            x,
            y,
            width: Math.max(1, Math.min(bounds.width, width - x)),
            height: Math.max(1, Math.min(bounds.height, height - y)),
          });
        }
      }
  }
  attach(tab) {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        autoplayPolicy: "document-user-activation-required",
        safeDialogs: true,
      },
    });
    tab.view = view;
    tab.sleeping = false;
    this.window.contentView.addChildView(view);
    view.setBackgroundColor(this.config.appearance.background);
    view.setBorderRadius(this.config.appearance.cornerRadius);
    const wc = view.webContents;
    wc.setAudioMuted(tab.muted);
    this.wireShortcuts(wc);
    const guard = (event, url) => {
      if (!safeWebURL(url) && url !== "about:blank") event.preventDefault();
    };
    wc.on("will-navigate", guard);
    wc.on("will-redirect", guard);
    wc.on("will-frame-navigate", (event) => {
      // Subframes may legitimately use about:blank, blob: and extension URLs;
      // Chromium enforces their origin rules. Local/privileged frames stay blocked.
      if (/^(file|javascript|chrome|devtools):/i.test(event.url))
        event.preventDefault();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (safeWebURL(url)) this.attempt(() => this.create(url));
      return { action: "deny" };
    });
    wc.on("did-start-loading", () => {
      tab.loading = true;
      tab.error = "";
      this.layout();
      this.change();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      this.change();
    });
    wc.on("page-title-updated", (_event, title) => {
      tab.title = title.slice(0, 250);
      this.change(true);
    });
    wc.on("did-navigate", (_event, url) => this.commit(tab, url));
    wc.on("did-navigate-in-page", (_event, url, main) => {
      if (main) this.commit(tab, url);
    });
    wc.on("did-fail-load", (_event, code, description, _url, main) => {
      if (!main) return;
      if (code === -3) {
        // Downloads and canceled navigations do not replace the current document.
        if (tab.committedURL) tab.url = tab.committedURL;
      } else tab.error = `${description} (${code})`;
      tab.loading = false;
      this.layout();
      this.change();
    });
    wc.on("render-process-gone", (_event, details) => {
      tab.error = `Page stopped: ${details.reason}. Reload to try again.`;
      tab.loading = false;
      this.detach(tab);
      this.layout();
      this.change();
    });
    wc.on("media-started-playing", () => {
      tab.playing = true;
      this.change();
    });
    wc.on("media-paused", () => {
      tab.playing = false;
      this.change();
    });
    wc.on("context-menu", (_event, params) => this.pageMenu(wc, params));
    if (tab.url) wc.loadURL(tab.url).catch(() => {});
    this.layout();
  }
  commit(tab, url) {
    if (!safeWebURL(url)) return;
    tab.url = url;
    tab.committedURL = url;
    tab.secure = url.startsWith("https:");
    this.change(true);
  }
  detach(tab) {
    if (!tab.view) return;
    const view = tab.view;
    tab.view = null;
    this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  close(id = this.activeId) {
    const index = this.items.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tab = this.items[index];
    this.closed.push({ url: tab.url, pinned: tab.pinned });
    if (this.closed.length > 20) this.closed.shift();
    this.detach(tab);
    this.items.splice(index, 1);
    if (!this.items.length) this.create();
    else if (id === this.activeId)
      this.activate(this.items[Math.min(index, this.items.length - 1)].id);
    this.change(true);
  }
  navigate(input) {
    const { url } = resolveInput(input, this.config.search);
    const tab = this.active || this.create();
    tab.url = url;
    tab.error = "";
    tab.blocked = 0;
    tab.secure = false;
    if (!tab.committedURL) tab.title = url ? new URL(url).hostname : "New tab";
    this.panel = null;
    if (!url) {
      this.detach(tab);
      tab.committedURL = null;
      tab.title = "New tab";
    } else if (!tab.view) this.attach(tab);
    else tab.view.webContents.loadURL(url).catch(() => {});
    this.layout();
    this.change(true);
  }
  reload() {
    const tab = this.active;
    if (tab?.url) {
      tab.error = "";
      if (!tab.view) this.attach(tab);
      else tab.view.webContents.reload();
      this.layout();
      this.change();
    }
  }
  downloadStarted(contents) {
    const tab = this.items.find((item) => item.view?.webContents === contents);
    if (!tab) return;
    tab.url = tab.committedURL;
    if (!tab.url) tab.title = "New tab";
    tab.loading = false;
    tab.secure = !!tab.url?.startsWith("https:");
    this.layout();
    this.change(true);
  }
  downloadFinished(contents) {
    const tab = this.items.find((item) => item.view?.webContents === contents);
    if (tab && !tab.url) {
      this.detach(tab);
      this.layout();
      this.change();
    }
  }
  pin(id = this.activeId) {
    const tab = this.items.find((t) => t.id === id);
    if (tab) {
      tab.pinned = !tab.pinned;
      this.change(true);
    }
  }
  cycle(direction) {
    const index = this.items.findIndex((t) => t.id === this.activeId);
    this.activate(
      this.items[(index + this.items.length + direction) % this.items.length]
        .id,
    );
  }
  reopen() {
    const tab = this.closed.at(-1);
    if (tab) {
      this.create(tab.url, tab.pinned);
      this.closed.pop();
    }
  }
  reorder(sourceId, targetId) {
    const source = this.items.findIndex((t) => t.id === sourceId),
      target = this.items.findIndex((t) => t.id === targetId);
    if (source >= 0 && target >= 0) {
      const [tab] = this.items.splice(source, 1);
      this.items.splice(target, 0, tab);
      this.change(true);
    }
  }
  sleepInactive() {
    const timeout = this.config.tabs.sleepAfterMinutes * 60_000;
    if (!timeout) return;
    let changed = false;
    for (const tab of this.items)
      if (
        tab.id !== this.activeId &&
        tab.view &&
        !tab.playing &&
        !tab.pinned &&
        Date.now() - tab.lastActive > timeout
      ) {
        this.detach(tab);
        tab.sleeping = true;
        changed = true;
      }
    if (changed) this.change();
  }
  attempt(callback) {
    try {
      callback();
    } catch (error) {
      this.emit("error-message", error.message);
    }
  }
  menu(id) {
    const tab = this.items.find((t) => t.id === id);
    if (!tab) return;
    Menu.buildFromTemplate([
      {
        label: tab.pinned ? "Unpin tab" : "Pin tab",
        click: () => this.pin(id),
      },
      {
        label: "Duplicate",
        click: () => this.attempt(() => this.create(tab.url)),
      },
      {
        label: tab.muted ? "Unmute" : "Mute",
        click: () => {
          tab.muted = !tab.muted;
          tab.view?.webContents.setAudioMuted(tab.muted);
          this.change();
        },
      },
      {
        label: "Put tab to sleep",
        enabled: tab.id !== this.activeId && !!tab.view && !tab.playing,
        click: () => {
          this.detach(tab);
          tab.sleeping = true;
          this.change();
        },
      },
      { type: "separator" },
      { label: "Close tab", click: () => this.close(id) },
    ]).popup({ window: this.window });
  }
  pageMenu(wc, params) {
    const items = [];
    if (safeWebURL(params.linkURL))
      items.push(
        {
          label: "Open link in new tab",
          click: () => this.attempt(() => this.create(params.linkURL)),
        },
        {
          label: "Copy link",
          click: () => clipboard.writeText(params.linkURL),
        },
      );
    if (params.isEditable)
      items.push(
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      );
    else if (params.selectionText)
      items.push(
        { role: "copy" },
        {
          label: "Search selection",
          click: () =>
            this.attempt(() =>
              this.create(
                resolveInput(params.selectionText, this.config.search).url,
              ),
            ),
        },
      );
    if (items.length) items.push({ type: "separator" });
    items.push(
      {
        label: "Back",
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack(),
      },
      { label: "Reload", click: () => wc.reload() },
    );
    Menu.buildFromTemplate(items).popup({ window: this.window });
  }
  dispose() {
    this.flush();
    clearInterval(this.sleepTimer);
    for (const tab of this.items) this.detach(tab);
    this.removeAllListeners();
  }
}
module.exports = { Tabs };

const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  Menu,
  dialog,
  shell,
} = require("electron");
const { configureSession } = require("./security.cjs");
const {
  createShell,
  applyWindowAppearance,
  chromeURL,
} = require("./window.cjs");
const { Tabs } = require("./tabs.cjs");
const { Extensions } = require("./extensions.cjs");
const { Downloads } = require("./downloads.cjs");
const { matches } = require("../core/shortcuts.cjs");

class Application {
  constructor(store) {
    this.store = store;
    this.ready = false;
    this.quitting = false;
  }
  async start() {
    this.session = session.fromPartition("persist:browser", { cache: true });
    configureSession(
      this.session,
      () => this.store.value,
      () => this.window,
      (id) => {
        const tab = this.tabs?.items.find((t) => t.view?.webContents.id === id);
        if (tab) {
          tab.blocked++;
          this.notify();
        }
      },
    );
    this.downloads = new Downloads(this.session);
    this.downloads.on("change", () => this.notify());
    this.downloads.on("started", (contents) =>
      this.tabs?.downloadStarted(contents),
    );
    this.downloads.on("finished", (contents) =>
      this.tabs?.downloadFinished(contents),
    );
    this.extensions = new Extensions(
      this.session,
      () => this.window,
      () => this.store.value,
      (value) => this.store.save(value),
      () => this.notify(),
    );
    this.store.on("change", () => {
      if (this.window && !this.window.isDestroyed()) {
        applyWindowAppearance(this.window, this.store.value);
        this.tabs.layout();
      }
      this.extensions.sync().catch((error) => this.error(error));
      this.notify();
    });
    this.store.on("error-message", () => this.notify());
    this.store.watch();
    this.registerIPC();
    this.buildMenu();
    await this.openWindow();
  }
  snapshot() {
    return {
      config: this.store.value,
      configPath: this.store.file,
      configError: this.store.error,
      restartRequired: this.store.restartRequired,
      platform: process.platform,
      tabs: this.tabs?.snapshot() || [],
      activeId: this.tabs?.activeId,
      panel: this.tabs?.panel,
      downloads: this.downloads?.items || [],
      extensions: this.extensions?.list() || [],
    };
  }
  notify() {
    // Bounded update frequency without starving the UI on busy pages.
    if (!this.ready || this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      if (this.window && !this.window.isDestroyed())
        this.window.webContents.send("browser:update", this.snapshot());
    }, 50);
  }
  error(error) {
    if (this.ready && !this.window?.isDestroyed())
      this.window.webContents.send("browser:update", {
        ...this.snapshot(),
        message: error.message,
      });
  }
  registerIPC() {
    const assertChrome = (event) => {
      if (
        !this.window ||
        event.sender !== this.window.webContents ||
        event.senderFrame !== this.window.webContents.mainFrame ||
        event.senderFrame.url !== chromeURL
      )
        throw new Error("Untrusted IPC sender.");
    };
    ipcMain.handle("browser:state", (event) => {
      assertChrome(event);
      return this.snapshot();
    });
    ipcMain.handle("browser:action", async (event, name, data) => {
      assertChrome(event);
      try {
        const result = await this.action(name, data);
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
  }
  wireShortcuts(contents) {
    contents.on("before-input-event", (event, input) => {
      for (const [name, binding] of Object.entries(
        this.store.value.shortcuts,
      )) {
        if (matches(binding, input)) {
          event.preventDefault();
          this.action(name).catch((error) => this.error(error));
          return;
        }
      }
      if (
        input.type === "keyDown" &&
        input.key === "Escape" &&
        this.tabs?.panel
      ) {
        event.preventDefault();
        this.tabs.setPanel(null);
      }
    });
  }
  async openWindow() {
    if (this.window) return this.window.focus();
    this.window = createShell(this.store.value);
    this.tabs = new Tabs(this.window, this.session, this.store, (wc) =>
      this.wireShortcuts(wc),
    );
    this.tabs.on("change", () => this.notify());
    this.tabs.on("error-message", (message) => this.error(new Error(message)));
    this.window.on("resize", () => this.tabs?.layout());
    let closeApproved = false,
      closePending = false;
    this.window.on("close", async (event) => {
      if (
        !this.quitting &&
        !closeApproved &&
        this.store.value.tabs.confirmCloseWindow &&
        this.tabs.items.length > 1
      ) {
        event.preventDefault();
        if (closePending) return;
        closePending = true;
        const result = await dialog.showMessageBox(this.window, {
          message: `Close ${this.tabs.items.length} tabs?`,
          buttons: ["Cancel", "Close Browser"],
          defaultId: 0,
          cancelId: 0,
        });
        closePending = false;
        if (result.response === 1) {
          closeApproved = true;
          this.window.close();
        }
      } else {
        this.ready = false;
        this.tabs.dispose();
      }
    });
    this.window.on("closed", () => {
      this.ready = false;
      this.window = null;
      this.tabs = null;
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    });
    this.wireShortcuts(this.window.webContents);
    await this.extensions.sync();
    await this.window.loadURL(chromeURL);
    this.ready = true;
    this.tabs.restore();
    this.window.show();
    this.notify();
  }
  async action(name, data) {
    const tabs = this.tabs,
      config = this.store.value;
    if (!tabs && name !== "newTab") return;
    switch (name) {
      case "newTab":
        if (!tabs) await this.openWindow();
        else tabs.create();
        break;
      case "activate":
        tabs.activate(String(data));
        break;
      case "closeTab":
        tabs.close(typeof data === "string" ? data : undefined);
        break;
      case "reopenTab":
        tabs.reopen();
        break;
      case "navigate":
        if (typeof data !== "string" || data.length > 16000)
          throw new Error("Invalid address.");
        tabs.navigate(data);
        break;
      case "focusAddress":
        this.window.webContents.focus();
        this.window.webContents.send("browser:update", {
          ...this.snapshot(),
          focusAddress: true,
        });
        break;
      case "focusPage":
        tabs.focus();
        break;
      case "viewport": {
        if (
          !data ||
          !["x", "y", "width", "height"].every(
            (key) =>
              Number.isInteger(data[key]) &&
              data[key] >= (key === "x" || key === "y" ? -32768 : 0) &&
              data[key] <= 32768,
          ) ||
          data.width < 0 ||
          data.height < 0
        )
          throw new Error("Invalid viewport.");
        tabs.viewport = {
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
        };
        tabs.layout();
        break;
      }
      case "toggleSidebar": {
        const next = structuredClone(config);
        next.appearance.sidebarCollapsed = !next.appearance.sidebarCollapsed;
        this.store.save(next);
        break;
      }
      case "pinTab":
        tabs.pin(data || undefined);
        break;
      case "tabMenu":
        tabs.menu(String(data));
        break;
      case "reorder":
        tabs.reorder(data?.source, data?.target);
        break;
      case "nextTab":
        tabs.cycle(1);
        break;
      case "previousTab":
        tabs.cycle(-1);
        break;
      case "back":
      case "forward": {
        const history = tabs.active?.view?.webContents.navigationHistory;
        if (name === "back" && history?.canGoBack()) history.goBack();
        if (name === "forward" && history?.canGoForward()) history.goForward();
        break;
      }
      case "reload":
        tabs.reload();
        break;
      case "stop":
        tabs.active?.view?.webContents.stop();
        break;
      case "settings":
      case "extensions":
      case "downloads":
        tabs.setPanel(name);
        break;
      case "closePanel":
        tabs.setPanel(null);
        break;
      case "saveConfig":
        if (typeof data !== "string" || data.length > 1024 * 1024)
          throw new Error("Config exceeds 1 MB.");
        this.store.save(JSON.parse(data));
        await this.extensions.sync();
        break;
      case "openConfig":
        await shell.openPath(this.store.file);
        break;
      case "resetConfig": {
        const result = await dialog.showMessageBox(this.window, {
          message: "Reset Browser settings?",
          detail:
            "A backup of the current config will be saved next to config.json.",
          buttons: ["Cancel", "Reset"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          this.store.reset();
          await this.extensions.sync();
          return { reset: true };
        }
        break;
      }
      case "restart":
        tabs.flush();
        app.relaunch();
        app.quit();
        break;
      case "installExtension":
        await this.extensions.install();
        break;
      case "removeExtension":
        await this.extensions.remove(String(data));
        break;
      case "extensionPopup":
        await this.openExtension(String(data));
        break;
      case "clearData": {
        const result = await dialog.showMessageBox(this.window, {
          type: "warning",
          message: "Clear cookies, site storage and cache?",
          detail: "This signs you out of websites. Tabs and config stay saved.",
          buttons: ["Cancel", "Clear data"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          await this.session.clearStorageData();
          await this.session.clearCache();
        }
        break;
      }
      case "revealDownload": {
        const item = this.downloads.items.find(
          (d) => d.id === data && d.state === "completed",
        );
        if (item) shell.showItemInFolder(item.path);
        break;
      }
      case "minimize":
        this.window.minimize();
        break;
      case "maximize":
        if (this.window.isMaximized()) this.window.unmaximize();
        else this.window.maximize();
        break;
      case "closeWindow":
        this.window.close();
        break;
      default:
        throw new Error("Unknown action.");
    }
  }
  async openExtension(id) {
    const extension = this.session.extensions.getExtension(id);
    const popup =
      extension?.manifest?.action?.default_popup ||
      extension?.manifest?.browser_action?.default_popup;
    if (!popup)
      throw new Error(
        "This extension has no popup. It can still run on websites.",
      );
    const url = new URL(popup, `chrome-extension://${extension.id}/`);
    if (url.protocol !== "chrome-extension:" || url.hostname !== extension.id)
      throw new Error("Invalid extension popup.");
    const popupWindow = new BrowserWindow({
      parent: this.window,
      width: 420,
      height: 560,
      title: extension.name,
      autoHideMenuBar: true,
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    popupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const guard = (event, destination) => {
      if (
        !(event.url || destination).startsWith(
          `chrome-extension://${extension.id}/`,
        )
      )
        event.preventDefault();
    };
    popupWindow.webContents.on("will-navigate", guard);
    popupWindow.webContents.on("will-redirect", guard);
    await popupWindow.loadURL(url.href);
  }
  buildMenu() {
    const run = (name) => () =>
      this.action(name).catch((error) => this.error(error));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [
              {
                label: "Browser",
                submenu: [
                  { role: "about" },
                  { label: "Settings…", click: run("settings") },
                  { type: "separator" },
                  { role: "hide" },
                  { role: "hideOthers" },
                  { role: "unhide" },
                  { role: "quit" },
                ],
              },
            ]
          : []),
        {
          label: "File",
          submenu: [
            { label: "New tab", click: run("newTab") },
            { label: "Reopen closed tab", click: run("reopenTab") },
            { label: "Settings…", click: run("settings") },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            { label: "Toggle sidebar", click: run("toggleSidebar") },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
      ]),
    );
  }
  dispose() {
    this.store.dispose();
    this.downloads?.dispose();
    clearTimeout(this.updateTimer);
  }
}
module.exports = { Application };

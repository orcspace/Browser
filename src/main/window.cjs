const { BrowserWindow } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const chromeURL = pathToFileURL(path.join(__dirname, "../ui/index.html")).href;
const transparency = new WeakMap();

function createShell(config) {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 760,
    minHeight: 520,
    title: "Browser",
    show: false,
    backgroundColor: config.appearance.window.transparent
      ? "#00000000"
      : config.appearance.background,
    transparent: config.appearance.window.transparent,
    icon: path.join(__dirname, "../../assets/icon.png"),
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      navigateOnDragDrop: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  transparency.set(window, config.appearance.window.transparent);
  applyWindowAppearance(window, config);
  return window;
}
function applyWindowAppearance(window, config) {
  const a = config.appearance;
  window.setOpacity(a.window.opacity);
  if (process.platform === "darwin")
    window.setVibrancy(a.material === "glass" ? "under-window" : null);
  if (process.platform === "win32")
    window.setBackgroundMaterial(a.material === "glass" ? "acrylic" : "none");
  // Transparency is fixed at window creation; do not fake a live native change.
  window.setBackgroundColor(
    transparency.get(window) ? "#00000000" : a.background,
  );
}
module.exports = { createShell, applyWindowAppearance, chromeURL };

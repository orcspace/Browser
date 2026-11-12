const { app } = require("electron");
const path = require("node:path");
const { ConfigStore } = require("./config-store.cjs");
const { Application } = require("./application.cjs");

app.setName("Browser");
app.enableSandbox();
if (process.env.BROWSER_PROFILE)
  app.setPath("userData", path.resolve(process.env.BROWSER_PROFILE));
// Prevent two processes from writing the same profile concurrently.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  const store = new ConfigStore(app.getPath("userData"));
  if (store.value.privacy.blockThirdPartyCookies)
    app.commandLine.appendSwitch("test-third-party-cookie-phaseout");
  const application = new Application(store);
  app
    .whenReady()
    .then(() => application.start())
    .catch((error) => {
      console.error(error);
      app.quit();
    });
  app.on("second-instance", () => {
    if (application.window) {
      if (application.window.isMinimized()) application.window.restore();
      application.window.focus();
    } else application.openWindow().catch(console.error);
  });
  app.on("before-quit", () => {
    application.quitting = true;
  });
  app.on("will-quit", () => application.dispose());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!application.window && application.session)
      application.openWindow().catch(console.error);
  });
}

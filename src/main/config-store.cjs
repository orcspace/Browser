const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  defaults,
  readConfig,
  validateConfig,
  writeJSON,
} = require("../core/config.cjs");

class ConfigStore extends EventEmitter {
  constructor(root) {
    super();
    this.file = path.join(root, "config.json");
    this.tabsFile = path.join(root, "tabs.json");
    this.error = "";
    try {
      this.value = readConfig(this.file);
    } catch (error) {
      this.value = structuredClone(defaults);
      this.error = error.message;
    }
    this.startup = structuredClone(this.value);
  }
  get restartRequired() {
    return (
      this.value.privacy.blockThirdPartyCookies !==
        this.startup.privacy.blockThirdPartyCookies ||
      this.value.appearance.window.transparent !==
        this.startup.appearance.window.transparent
    );
  }
  save(patch) {
    const value = validateConfig(patch);
    writeJSON(this.file, value);
    this.set(value);
  }
  set(value) {
    const changed =
      JSON.stringify(value) !== JSON.stringify(this.value) || this.error;
    this.value = value;
    this.error = "";
    if (changed) this.emit("change");
  }
  watch() {
    // Watch the directory so atomic editor replacements keep working. A native
    // filesystem notification avoids waking the process every second when idle.
    this.watcher = fs.watch(path.dirname(this.file), (_event, name) => {
      if (name && String(name) !== path.basename(this.file)) return;
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        try {
          this.set(readConfig(this.file));
        } catch (error) {
          if (this.error !== error.message) {
            this.error = error.message;
            this.emit("error-message", error.message);
          }
        }
      }, 50);
    });
    this.watcher.on("error", (error) => {
      this.error = error.message;
      this.emit("error-message", error.message);
    });
  }
  reset() {
    if (fs.existsSync(this.file))
      fs.copyFileSync(this.file, `${this.file}.${Date.now()}.bak`);
    this.save(defaults);
  }
  readTabs() {
    try {
      if (fs.statSync(this.tabsFile).size > 1024 * 1024) return {};
      const saved = JSON.parse(fs.readFileSync(this.tabsFile, "utf8"));
      return Array.isArray(saved.tabs) ? saved : {};
    } catch {
      return {};
    }
  }
  saveTabs(value) {
    writeJSON(this.tabsFile, value);
  }
  dispose() {
    this.watcher?.close();
    clearTimeout(this.reloadTimer);
    this.removeAllListeners();
  }
}
module.exports = { ConfigStore };

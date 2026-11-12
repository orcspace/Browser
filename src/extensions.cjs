const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');

class Extensions {
  constructor(session, window, config, save, notify) {
    Object.assign(this, { session, window, config, save, notify });
    this.errors = new Map();
    this.loaded = new Map();
  }
  list() {
    return this.config().extensions.paths.map(directory => {
      const extension = this.loaded.get(directory);
      return { path: directory, id: extension?.id, name: extension?.name || path.basename(directory), version: extension?.version || '', error: this.errors.get(directory) || '' };
    });
  }
  async sync() {
    const directories = this.config().extensions.paths;
    for (const [directory, extension] of this.loaded) {
      if (!directories.includes(directory)) { this.session.extensions.removeExtension(extension.id); this.loaded.delete(directory); this.errors.delete(directory); }
    }
    for (const directory of directories) {
      if (this.loaded.has(directory)) continue;
      try {
        const manifestPath = path.join(directory, 'manifest.json');
        if (fs.statSync(manifestPath).size > 1024 * 1024) throw new Error('Manifest too large.');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (![2, 3].includes(manifest.manifest_version)) throw new Error('Expected a Manifest V2 or V3 extension.');
        const extension = await this.session.extensions.loadExtension(directory, { allowFileAccess: false });
        this.loaded.set(directory, extension); this.errors.delete(directory);
      } catch (error) { this.errors.set(directory, error.message); }
    }
    this.notify();
  }
  async install() {
    const result = await dialog.showOpenDialog(this.window(), { title: 'Load unpacked extension', properties: ['openDirectory'] });
    if (result.canceled) return;
    const directory = fs.realpathSync(result.filePaths[0]);
    const file = path.join(directory, 'manifest.json');
    if (!fs.existsSync(file)) throw new Error('Select a folder containing manifest.json. Extract ZIP files first.');
    if (fs.statSync(file).size > 1024 * 1024) throw new Error('Manifest too large.');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const permissions = [...(manifest.permissions || []), ...(manifest.host_permissions || [])];
    const answer = await dialog.showMessageBox(this.window(), {
      type: 'warning', title: 'Load extension', message: `Load ${manifest.name || path.basename(directory)}?`,
      detail: `Extensions can access websites according to their manifest. Only load code you trust.\n\nRequested permissions:\n${permissions.join(', ') || 'None declared'}\n\nKeep this folder in place. Electron supports a subset of Chrome extension APIs.`,
      buttons: ['Cancel', 'Load extension'], defaultId: 0, cancelId: 0
    });
    if (answer.response !== 1) return;
    const next = structuredClone(this.config());
    if (!next.extensions.paths.includes(directory)) next.extensions.paths.push(directory);
    this.save(next); await this.sync();
  }
  remove(id) {
    const next = structuredClone(this.config());
    next.extensions.paths = next.extensions.paths.filter(directory => this.loaded.get(directory)?.id !== id && directory !== id);
    this.save(next); return this.sync();
  }
}
module.exports = { Extensions };

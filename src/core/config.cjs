const fs = require('node:fs');
const path = require('node:path');
const defaults = require('../../config/default.json');
const { safeWebURL } = require('./navigation.cjs');
const copy = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function merge(base, patch, at = 'config') {
  if (!object(patch)) throw new Error(`${at} must be an object.`);
  const result = copy(base);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key)) throw new Error(`Unknown setting: ${at}.${key}`);
    result[key] = object(base[key]) ? merge(base[key], value, `${at}.${key}`) : copy(value);
  }
  return result;
}
function validateConfig(patch) {
  const config = merge(defaults, patch);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const number = (obj, key, min, max) => assert(Number.isInteger(obj[key]) && obj[key] >= min && obj[key] <= max, `${key} must be an integer from ${min} to ${max}.`);
  assert(config.version === 1, 'Unsupported config version.');
  const a = config.appearance;
  for (const key of ['background', 'surface', 'text', 'muted', 'accent']) assert(/^#[\da-f]{6}$/i.test(a[key]), `${key} must be a six-digit hex color.`);
  assert(typeof a.fontFamily === 'string' && a.fontFamily.length > 0 && a.fontFamily.length <= 200, 'Invalid fontFamily.');
  for (const [key, min, max] of [['fontSize', 11, 22], ['sidebarWidth', 180, 420], ['sidebarCollapsedWidth', 52, 84], ['toolbarHeight', 44, 80], ['tabHeight', 30, 60], ['cornerRadius', 0, 24]]) number(a, key, min, max);
  for (const key of ['sidebarCollapsed', 'showBookmarks', 'showSearchHints', 'reduceMotion']) assert(typeof a[key] === 'boolean', `${key} must be true or false.`);
  assert(Array.isArray(config.search.engines) && config.search.engines.length > 0 && config.search.engines.length <= 40, 'Provide 1–40 search engines.');
  const ids = new Set(), keywords = new Set();
  for (const engine of config.search.engines) {
    assert(object(engine) && Object.keys(engine).every(k => ['id', 'name', 'keyword', 'url'].includes(k)), 'Invalid search engine.');
    assert(typeof engine.id === 'string' && /^[a-z\d_-]{1,30}$/i.test(engine.id) && !ids.has(engine.id), 'Search engine IDs must be unique.');
    assert(typeof engine.keyword === 'string' && /^[a-z\d!_-]{1,12}$/i.test(engine.keyword) && !keywords.has(engine.keyword.toLowerCase()), 'Search keywords must be unique.');
    assert(typeof engine.name === 'string' && engine.name.length > 0 && engine.name.length <= 60, 'Invalid engine name.');
    assert(typeof engine.url === 'string' && engine.url.length < 2048 && engine.url.split('{query}').length === 2 && safeWebURL(engine.url) && engine.url.startsWith('https://'), 'Search templates need an HTTPS URL and exactly one {query}.');
    assert(!new URL(engine.url).hostname.includes('{query}'), 'Put {query} in the path or query, not the hostname.');
    ids.add(engine.id); keywords.add(engine.keyword.toLowerCase());
  }
  assert(ids.has(config.search.default), 'Default search engine must exist.');
  assert(['pinned', 'all', 'none'].includes(config.tabs.restore), 'tabs.restore must be pinned, all or none.');
  number(config.tabs, 'sleepAfterMinutes', 0, 1440); number(config.tabs, 'maxOpen', 1, 500);
  assert(typeof config.tabs.confirmCloseWindow === 'boolean', 'confirmCloseWindow must be true or false.');
  for (const key of ['doNotTrack', 'globalPrivacyControl', 'blockThirdPartyCookies', 'blockTrackers']) assert(typeof config.privacy[key] === 'boolean', `${key} must be true or false.`);
  assert(Array.isArray(config.privacy.blockedHosts) && config.privacy.blockedHosts.length <= 10000 && config.privacy.blockedHosts.every(host => typeof host === 'string' && /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(host)), 'blockedHosts must contain domain names.');
  config.privacy.blockedHosts = config.privacy.blockedHosts.map(host => host.toLowerCase());
  for (const value of Object.values(config.privacy.permissions)) assert(['ask', 'block'].includes(value), 'Permissions must be ask or block.');
  assert(Array.isArray(config.extensions.paths) && config.extensions.paths.length <= 100 && config.extensions.paths.every(p => typeof p === 'string' && path.isAbsolute(p)), 'Extension paths must be absolute directory paths.');
  assert(Array.isArray(config.bookmarks) && config.bookmarks.length <= 100, 'Provide at most 100 bookmarks.');
  for (const item of config.bookmarks) assert(object(item) && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 80 && safeWebURL(item.url), 'Bookmarks need a title and HTTP(S) URL.');
  const bindings = new Set();
  for (const value of Object.values(config.shortcuts)) {
    assert(typeof value === 'string' && /^(?:(?:CommandOrControl|Control|Command|Alt|Shift)\+)+(?:[a-z\d,=\-]|Tab|Space|Backspace|F\d{1,2})$/i.test(value), `Invalid shortcut: ${value}`);
    assert(!bindings.has(value.toLowerCase()), `Duplicate shortcut: ${value}`); bindings.add(value.toLowerCase());
  }
  return config;
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function readConfig(file) {
  if (!fs.existsSync(file)) writeJSON(file, defaults);
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('Config exceeds 1 MB.');
  return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}
module.exports = { defaults, validateConfig, readConfig, writeJSON };

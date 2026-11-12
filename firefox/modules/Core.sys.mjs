const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
export function merge(base, patch, at = 'config') {
  if (!object(patch)) fail(`${at} must be an object.`);
  const result = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key)) fail(`Unknown setting: ${at}.${key}`);
    result[key] = object(base[key]) && !['cssVariables', 'preferences'].includes(key) ? merge(base[key], value, `${at}.${key}`) : clone(value);
  }
  return result;
}
export function validateConfig(defaults, patch) {
  const c = merge(defaults, patch);
  if (c.version !== 3) fail('Unsupported config version.');
  const a = c.appearance;
  for (const k of ['background', 'surface', 'text', 'muted', 'accent']) if (typeof a[k] !== 'string' || !/^#[\da-f]{6}$/i.test(a[k])) fail(`Invalid ${k} color.`);
  for (const [k, min, max] of [['fontSize',11,24],['sidebarWidth',180,500],['tabHeight',28,70],['cornerRadius',0,30]]) if (!Number.isInteger(a[k]) || a[k] < min || a[k] > max) fail(`Invalid ${k}.`);
  for (const [k, min, max] of [['backgroundOpacity',0,1],['surfaceOpacity',0,1],['blur',0,100],['windowOpacity',0.1,1]]) if (typeof a[k] !== 'number' || !Number.isFinite(a[k]) || a[k] < min || a[k] > max) fail(`Invalid ${k}.`);
  if (!['solid','glass'].includes(a.material) || typeof a.reduceMotion !== 'boolean') fail('Invalid appearance settings.');
  if (typeof a.fontFamily !== 'string' || !a.fontFamily || a.fontFamily.length > 200) fail('Invalid font family.');
  if (typeof a.customCSS !== 'string' || a.customCSS.length > 100000) fail('customCSS must be CSS text under 100 KB.');
  if (!object(a.cssVariables) || Object.entries(a.cssVariables).some(([k,v]) => !/^--[a-z][a-z\d-]*$/i.test(k) || typeof v !== 'string' || v.length > 2000)) fail('Invalid CSS variables.');
  if (!Array.isArray(c.search.engines) || !c.search.engines.length || c.search.engines.length > 40) fail('Provide 1–40 search engines.');
  const ids = new Set(), keys = new Set(), names = new Set();
  for (const e of c.search.engines) {
    if (!object(e) || Object.keys(e).some(k => !['id','name','keyword','url'].includes(k))) fail('Invalid search engine.');
    if (typeof e.id !== 'string' || !/^[a-z\d_-]{1,30}$/i.test(e.id) || ids.has(e.id)) fail('Search IDs must be unique.');
    if (typeof e.name !== 'string' || !e.name || e.name.length > 60 || names.has(e.name)) fail('Search names must be unique.');
    if (typeof e.keyword !== 'string' || !/^[a-z\d!_-]{1,12}$/i.test(e.keyword) || keys.has(e.keyword.toLowerCase())) fail('Search keywords must be unique.');
    if (typeof e.url !== 'string' || e.url.length > 2048 || e.url.split('{query}').length !== 2 || !e.url.startsWith('https://')) fail('Search URLs need HTTPS and one {query}.');
    let u; try { u = new URL(e.url); } catch { fail('Invalid search URL.'); }
    if (u.username || u.password || u.hostname.includes('{query}')) fail('Invalid search URL credentials or hostname.');
    ids.add(e.id); keys.add(e.keyword.toLowerCase()); names.add(e.name);
  }
  if (!ids.has(c.search.default)) fail('Default search engine must exist.');
  if (!['pinned','all'].includes(c.tabs.restore) || !Number.isInteger(c.tabs.sleepAfterMinutes) || c.tabs.sleepAfterMinutes < 0 || c.tabs.sleepAfterMinutes > 1440) fail('Invalid tab settings.');
  if (!['strict','standard'].includes(c.privacy.trackingProtection)) fail('Invalid tracking protection.');
  for (const [k,v] of Object.entries(c.privacy)) if (k !== 'trackingProtection' && typeof v !== 'boolean') fail(`Invalid privacy setting: ${k}`);
  if (typeof c.extensions.allowUnsigned !== 'boolean') fail('allowUnsigned must be true or false.');
  if (!object(c.preferences) || Object.entries(c.preferences).some(([k,v]) => !/^[a-z][a-z\d._-]+$/i.test(k) || /^(general\.config\.|security\.|network\.stricttransportsecurity\.|network\.http\.http3\.enable_0rtt|fission\.|remote\.|xpinstall\.|signon\.|datareporting\.|toolkit\.telemetry\.)/.test(k) || !['boolean','string','number'].includes(typeof v) || (typeof v === 'number' && (!Number.isInteger(v) || v < -2147483648 || v > 2147483647)))) fail('Invalid or protected Firefox preference.');
  return c;
}
export function searchURL(text, search) {
  const value = String(text).trim();
  const match = /^(\S+)\s+([\s\S]+)$/.exec(value);
  const engine = match && search.engines.find(e => e.keyword.toLowerCase() === match[1].toLowerCase());
  const chosen = engine || search.engines.find(e => e.id === search.default);
  return chosen.url.replace('{query}', encodeURIComponent(engine ? match[2].trim() : value));
}

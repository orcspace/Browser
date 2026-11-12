const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaults, validateConfig, readConfig, writeJSON } = require('../src/core/config.cjs');
const { resolveInput, safeWebURL, isBlockedHost } = require('../src/core/navigation.cjs');
const { matches } = require('../src/core/shortcuts.cjs');
const { thirdPartyRequest, stripHeader } = require('../src/core/privacy.cjs');

test('search prefixes encode arbitrary text and custom providers', () => {
  assert.equal(resolveInput('y майнкрафт & mods', defaults.search).url, 'https://www.youtube.com/results?search_query=%D0%BC%D0%B0%D0%B9%D0%BD%D0%BA%D1%80%D0%B0%D1%84%D1%82%20%26%20mods');
  assert.equal(resolveInput('Y cats', defaults.search).engine, 'YouTube');
  assert.equal(resolveInput('ordinary query', defaults.search).url, 'https://duckduckgo.com/?q=ordinary%20query');
  const config = validateConfig({ search: { default: 'custom', engines: [{ id: 'custom', name: 'Custom', keyword: 'c', url: 'https://example.org/search/{query}' }] } });
  assert.equal(resolveInput('c a/b?', config.search).url, 'https://example.org/search/a%2Fb%3F');
});
test('navigation accepts websites and local development, rejects privileged schemes', () => {
  for (const input of ['https://example.com/a', 'example.com/a', 'example.com:8443/a', 'localhost:3000', 'http://127.0.0.1:8080']) assert.equal(resolveInput(input, defaults.search).kind, 'url');
  for (const input of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'chrome://settings', 'https://user:pass@example.com']) assert.throws(() => resolveInput(input, defaults.search));
  assert.equal(safeWebURL('https://user:pass@example.com'), null);
  assert.equal(resolveInput('', defaults.search).kind, 'newtab');
});
test('configuration rejects invalid values, unknown keys and unsafe templates', () => {
  for (const patch of [{ appearance: { sidebarWidth: -1 } }, { appearance: { background: 'red' } }, { tabs: { restore: 'everything' } }, { privacy: { permissions: { camera: 'allow' } } }, { extensions: { paths: ['relative/path'] } }, { typo: true }, { search: { default: 'missing' } }, { bookmarks: [{ title: 'bad', url: 'file:///secret' }] }]) assert.throws(() => validateConfig(patch));
  const engines = [{ id: 'a', name: 'A', keyword: 'y', url: 'javascript:{query}' }];
  assert.throws(() => validateConfig({ search: { default: 'a', engines } }));
  assert.throws(() => validateConfig({ search: { engines: [...defaults.search.engines, defaults.search.engines[0]] } }));
  assert.equal(validateConfig({ appearance: { sidebarWidth: 300 } }).appearance.sidebarWidth, 300);
  assert.equal(defaults.appearance.sidebarWidth, 236);
});
test('atomic config round trip and malformed external edits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-config-'));
  try {
    const file = path.join(dir, 'config.json');
    assert.deepEqual(readConfig(file), defaults);
    writeJSON(file, { appearance: { accent: '#ffddaa' } });
    assert.equal(readConfig(file).appearance.accent, '#ffddaa');
    fs.writeFileSync(file, '{bad json');
    assert.throws(() => readConfig(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('tracker domain matching avoids lookalike suffixes', () => {
  assert.ok(isBlockedHost('a.doubleclick.net', ['doubleclick.net']));
  assert.ok(!isBlockedHost('notdoubleclick.net', ['doubleclick.net']));
  assert.ok(!isBlockedHost('doubleclick.net.example.com', ['doubleclick.net']));
});
test('cookie policy uses registrable sites, scheme and private suffixes', () => {
  const request = (url, top, type = 'image') => ({ url, frame: { top: { url: top } }, resourceType: type });
  assert.ok(!thirdPartyRequest(request('https://cdn.example.co.uk/a', 'https://www.example.co.uk')));
  assert.ok(thirdPartyRequest(request('https://one.github.io/a', 'https://two.github.io')));
  assert.ok(thirdPartyRequest(request('http://example.org/a', 'https://example.org')));
  assert.ok(!thirdPartyRequest(request('https://example.net', 'https://example.org', 'mainFrame')));
  assert.deepEqual(stripHeader({ Cookie: 'private', DNT: '1' }, 'cookie'), { DNT: '1' });
  assert.deepEqual(stripHeader({ 'Set-Cookie': ['secret'], Other: ['ok'] }, 'set-cookie'), { Other: ['ok'] });
});
test('shortcuts respect platform and exact modifier combinations', () => {
  const input = { type: 'keyDown', key: 't', control: true };
  assert.ok(matches('CommandOrControl+T', input, 'win32'));
  assert.ok(!matches('CommandOrControl+T', { ...input, shift: true }, 'win32'));
  assert.ok(!matches('CommandOrControl+T', input, 'darwin'));
  assert.ok(matches('CommandOrControl+T', { type: 'keyDown', key: 't', meta: true }, 'darwin'));
});

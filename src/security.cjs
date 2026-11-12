const { dialog } = require('electron');
const { isBlockedHost } = require('./core/navigation.cjs');
const { thirdPartyRequest, stripHeader } = require('./core/privacy.cjs');

function configureSession(session, getConfig, getWindow, onBlocked) {
  session.setSpellCheckerEnabled(false);
  // Deny unapproved permission checks; approved requests are scoped to one call.
  session.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  session.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const complete = allowed => { try { callback(allowed); } catch {} };
    if (permission === 'fullscreen') return complete(true);
    const rules = getConfig().privacy.permissions;
    const keys = permission === 'media' ? (details.mediaTypes || []).map(t => t === 'video' ? 'camera' : 'microphone') : [permission];
    if (!keys.length || keys.some(key => rules[key] !== 'ask')) return complete(false);
    try {
      // Bind the approval to the requesting document, including cross-origin frames.
      const origin = new URL(details.requestingUrl || contents.getURL()).origin;
      const document = contents.getURL();
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question', title: 'Website permission',
        message: `${origin} wants to use ${keys.join(' and ')}.`,
        detail: 'Allow for this request only.', buttons: ['Block', 'Allow once'], defaultId: 0, cancelId: 0
      });
      complete(answer.response === 1 && !contents.isDestroyed() && contents.getURL() === document);
    } catch { complete(false); }
  });
  session.on('will-download', (_event, item) => {
    // The main process installs the download UI listener separately.
    item.setSaveDialogOptions({ title: 'Save download', buttonLabel: 'Save' });
  });
  session.webRequest.onBeforeRequest((details, callback) => {
    let blocked = false;
    try {
      const config = getConfig().privacy;
      blocked = config.blockTrackers && details.resourceType !== 'mainFrame' && isBlockedHost(new URL(details.url).hostname, config.blockedHosts);
    } catch {}
    if (blocked) onBlocked(details.webContentsId);
    callback({ cancel: blocked });
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    let headers = { ...details.requestHeaders };
    const privacy = getConfig().privacy;
    if (privacy.blockThirdPartyCookies && thirdPartyRequest(details)) headers = stripHeader(headers, 'cookie');
    if (privacy.doNotTrack) headers.DNT = '1';
    if (privacy.globalPrivacyControl) headers['Sec-GPC'] = '1';
    callback({ requestHeaders: headers });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = getConfig().privacy.blockThirdPartyCookies && thirdPartyRequest(details) ? stripHeader(details.responseHeaders, 'set-cookie') : details.responseHeaders;
    callback({ responseHeaders: headers });
  });
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  session.on('select-usb-device', event => event.preventDefault());
  session.on('select-hid-device', event => event.preventDefault());
  session.on('select-serial-port', event => event.preventDefault());
}
module.exports = { configureSession };

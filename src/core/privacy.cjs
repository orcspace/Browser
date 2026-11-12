const { getDomain } = require("tldts");

function site(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return `${parsed.protocol}//${getDomain(parsed.hostname, { allowPrivateDomains: true }) || parsed.hostname}`;
  } catch {
    return null;
  }
}
function thirdPartyRequest(details) {
  if (details.resourceType === "mainFrame") return false;
  // Compare schemeful registrable sites, including private suffixes (github.io).
  let top;
  try {
    top = details.frame?.top?.url || details.webContents?.getURL();
  } catch {
    /* Frames can disappear while an in-flight request is observed. */
  }
  top = top || details.initiatorOrigin || details.referrer;
  const target = site(details.url),
    origin = site(top);
  return !!target && (!origin || target !== origin);
}
function stripHeader(headers, name) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== name),
  );
}
module.exports = { site, thirdPartyRequest, stripHeader };

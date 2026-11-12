const { domainToASCII } = require("node:url");
const blocklists = new WeakMap();

function safeWebURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function resolveInput(input, search) {
  const value = String(input).trim();
  if (!value || value === "browser://newtab")
    return { url: null, kind: "newtab" };
  const match = /^(\S+)\s+([\s\S]+)$/.exec(value);
  const engine =
    match &&
    search.engines.find(
      (e) => e.keyword.toLowerCase() === match[1].toLowerCase(),
    );
  if (engine)
    return {
      url: engine.url.replace("{query}", encodeURIComponent(match[2].trim())),
      kind: "search",
      engine: engine.name,
    };
  const direct = safeWebURL(value);
  if (direct) return { url: direct, kind: "url" };
  // Explicit schemes are never handed to a search provider.
  if (
    /^[a-z][a-z\d+.-]*:/i.test(value) &&
    !/^(localhost|[^\s/:]+\.\w+|\[[\da-f:]+\]):\d+(\/|$)/i.test(value)
  ) {
    throw new Error("Only http:// and https:// addresses are supported.");
  }
  if (!/\s/.test(value)) {
    const host = value.split("/")[0];
    const hostname = host.replace(/:\d+$/, "");
    if (
      hostname === "localhost" ||
      hostname.startsWith("[") ||
      (hostname.includes(".") && domainToASCII(hostname))
    ) {
      const url = safeWebURL(
        `${hostname === "localhost" || /^127\./.test(hostname) || hostname.startsWith("[") ? "http" : "https"}://${value}`,
      );
      if (url) return { url, kind: "url" };
    }
  }
  const fallback = search.engines.find((e) => e.id === search.default);
  return {
    url: fallback.url.replace("{query}", encodeURIComponent(value)),
    kind: "search",
    engine: fallback.name,
  };
}

function isBlockedHost(host, blockedHosts) {
  host = host.toLowerCase().replace(/\.$/, "");
  let domains = blocklists.get(blockedHosts);
  if (!domains) {
    domains = new Set(blockedHosts);
    blocklists.set(blockedHosts, domains);
  }
  for (
    let suffix = host;
    suffix.includes(".");
    suffix = suffix.slice(suffix.indexOf(".") + 1)
  ) {
    if (domains.has(suffix)) return true;
  }
  return false;
}
module.exports = { resolveInput, safeWebURL, isBlockedHost };

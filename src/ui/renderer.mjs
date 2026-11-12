/* The local browser chrome. Remote pages never receive this API. */
import { $, icon, escapeHTML, shortcutLabel } from "./helpers.mjs";
import { applyTheme } from "./theme.mjs";
import { createPanels } from "./panels.mjs";
let state;
let previousActive;
const tabNodes = new Map();
let previousHints;
const updatePanels = createPanels(send, toast);
let toastTimer;
const short = (binding) => shortcutLabel(binding, state?.platform);

async function send(name, data) {
  const result = await window.browser.action(name, data);
  if (!result.ok) toast(result.error);
  return result;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 6000);
}
function tabMarkup(tab) {
  return `<div class="tab" data-tab="${tab.id}" role="button" tabindex="0" draggable="true"><span class="tab-icon"></span><span class="tab-name"></span><button class="icon-button close-tab" data-close="${tab.id}">${icon("close")}</button></div>`;
}
function renderTabs() {
  const live = new Set(state.tabs.map((tab) => tab.id));
  for (const [id, entry] of tabNodes)
    if (!live.has(id)) {
      entry.node.remove();
      tabNodes.delete(id);
    }
  let pinnedIndex = 0,
    regularIndex = 0;
  for (const tab of state.tabs) {
    let entry = tabNodes.get(tab.id);
    if (!entry) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = tabMarkup(tab);
      entry = { node: wrapper.firstElementChild };
      tabNodes.set(tab.id, entry);
    }
    const signature = JSON.stringify([
      tab.title,
      tab.url,
      tab.pinned,
      tab.playing,
      tab.sleeping,
      tab.loading,
      tab.id === state.activeId,
    ]);
    const node = entry.node;
    if (signature !== entry.signature) {
      node.className = `tab ${tab.id === state.activeId ? "active" : ""} ${tab.pinned ? "pinned" : ""} ${tab.sleeping ? "sleeping" : ""} ${tab.loading ? "loading" : ""}`;
      node.setAttribute(
        "aria-label",
        `${tab.title}${tab.pinned ? ", pinned" : ""}`,
      );
      node.title = `${tab.title}${tab.sleeping ? " · Sleeping" : ""}\n${tab.url || ""}`;
      const glyph = tab.playing
        ? icon("volume")
        : tab.sleeping
          ? icon("moon")
          : escapeHTML(
              tab.url
                ? new URL(tab.url).hostname
                    .replace(/^www\./, "")[0]
                    .toUpperCase()
                : "○",
            );
      if (entry.glyph !== glyph)
        node.querySelector(".tab-icon").innerHTML = glyph;
      node.querySelector(".tab-name").textContent = tab.title;
      node
        .querySelector(".close-tab")
        .setAttribute("aria-label", `Close ${tab.title}`);
      entry.signature = signature;
      entry.glyph = glyph;
    }
    const parent = $(tab.pinned ? "#pinned-tabs" : "#regular-tabs");
    const index = tab.pinned ? pinnedIndex++ : regularIndex++;
    if (parent.children[index] !== node)
      parent.insertBefore(node, parent.children[index] || null);
  }
}
function update(next) {
  state = next;
  const config = state.config;
  const appearance = config.appearance;
  const themeChanged = applyTheme(appearance, state.platform);
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  renderTabs();
  $("#pinned-label").hidden = !state.tabs.some((tab) => tab.pinned);
  $("#tab-count").textContent = state.tabs.length;
  $("#new-shortcut").textContent = short(config.shortcuts.newTab);
  $("#protection").innerHTML =
    `${icon("shield")}<span>${config.privacy.blockTrackers ? `Protection on${active?.blocked ? ` · ${active.blocked} blocked` : ""}` : "Protection paused"}</span>`;
  if (document.activeElement !== $("#address"))
    $("#address").value = active?.url || "";
  $("#address-icon").innerHTML = icon(active?.secure ? "lock" : "search");
  $("#back").disabled = !active?.canGoBack;
  $("#forward").disabled = !active?.canGoForward;
  $("#reload").innerHTML = icon(active?.loading ? "close" : "reload");
  $("#reload").dataset.action = active?.loading ? "stop" : "reload";
  $("#newtab").hidden = !!active?.url || !!state.panel;
  $("#error-page").hidden = !active?.error || !!state.panel;
  $("#page-error").textContent = active?.error || "";
  $("#panel").hidden = !state.panel;
  $("#search-hints").hidden = !appearance.showSearchHints;
  const hintsSignature = JSON.stringify(config.search.engines);
  if (hintsSignature !== previousHints)
    $("#search-hints").innerHTML = config.search.engines
      .slice(0, 5)
      .map(
        (engine) =>
          `<button class="engine-chip" data-keyword="${escapeHTML(engine.keyword)}"><kbd>${escapeHTML(engine.keyword)}</kbd>${escapeHTML(engine.name)}</button>`,
      )
      .join("");
  $("#default-engine").textContent = config.search.engines.find(
    (engine) => engine.id === config.search.default,
  )?.name;
  $("#keyboard-hint").textContent =
    `${short(config.shortcuts.focusAddress)} to search · ${short(config.shortcuts.newTab)} for a new tab`;
  previousHints = hintsSignature;
  updatePanels(state);
  if (
    previousActive !== state.activeId &&
    !active?.url &&
    !state.panel &&
    document.activeElement !== $("#address") &&
    document.activeElement?.tagName !== "TEXTAREA"
  )
    $("#search").focus();
  previousActive = state.activeId;
  if (themeChanged) requestAnimationFrame(syncViewport);
  if (state.focusAddress) {
    $("#address").focus();
    $("#address").select();
  }
  if (state.message) toast(state.message);
  if (state.configError && !state.panel)
    toast(`Config error: ${state.configError}. Using the last valid settings.`);
  updateEngine();
}
function updateEngine() {
  if (!state) return;
  const keyword = $("#address").value.trim().split(/\s/)[0].toLowerCase();
  const engine = state.config.search.engines.find(
    (item) => item.keyword.toLowerCase() === keyword,
  );
  $("#engine-indicator").textContent = engine ? engine.name : "";
}
document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close]");
  if (close) {
    send("closeTab", close.dataset.close);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action) {
    send(action.dataset.action).then((result) => {
      if (result.reset) updatePanels.clearDraft();
    });
    return;
  }
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    send("activate", tab.dataset.tab);
    return;
  }
  const chip = event.target.closest("[data-keyword]");
  if (chip) {
    $("#search").value = `${chip.dataset.keyword} `;
    $("#search").focus();
    return;
  }
  const remove = event.target.closest("[data-remove]");
  if (remove) send("removeExtension", remove.dataset.remove);
  const popup = event.target.closest("[data-popup]");
  if (popup) send("extensionPopup", popup.dataset.popup);
  const download = event.target.closest("[data-download]");
  if (download) send("revealDownload", download.dataset.download);
});
document.addEventListener("contextmenu", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    event.preventDefault();
    send("tabMenu", tab.dataset.tab);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.panel) send("closePanel");
    else {
      $("#address").value =
        state.tabs.find((tab) => tab.id === state.activeId)?.url || "";
      $("#address").blur();
      send("focusPage");
    }
  }
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.matches("[data-tab]")
  ) {
    event.preventDefault();
    send("activate", event.target.dataset.tab);
  }
});
let dragged;
document.addEventListener("dragstart", (event) => {
  dragged = event.target.closest("[data-tab]")?.dataset.tab;
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest("[data-tab]")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (dragged && tab) {
    event.preventDefault();
    send("reorder", { source: dragged, target: tab.dataset.tab });
  }
  dragged = null;
});
$("#address-form").addEventListener("submit", (event) => {
  event.preventDefault();
  send("navigate", $("#address").value);
  $("#address").blur();
});
$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  send("navigate", $("#search").value);
  $("#search").value = "";
});
$("#address").addEventListener("focus", () => $("#address").select());
$("#address").addEventListener("input", updateEngine);
for (const [selector, name] of Object.entries({
  ".collapse": "sidebar",
  "#new-icon": "plus",
  "#back": "back",
  "#forward": "forward",
  "#reload": "reload",
  "#search-icon": "search",
  "#search-submit": "forward",
}))
  $(selector).innerHTML = icon(name);
for (const name of [
  "downloads",
  "extensions",
  "settings",
  "minimize",
  "maximize",
  "closeWindow",
])
  $(`[data-action="${name}"]`).innerHTML = icon(
    {
      downloads: "download",
      extensions: "extension",
      settings: "settings",
      minimize: "min",
      maximize: "max",
      closeWindow: "close",
    }[name],
  );
let lastViewport;
function syncViewport() {
  const viewport = $("#viewport"),
    rect = viewport.getBoundingClientRect();
  const bounds = {
    x: Math.round(rect.x + viewport.clientLeft),
    y: Math.round(rect.y + viewport.clientTop),
    width: viewport.clientWidth,
    height: viewport.clientHeight,
  };
  const signature = JSON.stringify(bounds);
  if (signature !== lastViewport) {
    lastViewport = signature;
    send("viewport", bounds);
  }
}
new ResizeObserver(syncViewport).observe($("#viewport"));
window.addEventListener("resize", syncViewport);
window.browser.subscribe(update);
window.browser.state().then(update);

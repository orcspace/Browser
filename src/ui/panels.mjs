import { $, icon, escapeHTML } from "./helpers.mjs";

function header(title, description) {
  return `<div class="panel-top"><h2>${title}</h2><button class="icon-button" data-action="closePanel" aria-label="Close panel">${icon("close")}</button></div><p class="panel-description">${description}</p>`;
}
export function createPanels(send, toast) {
  let rendered,
    signature,
    draft = null,
    dirty = false,
    current;
  const update = (state) => {
    current = state;
    const kind = state.panel;
    if (!kind) {
      rendered = null;
      signature = null;
      return;
    }
    if (kind === "settings") {
      if (rendered !== kind) {
        $("#panel").innerHTML =
          header(
            "Make it yours.",
            "Edit every part of the interface: colors, layout, spacing and your own CSS. Save here or edit the config in your favorite editor.",
          ) +
          `<div class="config-location">${escapeHTML(state.configPath)}</div><div class="panel-actions"><button class="secondary" data-preset="solid">Solid midnight</button><button class="secondary" data-preset="glass">Matte glass</button></div><div class="warning" id="config-warning"></div><textarea id="config-editor" aria-label="Browser configuration" spellcheck="false"></textarea><div class="panel-actions"><button class="primary" id="save-config">Save changes</button><button class="secondary" data-action="openConfig">Open config file</button><button class="secondary" data-action="resetConfig">Reset settings</button><button class="secondary" data-action="clearData">Clear browsing data</button><button class="secondary" id="restart" data-action="restart" hidden>Restart Browser</button></div><p class="panel-description">Use <code>appearance.customCSS</code> to override any interface rule and <code>appearance.cssVariables</code> for design tokens. Native glass uses macOS vibrancy or Windows 11 acrylic. Changing native window transparency needs a restart. Web pages keep their own backgrounds.</p>`;
        const editor = $("#config-editor");
        editor.value =
          dirty && draft !== null
            ? draft
            : JSON.stringify(state.config, null, 2);
        editor.addEventListener("input", () => {
          draft = editor.value;
          dirty = true;
        });
        editor.addEventListener("keydown", (event) => {
          if (event.key === "Tab") {
            event.preventDefault();
            editor.setRangeText(
              "  ",
              editor.selectionStart,
              editor.selectionEnd,
              "end",
            );
            draft = editor.value;
            dirty = true;
          }
        });
        const save = async () => {
          const submitted = editor.value;
          const result = await send("saveConfig", submitted);
          if (result.ok) {
            if (draft === submitted || !dirty) {
              draft = null;
              dirty = false;
            }
            toast("Configuration saved.");
          }
        };
        $("#save-config").onclick = save;
        for (const button of document.querySelectorAll("[data-preset]"))
          button.onclick = async () => {
            try {
              const config = JSON.parse(editor.value);
              config.appearance = {
                ...current.config.appearance,
                ...config.appearance,
              };
              config.appearance.material = button.dataset.preset;
              config.appearance.window = {
                ...config.appearance.window,
                transparent: button.dataset.preset === "glass",
              };
              editor.value = JSON.stringify(config, null, 2);
              draft = editor.value;
              dirty = true;
              await save();
            } catch (error) {
              toast(error.message);
            }
          };
      }
      if (!dirty && document.activeElement !== $("#config-editor"))
        $("#config-editor").value = JSON.stringify(state.config, null, 2);
      $("#config-warning").textContent = [
        state.configError && `Config error: ${state.configError}`,
        state.restartRequired &&
          "Restart Browser to apply native window transparency or cookie policy.",
      ]
        .filter(Boolean)
        .join(" ");
      $("#restart").hidden = !state.restartRequired;
    } else {
      const data = kind === "extensions" ? state.extensions : state.downloads;
      const nextSignature = JSON.stringify(data);
      if (kind === rendered && signature === nextSignature) return;
      signature = nextSignature;
      if (kind === "extensions") {
        $("#panel").innerHTML =
          header(
            "Your extensions.",
            "Load an unpacked extension folder containing manifest.json. Keep that folder in place. Electron supports a subset of Chrome APIs; some extensions and Chrome Web Store installation are not supported.",
          ) +
          '<div class="panel-actions"><button class="primary" data-action="installExtension">Load unpacked extension</button></div>' +
          (state.extensions.length
            ? state.extensions
                .map(
                  (extension) =>
                    `<div class="row">${icon("extension")}<div class="row-content"><div class="row-title">${escapeHTML(extension.name)} <span class="row-detail">${escapeHTML(extension.version)}</span></div><div class="row-detail">${escapeHTML(extension.path)}</div>${extension.error ? `<div class="warning">${escapeHTML(extension.error)}</div>` : ""}</div>${extension.id ? `<button class="secondary" data-popup="${escapeHTML(extension.id)}">Open</button>` : ""}<button class="secondary" data-remove="${escapeHTML(extension.id || extension.path)}">Remove</button></div>`,
                )
                .join("")
            : '<div class="empty">A clean slate. Add only what you need.</div>');
      } else if (kind === "downloads") {
        $("#panel").innerHTML =
          header(
            "Downloads.",
            "Files downloaded during this session. Choose where each file is saved.",
          ) +
          (state.downloads.length
            ? state.downloads
                .map(
                  (item) =>
                    `<div class="row">${icon("download")}<div class="row-content"><div class="row-title">${escapeHTML(item.name)}</div><div class="row-detail">${escapeHTML(item.state)} · ${(item.received / 1048576).toFixed(1)}${item.total ? ` / ${(item.total / 1048576).toFixed(1)}` : ""} MB</div></div>${item.state === "completed" ? `<button class="secondary" data-download="${item.id}">Show in folder</button>` : ""}</div>`,
                )
                .join("")
            : '<div class="empty">Nothing downloaded yet.</div>');
      }
    }
    rendered = kind;
  };
  update.clearDraft = () => {
    draft = null;
    dirty = false;
  };
  return update;
}

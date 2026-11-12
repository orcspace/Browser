export const $ = (selector) => document.querySelector(selector);
export const icon = (name) =>
  `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export const shortcutLabel = (binding, platform) =>
  binding
    .replace("CommandOrControl", platform === "darwin" ? "⌘" : "Ctrl")
    .replaceAll("Control", "Ctrl")
    .replaceAll("Shift", "⇧")
    .replaceAll("+", " ");

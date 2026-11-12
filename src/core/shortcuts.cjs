const aliases = {
  space: " ",
  plus: "+",
  left: "arrowleft",
  right: "arrowright",
  up: "arrowup",
  down: "arrowdown",
  esc: "escape",
  return: "enter",
};
const namedKeys = new Set([
  "tab",
  "backspace",
  "delete",
  "insert",
  "home",
  "end",
  "pageup",
  "pagedown",
  "enter",
  "escape",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
]);
function parseBinding(binding, platform = process.platform) {
  if (binding === "") return null;
  if (typeof binding !== "string") throw new Error("Shortcut must be text.");
  const parts = binding.toLowerCase().split("+");
  const rawKey = parts.pop();
  const key = aliases[rawKey] || rawKey;
  if (
    !key ||
    !(
      key.length === 1 ||
      namedKeys.has(key) ||
      /^f([1-9]|1\d|2[0-4])$/.test(key)
    )
  )
    throw new Error(`Invalid shortcut key: ${rawKey}`);
  const mods = new Set(parts);
  if (
    mods.size !== parts.length ||
    parts.some(
      (part) =>
        !["commandorcontrol", "control", "command", "alt", "shift"].includes(
          part,
        ),
    )
  )
    throw new Error(`Invalid shortcut modifiers: ${binding}`);
  return {
    key,
    control:
      mods.has("control") ||
      (mods.has("commandorcontrol") && platform !== "darwin"),
    meta:
      mods.has("command") ||
      (mods.has("commandorcontrol") && platform === "darwin"),
    alt: mods.has("alt"),
    shift: mods.has("shift"),
  };
}
function matches(binding, input, platform = process.platform) {
  const parsed = parseBinding(binding, platform);
  return (
    !!parsed &&
    input.type === "keyDown" &&
    input.key.toLowerCase() === parsed.key &&
    ["control", "meta", "alt", "shift"].every(
      (key) => !!input[key] === parsed[key],
    )
  );
}
module.exports = { matches, parseBinding };

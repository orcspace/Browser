function matches(binding, input, platform = process.platform) {
  const parts = binding.toLowerCase().split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  const ctrl = mods.has('control') || (mods.has('commandorcontrol') && platform !== 'darwin');
  const meta = mods.has('command') || (mods.has('commandorcontrol') && platform === 'darwin');
  return input.type === 'keyDown' && input.key.toLowerCase() === (key === 'space' ? ' ' : key) &&
    !!input.control === ctrl && !!input.meta === meta && !!input.alt === mods.has('alt') && !!input.shift === mods.has('shift');
}
module.exports = { matches };

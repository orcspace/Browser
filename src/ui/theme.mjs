let previous;
const customProperties = new Set();

export function applyTheme(appearance, platform) {
  const signature = JSON.stringify(appearance);
  if (signature === previous) return false;
  previous = signature;
  const root = document.documentElement;
  for (const key of customProperties) root.style.removeProperty(key);
  customProperties.clear();
  for (const key of ["background", "surface", "text", "muted", "accent"])
    root.style.setProperty(`--${key}`, appearance[key]);
  const variables = {
    sidebar: `${appearance.sidebarCollapsed ? appearance.sidebarCollapsedWidth : appearance.sidebarWidth}px`,
    toolbar: `${appearance.toolbarHeight}px`,
    "tab-height": `${appearance.tabHeight}px`,
    radius: `${appearance.cornerRadius}px`,
    "font-scale": appearance.fontSize / 13,
    "background-fill": `color-mix(in srgb, var(--background) ${appearance.material === "glass" ? appearance.backgroundOpacity * 100 : 100}%, transparent)`,
    "surface-fill": `color-mix(in srgb, var(--surface) ${appearance.material === "glass" ? appearance.surfaceOpacity * 100 : 100}%, transparent)`,
    blur: appearance.material === "glass" ? `${appearance.blur}px` : "0px",
  };
  for (const [key, value] of Object.entries(variables))
    root.style.setProperty(`--${key}`, value);
  for (const [key, value] of Object.entries(appearance.cssVariables)) {
    root.style.setProperty(key, value);
    customProperties.add(key);
  }
  document.body.style.fontFamily = appearance.fontFamily;
  document.body.style.fontSize = `${appearance.fontSize}px`;
  document.body.classList.toggle("collapsed", appearance.sidebarCollapsed);
  document.body.classList.toggle("mac", platform === "darwin");
  document.body.classList.toggle("reduce-motion", appearance.reduceMotion);
  document.body.classList.toggle("glass", appearance.material === "glass");
  document.body.classList.toggle("transparent", appearance.window.transparent);
  document.querySelector("#custom-style").textContent = appearance.customCSS;
  return true;
}

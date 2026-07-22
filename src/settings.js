/**
 * The app's preferences: what a deployment ships with, and what this device has since chosen.
 *
 * Three layers, in order: the environment sets what a deployment ships with, the user's own change
 * overrides it and persists on the device, and a consumer subscribes to the result rather than
 * reading the checkbox. Nothing here touches the things a setting controls; the feature that owns
 * the legend or the charts subscribes and does that itself.
 *
 * Adding an on/off one is three lines and a translation: a row in SETTINGS below, the markup for
 * its checkbox in index.html, and a VITE_SETTINGS_* line in .env.
 */

// "false"/"0"/"no"/"off" turn a setting off; anything else set turns it on; unset takes the
// fallback. Written out rather than left to Boolean(), which would read the string "false" as true —
// and .env has nothing but strings, so that is the mistake this exists to prevent.
const OFF = new Set(["false", "0", "no", "off"]);
const envFlag = (value, fallback = true) => (value == null || value === "" ? fallback : !OFF.has(String(value).trim().toLowerCase()));

/**
 * Every preference the settings modal offers. `el` is its checkbox in index.html; `fallback` is
 * what it ships as, which every deployment can set in .env. The env vars are spelled out one by one
 * rather than looked up by name because Vite substitutes `import.meta.env.VITE_X` statically —
 * building the name at runtime would silently read undefined in a production build.
 */
const SETTINGS = [
  {key: "legend", el: "set-legend", fallback: envFlag(import.meta.env.VITE_SETTINGS_MAP_LEGEND_VISIBLE)},
  {key: "shadedWarningLevels", el: "set-shaded-warning-levels", fallback: envFlag(import.meta.env.VITE_SETTINGS_SHADED_WARNING_LEVELS)}
];

/**
 * The language a device that has never picked one is served in.
 *
 * Not a checkbox and not in the settings modal — the header's picker is the control, and it writes
 * its own choice to localStorage, which outranks this. So this is only ever the starting point: a
 * deployment for a Spanish-speaking audience opens in Spanish instead of making every visitor
 * change it. An unsupported code falls back to English at setLanguage(), so a typo here costs the
 * default and nothing else.
 */
const DEFAULT_LANGUAGE = import.meta.env.VITE_SETTINGS_DEFAULT_LANGUAGE || "en";

/**
 * The theme a device that has never picked one is served in. Like the language, the header's toggle
 * is the control and its choice outranks this. Only two values exist, so an unrecognised one is
 * rejected here rather than reaching the DOM as a data-theme nothing has styles for.
 */
const THEMES = ["dark", "light"];
const DEFAULT_THEME = THEMES.includes(import.meta.env.VITE_SETTINGS_DEFAULT_THEME) ? import.meta.env.VITE_SETTINGS_DEFAULT_THEME : "dark";

const STORAGE_PREFIX = "rfs-setting-";
const values = new Map();
const listeners = new Map();

/** What the device remembers, or what the deployment ships with if it has never been touched. */
function initialValue({key, fallback}) {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  return stored === null ? fallback : stored === "true";
}

const getSetting = (key) => values.get(key) ?? false;

function setSetting(key, value) {
  if (values.get(key) === value) return;
  values.set(key, value);
  localStorage.setItem(STORAGE_PREFIX + key, String(value));
  for (const fn of listeners.get(key) ?? []) fn(value);
}

/**
 * Subscribe to a setting. Fires immediately with the current value, so a subscriber writes the
 * "apply this" code once instead of once for startup and once for changes — which is also what
 * makes a deployment's env default actually take effect rather than only its user changes.
 */
function onSetting(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  fn(getSetting(key));
}

/** Read every setting and wire its checkbox. Call once, before anything subscribes. */
function initSettings() {
  for (const setting of SETTINGS) {
    values.set(setting.key, initialValue(setting));
    const el = document.getElementById(setting.el);
    if (!el) continue;
    el.checked = values.get(setting.key);
    el.addEventListener("change", () => setSetting(setting.key, el.checked));
  }
}

export {DEFAULT_LANGUAGE, DEFAULT_THEME, getSetting, initSettings, onSetting};

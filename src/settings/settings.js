import {heroIcon} from "../icons/icons.js"
import {getLanguage, setLanguage} from "../i18n/i18n.js";
import {wireMenu} from "../map/menu.js";

const $ = (id) => document.getElementById(id);

// env vars are strings so we can't check for truthiness straight up
const ON = new Set(["true", "1", "yes", "on"]);
const OFF = new Set(["false", "0", "no", "off"]);
const envToBool = value => ON.has(value) ? true : !OFF.has(value);
const envNumber = (value, fallback) => (value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback);

// Where the map opens: the deployment's configured view, or the whole world.
const MAP_CENTER = [envNumber(import.meta.env.VITE_MAP_CENTER_LON, 0), envNumber(import.meta.env.VITE_MAP_CENTER_LAT, 20)];
const MAP_ZOOM = envNumber(import.meta.env.VITE_MAP_ZOOM, 1.5);
const MAP_DEFAULT_BASEMAP = import.meta.env.VITE_MAP_DEFAULT_BASEMAP || "";

// The languages the app supports, declared once: the picker's buttons in index.html.
const LANGUAGES = [...document.querySelectorAll("#lang-menu [data-lang]")].map((el) => el.dataset.lang);

// check that non-boolean choices are valid
// if user wants dark mode use it, if the deployed default is dark use it, otherwise use light
const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const DEFAULT_THEME = prefersDark || import.meta.env.VITE_PREFERENCES_DEFAULT_THEME === "dark" ? "dark" : "light";
const envLanguage = import.meta.env.VITE_PREFERENCES_DEFAULT_LANGUAGE;
const DEFAULT_LANGUAGE = LANGUAGES.includes(envLanguage) ? envLanguage : "en";

const PREFERENCES = [
  {key: "theme", el: "set-theme", fallback: DEFAULT_THEME},
  {key: "language", el: "set-language", fallback: DEFAULT_LANGUAGE},
]
const SETTINGS = [
  {key: "legend", el: "set-legend", fallback: envToBool(import.meta.env.VITE_SETTINGS_LEGEND)},
  {key: "shadedWarningLevels", el: "set-shaded-warning-levels", fallback: envToBool(import.meta.env.VITE_SETTINGS_SHADED_WARNING_LEVELS)},
];

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

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("btn-theme").replaceChildren(heroIcon(theme === "dark" ? "sun" : "moon"));
}

/**
 * The header's language dropdown. onLanguageChange(code) fires after the UI has retranslated, for
 * text that walking [data-i18n] elements cannot reach (canvas charts, state-dependent titles).
 */
function initLanguagePicker(onLanguageChange) {
  const menu = $("lang-menu");
  const options = [...menu.querySelectorAll(".layer-opt[data-lang]")];
  // What this device last chose, or the deployment's configured default for one that never has.
  setLanguage(prefs.get("language"));
  // setLanguage() is the authority on what that resolved to — an unsupported code (a typo in
  // .env, a stale stored value) lands on English, and the menu has to agree with the app.
  const active = getLanguage();
  // Same dropdown behaviour as the basemap and layer pickers.
  const closeMenu = wireMenu($("btn-language"), menu);
  for (const opt of options) {
    const code = opt.dataset.lang;
    opt.classList.toggle("active", code === active);
    opt.addEventListener("click", () => {
      setLanguage(code);
      onLanguageChange?.(code);
      prefs.set("language", code);
      options.forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      closeMenu();
    });
  }
}

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

const prefs = (() => {
  return {
    get(key) {
      const pref = PREFERENCES.find((p) => p.key === key);
      if (!pref) throw new Error(`Unknown preference: ${key}`);
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      return stored === null ? pref.fallback : stored;
    },
    set(key, value) {
      const pref = PREFERENCES.find((p) => p.key === key);
      if (!pref) throw new Error(`Unknown preference: ${key}`);
      localStorage.setItem(STORAGE_PREFIX + key, value);
    }
  }
})()

export {
  applyTheme,
  DEFAULT_THEME,
  getSetting,
  initLanguagePicker,
  initSettings,
  LANGUAGES,
  MAP_CENTER,
  MAP_DEFAULT_BASEMAP,
  MAP_ZOOM,
  onSetting
};

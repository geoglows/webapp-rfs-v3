import {heroIcon} from "../shared/icons/icons.js"
import {setLanguage} from "../i18n/i18n.js";
import {wireMenu} from "../map/menu.js";
// When this bundle was made — stampBuildDate() in vite.config.js writes the module.
import BUILD_DATE from "virtual:build-date";

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
const MAX_FLOOD_REACHES = envNumber(import.meta.env.VITE_MAX_FLOOD_REACHES, 50);
const MIN_FLOOD_MAPS_ZOOM = envNumber(import.meta.env.VITE_MIN_FLOOD_MAPS_ZOOM, 7);
const SAVED_RIVERS = {
  highlight: envToBool(import.meta.env.VITE_SAVED_RIVERS_HIGHLIGHT),
  color: import.meta.env.VITE_SAVED_RIVERS_COLOR || "",
  borderWidth: envNumber(import.meta.env.VITE_SAVED_RIVERS_BORDER_WIDTH, 3)
};

// The languages the app supports, declared once: the picker's buttons in index.html.
const LANGUAGES = [...document.querySelectorAll("#lang-menu [data-lang]")].map((el) => el.dataset.lang);

// check that non-boolean choices are valid
// if user wants dark mode use it, if the deployed default is dark use it, otherwise use light
const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const DEFAULT_THEME = prefersDark || import.meta.env.VITE_PREFERENCES_DEFAULT_THEME === "dark" ? "dark" : "light";
const envLanguage = import.meta.env.VITE_PREFERENCES_DEFAULT_LANGUAGE;
const DEFAULT_LANGUAGE = LANGUAGES.includes(envLanguage) ? envLanguage : "en";

const PREFERENCES = [
  // The theme used to be its own localStorage key (rfs-theme); it is migrated in initSettings().
  {key: "theme", el: "set-theme", fallback: DEFAULT_THEME},
  {key: "language", el: "set-language", fallback: DEFAULT_LANGUAGE},
]
const SETTINGS = [
  // No checkbox: this one is flipped by the streams panel's legend button (panelControls).
  {key: "legend", fallback: envToBool(import.meta.env.VITE_SETTINGS_LEGEND)},
  {key: "shadedWarningLevels", el: "set-shaded-warning-levels", fallback: envToBool(import.meta.env.VITE_SETTINGS_SHADED_WARNING_LEVELS)},
  // The deployment picks the starting state (VITE_SAVED_RIVERS_HIGHLIGHT, via SAVED_RIVERS below);
  // from there it is the user's, per device. The colour and width of the outline stay deployment
  // config — they are branding, not a preference anyone would want to sit and adjust.
  {key: "savedHighlight", el: "set-saved-highlight", fallback: SAVED_RIVERS.highlight},
];

const STORAGE_PREFIX = "rfs-setting-";
const SAVED_AT_KEY = "rfs-settings-saved-at";
// Where the theme used to live, and where it still lives for the hydrography explorer: that app is
// deployed alongside this one at /rfs-hydrography and reads this key directly, and the two share
// one origin, so this is not a dead migration key — it is a live channel between two apps. Hence
// copy-and-mirror below rather than the move this used to do, which silently wiped that app's
// theme on every visit here. Delete this and both call sites when that app is retired into this one.
const LEGACY_THEME_KEY = "rfs-theme";
const values = new Map();
const listeners = new Map();
const anyListeners = new Set();

/** What the device remembers, or what the deployment ships with if it has never been touched. */
function initialValue({key, fallback}) {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  return stored === null ? fallback : stored === "true";
}

const getSetting = (key) => values.get(key) ?? false;

function setSetting(key, value, {remote = false} = {}) {
  if (values.get(key) === value) return;
  values.set(key, value);
  localStorage.setItem(STORAGE_PREFIX + key, String(value));
  const el = SETTINGS.find((s) => s.key === key)?.el;
  if (el && $(el)) $(el).checked = value;
  for (const fn of listeners.get(key) ?? []) fn(value);
  if (!remote) noteLocalChange();
}

/** Stamp the device's last edit so a pull from the profile can tell which side is newer. */
function noteLocalChange() {
  localStorage.setItem(SAVED_AT_KEY, new Date().toISOString());
  const snapshot = getPreferences();
  for (const fn of anyListeners) fn(snapshot);
}

/** When this device last changed any preference, or null if never. */
const preferencesSavedAt = () => localStorage.getItem(SAVED_AT_KEY);

/**
 * Every preference this app keeps, as the flat camelCase object rfs.user_data stores. It is shared
 * with every other RFS app version, so keys are a contract: never renamed, never repurposed.
 */
function getPreferences() {
  const out = {theme: prefs.get("theme"), lang: prefs.get("language")};
  for (const {key} of SETTINGS) out[key] = getSetting(key);
  return out;
}

/**
 * Apply a preferences object that arrived from the profile. Unknown keys are ignored, invalid
 * values are ignored, and nothing here counts as a local edit, so it can't bounce back up.
 */
function applyPreferences(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.theme === "light" || obj.theme === "dark") prefs.set("theme", obj.theme, {remote: true});
  if (LANGUAGES.includes(obj.lang)) prefs.set("language", obj.lang, {remote: true});
  for (const {key} of SETTINGS) if (typeof obj[key] === "boolean") setSetting(key, obj[key], {remote: true});
}

/**
 * Back to what the deployment ships with, as if this device had never been touched. For sign-out:
 * the next person at this browser gets the defaults, not the last account's choices. Not a local
 * edit — nothing here is pushed anywhere.
 */
function resetPreferences() {
  for (const {key} of [...PREFERENCES, ...SETTINGS]) localStorage.removeItem(STORAGE_PREFIX + key);
  localStorage.removeItem(SAVED_AT_KEY);
  applyPreferences({theme: DEFAULT_THEME, lang: DEFAULT_LANGUAGE, ...Object.fromEntries(SETTINGS.map((s) => [s.key, s.fallback]))});
}

/** Fires with the whole preferences object after any local edit — what the profile sync pushes. */
function onPreferencesChange(fn) {
  anyListeners.add(fn);
  return () => anyListeners.delete(fn);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("btn-theme").replaceChildren(heroIcon(theme === "dark" ? "sun" : "moon"));
}

/**
 * The header's language dropdown. onLanguageChange(code) fires after the UI has retranslated, for
 * text that walking [data-i18n] elements cannot reach (canvas charts, loaded documents).
 *
 * Every language but English is fetched the first time it is picked, so switching is asynchronous:
 * the menu answers the click immediately and the text follows when the dictionary lands. The code
 * handed to onLanguageChange is the one that ended up in effect, which is not the one clicked if
 * its translations could not be loaded.
 */
function initLanguagePicker(onLanguageChange) {
  const menu = $("lang-menu");
  const options = [...menu.querySelectorAll(".opt[data-lang]")];
  // What this device last chose, or the deployment's configured default for one that never has. A
  // stored code the menu no longer offers (a typo in .env, a language since dropped) is neither.
  // Same dropdown behaviour as the basemap and layer pickers, but anchored: this is the one that
  // opens inside `.panel`, whose overflow clip would otherwise cut it off at the column's edge.
  const closeMenu = wireMenu($("btn-language"), menu, {anchored: true});
  const markActive = (lang) => options.forEach((o) => o.classList.toggle("active", o.dataset.lang === lang));
  let first = true;
  // Runs now with what this device last chose (or the deployment's default), and again on every
  // change — a click below, or a language pulled from the profile. A stored code the menu no longer
  // offers (a typo in .env, a language since dropped) reads as English.
  onSetting("language", async (stored) => {
    const code = LANGUAGES.includes(stored) ? stored : "en";
    // Marked before the fetch: the click is answered now, not when the network says so.
    markActive(code);
    const isFirst = first;
    first = false;
    // Not awaited on load: index.html is written in English, so the app is readable from the first
    // frame and simply retranslates a moment later. What is actually in effect afterwards: on a
    // failed load that is English, and the menu is corrected to say so; on a click that a later
    // click overtook, it is the later one's — so both settle on the same answer.
    const applied = await setLanguage(code);
    markActive(applied);
    if (!isFirst) onLanguageChange?.(applied);
  });
  for (const opt of options) {
    opt.addEventListener("click", () => {
      prefs.set("language", opt.dataset.lang);
      closeMenu();
    });
  }
}

function onSetting(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  fn(PREFERENCES.some((p) => p.key === key) ? prefs.get(key) : getSetting(key));
}

/** Read every setting and wire its checkbox. Call once, before anything subscribes. */
function initSettings() {
  // A configured saved-river colour outranks the stylesheet's light/dark pair of --saved, so the
  // heart and the outline the map draws stay the same colour — which is the whole point of the
  // variable. Left alone when nothing is configured, so each theme keeps the pink picked for it.
  if (SAVED_RIVERS.color) document.documentElement.style.setProperty("--saved", SAVED_RIVERS.color);
  // Adopt on every load, not seed-once: the other app writes this key when its user flips the
  // theme, and this read is the only way that choice reaches this app.
  const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
  if (legacyTheme === "light" || legacyTheme === "dark") {
    localStorage.setItem(STORAGE_PREFIX + "theme", legacyTheme);
  }
  if ($("build-date")) $("build-date").textContent = BUILD_DATE;
  for (const setting of SETTINGS) {
    values.set(setting.key, initialValue(setting));
    const el = document.getElementById(setting.el);
    if (!el) continue;
    el.checked = values.get(setting.key);
    el.addEventListener("change", () => setSetting(setting.key, el.checked));
  }
}

const prefs = {
  get(key) {
    const pref = PREFERENCES.find((p) => p.key === key);
    if (!pref) throw new Error(`Unknown preference: ${key}`);
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    return stored === null ? pref.fallback : stored;
  },
  set(key, value, {remote = false} = {}) {
    const pref = PREFERENCES.find((p) => p.key === key);
    if (!pref) throw new Error(`Unknown preference: ${key}`);
    if (prefs.get(key) === value) return;
    localStorage.setItem(STORAGE_PREFIX + key, value);
    // The other half of the LEGACY_THEME_KEY channel: mirror the choice out so the hydrography
    // explorer picks it up on its next load.
    if (key === "theme") localStorage.setItem(LEGACY_THEME_KEY, value);
    for (const fn of listeners.get(key) ?? []) fn(value);
    if (!remote) noteLocalChange();
  }
};

/** The header's sun/moon button; the theme itself is a preference so the profile can carry it. */
function initThemeToggle(onThemeChange) {
  onSetting("theme", (theme) => {
    applyTheme(theme);
    onThemeChange?.(theme);
  });
  $("btn-theme").addEventListener("click", () => prefs.set("theme", prefs.get("theme") === "dark" ? "light" : "dark"));
}

export {
  applyPreferences,
  applyTheme,
  DEFAULT_THEME,
  getPreferences,
  getSetting,
  initLanguagePicker,
  initSettings,
  initThemeToggle,
  onPreferencesChange,
  preferencesSavedAt,
  resetPreferences,
  setSetting,
  LANGUAGES,
  MAP_CENTER,
  MAP_DEFAULT_BASEMAP,
  MAP_ZOOM,
  MAX_FLOOD_REACHES,
  MIN_FLOOD_MAPS_ZOOM,
  onSetting,
  SAVED_RIVERS
};

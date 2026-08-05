import {heroIcon} from "../icons/icons.js"
import {setLanguage} from "../i18n/i18n.js";
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

// The ceiling on how many reaches one flood map may span. A hard capability limit, not a taste:
// past it the worker's corridor grid and the canvas MapLibre drapes it on outgrow what the browser
// will allocate. Configurable so a deployment can move it if its users are on very different
// hardware — not so it can be tuned per preference. See MAX_FLOOD_REACHES in flood-maps/selection.js.
const MAX_FLOOD_REACHES = envNumber(import.meta.env.VITE_MAX_FLOOD_REACHES, 50);

// Below this zoom the flood library is not consulted at all: too many data tiles fall under the
// viewport to load, and a reach is too small to aim at. Read by the viewport→coverage bridge
// (flood-maps/tilesLayer.js) and by the highlight that marks what the library does not hold, which
// would otherwise have the whole world to mark.
const MIN_FLOOD_MAPS_ZOOM = envNumber(import.meta.env.VITE_MIN_FLOOD_MAPS_ZOOM, 7);

/**
 * The outline the map draws around every river the user has saved (map/Streams.js).
 *
 * `highlight` false drops the layer entirely — saving still works and the saved list still fills,
 * there is simply nothing drawn on the map. A deployment that styles its streams by forecast may
 * not want a second colour competing with that.
 *
 * `color` is left empty by default so the stylesheet keeps its own light/dark pair for the heart
 * and the outline; setting it pins both themes to that one colour, which is the deployer's call.
 * `borderWidth` is how far the outline shows past the streams line on each side, in pixels.
 */
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
  {key: "theme", el: "set-theme", fallback: DEFAULT_THEME},
  {key: "language", el: "set-language", fallback: DEFAULT_LANGUAGE},
]
const SETTINGS = [
  {key: "legend", el: "set-legend", fallback: envToBool(import.meta.env.VITE_SETTINGS_LEGEND)},
  {key: "shadedWarningLevels", el: "set-shaded-warning-levels", fallback: envToBool(import.meta.env.VITE_SETTINGS_SHADED_WARNING_LEVELS)},
  // The deployment picks the starting state (VITE_SAVED_RIVERS_HIGHLIGHT, via SAVED_RIVERS below);
  // from there it is the user's, per device. The colour and width of the outline stay deployment
  // config — they are branding, not a preference anyone would want to sit and adjust.
  {key: "savedHighlight", el: "set-saved-highlight", fallback: SAVED_RIVERS.highlight},
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
 * text that walking [data-i18n] elements cannot reach (canvas charts, loaded documents).
 *
 * Every language but English is fetched the first time it is picked, so switching is asynchronous:
 * the menu answers the click immediately and the text follows when the dictionary lands. The code
 * handed to onLanguageChange is the one that ended up in effect, which is not the one clicked if
 * its translations could not be loaded.
 */
function initLanguagePicker(onLanguageChange) {
  const menu = $("lang-menu");
  const options = [...menu.querySelectorAll(".layer-opt[data-lang]")];
  // What this device last chose, or the deployment's configured default for one that never has. A
  // stored code the menu no longer offers (a typo in .env, a language since dropped) is neither.
  const stored = prefs.get("language");
  const active = LANGUAGES.includes(stored) ? stored : "en";
  // Not awaited: index.html is written in English, so the app is readable from the first frame and
  // simply retranslates a moment later. Started here rather than on first use so that a returning
  // user's language is on its way while the map is still loading.
  void setLanguage(active);
  // Same dropdown behaviour as the basemap and layer pickers, but anchored: this is the one that
  // opens inside `.panel`, whose overflow clip would otherwise cut it off at the column's edge.
  const closeMenu = wireMenu($("btn-language"), menu, {anchored: true});
  const markActive = (lang) => options.forEach((o) => o.classList.toggle("active", o.dataset.lang === lang));
  markActive(active);
  for (const opt of options) {
    const code = opt.dataset.lang;
    opt.addEventListener("click", async () => {
      // Marked and stored before the fetch: the click is answered now, not when the network says so.
      markActive(code);
      prefs.set("language", code);
      closeMenu();
      // What is actually in effect afterwards. On a failed load that is English, and the menu is
      // corrected to say so; on a click that a later click overtook, it is the later one's — so
      // both settle on the same answer rather than racing each other back and forth.
      const applied = await setLanguage(code);
      markActive(applied);
      onLanguageChange?.(applied);
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
  // A configured saved-river colour outranks the stylesheet's light/dark pair of --saved, so the
  // heart and the outline the map draws stay the same colour — which is the whole point of the
  // variable. Left alone when nothing is configured, so each theme keeps the pink picked for it.
  if (SAVED_RIVERS.color) document.documentElement.style.setProperty("--saved", SAVED_RIVERS.color);
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
  MAX_FLOOD_REACHES,
  MIN_FLOOD_MAPS_ZOOM,
  onSetting,
  SAVED_RIVERS
};

import en from "./locales/en.js";

/**
 * The UI strings, one dictionary per language under ./locales/.
 *
 * English is imported: it is the fallback t() reaches for on any missing key, so it has to be in
 * hand synchronously, and it is the language index.html is already written in. Every other language
 * is a JSON file fetched only if somebody selects it — globbed lazily, so each is its own chunk and
 * a deployment's untouched languages cost their users nothing. Adding a language is a JSON file in
 * ./locales/ plus a button in #lang-menu; nothing imports one by name.
 */
const LOADERS = import.meta.glob("./locales/*.json", {import: "default"});
const DICTS = {en};

let currentLang = "en";
// Bumped per setLanguage() call, so a dictionary that arrives after a newer choice was made is
// dropped rather than repainting the UI into a language the user has already moved on from.
let switchId = 0;

function t(key, lang = currentLang) {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}

/**
 * Fetch a language's dictionary if it isn't already in hand. Resolves to the code that can actually
 * be shown — the one asked for, or "en" when there is no such language or its file will not load.
 * A failure is not fatal by design: every key falls back to English, so the app keeps working in a
 * language nobody chose rather than not at all.
 */
async function loadDict(lang) {
  if (DICTS[lang]) return lang;
  const load = LOADERS[`./locales/${lang}.json`];
  if (!load) return "en";
  try {
    DICTS[lang] = await load();
    return lang;
  } catch (e) {
    console.warn(`Translations for "${lang}" could not be loaded, staying in English: ${e.message}`);
    return "en";
  }
}

// The phases a cached dataset's build reports, in the order it reports them.
const DATA_PHASES = {
  download: "settings.data.downloading",
  sort: "settings.data.sorting",
  verify: "settings.data.verifying",
  store: "settings.data.storing"
};

/**
 * "Downloading 42%" — one build's progress as a line of text in the current language. The same
 * download is watched from three places now (the Settings row, the search box, the charts dock), so
 * it reads the same in all three. A percentage rather than a count: the download reports per chunk
 * over hundreds of chunks, and nothing else stays legible at that rate.
 */
function dataProgress({phase, done, total}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `${t(DATA_PHASES[phase] ?? "settings.data.starting")} ${pct}%`;
}

function getLanguage() {
  return currentLang;
}

function applyTranslations(lang, root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n, lang);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml, lang);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder, lang));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle, lang));
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel, lang));
  });
}

/**
 * Switch the app to a language, fetching its dictionary first if this is the first time it has been
 * asked for. Resolves once the UI has been retranslated, to the code actually in effect — callers
 * with text that walking [data-i18n] cannot reach (canvas charts, loaded documents) should await it
 * and then read getLanguage().
 *
 * Awaiting is optional. Until it resolves the UI stays in whatever language it was already showing,
 * which for a cold start is the English written into index.html.
 */
async function setLanguage(lang) {
  const id = ++switchId;
  const code = await loadDict(lang);
  // A later choice already won. It has applied its own translations, or is about to.
  if (id !== switchId) return currentLang;
  currentLang = code;
  document.documentElement.lang = code;
  applyTranslations(code);
  return code;
}

export {
  applyTranslations,
  dataProgress,
  getLanguage,
  setLanguage,
  t
};

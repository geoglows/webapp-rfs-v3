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

const SLOT = /\{(\d+)}/g;

// The children an element had before it was ever filled, per element. Kept because filling is what
// removes them: a language change refills from the same original elements rather than from whatever
// the previous language's word order left behind.
const slotsOf = new WeakMap();

const markup = (html) => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content;
};

/**
 * A sentence that is more than plain text, written into the element that asked for it.
 *
 * Inline emphasis (<strong>, <em>) is written into the sentence itself, since there is nothing in it
 * to keep in one place. Anything carrying markup a translation should not have to copy — a link and
 * its URL — stays in index.html as a child of the element, and the sentence refers to it as `{0}`,
 * `{1}` … in whatever position its word order needs. The children are moved rather than rebuilt, so
 * a link whose own text is translated is still the node the [data-i18n] pass reaches afterwards.
 */
function fill(el, text) {
  let slots = slotsOf.get(el);
  if (!slots) {
    slots = [...el.children];
    slotsOf.set(el, slots);
  }
  el.replaceChildren();
  let at = 0;
  for (const match of text.matchAll(SLOT)) {
    if (match.index > at) el.append(markup(text.slice(at, match.index)));
    const slot = slots[Number(match[1])];
    if (slot) el.append(slot);
    at = match.index + match[0].length;
  }
  if (at < text.length) el.append(markup(text.slice(at)));
}

function applyTranslations(lang, root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n, lang);
  });
  // After the plain pass: a [data-i18n] element that is one of these slots has its own text by now,
  // and filling only moves it, so both are in the language just applied.
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    fill(el, t(el.dataset.i18nHtml, lang));
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

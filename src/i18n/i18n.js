import en from "./locales/en.js";

/**
 * The UI strings, one dictionary per language under ./locales/. English is imported because it is
 * the synchronous fallback for any missing key; the rest are globbed lazily, one chunk each, fetched
 * only if selected. Adding a language is a JSON file here plus a button in #lang-menu.
 */
const LOADERS = import.meta.glob("./locales/*.json", {import: "default"});
const DICTS = {en};

let currentLang = "en";
// Bumped per setLanguage(), so a dictionary arriving after a newer choice is dropped.
let switchId = 0;

function t(key, lang = currentLang) {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}

// `{name}` values written into a string. Distinct from the `{0}` slots fill() understands, which
// move an *element* into place and only appear in [data-i18n-html] markup.
const VARS = /\{(\w+)}/g;

const interpolate = (text, vars) =>
  (vars ? text.replace(VARS, (whole, name) => (name in vars ? String(vars[name]) : whole)) : text);

/** A translated sentence with its `{name}` placeholders filled in. */
function tf(key, vars, lang = currentLang) {
  return interpolate(t(key, lang), vars);
}

const RULES = new Map();
const rulesFor = (lang) => {
  if (!RULES.has(lang)) RULES.set(lang, new Intl.PluralRules(lang));
  return RULES.get(lang);
};

/**
 * A sentence whose wording depends on a count: reads `<key>.one` or `.other` and fills `{n}` in the
 * reader's locale. `Intl.PluralRules` rather than `n === 1`, because plenty of languages put the
 * boundary elsewhere. Every locale carries exactly `.one` and `.other`; a category a language has and
 * the dictionary does not (French `many`) falls back to `.other`.
 */
function tn(key, count, vars = {}, lang = currentLang) {
  const category = rulesFor(lang).select(count);
  const dict = DICTS[lang] ?? {};
  const text = dict[`${key}.${category}`] ?? dict[`${key}.other`]
    ?? en[`${key}.${category}`] ?? en[`${key}.other`] ?? key;
  return interpolate(text, {n: count.toLocaleString(lang), ...vars});
}

/**
 * Fetch a language's dictionary. Resolves to the code that can actually be shown — the one asked for,
 * or "en". A failure is not fatal: every key falls back to English.
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
 * "Downloading 42%" — one build's progress, worded the same in all three places that watch it. A
 * percentage rather than a count: the download reports per chunk over hundreds of chunks.
 */
function dataProgress({phase, done, total}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `${t(DATA_PHASES[phase] ?? "settings.data.starting")} ${pct}%`;
}

function getLanguage() {
  return currentLang;
}

const SLOT = /\{(\d+)}/g;

// The children an element had before it was first filled — filling is what removes them, so a
// language change refills from the originals rather than the last language's word order.
const slotsOf = new WeakMap();

const markup = (html) => {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content;
};

/**
 * A sentence that is more than plain text. Inline emphasis lives in the sentence; anything a
 * translation should not have to copy — a link and its URL — stays in index.html as a child and the
 * sentence refers to it as `{0}`, `{1}` … wherever its word order needs. Children are moved, not
 * rebuilt, so a translated link is still the node the [data-i18n] pass reaches afterwards.
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

/**
 * Whether an element's tooltip should also be spoken as its name.
 *
 * True for a control that shows no word of its own — an icon button, a glyph like the player's
 * ▶, an empty count — and false for anything that already reads as something, or for a bare
 * span/div that ARIA gives no name to in the first place. See the call site for why each half of
 * that matters.
 *
 * "Word" rather than "text" is the point of WORDS: a face that is one arrow or one ✕ is a picture
 * spelled with a character, and speaking it as its codepoint name is no better than leaving the
 * control unnamed. Only content a person could actually say back is treated as a name.
 */
const NAMEABLE = "a[href], button, input, select, textarea, summary, [role]";
const WORDS = /[\p{L}\p{N}]/u;
const namesFromTitle = (el) => el.matches(NAMEABLE) && !WORDS.test(el.textContent);

function applyTranslations(lang, root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n, lang);
  });
  // After the plain pass, so a [data-i18n] element used as a slot already carries its own text.
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    fill(el, t(el.dataset.i18nHtml, lang));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder, lang));
  });
  // A tooltip becomes the accessible name only where there is no name already and the element can
  // hold one — which is what a data-i18n-title mostly marks: an unlabelled icon control.
  //
  // The two exclusions are not defensive, they are both things ARIA forbids. A tooltip on a plain
  // <span> or <div> cannot be its name (aria-label is prohibited on elements with no role, and a
  // screen reader is entitled to drop it), and a tooltip on a control that already shows a word is
  // a *different* name from the one on screen — "Clear" spoken as "Empty whatever the current
  // method is holding" is a control nobody can ask for out loud. In both cases the tooltip is
  // still set; it is simply left as the tooltip it is.
  //
  // The few elements whose spoken name should genuinely differ from their text say so with their
  // own data-i18n-aria-label, handled below, and are left alone here.
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle, lang));
    if (el.dataset.i18nAriaLabel || !namesFromTitle(el)) return;
    el.setAttribute("aria-label", t(el.dataset.i18nTitle, lang));
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel, lang));
  });
}

/**
 * Switch the app to a language, fetching its dictionary if needed. Resolves once the UI is
 * retranslated, to the code actually in effect — callers with text that walking [data-i18n] cannot
 * reach (canvas charts) should await it and read getLanguage(). Awaiting is optional; until then the
 * UI stays in the language it was showing.
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
  t,
  tf,
  tn
};

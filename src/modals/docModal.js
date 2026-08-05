import {getLanguage, t} from "../i18n/i18n.js";

const $ = (id) => document.getElementById(id);

/**
 * A modal whose body is prose rather than controls: one HTML document per language, fetched the
 * first time somebody opens it in that language.
 *
 * The documents are files rather than i18n.js keys because that dictionary is for labels. Paragraph
 * after paragraph of markup in it would swamp the strings the UI actually reads, translating prose
 * is a per-document job rather than a per-key one, and none of it belongs in the bundle that has to
 * load before the map can draw. Only the modal's own chrome — its heading, its close button — stays
 * in the dictionary, because that is what the rest of the UI is made of.
 *
 * Callers own the glob, since import.meta.glob only takes a literal pattern and so cannot be
 * handed one from here. What arrives is its map of path -> lazy loader; `dir` says which directory
 * those paths are in, so a language can be looked up in it and English found as the fallback.
 */
function createDocModal({modalId, bodyId, docs, dir, name}) {
  const body = $(bodyId);
  const docFor = (lang) => docs[`${dir}/${lang}.html`] ?? docs[`${dir}/en.html`];
  // What has already been fetched, so reopening — or switching back to a language — costs nothing.
  const cache = new Map();
  // Which language the body is currently showing, so a language change while the modal is closed is
  // noticed the next time it opens rather than repainting text nobody is looking at.
  let rendered = null;
  // Bumped per load, so a document that lands after the language changed again is dropped instead
  // of overwriting the newer one it raced.
  let loadId = 0;

  async function render() {
    const lang = getLanguage();
    if (rendered === lang) return;
    const id = ++loadId;
    if (cache.has(lang)) {
      body.innerHTML = cache.get(lang);
      rendered = lang;
      return;
    }
    body.innerHTML = `<p class="hint">${t("doc.loading")}</p>`;
    try {
      const html = await docFor(lang)();
      if (id !== loadId) return;
      cache.set(lang, html);
      body.innerHTML = html;
      rendered = lang;
    } catch (e) {
      if (id !== loadId) return;
      console.warn(`${name} failed to load: ${e.message}`);
      body.innerHTML = `<p class="hint error">${t("doc.failed")}</p>`;
      // Left unset so the next open retries rather than treating the error as this language's text.
      rendered = null;
    }
  }

  return {
    /** Show the modal, fetching this language's document if it isn't already in hand. */
    open() {
      $(modalId).classList.remove("hidden");
      void render();
    },
    /**
     * Called after the app retranslates. Repaints only if the modal is open — otherwise the stale
     * language is left for open() to notice, which keeps a language the user is only passing
     * through from pulling down a document nobody is reading.
     */
    onLanguageChange() {
      if (!$(modalId).classList.contains("hidden")) void render();
    }
  };
}

export {createDocModal};

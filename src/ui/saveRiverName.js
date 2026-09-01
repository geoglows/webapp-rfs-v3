import {t} from "../i18n/i18n.js";
import {$} from "../dom.js";


/**
 * The name a river is saved under, asked for in a modal rather than a `prompt()` — the browser
 * dialog can't be translated, styled, or dismissed with the rest of the app's Escape handling.
 *
 * Resolves to the typed name, or to null if the prompt was dismissed. Null means "don't save": the
 * heart is a two-step action, and backing out of the second step must not leave a river saved.
 * An empty string is a real answer — a saved river with no name, listed by its id.
 */
let settle = null;
let wired = false;

function finish(name) {
  const done = settle;
  settle = null;
  $("save-river-modal")?.classList.add("hidden");
  done?.(name);
}

/**
 * Wired on first use rather than at startup: nothing here exists until somebody clicks a heart, and
 * this way the module has no init call for main.js to keep in sync.
 *
 * Escape and the ✕ are handled here rather than left to main.js's generic modal closers, because
 * hiding this modal without answering would strand the caller on a promise that never settles.
 */
function wire() {
  if (wired) return;
  wired = true;
  const modal = $("save-river-modal");
  $("save-river-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    finish($("save-river-name")?.value.trim() ?? "");
  });
  $("save-river-cancel")?.addEventListener("click", () => finish(null));
  $("save-river-close")?.addEventListener("click", () => finish(null));
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) finish(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settle) finish(null);
  });
}

function askRiverName({riverId, name = ""}) {
  wire();
  const modal = $("save-river-modal");
  const input = $("save-river-name");
  if (!modal || !input) return Promise.resolve(null);
  // A second ask supersedes the first — the earlier caller is answered "dismissed" rather than left
  // holding a promise the modal is no longer showing.
  finish(null);
  // Set in JS, not by data-i18n, because it names the reach being saved. A language change while
  // the prompt is open leaves this one line in the old language; the prompt is a few seconds long.
  const heading = $("save-river-title");
  if (heading) heading.textContent = `${t("saveRiver.heading")} ${riverId}`;
  input.value = name;
  modal.classList.remove("hidden");
  input.focus();
  input.select();
  return new Promise((resolve) => {
    settle = resolve;
  });
}

export {askRiverName};

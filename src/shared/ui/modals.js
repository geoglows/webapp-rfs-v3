/**
 * Opening and closing the dialogs, on both pages.
 *
 * Every modal in either app is the same shape — a `.backdrop` holding one `.card.modal`, hidden by
 * a class — so there is exactly one way in and three ways out, and they are the same on both pages.
 * This lived in the data viewer's main.js and the hydrography page simply did not have it: its
 * Settings cog opened nothing, and its ✕ buttons and Escape key did nothing, because the markup was
 * copied across when the two apps merged and the wiring was not.
 *
 * Opening a *particular* dialog is the owner's business — the search box opens itself from the
 * magnifying glass, because it also has to focus its field and clear the last answer — so the only
 * open handled here is Settings, which has nothing to set up.
 */
import {$} from "../dom.js";

const hide = (el) => el?.classList.add("hidden");

/**
 * Wire the dialogs. `onEscape` runs after Escape has closed whatever was open, for a page that has
 * more than modals to dismiss — the data viewer's docks.
 */
export function wireModals({onEscape} = {}) {
  $("btn-settings")?.addEventListener("click", () => $("settings-modal")?.classList.remove("hidden"));

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => hide($(btn.dataset.close)));
  });

  // A click that lands on the backdrop itself rather than on the card sitting in it — which is what
  // "outside the dialog" means, and why the backdrop is a real element and not a pseudo-element.
  document.querySelectorAll(".backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hide(backdrop);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Read at the moment of the press, so a dialog added since — a confirm — is included. The
    // confirm dialog answers Escape itself, on the capture phase, and stops it reaching here.
    document.querySelectorAll(".backdrop").forEach(hide);
    onEscape?.();
  });
}

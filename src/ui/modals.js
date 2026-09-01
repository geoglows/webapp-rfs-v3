/**
 * Opening and closing the dialogs: every modal is a `.backdrop` holding one `.card.modal`, hidden
 * by a class, so there is one way in and three ways out.
 *
 * Opening a *particular* dialog is the owner's business — the search box focuses its field and
 * clears the last answer — so the only open handled here is Settings, which has nothing to set up.
 */
import {$} from "../dom.js";

const hide = (el) => el?.classList.add("hidden");

/** `onEscape` runs after Escape has closed whatever was open — the data viewer's docks. */
export function wireModals({onEscape} = {}) {
  $("btn-settings")?.addEventListener("click", () => $("settings-modal")?.classList.remove("hidden"));

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => hide($(btn.dataset.close)));
  });

  // Only a click on the backdrop itself, not on the card sitting in it.
  document.querySelectorAll(".backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hide(backdrop);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Queried at press time so a confirm added since is included; it answers Escape on capture.
    document.querySelectorAll(".backdrop").forEach(hide);
    onEscape?.();
  });
}

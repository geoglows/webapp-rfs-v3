import {closeDock, isDockOpen, openDock} from "./dock.js";

/**
 * The help/about text, docked beside the map so the reader can try what it describes while it is
 * still on screen — and shown what it means: passages that talk about a control carry a
 * `data-spotlight` with that control's selector(s), and hovering the passage outlines the control.
 *
 * The spotlight is a class on the target, so what it looks like belongs to the stylesheet
 * (.spotlight). Targets inside the left column's scroll area are scrolled into view so the outline
 * is actually visible; the map and its overlays never need it.
 */
function createHelpDock({map}) {
  const body = document.getElementById("help-dock")?.querySelector(".modal-body");
  const button = document.getElementById("btn-help");
  const exit = document.getElementById("help-close");
  const scroll = document.getElementById("scroll");

  let lit = [];
  const clear = () => {
    for (const el of lit) el.classList.remove("spotlight");
    lit = [];
  };
  const light = (selector) => {
    clear();
    if (!selector) return;
    lit = [...document.querySelectorAll(selector)];
    for (const el of lit) {
      el.classList.add("spotlight");
      if (scroll?.contains(el)) el.scrollIntoView({block: "nearest", behavior: "smooth"});
    }
  };

  // Delegated on the dock body, and re-derived on every move: the passages nest (a heading's
  // spotlight covers its whole section, an item in its list points at one control), and the
  // innermost one under the pointer wins.
  let current = null;
  body?.addEventListener("mouseover", (e) => {
    const passage = e.target?.closest?.("[data-spotlight]");
    if (passage === current) return;
    current = passage;
    light(passage?.dataset.spotlight);
  });
  body?.addEventListener("mouseleave", () => {
    current = null;
    clear();
  });

  const open = () => openDock(map, "help");
  const close = () => {
    clear();
    closeDock(map, "help");
  };
  button?.addEventListener("click", () => (isDockOpen("help") ? close() : open()));
  exit?.addEventListener("click", close);
  return {open, close};
}

export {createHelpDock};

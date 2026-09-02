import {closeDock, isDockOpen, openDock} from "./dock.js";

/**
 * The help/about text, docked beside the map so the reader can try what it describes while it is
 * still on screen — and shown what it means: passages that talk about a control carry a
 * `data-spotlight` with that control's selector(s), and hovering the passage outlines the control.
 * The outline is a class on the target, so what it looks like belongs to the stylesheet
 * (.spotlight).
 *
 * What the dock has to work around is that the panel's own sections step aside for it, the way they
 * do for any other dock, and an outline drawn on a hidden element points at nothing. So the sections
 * come along, cloned live on every open and made inert, in one of two shapes:
 *
 *   data-mirror   a copy of a whole section, mounted in the help section that walks through it.
 *                 The forecast and flood controls are laid out as much as worded, and a paragraph
 *                 about the discharge slider means nothing without the row of controls it sits in.
 *   data-control  a copy of one button, at the head of the sentence about it. The explorer's tools
 *                 and its five selection methods are a list of buttons either way, so the list of
 *                 sentences carries them and needs no second copy of the section.
 *
 * A `data-spotlight` is resolved against its help section's mirror first and against the page after
 * that — per selector, so "#btn-legend, #legend-overlay" finds the button in the copy and the legend
 * out on the map.
 */
function createHelpDock({map}) {
  const dock = document.getElementById("help-dock");
  const body = dock?.querySelector(".modal-body");
  const button = document.getElementById("btn-help");
  const exit = document.getElementById("help-close");

  /**
   * Cloned rather than built, so a copy is the thing it copies: its markup, its ids and therefore
   * every rule the stylesheet writes about it, down to which selection method has the check in its
   * box and what FIM mode currently says. The clones keep those ids, which is the point of them and
   * is also why they sit after the live sections in the document — getElementById and querySelector
   * both answer with the first match in document order, so every `$("btn-copy")` in the app still
   * means the button in the panel.
   *
   * Rebuilt on every open, and on a language change: the state moves on, and filling a
   * [data-i18n-html] passage replaces its children, which takes an inline copy with them.
   */
  function buildCopies() {
    for (const mount of body?.querySelectorAll("[data-mirror]") ?? []) {
      const section = document.querySelector(mount.dataset.mirror);
      if (!section) continue;
      const copy = section.cloneNode(true);
      // …minus the heading's own ? — a button that opens this dock, inside this dock, is nothing.
      for (const jump of copy.querySelectorAll("[data-help]")) jump.remove();
      mount.replaceChildren(copy);
    }
    for (const passage of body?.querySelectorAll("[data-control]") ?? []) {
      for (const old of passage.querySelectorAll(".help-ctl")) old.remove();
      // The sentence is put in one element as it goes in: the passage becomes a row of button then
      // sentence, and an inline <strong> left loose in it would be a column of its own.
      const said = passage.querySelector(":scope > .help-say");
      if (said) said.replaceWith(...said.childNodes);
      const say = document.createElement("span");
      say.className = "help-say";
      say.append(...passage.childNodes);
      const copies = [...document.querySelectorAll(passage.dataset.control)].map((el) => {
        const copy = el.cloneNode(true);
        copy.removeAttribute("id");
        copy.classList.add("help-ctl");
        copy.disabled = true;
        copy.tabIndex = -1;
        copy.setAttribute("aria-hidden", "true");
        return copy;
      });
      passage.replaceChildren(...copies, say);
    }
  }

  let lit = [];
  const clear = () => {
    for (const el of lit) el.classList.remove("spotlight");
    lit = [];
  };
  const light = (passage) => {
    clear();
    const selector = passage?.dataset.spotlight;
    if (selector) {
      const mirror = passage.closest(".help-section")?.querySelector("[data-mirror]");
      lit = selector.split(",").flatMap((one) => {
        const copied = [...mirror?.querySelectorAll(one) ?? []];
        return copied.length ? copied : [...document.querySelectorAll(one)];
      });
    } else {
      lit = [...passage?.querySelectorAll(".help-ctl") ?? []];
    }
    for (const el of lit) el.classList.add("spotlight");
  };

  // Delegated on the dock body, and re-derived on every move: the passages nest (a heading's
  // spotlight covers its whole section, an item in its list points at one control), and the
  // innermost one under the pointer wins.
  let current = null;
  body?.addEventListener("mouseover", (e) => {
    const passage = e.target?.closest?.("[data-spotlight], [data-control]");
    if (passage === current) return;
    current = passage;
    light(passage);
  });
  body?.addEventListener("mouseleave", () => {
    current = null;
    clear();
  });

  const open = () => {
    buildCopies();
    return openDock(map, "help");
  };

  // Each section of the controls column carries a ? beside its heading, which opens the dock at the
  // part of the text about that section rather than at the top of it. Wired here rather than where
  // the sections are, because what a topic name means is this dock's business: the buttons name one
  // and the help sections answer to it.
  for (const jump of document.querySelectorAll("[data-help]")) {
    jump.addEventListener("click", async () => {
      const wasOpen = isDockOpen("help");
      await open();
      body?.querySelector(`[data-help-topic="${jump.dataset.help}"]`)
        ?.scrollIntoView({block: "start", behavior: wasOpen ? "smooth" : "auto"});
    });
  }
  const close = () => {
    clear();
    closeDock(map, "help");
  };
  button?.addEventListener("click", () => (isDockOpen("help") ? close() : open()));
  exit?.addEventListener("click", close);
  return {open, close, repaint: () => isDockOpen("help") && buildCopies()};
}

export {createHelpDock};

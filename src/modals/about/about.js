import {createDocModal} from "../docModal.js";

// One document per language alongside this file — see the note on the glob in instructions.js. What
// the About modal holds is credits and attributions: link-heavy markup that changes when a
// dependency or data source does, which is a worse fit for the label dictionary than for a document.
const docs = import.meta.glob("./*.html", {query: "?raw", import: "default"});

const createAbout = () => createDocModal({
  modalId: "info-modal",
  bodyId: "about-body",
  docs,
  dir: ".",
  name: "About"
});

export {createAbout};
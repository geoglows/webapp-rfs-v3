import {createDocModal} from "../docModal.js";

// One document per language alongside this file. The glob has to live here rather than in
// docModal.js: import.meta.glob only takes a literal pattern, so each set of documents declares
// its own. Lazy, so every language is a separate chunk fetched only if it is asked for.
const docs = import.meta.glob("./*.html", {query: "?raw", import: "default"});

const createInstructions = () => createDocModal({
  modalId: "instructions-modal",
  bodyId: "instructions-body",
  docs,
  dir: ".",
  name: "Instructions"
});

export {createInstructions};
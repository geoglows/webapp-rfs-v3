import {dataProgress, t} from "../i18n/i18n";
import {resolve} from "../data/riverIndex";
import {locate} from "../data/riverLocation";

const $ = (id) => document.getElementById(id);

/**
 * Find a reach by typing its river ID.
 *
 * This is the one way into a reach that arrives without an index: map clicks read one off the tile
 * and saved rivers store their own, but a bare ID has to be resolved against the riverId axis. That
 * costs a one-time ~17 MB download on a device that hasn't got the lookup yet, which is this box's
 * job to take rather than an errand to send the user on — so Search always searches, and the status
 * line reports the download when there is one.
 *
 * onFound({riverId, riverIndex, lat, lon}) hands the resolved reach on — main.js points it at the
 * charts dock and the camera. Same shape a saved river has, so a found river is treated as one; the
 * coordinate is read from the metadata store once the index is known, and is the only part that may
 * be missing (the reach is still found, the map just stays where it is).
 */
function createRiverSearch({onFound}) {
  const modal = $("search-modal");
  const form = $("search-form");
  const input = $("search-river-id");
  const line = $("search-status");
  if (!modal || !form || !input || !line) return;

  let busy = false;
  let errored = false;

  /**
   * The status line carries everything this box has to say, so a rejection has to look different
   * from "Searching…" — same element, same dim hint styling otherwise, and a "no such river" that
   * reads as progress text is a message the user does not register.
   *
   * `error` is for answers the user has to act on: a malformed ID, an ID the network doesn't have.
   * A slow first search is not one — it is progress, and it says so in the same place.
   */
  function say(text, {error = false} = {}) {
    line.textContent = text;
    line.classList.toggle("error", error);
    input.setAttribute("aria-invalid", String(error));
    errored = error;
  }

  const close = () => modal.classList.add("hidden");

  function open() {
    modal.classList.remove("hidden");
    input.focus();
    input.select();
    say("");
  }

  async function search() {
    if (busy) return;
    const raw = input.value.trim();
    if (!/^\d+$/.test(raw)) {
      say(t("search.invalid"), {error: true});
      return;
    }
    busy = true;
    // The first search of a session pulls ~44 MB of typed arrays out of IndexedDB; later ones are a
    // binary search over memory. Only the first is slow enough to need saying, but saying it always
    // is simpler than deciding.
    say(t("search.searching"));
    try {
      // Downloads the lookup if this device hasn't got it — the status line turns into a progress
      // reading for as long as that takes, and the search finishes on the far side of it.
      const riverIndex = await resolve(raw, {onProgress: (p) => say(dataProgress(p))});
      if (riverIndex < 0) {
        say(t("search.notFound").replace("{id}", raw), {error: true});
        return;
      }
      // The reach is found either way; where it is on the map is a second, smaller read. Hand on the
      // same shape a saved river has, so the caller treats a found river exactly like a picked one.
      const at = await locate(riverIndex).catch((e) => {
        console.error(`could not locate river ${raw}: ${e.message}`);
        return null;
      });
      close();
      onFound?.({riverId: Number(raw), riverIndex, lat: at?.lat, lon: at?.lon});
    } catch (e) {
      say(`${t("search.failed")}: ${e.message}`, {error: true});
    } finally {
      busy = false;
    }
  }

  // A <form> rather than a click handler: Enter submits for free, which is how a search box is used.
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void search();
  });
  // A rejection of the last ID sitting under the one being typed now reads as a rejection of this
  // one. Only clears errors, so an in-flight download's progress isn't wiped by typing.
  input.addEventListener("input", () => {
    if (errored) say("");
  });
  $("btn-search-river")?.addEventListener("click", () => open());

  return {open, close};
}

export {createRiverSearch};

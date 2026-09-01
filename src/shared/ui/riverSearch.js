import {$, el} from "../dom.js";
import {dataProgress, t} from "../i18n/i18n";
import {resolve} from "../data/riverIndex";
import {load as loadNames, search as searchNames} from "../data/riverNames";
import {locate} from "../data/riverLocation";


// Long enough that a burst of typing is one search, short enough to feel like none. The search
// itself is a scan of a few hundred rows in memory, so this is about how often the list is rebuilt
// under the user's eyes, not about cost.
const TYPING_MS = 120;

/**
 * Find a reach by name, or by ID — two boxes, because they are two different questions. A name is
 * answered loosely from a ~100 kB table already on the device and can return a dozen rivers; an ID is
 * exact and has to be resolved against the riverId axis, a one-time ~17 MB download. Each half has
 * its own status line, because "no named river matches that" and "no river has that ID" are different
 * answers. Only the name box is worth typing into as you go.
 *
 * onFound({riverId, riverIndex, lat, lon}, {bbox, span}) hands the resolved reach on. The first
 * argument is the reach and nothing else, in the shape a saved river has, because the charts dock
 * renders its fields as attributes; the second is only sent for a name, where `bbox` frames the whole
 * river and `span` paints it. onClear() takes that highlight back off — it outlives the dialog, so
 * nothing else will notice the user is done with it.
 *
 * `locateOnPick` — a named river's row already carries what the explorer needs, so it reads no store
 * on a name pick; this page also wants the mouth's coordinate, to make a found river savable.
 * `requireLocationById` — this page goes without a location, since the charts only need the
 * riverIndex; the explorer cannot, because the same read is where its upstream count comes from.
 */
function createRiverSearch({onFound, onClear, locateOnPick = true, requireLocationById = false}) {
  const modal = $("search-modal");
  const nameForm = $("search-name-form");
  const nameInput = $("search-river-name");
  const nameLine = $("search-name-status");
  const idForm = $("search-id-form");
  const idInput = $("search-river-id");
  const idLine = $("search-id-status");
  const results = $("search-results");
  const clearBtn = $("search-clear");
  if (!modal || !nameForm || !nameInput || !nameLine || !idForm || !idInput || !idLine || !results) return;

  let busy = false;
  // Which lines are currently showing a rejection, so typing clears only the box's own.
  const errored = new Set();
  let typing = null;
  // The rows on screen now, so Enter can take the first one without reading them back out of the DOM.
  let shown = [];
  // Whether a river is currently painted on the map. The highlight deliberately outlives this
  // dialog — you close it to look at the river — so the only thing that knows it is still there is
  // this flag, and the Clear button is off until there is something to clear.
  let highlighted = false;

  /**
   * One status line per box, so a rejection has to look different from "Searching…" or it reads as
   * progress text and goes unregistered. `error` is for answers the user has to act on — a malformed
   * ID, an ID the network doesn't have — and a slow first search is not one.
   */
  function say(line, input, text, {error = false} = {}) {
    line.textContent = text;
    line.classList.toggle("error", error);
    input.setAttribute("aria-invalid", String(error));
    if (error) errored.add(line);
    else errored.delete(line);
  }

  const sayName = (text, opts) => say(nameLine, nameInput, text, opts);
  const sayId = (text, opts) => say(idLine, idInput, text, opts);

  const close = () => modal.classList.add("hidden");

  /** Take the highlighted river off the map and empty the box that put it there — a cleared map under
   * a box still reading "Severn" looks like the search failed. */
  function clearHighlight() {
    highlighted = false;
    nameInput.value = "";
    renderResults([]);
    sayName("");
    if (clearBtn) clearBtn.disabled = true;
    onClear?.();
  }

  function open() {
    modal.classList.remove("hidden");
    // The name box, not the ID box: it is the one most people want, and the one that costs nothing.
    nameInput.focus();
    nameInput.select();
    sayName("");
    sayId("");
    if (clearBtn) clearBtn.disabled = !highlighted;
    // The names are wanted the moment this box is opened, not when the app started: most sessions
    // never open it, and the table is small enough that fetching it on open is not a wait.
    void loadNames().then(() => {
      if (!modal.classList.contains("hidden")) runNameSearch();
    }).catch((e) => console.warn(`[names] the river names could not be loaded: ${e.message}`));
  }

  /**
   * Which river this one is — the table holds two Severns and three Verdes, so the name alone is not
   * an answer. Country, then what it flows into, then its system. The watershed is dropped when it
   * only repeats one of the others: "Severn · United Kingdom", not "… · Severn".
   */
  function describe(river) {
    const parts = [river.country, river.parentName && t("search.tributaryOf").replace("{name}", river.parentName)];
    if (river.watershed && river.watershed !== river.name && river.watershed !== river.parentName) {
      parts.push(river.watershed);
    }
    return parts.filter(Boolean).join(" · ");
  }

  /**
   * Go to a river the user picked out of the list. The row carries the mouth's riverIndex, so the
   * charts open with no lookup; the coordinate is read off the metadata store by index, as the ID path
   * does, because that is what makes a found river savable. A failure is survivable — the camera uses
   * the bounding box, not the point.
   */
  async function pick(river) {
    close();
    const at = locateOnPick
      ? await locate(river.riverIndex).catch((e) => {
        console.error(`could not locate ${river.name} (${river.riverId}): ${e.message}`);
        return null;
      })
      : null;
    // Two arguments, not one object: the charts dock renders every field of the first in its Details
    // tab, so anything that is not an attribute of the reach cannot travel in it. The upstream count
    // comes off the row — the span's length is the count, already in hand.
    onFound?.(
      {
        riverId: river.riverId,
        riverIndex: river.riverIndex,
        upstreamCount: river.hi - river.lo,
        lat: at?.lat,
        lon: at?.lon
      },
      {bbox: river.bbox, span: {lo: river.lo, hi: river.hi}, name: river.name}
    );
    highlighted = true;
    if (clearBtn) clearBtn.disabled = false;
  }

  function renderResults(rivers) {
    shown = rivers;
    results.replaceChildren(...rivers.map((river) => {
      const row = el("button", {class: "search-hit"});
      row.type = "button";
      row.append(el("b", {text: river.name}), el("span", {class: "hint", text: describe(river)}));
      row.addEventListener("click", () => void pick(river));
      return row;
    }));
    results.classList.toggle("hidden", !rivers.length);
    nameInput.setAttribute("aria-expanded", String(rivers.length > 0));
  }

  /** Names, on every keystroke. Silent about an empty box; explicit about a query that found nothing. */
  function runNameSearch() {
    const raw = nameInput.value.trim();
    if (!raw) {
      renderResults([]);
      sayName("");
      return;
    }
    const hits = searchNames(raw);
    renderResults(hits);
    if (!hits.length) sayName(t("search.noName").replace("{name}", raw), {error: true});
    else sayName("");
  }

  /** IDs, on submit, because this is the half that may have to download 17 MB first. */
  async function searchById(raw) {
    if (busy) return;
    if (!/^\d+$/.test(raw)) {
      sayId(t("search.invalid"), {error: true});
      return;
    }
    busy = true;
    // The first search of a session pulls ~44 MB of typed arrays out of IndexedDB; later ones are a
    // binary search over memory. Only the first is slow enough to need saying, but saying it always
    // is simpler than deciding.
    sayId(t("search.searching"));
    try {
      // Downloads the lookup if this device hasn't got it — the status line turns into a progress
      // reading for as long as that takes, and the search finishes on the far side of it.
      const riverIndex = await resolve(raw, {onProgress: (p) => sayId(dataProgress(p))});
      if (riverIndex < 0) {
        sayId(t("search.notFound").replace("{id}", raw), {error: true});
        return;
      }
      // The reach is found either way; where it is on the map is a second, smaller read. Hand on the
      // same shape a saved river has, so the caller treats a found river exactly like a picked one.
      const at = await locate(riverIndex).catch((e) => {
        console.error(`could not locate river ${raw}: ${e.message}`);
        return null;
      });
      if (!at && requireLocationById) {
        sayId(t("search.unlocatable"), {error: true});
        return;
      }
      close();
      onFound?.({
        riverId: Number(raw), riverIndex, upstreamCount: at?.upstreamCount, lat: at?.lat, lon: at?.lon
      });
    } catch (e) {
      sayId(`${t("search.failed")}: ${e.message}`, {error: true});
    } finally {
      busy = false;
    }
  }

  // Forms rather than click handlers: Enter submits for free, which is how a search box is used, and
  // Enter in one box cannot submit the other.
  nameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = nameInput.value.trim();
    // Enter takes the top row, which is the one the ranking put there. Typing a name and pressing
    // Enter is how this box is used when the answer is obvious, and reaching for the mouse to
    // confirm a single result is not.
    if (shown.length) return void pick(shown[0]);
    if (raw) sayName(t("search.noName").replace("{name}", raw), {error: true});
  });

  idForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void searchById(idInput.value.trim());
  });

  nameInput.addEventListener("input", () => {
    // A rejection of the last thing typed, sitting under the thing being typed now, reads as a
    // rejection of this one.
    if (errored.has(nameLine)) sayName("");
    clearTimeout(typing);
    typing = setTimeout(runNameSearch, TYPING_MS);
  });

  // Only clears errors, so an in-flight download's progress isn't wiped by typing beside it.
  idInput.addEventListener("input", () => {
    if (errored.has(idLine)) sayId("");
  });

  clearBtn?.addEventListener("click", () => clearHighlight());

  // Either id: the data viewer's header calls it "search a river", the hydrography page's just
  // "search". Both are the same dialog and neither markup is worth churning to agree.
  ($("btn-search-river") ?? $("btn-search"))?.addEventListener("click", () => open());

  return {open, close};
}

export {createRiverSearch};

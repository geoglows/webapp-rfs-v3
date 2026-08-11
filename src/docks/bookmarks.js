import {t} from "../i18n/i18n.js";
import {listSavedRivers, onSavedRiversChange, removeSavedRiver} from "../data/savedRivers.js";
import {closeDock, isDockOpen, openDock} from "./dock.js";

// todo the bookmarks should be databased.
// todo the defaults should be a json fetched async only on first load.
// todo bookmarks code needs a get/set interface to the db table
const defaultBookmarks = [
  {riverId: 760021611, riverIndex: 5192926, lat: 29.0929, lon: -89.2522, name: "Mississippi, USA"},
  {riverId: 160064246, riverIndex: 1138142, lat: 31.4749, lon: 30.3599, name: "Nile, East Africa"},
  {riverId: 710431167, riverIndex: 4725888, lat: 31.7776, lon: -114.7304, name: "Colorado, Mexico"},
  {riverId: 441057380, riverIndex: 3074511, lat: 23.1933, lon: 90.6048, name: "Ganges, India"},
  {riverId: 430157411, riverIndex: 2862943, lat: 10.1946, lon: 106.7421, name: "Mekong, Vietnam"},
  {riverId: 210393186, riverIndex: 1320246, lat: 41.7370, lon: 12.2307, name: "Tiber, Italy"},
  {riverId: 621010293, riverIndex: 4239728, lat: -0.4756, lon: -51.4222, name: "Amazon, Brazil"},
  {riverId: 130747391, riverIndex: 539910, lat: -6.0567, lon: 12.3688, name: "Congo, D.R. Congo"},
  {riverId: 640255644, riverIndex: 4485280, lat: -33.8890, lon: -58.4528, name: "Parana, Argentina"},
  {riverId: 540514417, riverIndex: 3841659, lat: -35.3793, lon: 139.3540, name: "Murray, Australia"},
  {riverId: 441077984, riverIndex: 3074481, lat: 24.0103, lon: 67.4701, name: "Indus, India"},
  {riverId: 280302448, riverIndex: 1761448, lat: 46.5486, lon: 49.4263, name: "Volga, Russia"},
  {riverId: 220463113, riverIndex: 1445605, lat: 45.1646, lon: 29.7219, name: "Danube, Romania"},
  {riverId: 230452055, riverIndex: 1515260, lat: 49.4346, lon: 0.2895, name: "Seine, France"},
  {riverId: 410641150, riverIndex: 2565012, lat: 53.1083, lon: 140.6268, name: "Amur, China/Russia"},
  {riverId: 140049491, riverIndex: 710249, lat: 4.3350, lon: 6.0729, name: "Niger, Nigeria"}
]

const degrees = (d) => (d == null ? "" : d.toFixed(4));
// A saved river need not have been given a name, and one saved before its coordinate could be read
// has no lat/lon either. Both are shown as blank cells rather than as "null" or a dropped row.
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

/**
 * The rivers table both docks show: id · name · coordinate · the button that flies to it.
 *
 * `removable` adds the second action, which is the only difference between the read-only default
 * list and the user's own — the two are meant to read as the same list, and sharing the renderer is
 * what keeps them that way as either one changes.
 */
function riverTable(rows, {removable = false} = {}) {
  const cells = rows.map(({riverId, name, lat, lon}) => `
      <tr>
        <td class="k">${riverId}</td>
        <td class="v">${escapeHtml(name ?? "")}</td>
        <td class="n">${degrees(lat)}</td>
        <td class="n">${degrees(lon)}</td>
        <td class="a">
          <button class="btn auto" data-select-river="${riverId}">${t("bookmarks.select")}</button>
          ${removable ? `<button class="btn auto danger" data-remove-river="${riverId}">${t("saved.remove")}</button>` : ""}
        </td>
      </tr>`).join("");
  return `
      <table class="table">
        <thead>
          <tr>
            <td>${t("bookmarks.col.id")}</td>
            <td>${t("bookmarks.col.name")}</td>
            <td>${t("bookmarks.col.lat")}</td>
            <td>${t("bookmarks.col.lon")}</td>
            <td>${t("bookmarks.col.actions")}</td>
          </tr>
        </thead>
        <tbody>${cells}</tbody>
      </table>`;
}

/** The read-only list of notable rivers the app ships with. */
function createBookmarksDock({map, onSelectRiver}) {
  const body = document.getElementById("bookmarks-body");
  const button = document.getElementById("btn-bookmarks");
  const exit = document.getElementById("bookmarks-close");

  const render = () => (body.innerHTML = riverTable(defaultBookmarks));

  function open() {
    render();
    openDock(map, "bookmarks");
  }

  const close = () => closeDock(map, "bookmarks");

  // Delegated so the rows can be re-rendered freely without rewiring anything.
  body?.addEventListener("click", (e) => {
    const id = e.target?.dataset?.selectRiver;
    if (!id) return;
    const entry = defaultBookmarks.find((b) => String(b.riverId) === id);
    if (entry) onSelectRiver(entry);
  });
  button?.addEventListener("click", () => (isDockOpen("bookmarks") ? close() : open()));
  exit?.addEventListener("click", close);

  return {open, close};
}

/**
 * The rivers the user saved themselves — the same table as the defaults, plus the ability to drop a
 * row, and empty until somebody hearts a river.
 *
 * Kept live rather than rendered once: hearting or un-hearting a river from the charts dock changes
 * this list while it may be on screen, so it re-renders on every change to it instead of only when
 * it is opened.
 */
function createSavedRiversDock({map, onSelectRiver}) {
  const body = document.getElementById("saved-body");
  const button = document.getElementById("btn-saved");
  const exit = document.getElementById("saved-close");

  function render() {
    const rows = listSavedRivers();
    body.innerHTML = rows.length
      ? riverTable(rows, {removable: true})
      : `<div class="hint">${t("saved.empty")}</div>`;
  }

  function open() {
    render();
    openDock(map, "saved");
  }

  const close = () => closeDock(map, "saved");

  body?.addEventListener("click", (e) => {
    const remove = e.target?.dataset?.removeRiver;
    if (remove) {
      // The re-render is the change watcher's job, not this handler's — un-hearting the same river
      // from the charts dock has to repaint this list too, so there is one path for both.
      removeSavedRiver(Number(remove));
      return;
    }
    const id = e.target?.dataset?.selectRiver;
    if (!id) return;
    const entry = listSavedRivers().find((b) => String(b.riverId) === id);
    if (entry) onSelectRiver(entry);
  });
  button?.addEventListener("click", () => (isDockOpen("saved") ? close() : open()));
  exit?.addEventListener("click", close);

  // Only worth the DOM work while it is the dock on screen; opening it renders anyway.
  onSavedRiversChange(() => {
    if (isDockOpen("saved")) render();
  });

  return {open, close};
}

export {createBookmarksDock, createSavedRiversDock};

import {t} from "../../../shared/i18n/i18n.js";
import {heroIcon} from "../../../shared/icons/icons.js";
import {travelToRiver} from "../map/framing.js";
import {listSavedRivers, onSavedRiversChange, removeSavedRiver} from "../savedRivers.js";
import {closeDock, isDockOpen, openDock} from "./dock.js";

// todo the defaults should be a json fetched async only on first load.
// No riverIndex here on purpose: a position on the zarr axis is only good for the publication of
// the store it was read from, and the axis is reordered when the data is regenerated. The charts
// dock resolves the id through the lookup instead, which is kept in step with the store.
const defaultBookmarks = [
  {riverId: 760021611, lat: 29.0929, lon: -89.2522, name: "Mississippi, USA"},
  {riverId: 160064246, lat: 31.4749, lon: 30.3599, name: "Nile, East Africa"},
  {riverId: 710431167, lat: 31.7776, lon: -114.7304, name: "Colorado, Mexico"},
  {riverId: 441057380, lat: 23.1933, lon: 90.6048, name: "Ganges, India"},
  {riverId: 430157411, lat: 10.1946, lon: 106.7421, name: "Mekong, Vietnam"},
  {riverId: 210393186, lat: 41.7370, lon: 12.2307, name: "Tiber, Italy"},
  {riverId: 621010293, lat: -0.4756, lon: -51.4222, name: "Amazon, Brazil"},
  {riverId: 130747391, lat: -6.0567, lon: 12.3688, name: "Congo, D.R. Congo"},
  {riverId: 640255644, lat: -33.8890, lon: -58.4528, name: "Parana, Argentina"},
  {riverId: 540514417, lat: -35.3793, lon: 139.3540, name: "Murray, Australia"},
  {riverId: 441077984, lat: 24.0103, lon: 67.4701, name: "Indus, India"},
  {riverId: 280302448, lat: 46.5486, lon: 49.4263, name: "Volga, Russia"},
  {riverId: 220463113, lat: 45.1646, lon: 29.7219, name: "Danube, Romania"},
  {riverId: 230452055, lat: 49.4346, lon: 0.2895, name: "Seine, France"},
  {riverId: 410641150, lat: 53.1083, lon: 140.6268, name: "Amur, China/Russia"},
  {riverId: 140049491, lat: 4.3350, lon: 6.0729, name: "Niger, Nigeria"}
]

const degrees = (d) => (d == null ? "" : d.toFixed(4));
// A saved river need not have been given a name, and one saved before its coordinate could be read
// has no lat/lon either. Both are shown as blank cells rather than as "null" or a dropped row.
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

/** An icon button for a row: its action and the river it acts on ride in data attributes. */
const rowAction = (action, riverId, icon, titleKey, className = "") =>
  `<button class="btn sm ${className}" data-action="${action}" data-river="${riverId}" title="${t(titleKey)}" aria-label="${t(titleKey)}">${heroIcon(icon).outerHTML}</button>`;

/**
 * The rivers table both docks show: id · name · coordinate · the actions on it — open its charts,
 * fly the map to it, and (for the user's own list) drop it.
 *
 * `removable` adds the third action, which is the only difference between the read-only default
 * list and the user's own — the two are meant to read as the same list, and sharing the renderer is
 * what keeps them that way as either one changes.
 */
function riverTable(rows, {removable = false, sort = null} = {}) {
  // A sortable column's header is a button; the one in effect carries its direction as an arrow.
  const head = (key, labelKey) => {
    if (!sort) return `<td>${t(labelKey)}</td>`;
    const active = sort.key === key;
    const arrow = active ? (sort.asc ? " ↑" : " ↓") : "";
    return `<td aria-sort="${active ? (sort.asc ? "ascending" : "descending") : "none"}"><button class="sort${active ? " active" : ""}" data-sort="${key}" title="${t("saved.sort")}">${t(labelKey)}${arrow}</button></td>`;
  };
  const cells = rows.map(({riverId, name, lat, lon}) => `
      <tr>
        <td class="k">${riverId}</td>
        <td class="v">${escapeHtml(name ?? "")}</td>
        <td class="n">${degrees(lat)}</td>
        <td class="n">${degrees(lon)}</td>
        <td class="a">
          ${rowAction("charts", riverId, "chart-bar-solid", "bookmarks.charts")}
          ${rowAction("locate", riverId, "map-pin", "bookmarks.locate")}
          ${removable ? rowAction("remove", riverId, "trash", "saved.remove", "danger") : ""}
        </td>
      </tr>`).join("");
  return `
      <table class="table rivers">
        <thead>
          <tr>
            ${head("riverId", "bookmarks.col.id")}
            ${head("name", "bookmarks.col.name")}
            <td>${t("bookmarks.col.lat")}</td>
            <td>${t("bookmarks.col.lon")}</td>
            <td></td>
          </tr>
        </thead>
        <tbody>${cells}</tbody>
      </table>`;
}

/**
 * What a click in either table means: which action, on which of the rows. The click may land on
 * the icon inside the button rather than the button itself, hence the walk up.
 */
function rowClick(e, rows) {
  const btn = e.target?.closest?.("[data-action][data-river]");
  if (!btn) return null;
  const entry = rows.find((b) => String(b.riverId) === btn.dataset.river);
  return entry ? {action: btn.dataset.action, entry} : null;
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
    const hit = rowClick(e, defaultBookmarks);
    if (hit?.action === "charts") onSelectRiver(hit.entry);
    else if (hit?.action === "locate") travelToRiver(map, hit.entry);
  });
  button?.addEventListener("click", () => (isDockOpen("bookmarks") ? close() : open()));
  exit?.addEventListener("click", close);

  return {open, close};
}

/** The saved list in the order asked for: by id numerically, or by name alphabetically (ignoring case). */
function sortRivers(rows, {key, asc}) {
  const cmp = key === "name"
    ? (a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, {sensitivity: "base"}) || a.riverId - b.riverId
    : (a, b) => a.riverId - b.riverId;
  return rows.sort((a, b) => (asc ? cmp(a, b) : cmp(b, a)));
}

/**
 * The rivers the user saved themselves — the same table as the defaults, plus the ability to drop a
 * row and to sort by id or name, and empty until somebody hearts a river.
 *
 * Kept live rather than rendered once: hearting or un-hearting a river from the charts dock changes
 * this list while it may be on screen, so it re-renders on every change to it instead of only when
 * it is opened.
 */
function createSavedRiversDock({map, onSelectRiver}) {
  const body = document.getElementById("saved-body");
  const button = document.getElementById("btn-saved");
  const exit = document.getElementById("saved-close");

  // Ascending by id to begin with; clicking a header sorts by it, clicking it again flips it.
  let sort = {key: "riverId", asc: true};

  function render() {
    const rows = sortRivers(listSavedRivers(), sort);
    body.innerHTML = rows.length
      ? riverTable(rows, {removable: true, sort})
      : `<div class="hint">${t("saved.empty")}</div>`;
  }

  function open() {
    render();
    openDock(map, "saved");
  }

  const close = () => closeDock(map, "saved");

  body?.addEventListener("click", (e) => {
    const header = e.target?.closest?.("[data-sort]");
    if (header) {
      const key = header.dataset.sort;
      sort = {key, asc: sort.key === key ? !sort.asc : true};
      render();
      return;
    }
    const hit = rowClick(e, listSavedRivers());
    if (!hit) return;
    // The re-render after a removal is the change watcher's job, not this handler's — un-hearting
    // the same river from the charts dock has to repaint this list too, so there is one path for both.
    if (hit.action === "remove") removeSavedRiver(hit.entry.riverId);
    else if (hit.action === "charts") onSelectRiver(hit.entry);
    else if (hit.action === "locate") travelToRiver(map, hit.entry);
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

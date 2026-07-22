import {t} from "../i18n/i18n";
import {DEFAULT_BOOKMARKS} from "../constants";
import {closeDock, isDockOpen, openDock} from "./dock";

const $ = (id) => document.getElementById(id);

/**
 * The saved rivers dock: a small table of bookmarked reaches (id · name · a button that jumps
 * straight to that reach's charts) that opens in the same slot as the charts dock, beneath the
 * hydrology controls.
 *
 * onSelectRiver({riverId, riverIndex, lat, lon, name}) is what the row buttons do — main.js points
 * it at the charts dock and at the camera. The bookmark carries the reach's riverIndex so the
 * readers can go straight at the data without resolving the id first, and its coordinate so the map
 * can fly there rather than leaving the user to find the river they just asked to see.
 */
function createBookmarksDock({map, onSelectRiver}) {
  // The list is fixed for now; rendering on every open keeps it in the current language without a
  // separate relocalization path, and 16 rows is nothing.
  const bookmarks = DEFAULT_BOOKMARKS;

  // Four decimals is ~11 m — finer than the reach the number stands for, and any coarser rounds two
  // neighbouring outlets onto the same point.
  const degrees = (d) => (d == null ? "" : d.toFixed(4));

  function render() {
    const rows = bookmarks.map(({riverId, name, lat, lon}) => `
      <tr>
        <td class="k">${riverId}</td>
        <td class="v">${name}</td>
        <td class="n">${degrees(lat)}</td>
        <td class="n">${degrees(lon)}</td>
        <td class="a"><button class="btn ghost row-btn" data-river-id="${riverId}">${t("bookmarks.select")}</button></td>
      </tr>`).join("");
    $("bookmarks-body").innerHTML = `
      <p class="hint">${t("bookmarks.hint")}</p>
      <table class="attr-table bookmarks-table">
        <thead>
          <tr>
            <td>${t("bookmarks.col.id")}</td>
            <td>${t("bookmarks.col.name")}</td>
            <td>${t("bookmarks.col.lat")}</td>
            <td>${t("bookmarks.col.lon")}</td>
            <td>${t("bookmarks.col.actions")}</td>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function open() {
    render();
    openDock(map, "bookmarks");
  }

  const close = () => closeDock(map, "bookmarks");

  // Delegated so the rows can be re-rendered freely without rewiring anything.
  $("bookmarks-body")?.addEventListener("click", (e) => {
    const id = e.target?.dataset?.riverId;
    if (!id) return;
    const entry = bookmarks.find((b) => String(b.riverId) === id);
    if (entry) onSelectRiver(entry);
  });
  $("btn-bookmarks")?.addEventListener("click", () => (isDockOpen("bookmarks") ? close() : open()));
  $("bookmarks-close")?.addEventListener("click", close);

  return {open, close};
}

export {createBookmarksDock};
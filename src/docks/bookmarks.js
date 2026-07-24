import {t} from "../i18n/i18n.js";
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

function createBookmarksDock({map, onSelectRiver}) {
  const degrees = (d) => (d == null ? "" : d.toFixed(4))

  const body = document.getElementById("bookmarks-body")
  const button = document.getElementById("btn-bookmarks")
  const exit = document.getElementById("bookmarks-close")

  function render() {
    const rows = defaultBookmarks.map(({riverId, name, lat, lon}) => `
      <tr>
        <td class="k">${riverId}</td>
        <td class="v">${name}</td>
        <td class="n">${degrees(lat)}</td>
        <td class="n">${degrees(lon)}</td>
        <td class="a"><button class="btn ghost row-btn" data-river-id="${riverId}">${t("bookmarks.select")}</button></td>
      </tr>`).join("");
    body.innerHTML = `
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
  body?.addEventListener("click", (e) => {
    const id = e.target?.dataset?.riverId;
    if (!id) return;
    const entry = defaultBookmarks.find((b) => String(b.riverId) === id);
    if (entry) onSelectRiver(entry);
  });
  button?.addEventListener("click", () => (isDockOpen("bookmarks") ? close() : open()));
  exit?.addEventListener("click", close);

  return {open, close};
}

export {createBookmarksDock};

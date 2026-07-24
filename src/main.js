import "./settings/rfsConfig.js"
import {applyTheme, DEFAULT_THEME, initLanguagePicker, initSettings, onSetting} from "./settings/settings.js";

import {map} from "./map/map";
import {applyBasemap, defaultBasemap} from "./map/basemaps";
import {addRasterOverlays, applyLayerVisibility} from "./map/layers";
import {StreamAnimation} from "./map/streams/animation";
import {addInspectHighlightLayer} from "./map/inspectHighlight";
import {createFloodController} from "./map/flood-maps/floodController";
import {build, status} from "./data/riverIndex";
import {hydrateIcons} from "./icons/icons";
import {createChartsDock} from "./ui/chartsDock";
import {createBookmarksDock} from "./ui/bookmarksDock";
import {closeAllDocks} from "./ui/dock";
import {createPanelControls} from "./ui/panelControls";
import {createDataSettings} from "./ui/dataSettings";
import {createRiverSearch} from "./ui/riverSearch";

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════
// Shared state · read by more than one feature, so it lives here
// ═══════════════════════════════════════════════════════════════════════════
function newestForecastExpected() {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 12);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

let currentForecastDate = "2026-07-10" // newestForecastExpected();;
let mapLoaded = false;

// ═══════════════════════════════════════════════════════════════════════════
// Features
// ═══════════════════════════════════════════════════════════════════════════
const anim = new StreamAnimation(map);

const flood = createFloodController({
  map,
  anim,
  getForecastDate: () => currentForecastDate,
  isMapLoaded: () => mapLoaded
});

const chartsDock = createChartsDock({map, getForecastDate: () => currentForecastDate});

function goToRiver(river) {
  if (river.lat != null && river.lon != null) {
    map.flyTo({center: [river.lon, river.lat], zoom: Math.max(map.getZoom(), 10)});
  }
  chartsDock.openForRiver(river);
}

// A saved river arrives whole: id, position on the zarr riverId axis, and outlet coordinate.
createBookmarksDock({map, onSelectRiver: goToRiver});

// The Settings data list. Constructed here rather than with the rest of the modal chrome because
// the background prefetch below has to be able to tell it to re-read — a download the panel didn't
// start still belongs on its row.
const dataSettings = createDataSettings();

const panelControls = createPanelControls({
  anim,
  onForecastDateChange: (date) => {
    currentForecastDate = date;
    flood.onForecastDateChange();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Background work · started once the app is up, never waited on
// ═══════════════════════════════════════════════════════════════════════════
// After the browser has finished with the frame that got the app on screen. The timeout is the
// point: an app being interacted with may never go idle, and this work would rather start late than
// never. Falls back to a plain delay for browsers without the callback.
const whenIdle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, {timeout: 10_000}) : setTimeout(fn, 3_000));

/**
 * Fill the river ID lookup in the background, so searching by ID is instant the first time somebody
 * tries it rather than a 17 MB wait at the moment they ask.
 *
 * Everything about it is already built for this: the build runs in its own worker, is cached on the
 * device once it lands, and coalesces — so the search box or the Settings row asking for it
 * mid-flight joins this one instead of starting a second. Nothing here is on any critical path;
 * failing is the same as not having run.
 */
async function prefetchRiverIndex() {
  if (await status().catch(() => null)) return;
  try {
    const built = build();
    // Started, so the Settings row can find it: refresh() joins a download in flight and takes over
    // reporting it, which covers the case of the modal already being open when this begins. If it
    // is opened later, its own refresh does the same. Either way the row shows this build's
    // progress, because the worker's messages fan out to every watcher rather than to one caller.
    void dataSettings?.refresh();
    const {n} = await built;
    console.log(`River ID lookup ready in the background: ${n.toLocaleString()} rivers.`);
  } catch (e) {
    console.warn(`River ID lookup prefetch did not finish: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Map lifecycle · app layers, click handling, and load wiring
// ═══════════════════════════════════════════════════════════════════════════
map.on("load", async () => {
  anim.addStreamsLayer();
  applyLayerVisibility(map, "streams");
  addRasterOverlays(map);
  addInspectHighlightLayer(map);
  flood.onMapLoad();
  // Slot the default basemap in beneath the app layers just added. Not awaited so the (async,
  // fetched) vector style doesn't hold up the rest of load; it inserts under everything when ready.
  void applyBasemap(map, defaultBasemap());
  console.log("Basemap + streams loaded.");
  mapLoaded = true;
  map.on("click", (e) => {
    const pad = 10;
    const box = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad]
    ];
    const feats = map.queryRenderedFeatures(box, {layers: ["streams"]});
    const hit = feats.find((f) => f.properties?.riverId != null);
    if (hit) {
      // Clicking a reach while zoomed out fluidly zooms in to it so the stream fills the view.
      if (map.getZoom() < 10) map.easeTo({center: e.lngLat, zoom: 10});
      if (flood.isMappingMode()) flood.selectReach(Number(hit.properties.riverId));
      else chartsDock.openForRiver(hit.properties);
      return;
    }
    if (flood.isMappingMode()) flood.queryDepth(e.lngLat);
  });
  map.on("mouseenter", "streams", () => map.getCanvas().style.cursor = "pointer")
  map.on("mouseleave", "streams", () => map.getCanvas().style.cursor = "");
  panelControls.initForecastDatePicker({defaultDate: currentForecastDate});
  void anim.setDate(currentForecastDate);
  whenIdle(prefetchRiverIndex);
});
// MapLibre flattens every failure into a generic `error` event, so a bad tile fetch arrives as
// nothing but "Bad response code: 404". The source id and url live on the event, not the message —
// log them too, otherwise the console says something went wrong without saying what.
map.on("error", (e) => {
  if (!e?.error) return;
  const where = e.sourceId ? ` [${e.sourceId}]` : "";
  console.error(`map${where}: ${e.error.message}`, e.error.url ?? "");
});

// ═══════════════════════════════════════════════════════════════════════════
hydrateIcons()
initSettings();
onSetting("legend", (on) => $("legend-overlay").classList.toggle("hidden", !on));
onSetting("shadedWarningLevels", () => chartsDock.rerenderCharts());
initLanguagePicker(() => {
  panelControls.updateSliderVisibility();
  chartsDock.rerenderCharts();
});

// What this device last chose, or the deployment's configured default for one that never has. A
// stored value that is neither theme is treated as never having chosen.
const storedTheme = localStorage.getItem("rfs-theme");
let currentTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : DEFAULT_THEME;
applyTheme(currentTheme);
$("btn-theme").addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem("rfs-theme", currentTheme);
  applyTheme(currentTheme);
  // Charts bake their axis/text/grid colors at construction, so any on screen need repainting.
  chartsDock.restyleCharts();
});

const openModal = (id) => $(id).classList.remove("hidden");
const closeModal = (id) => $(id).classList.add("hidden");

// A searched river arrives resolved to the same three things a saved one carries — id, index, and
// where it is — so it is gone to the same way.
createRiverSearch({onFound: goToRiver});

$("btn-info").addEventListener("click", () => openModal("info-modal"));
$("btn-settings").addEventListener("click", () => openModal("settings-modal"));
document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => closeModal(el.dataset.close)));
for (const id of ["info-modal", "settings-modal", "search-modal"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target === $(id)) closeModal(id);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
  closeAllDocks(map);
});

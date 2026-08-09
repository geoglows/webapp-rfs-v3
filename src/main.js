import "./settings/rfsConfig.js"
import {applyTheme, DEFAULT_THEME, initLanguagePicker, initSettings, onSetting} from "./settings/settings.js";

import {map} from "./map/map";
import {applyBasemap, defaultBasemap} from "./map/basemaps";
import {addRasterLayer, applyStreamsVisibility} from "./map/layers";
import {Streams} from "./map/Streams.js";
import {createFloodController} from "./map/flood-maps/floodController";
import {build, status} from "./data/riverIndex";
import {hydrateIcons} from "./icons/icons";
import {createChartsDock} from "./docks/charts.js";
import {createBookmarksDock, createSavedRiversDock} from "./docks/bookmarks.js";
import {onSavedRiversChange, savedRiverIds} from "./data/savedRivers.js";
import {closeAllDocks} from "./docks/dock.js";
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
const streams = new Streams(map);

const flood = createFloodController({
  map,
  streams,
  getForecastDate: () => currentForecastDate,
  isMapLoaded: () => mapLoaded
});

const chartsDock = createChartsDock({map, streams, getForecastDate: () => currentForecastDate});

function goToRiver(river) {
  if (river.lat != null && river.lon != null) {
    map.flyTo({center: [river.lon, river.lat], zoom: Math.max(map.getZoom(), 10)});
  }
  chartsDock.openForRiver(river, river);
}

// A saved river arrives whole: id, position on the zarr riverId axis, and outlet coordinate. The
// two lists are the same table over different rows — the app's defaults, and the user's own.
createBookmarksDock({map, onSelectRiver: goToRiver});
createSavedRiversDock({map, onSelectRiver: goToRiver});

// The pink outline on saved reaches. Set now for what was saved in an earlier session and again on
// every change; the map re-applies it as tiles arrive, so nothing here waits for the map to load.
streams.setSavedRivers(savedRiverIds());
onSavedRiversChange((saved) => streams.setSavedRivers(saved.map((e) => e.riverId)));

// The Settings data list. Constructed here rather than with the rest of the modal chrome because
// the background prefetch below has to be able to tell it to re-read — a download the panel didn't
// start still belongs on its row.
const dataSettings = createDataSettings();

const panelControls = createPanelControls({
  streams,
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
  streams.addStreamsLayer();
  applyStreamsVisibility(map);
  addRasterLayer(map);
  flood.onMapLoad();
  void applyBasemap(map, defaultBasemap());  // Allow the basemaps to continue to load async
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
      if (flood.isMappingMode()) {
        // In mapping mode the click is a reach selection, not a navigation — leave the view alone.
        flood.selectReach(Number(hit.properties.riverId));
        return;
      }
      // Clicking a reach while zoomed out fluidly zooms in to it so the stream fills the view.
      if (map.getZoom() < 10) map.easeTo({center: e.lngLat, zoom: 10});
      // The click point comes along as the reach's location: saving it from here then costs no
      // lookup at all, since the tile already carried the index and this is where it is.
      chartsDock.openForRiver(hit.properties, {lat: e.lngLat.lat, lon: e.lngLat.lng});
      return;
    }
    if (flood.isMappingMode()) flood.queryDepth(e.lngLat);
  });
  map.on("mouseenter", "streams", () => map.getCanvas().style.cursor = "pointer")
  map.on("mouseleave", "streams", () => map.getCanvas().style.cursor = "");
  panelControls.initForecastDatePicker({defaultDate: currentForecastDate});
  void streams.setDate(currentForecastDate);
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
// Fires now, before the map has loaded, so Streams holds the answer and builds the layer with it.
onSetting("savedHighlight", (on) => streams.setSavedHighlightVisible(on));
// The text that walking [data-i18n] cannot reach: the slider button, whose label depends on its
// state, and the charts, whose axis titles are drawn into a canvas.
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

$("btn-settings").addEventListener("click", () => openModal("settings-modal"));
$("btn-info").addEventListener("click", () => openModal("info-modal"));
$("btn-instructions").addEventListener("click", () => openModal("instructions-modal"));
document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => closeModal(el.dataset.close)));
for (const id of ["info-modal", "instructions-modal", "settings-modal", "search-modal"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target === $(id)) closeModal(id);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".backdrop").forEach((m) => m.classList.add("hidden"));
  closeAllDocks(map);
});

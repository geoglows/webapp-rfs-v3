// Importing map.js stands the map up: it constructs the MapLibre instance on #map, registers the
// pmtiles protocol, and wires the basemap + layer pickers. This module is the composition root —
// it owns the app-wide state that several features share (the forecast date, the theme) and wires
// the feature modules together. The features themselves live in:
//   map/fim/floodController.js  flood worker, reach selection, discharge styles, GeoTIFF export
//   ui/chartsDock.js            the inspected reach and its tabbed chart panels
//   ui/panelControls.js         language, forecast date, stream styleset, player visibility
// FIRST: tells the rfsjs package where this app's data lives. The package ships with
// blank locations while the data layout is being finalized, so it reads nothing until this runs.
// Must stay the first import — see the note in that file about import hoisting.
import "./rfsConfig";
import {map} from "./map/map";
import {applyBasemap, BASEMAPS} from "./map/basemaps";
import {addRasterOverlays, applyLayerVisibility} from "./map/layers";
import {StreamAnimation} from "./map/streams/animation";
import {addInspectHighlightLayer} from "./map/inspectHighlight";
import {createFloodController} from "./map/fim/floodController";
import {DEFAULT_FORECAST_DATE} from "./constants";
import {heroIcon} from "./icons/heroicons";
import {createChartsDock} from "./ui/chartsDock";
import {createPanelControls} from "./ui/panelControls";

const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════
// Shared state · read by more than one feature, so it lives here
// ═══════════════════════════════════════════════════════════════════════════
let currentForecastDate = DEFAULT_FORECAST_DATE;
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

const panelControls = createPanelControls({
  anim,
  onForecastDateChange: (date) => {
    currentForecastDate = date;
    flood.onForecastDateChange();
  },
  onLanguageChange: () => chartsDock.relocalizeCharts()
});

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
  applyBasemap(map, BASEMAPS[0]);
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
  map.on("mouseenter", "streams", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "streams", () => {
    map.getCanvas().style.cursor = "";
  });
  panelControls.initForecastDatePicker();
  anim.setDate(DEFAULT_FORECAST_DATE);
});
map.on("error", (e) => {
  if (e?.error) console.error(`map: ${e.error.message}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Chrome · icons, theme, and modals
// ═══════════════════════════════════════════════════════════════════════════
$("btn-info").replaceChildren(heroIcon("information-circle"));
$("btn-settings").replaceChildren(heroIcon("cog-6-tooth"));
$("btn-language").replaceChildren(heroIcon("language"));
$("btn-search-river").replaceChildren(heroIcon("magnifying-glass-solid"));
$("btn-charts").replaceChildren(heroIcon("chart-bar-solid"));
$("btn-bookmarks").replaceChildren(heroIcon("bookmark-solid"));
$("btn-toggle-slider").replaceChildren(heroIcon("clock-solid"));

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("btn-theme").replaceChildren(heroIcon(theme === "dark" ? "sun" : "moon"));
}

let currentTheme = localStorage.getItem("rfs-theme") === "light" ? "light" : "dark";
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
$("btn-info").addEventListener("click", () => openModal("info-modal"));
$("btn-settings").addEventListener("click", () => openModal("settings-modal"));
document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => closeModal(el.dataset.close)));
for (const id of ["info-modal", "settings-modal"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target === $(id)) closeModal(id);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
  chartsDock.close();
});

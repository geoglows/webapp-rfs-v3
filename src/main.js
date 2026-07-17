import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { StreamAnimation } from "./map/streams/animation";
import { Selection } from "./map/fim/selection";
import { flowsAtLadderPosition, uniformFlows } from "./map/fim/hydro";
import { legendGradient } from "./map/fim/colormap";
import { encodeExtentGeoTiff } from "./map/fim/geotiff";
import { calciteIcon } from "./icons/icons";
import { heroIcon } from "./icons/heroicons";
import { setLanguage, t } from "./i18n/i18n";
const DATA_BASE = import.meta.env.VITE_DATA_URL ?? `${location.origin}/data`;
const FIM_DATA_URL = import.meta.env.VITE_FIM_DATA_URL ?? `${DATA_BASE}/fim`;
const FIM_TILES_URL = import.meta.env.VITE_FIM_TILES_PMTILES ?? `${FIM_DATA_URL}/tile_boundaries.pmtiles`;
// Below this zoom the viewport can cover hundreds of data tiles; loading every one's header
// would be a request storm, so coverage only loads once you're zoomed in to work.
const FIM_MIN_COVERAGE_ZOOM = 7;
function todayUtc() {
  const d = /* @__PURE__ */ new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}
const DEFAULT_FORECAST_DATE = import.meta.env.VITE_FORECAST_DEFAULT_DATE ?? todayUtc();
let currentForecastDate = DEFAULT_FORECAST_DATE;
const BASEMAPS = [
  {
    id: "light",
    label: "Light grey (Carto)",
    maxzoom: 20,
    tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`),
    attribution: "© OpenStreetMap contributors © CARTO"
  },
  {
    id: "dark",
    label: "Dark (Carto)",
    maxzoom: 20,
    tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
    attribution: "© OpenStreetMap contributors © CARTO"
  },
  {
    id: "streets",
    label: "Streets (OSM)",
    maxzoom: 19,
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors"
  },
  {
    id: "satellite",
    label: "Satellite (Esri)",
    maxzoom: 19,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
  },
  {
    id: "topographic",
    label: "Topographic (Esri)",
    maxzoom: 19,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, FAO, NOAA, © OpenStreetMap contributors, and the GIS User Community"
  },
  {
    id: "usgstopo",
    label: "Topographic (USGS)",
    maxzoom: 16,
    tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"],
    attribution: "USGS — The National Map: 3DEP, NHD, GNIS, NLCD, NTD, and others"
  }
];
const basemapStyle = (bm) => ({
  version: 8,
  sources: { basemap: { type: "raster", tiles: bm.tiles, tileSize: 256, attribution: bm.attribution, maxzoom: bm.maxzoom ?? 19 } },
  layers: [{ id: "basemap", type: "raster", source: "basemap" }]
});
const $ = (id) => document.getElementById(id);
const logEl = $("log");
function log(msg, cls = "") {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = msg + "\n";
  logEl.appendChild(s);
  logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight;
}
const worker = new Worker(new URL("./map/fim/worker.js", import.meta.url), { type: "module" });
let floodView = null;
let coverageSet = null;
let selectSeq = 0;
let flowsSpec = null;
let workerReady = false;
let floodCanvas = null;
let floodCtx = null;
let frameInFlight = false;
let pendingFlood = false;
let floodEnabled = false;
let lastFloodedCells = 0;
let floodMappingMode = false;
let selectedRiverId = null;
let selectedRiverProps = null;
let selection = null;
let current = { selected: [], floodable: [] };
let qmode = "ladder";
let currentStyleset = "forecast15";
let sliderVisible = true;
const protocol = new Protocol({ metadata: true });
maplibregl.addProtocol("pmtiles", protocol.tile);
const map = new maplibregl.Map({
  container: "map",
  style: basemapStyle(BASEMAPS[0]),
  center: [-103.8, 40.27],
  // over the demo tile, so flood coverage is discoverable on load
  zoom: 4,
  hash: "map",
  maxZoom: 13
});
// Zoom +/- plus the compass button, which resets bearing (and pitch) back to north-up on click.
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-left");
function setBasemap(id) {
  const bm = BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");
  map.addSource("basemap", { type: "raster", tiles: bm.tiles, tileSize: 256, attribution: bm.attribution, maxzoom: bm.maxzoom ?? 19 });
  const beforeId = (map.getStyle().layers ?? []).find((l) => l.id !== "basemap")?.id;
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, beforeId);
}
// Toggleable map overlays (many can be on at once). `on` is the default visibility; `raster`,
// when present, is a source spec this module adds to the map (streams + flood are added elsewhere).
// streams/flood default on even though the flood layer starts empty — it's created lazily in
// rebuildFloodOverlay(), which reapplies this state so a toggle made before the layer exists sticks.
const OVERLAYS = [
  { layerId: "streams", labelKey: "layers.streams", on: true },
  { layerId: "flood", labelKey: "layers.floodExtents", on: true },
  {
    layerId: "riverfld",
    labelKey: "layers.riverfld",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://floods.ssec.wisc.edu/tiles/RIVER-FLDglobal-composite_current/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: 'RIVER-FLD global flood composite © <a href="https://floods.ssec.wisc.edu/products/RIVER-FLDglobal-composite" target="_blank" rel="noopener">CIMSS/SSEC, UW–Madison</a> (VIIRS, George Mason University)'
    }
  },
  {
    layerId: "goes",
    labelKey: "layers.goes",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://earthlive.maptiles.arcgis.com/arcgis/rest/services/GOES/GOES31D/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "GOES / Himawari colorized IR © NOAA, via Esri Living Atlas"
    }
  },
  {
    layerId: "viirs",
    labelKey: "layers.viirs",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://modis.arcgis.com/arcgis/rest/services/VIIRS/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image"],
      tileSize: 256,
      attribution: "VIIRS true color © NASA Earthdata (GIBS), via Esri"
    }
  }
];
const layerVisible = Object.fromEntries(OVERLAYS.map((o) => [o.layerId, o.on]));
function applyLayerVisibility(layerId) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", layerVisible[layerId] ? "visible" : "none");
}
// Add the raster imagery/flood overlays. Inserted beneath the streams line layer (in reverse
// list order, so overlays listed higher in the picker also render visually on top) and start
// at their default visibility.
function addRasterOverlays() {
  const beforeId = map.getLayer("streams") ? "streams" : undefined;
  for (const ov of [...OVERLAYS].reverse()) {
    if (!ov.raster) continue;
    if (!map.getSource(ov.layerId)) map.addSource(ov.layerId, ov.raster);
    if (!map.getLayer(ov.layerId)) {
      map.addLayer({
        id: ov.layerId,
        type: "raster",
        source: ov.layerId,
        layout: { visibility: layerVisible[ov.layerId] ? "visible" : "none" }
      }, beforeId);
    }
  }
}
// Wire a map-control button to its dropdown menu: toggle on button click, close on outside click.
function wireMenu(btn, menu) {
  const closeMenu = () => {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", () => {
    const open = menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!menu.contains(target) && !btn.contains(target)) closeMenu();
  });
  return closeMenu;
}
// Basemap picker: single-choice radio group (only one basemap at a time).
function initBasemapPicker() {
  const btn = document.getElementById("basemap-btn");
  const menu = document.getElementById("basemap-menu");
  if (!btn || !menu) return;
  btn.replaceChildren(calciteIcon("basemap"));
  menu.innerHTML = "";
  const closeMenu = wireMenu(btn, menu);
  for (const bm of BASEMAPS) {
    const opt = document.createElement("button");
    opt.className = "layer-opt";
    opt.setAttribute("role", "menuitemradio");
    opt.textContent = bm.label;
    const active = bm.id === BASEMAPS[0].id;
    opt.setAttribute("aria-checked", String(active));
    opt.classList.toggle("active", active);
    opt.addEventListener("click", () => {
      setBasemap(bm.id);
      menu.querySelectorAll('[role="menuitemradio"]').forEach((o) => {
        o.classList.remove("active");
        o.setAttribute("aria-checked", "false");
      });
      opt.classList.add("active");
      opt.setAttribute("aria-checked", "true");
      closeMenu();
    });
    menu.appendChild(opt);
  }
}
// Layer picker: independent on/off toggles (many overlays can be visible at once).
function initLayerPicker() {
  const btn = document.getElementById("layer-btn");
  const menu = document.getElementById("layer-menu");
  if (!btn || !menu) return;
  btn.replaceChildren(calciteIcon("layers"));
  menu.innerHTML = "";
  wireMenu(btn, menu);
  for (const ov of OVERLAYS) {
    const opt = document.createElement("button");
    opt.className = "layer-opt layer-toggle";
    opt.setAttribute("role", "menuitemcheckbox");
    opt.setAttribute("aria-checked", String(layerVisible[ov.layerId]));
    const check = document.createElement("span");
    check.className = "check";
    check.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.setAttribute("data-i18n", ov.labelKey);
    label.textContent = t(ov.labelKey);
    opt.append(check, label);
    opt.addEventListener("click", () => {
      const next = !layerVisible[ov.layerId];
      layerVisible[ov.layerId] = next;
      applyLayerVisibility(ov.layerId);
      opt.setAttribute("aria-checked", String(next));
    });
    menu.appendChild(opt);
  }
}
initBasemapPicker();
initLayerPicker();
const anim = new StreamAnimation(map, log);
let mapLoaded = false;
map.on("load", async () => {
  anim.addStreamsLayer();
  applyLayerVisibility("streams");
  addRasterOverlays();
  addInspectHighlightLayer();
  addFimTilesLayer();
  log("Basemap + streams loaded.", "success");
  mapLoaded = true;
  map.on("click", (e) => {
    const pad = 10;
    const box = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad]
    ];
    const feats = map.queryRenderedFeatures(box, { layers: ["streams"] });
    const hit = feats.find((f) => f.properties?.riverId != null);
    if (hit) {
      // Clicking a reach while zoomed out fluidly zooms in to it so the stream fills the view.
      if (map.getZoom() < 10) map.easeTo({ center: e.lngLat, zoom: 10 });
      if (floodMappingMode) selection?.select(Number(hit.properties.riverId));
      else openChartsModal(hit.properties);
      return;
    }
    if (floodMappingMode) queryFloodDepth(e.lngLat);
  });
  map.on("mouseenter", "streams", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "streams", () => {
    map.getCanvas().style.cursor = "";
  });
  selection = new Selection(map, onSelectionChange, (id) => coverageSet?.has(id) ?? false);
  selection.addHighlightLayers();
  initForecastDatePicker();
  anim.setDate(DEFAULT_FORECAST_DATE);
});
map.on("error", (e) => {
  if (e?.error) log(`map: ${e.error.message}`, "error");
});
worker.postMessage({ type: "init", dataBase: FIM_DATA_URL });
worker.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "ready") {
    workerReady = true;
    $("legend-depth").style.background = `linear-gradient(to right, ${legendGradient()})`;
    log(`Flood index ready: ${msg.nTiles.toLocaleString()} tiles. Coverage loads from the map viewport.`, "success");
    refreshControls();
    syncViewportTiles();
  } else if (msg.type === "coverage") {
    coverageSet = new Set(new Uint32Array(msg.coverage));
    selection?.setCoverage([...coverageSet]);
    log(`Flood coverage: ${msg.nRivers.toLocaleString()} river(s) across ${msg.nActiveTiles} loaded tile(s).`, "success");
    selection?.refresh();
    refreshControls();
  } else if (msg.type === "selected") {
    if (msg.id !== selectSeq) return;
    if (msg.empty) {
      floodView = null;
      clearFloodOverlay();
      $("flood-status").textContent = "Selected reaches have no flood pixels.";
      return;
    }
    floodView = { bounds: msg.bounds, width: msg.width, height: msg.height };
    flowsSpec = msg.flows;
    rebuildFloodOverlay(floodView);
    const st = msg.stats;
    log(`Corridor slices: ${st.slices} river-slice(s) from ${st.tiles} tile(s), ${st.relations.toLocaleString()} relations.`, "success");
    computeFlood();
  } else if (msg.type === "frame") {
    frameInFlight = false;
    if (floodCtx && floodCanvas && msg.width === floodCanvas.width && msg.height === floodCanvas.height) {
      const img = new ImageData(new Uint8ClampedArray(msg.rgba), msg.width, msg.height);
      floodCtx.putImageData(img, 0, 0);
      refreshFloodCanvas();
      lastFloodedCells = msg.floodedCells;
      updateSaveButton();
      $("flood-status").textContent = `${msg.floodedCells.toLocaleString()} flooded cells · ${msg.computeMs.toFixed(1)} ms`;
    }
    if (pendingFlood) {
      pendingFlood = false;
      computeFlood();
    }
  } else if (msg.type === "export") {
    saveFloodGeoTiff(msg);
  } else if (msg.type === "query") {
    $("readout").textContent = msg.depth == null ? "no flooding at that pixel" : `depth ≈ ${msg.depth.toFixed(2)} m`;
  } else if (msg.type === "error") {
    log(`flood worker: ${msg.message}`, "error");
    $("flood-status").textContent = msg.message;
    frameInFlight = false;
  }
};
function requestSelect() {
  if (!workerReady || current.floodable.length === 0) return;
  $("flood-status").textContent = "Fetching river slices…";
  worker.postMessage({ type: "select", id: ++selectSeq, comids: current.floodable });
}
function rebuildFloodOverlay(view) {
  if (!mapLoaded) return;
  if (map.getLayer("flood")) map.removeLayer("flood");
  if (map.getSource("flood")) map.removeSource("flood");
  floodCanvas = document.createElement("canvas");
  floodCanvas.width = view.width;
  floodCanvas.height = view.height;
  floodCtx = floodCanvas.getContext("2d");
  const b = view.bounds;
  map.addSource("flood", {
    type: "canvas",
    canvas: floodCanvas,
    animate: false,
    coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]]
  });
  map.addLayer({
    id: "flood",
    type: "raster",
    source: "flood",
    paint: { "raster-fade-duration": 0, "raster-resampling": "nearest" }
  }, "streams");
  // The layer is recreated on every viewport/selection change, so reapply the picker's toggle state.
  applyLayerVisibility("flood");
}
function refreshFloodCanvas() {
  const src = map.getSource("flood");
  if (!src) return;
  src.play();
  requestAnimationFrame(() => src.pause());
}
function queryFloodDepth(lngLat) {
  if (!floodView) return;
  const b = floodView.bounds;
  const { lng, lat } = lngLat;
  if (lng < b.west || lng > b.east || lat < b.south || lat > b.north) return;
  worker.postMessage({
    type: "query",
    id: Date.now(),
    row: Math.round((90 - lat) * 3600),
    col: Math.round((lng + 180) * 3600)
  });
}
function onSelectionChange(s) {
  current = s;
  refreshControls();
  if (floodEnabled && workerReady && current.floodable.length > 0) requestSelect();
  else clearFloodOverlay();
}
function clearFloodOverlay() {
  lastFloodedCells = 0;
  updateSaveButton();
  if (!floodCtx || !floodCanvas) return;
  floodCtx.clearRect(0, 0, floodCanvas.width, floodCanvas.height);
  refreshFloodCanvas();
}
function refreshControls() {
  const btn = $("btn-create-flood");
  const hasFloodable = workerReady && current.floodable.length > 0;
  btn.disabled = !hasFloodable;
  btn.textContent = floodEnabled ? "Flood mapping on — live" : "Create flood map";
  if (!workerReady) $("flood-status").textContent = "Loading flood index…";
  else if (current.floodable.length === 0) {
    $("flood-status").textContent = current.selected.length ? "Selected reaches have no flood-library coverage in the loaded tiles yet." : "Click reaches on the map to select them.";
  } else if (!floodEnabled) {
    $("flood-status").textContent = `${current.floodable.length} reach(es) ready — press “Create flood map”.`;
  } else {
    $("flood-status").textContent = `${current.floodable.length} reach(es) flooding live — move the slider.`;
  }
}
function computeFlood() {
  if (!floodEnabled || !flowsSpec || !floodView || !workerReady || current.floodable.length === 0) return;
  if (frameInFlight) {
    pendingFlood = true;
    return;
  }
  const full = qmode === "ladder" ? flowsAtLadderPosition(flowsSpec, Number($("ladder").value)) : uniformFlows(flowsSpec, Number($("uniform").value));
  const flows = [];
  for (const comid of current.floodable) if (full.has(comid)) flows.push([comid, full.get(comid)]);
  if (flows.length === 0) return;
  frameInFlight = true;
  $("flood-status").textContent = "Computing…";
  worker.postMessage({ type: "frame", id: Date.now(), flows });
}
const ladderLabels = ["q3", "q8", "q12", "q15", "q18", "q22", "q25", "q28", "q30"];
function syncLadderLabel() {
  const t2 = Number($("ladder").value);
  const i = Math.min(Math.round(t2), ladderLabels.length - 1);
  $("ladder-val").textContent = flowsSpec?.ladderLabels?.[i] ?? ladderLabels[i];
}
function setQMode(m) {
  qmode = m;
  $("qmode-ladder").classList.toggle("active", m === "ladder");
  $("qmode-uniform").classList.toggle("active", m === "uniform");
  $("qctl-ladder").classList.toggle("hidden", m !== "ladder");
  $("qctl-uniform").classList.toggle("hidden", m !== "uniform");
  computeFlood();
}
function addFimTilesLayer() {
  if (map.getSource("fim-tiles")) return;
  map.addSource("fim-tiles", { type: "vector", url: `pmtiles://${FIM_TILES_URL}` });
  // Invisible fill = the viewport hit-test target. A line layer would miss a viewport sitting
  // entirely inside one tile with no edge on screen; a fill at opacity 0 still renders, so
  // queryRenderedFeatures returns it wherever the viewport lands.
  map.addLayer({
    id: "fim-tiles-hit",
    type: "fill",
    source: "fim-tiles",
    "source-layer": "fim_tiles",
    paint: { "fill-opacity": 0 }
  });
  // Faint outline, shown only in flood mode, so the data-tile footprint is visible.
  map.addLayer({
    id: "fim-tiles-outline",
    type: "line",
    source: "fim-tiles",
    "source-layer": "fim_tiles",
    layout: { visibility: floodMappingMode ? "visible" : "none" },
    paint: { "line-color": "#38bdf8", "line-width": 1, "line-opacity": 0.5, "line-dasharray": [2, 2] }
  });
  map.on("sourcedata", (e) => {
    if (e.sourceId === "fim-tiles" && e.isSourceLoaded) syncViewportTiles();
  });
}
// Which flood-data tiles overlap the current viewport → tell the worker to load their coverage.
// Gated on flood mode (and a min zoom) so normal browsing never fetches tile headers.
let lastViewportKey = "";
function syncViewportTiles() {
  if (!floodMappingMode || !workerReady || !map.getLayer("fim-tiles-hit")) return;
  if (map.getZoom() < FIM_MIN_COVERAGE_ZOOM) return;
  const names = [...new Set(
    map.queryRenderedFeatures({ layers: ["fim-tiles-hit"] }).map((f) => f.properties.name)
  )].sort();
  const key = names.join(",");
  if (key === lastViewportKey) return;
  lastViewportKey = key;
  if (names.length) worker.postMessage({ type: "viewport", tiles: names });
}
map.on("moveend", syncViewportTiles);
function setFloodMappingMode(on) {
  floodMappingMode = on;
  if (on) setInspectHighlight(null);
  const btn = $("btn-flood-mode");
  btn.classList.toggle("active", on);
  btn.textContent = t(on ? "flood.disable" : "flood.enable");
  $("flood-mode-hint").textContent = t(on ? "flood.hintOn" : "flood.hintOff");
  $("flood-controls").classList.toggle("mode-off", !on);
  for (const id of ["fim-tiles-outline", "fim-coverage", "sel-selected", "sel-floodable"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
  if (on) syncViewportTiles();
}
$("btn-flood-mode").addEventListener("click", () => setFloodMappingMode(!floodMappingMode));
function renderAttrTable(props) {
  const keys = Object.keys(props).sort((a, b) => a === "riverId" ? -1 : b === "riverId" ? 1 : a.localeCompare(b));
  if (!keys.length) return '<div class="attr-empty">This feature carries no attributes.</div>';
  return `<table class="attr-table">${keys.map((k) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(String(props[k]))}</td></tr>`).join("")}</table>`;
}
async function loadRiverTimeseries(blockId) {
  const block = document.getElementById(blockId);
  if (!block) return;
  try {
    const [{ fetchRiverTimeseries, DEV_RIVER_ID }, plots] = await Promise.all([
      import("./timeseries"),
      import("./plots/orchestrator")
    ]);
    const ts = await fetchRiverTimeseries();
    if (!document.getElementById(blockId)) {
      plots.clearPlots();
      return;
    }
    block.className = "";
    block.innerHTML = `<p class="hint">Dev river ${DEV_RIVER_ID} · ${ts.discharge.length.toLocaleString()} daily steps (clicked reach ignored during model development).</p><div class="ts-charts"></div>`;
    plots.plotAllRetro(block.querySelector(".ts-charts"), ts);
  } catch (e) {
    block.className = "ts-error";
    block.textContent = `Failed to load time series: ${e.message}`;
  }
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
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
const CHARTS_TABS = ["forecast", "retro", "details"];
const chartsRendered = { forecast: false, retro: false, details: false };
function renderForecastCharts() {
  // Don't fetch the forecast until a river is actually selected — opening the panel from the
  // header button (no reach) shows the same empty placeholder as the retro/details tabs.
  if (selectedRiverId == null) {
    $("charts-panel-forecast").innerHTML = `<div class="charts-empty"><p>${t("charts.empty.title")}</p><p class="hint">${t("charts.empty.hint")}</p></div>`;
    return;
  }
  $("charts-panel-forecast").innerHTML = `<div id="charts-fc-block" class="ts-loading"><span class="spinner"></span>Loading forecast…</div>`;
  loadForecastTimeseries("charts-fc-block");
}
async function loadForecastTimeseries(blockId) {
  const block = document.getElementById(blockId);
  if (!block) return;
  try {
    const [{ fetchForecastTimeseries }, { DEV_RIVER_ID }, plots] = await Promise.all([
      import("./forecastTimeseries"),
      import("./timeseries"),
      import("./plots/orchestrator")
    ]);
    const fc = await fetchForecastTimeseries(currentForecastDate);
    if (!document.getElementById(blockId)) {
      plots.clearPlots();
      return;
    }
    block.className = "";
    block.innerHTML = `<p class="hint">Dev river ${DEV_RIVER_ID} · forecast initialized ${fc.initDate.toISOString().slice(0, 10)} · ${fc.ensembleIds.length} members · ${fc.datetime.length} steps (clicked reach ignored during model development).</p><div class="ts-charts"></div>`;
    plots.plotAllForecast(block.querySelector(".ts-charts"), fc);
  } catch (e) {
    block.className = "ts-error";
    block.textContent = `Failed to load forecast: ${e.message}`;
  }
}
function renderRetroCharts() {
  if (selectedRiverId == null) {
    $("charts-panel-retro").innerHTML = `<div class="charts-empty"><p>${t("charts.empty.title")}</p><p class="hint">${t("charts.empty.hint")}</p></div>`;
  } else {
    $("charts-panel-retro").innerHTML = `<div id="charts-ts-block" class="ts-loading"><span class="spinner"></span>Loading time series…</div>`;
    loadRiverTimeseries("charts-ts-block");
  }
}
function renderChartsDetails() {
  $("charts-panel-details").innerHTML = selectedRiverProps ? renderAttrTable(selectedRiverProps) : `<div class="charts-empty"><p>${t("charts.empty.title")}</p><p class="hint">${t("charts.empty.hint")}</p></div>`;
}
function activateChartsTab(tab) {
  for (const name of CHARTS_TABS) {
    const on = name === tab;
    $(`charts-tab-${name}`).classList.toggle("active", on);
    $(`charts-tab-${name}`).setAttribute("aria-selected", String(on));
    $(`charts-panel-${name}`).hidden = !on;
  }
  if (!chartsRendered[tab]) {
    if (tab === "forecast") renderForecastCharts();
    else if (tab === "retro") renderRetroCharts();
    else renderChartsDetails();
    chartsRendered[tab] = true;
  }
}
for (const name of CHARTS_TABS) $(`charts-tab-${name}`).addEventListener("click", () => activateChartsTab(name));
const INSPECT_NO_MATCH = ["in", ["get", "riverId"], ["literal", []]];
function addInspectHighlightLayer() {
  if (map.getLayer("inspect-highlight")) return;
  map.addLayer({
    id: "inspect-highlight",
    type: "line",
    source: "geoglows",
    "source-layer": "streams",
    filter: INSPECT_NO_MATCH,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#00d1ff",
      // dark blue, distinct from the streams' return-period palette
      // widen with zoom so the trace stays clearly on top of the base streams line
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 8, 3, 13, 5.5, 16, 9],
      "line-opacity": 0.95
    }
  });
}
function setInspectHighlight(riverId) {
  if (!map.getLayer("inspect-highlight")) return;
  map.setFilter("inspect-highlight", riverId == null ? INSPECT_NO_MATCH : ["in", ["get", "riverId"], ["literal", [riverId]]]);
}
// The charts live in a dock that widens the left panel to half the viewport (see style.css),
// keeping the map visible and interactive on the right. Toggled by `charts-open` on <body>.
// The MapLibre canvas doesn't track sibling layout changes, so resize it across the transition.
function reflowMap(durationMs = 340) {
  const start = performance.now();
  const step = () => {
    map.resize();
    if (performance.now() - start < durationMs) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function openChartsDock() {
  document.body.classList.add("charts-open");
  reflowMap();
}
function closeChartsDock() {
  if (!document.body.classList.contains("charts-open")) return;
  document.body.classList.remove("charts-open");
  reflowMap();
  void import("./plots/orchestrator").then((m) => m.clearPlots());
}
function openChartsModal(props) {
  if (props) {
    selectedRiverProps = props;
    if (props.riverId != null) selectedRiverId = Number(props.riverId);
  }
  setInspectHighlight(selectedRiverId);
  $("charts-modal-title").textContent = selectedRiverId != null ? `${t("river.heading")} ${selectedRiverId}` : t("charts.heading");
  for (const name of CHARTS_TABS) chartsRendered[name] = false;
  activateChartsTab("forecast");
  openChartsDock();
}
$("btn-charts").addEventListener("click", () => openChartsModal());
$("charts-close").addEventListener("click", closeChartsDock);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
  closeChartsDock();
});
const legendToggle = document.getElementById("set-legend");
legendToggle?.addEventListener("change", () => document.getElementById("legend-overlay")?.classList.toggle("hidden", !legendToggle.checked));
function initLanguagePicker() {
  const btn = $("btn-language");
  const menu = $("lang-menu");
  const options = [...menu.querySelectorAll(".layer-opt[data-lang]")];
  const current2 = localStorage.getItem("rfs-lang") ?? "en";
  setLanguage(current2);
  for (const opt of options) {
    const code = opt.dataset.lang;
    opt.classList.toggle("active", code === current2);
    opt.addEventListener("click", () => {
      setLanguage(code);
      updateSliderVisibility();
      localStorage.setItem("rfs-lang", code);
      options.forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      closeMenu();
    });
  }
  const closeMenu = () => {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", () => {
    const open = menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!menu.contains(target) && !btn.contains(target)) closeMenu();
  });
}
initLanguagePicker();
function initForecastDatePicker() {
  const input = document.getElementById("forecast-date");
  if (!input) return;
  input.value = DEFAULT_FORECAST_DATE;
  input.addEventListener("change", () => {
    const date = input.value;
    if (!date) return;
    currentForecastDate = date;
    log(`Switching forecast date to ${date}…`, "info");
    anim.setDate(date);
  });
}
// The player (bottom timeseries slider) only makes sense for the animated "15 Day Forecast
// Timeseries" styleset, and only when the user hasn't toggled it off. Any other styleset disables
// the toggle and hides the player entirely.
function updateSliderVisibility() {
  const isTimeseries = currentStyleset === "forecast15";
  const show = isTimeseries && sliderVisible;
  $("player").classList.toggle("hidden", !show);
  if (!show) anim.pause();
  const btn = $("btn-toggle-slider");
  if (!btn) return;
  btn.disabled = !isTimeseries;
  btn.classList.toggle("active", show);
  const label = t(show ? "stream.hideSlider" : "stream.showSlider");
  btn.title = label;
  btn.setAttribute("aria-label", label);
}
function initStreamStyleControls() {
  const sel = $("stream-style");
  if (sel) {
    sel.value = currentStyleset;
    sel.addEventListener("change", () => {
      currentStyleset = sel.value;
      anim.setStyleset(currentStyleset);
      if (currentStyleset === "maxflow" || currentStyleset === "timetopeak") {
        const label = sel.options[sel.selectedIndex]?.textContent ?? currentStyleset;
        log(`“${label}” styleset is a placeholder — not available yet.`, "info");
      }
      updateSliderVisibility();
    });
  }
  $("btn-toggle-slider")?.addEventListener("click", () => {
    sliderVisible = !sliderVisible;
    updateSliderVisibility();
  });
  updateSliderVisibility();
}
$("qmode-ladder").addEventListener("click", () => setQMode("ladder"));
$("qmode-uniform").addEventListener("click", () => setQMode("uniform"));
$("ladder").addEventListener("input", () => {
  syncLadderLabel();
  computeFlood();
});
$("uniform").addEventListener("input", computeFlood);
$("btn-create-flood").addEventListener("click", () => {
  if (!workerReady || current.floodable.length === 0) return;
  floodEnabled = true;
  refreshControls();
  requestSelect();
});
function updateSaveButton() {
  ;
  $("btn-save-geotiff").disabled = !(floodEnabled && lastFloodedCells > 0);
}
function currentQLabel() {
  if (qmode === "uniform") return `${Number($("uniform").value)}cms`;
  const i = Math.min(Math.round(Number($("ladder").value)), ladderLabels.length - 1);
  return (flowsSpec?.ladderLabels?.[i] ?? ladderLabels[i]).replace(/[^\w.-]+/g, "");
}
function saveFloodGeoTiff(msg) {
  if (!msg.extent) {
    log("No flood map to export.", "error");
    return;
  }
  const buf = encodeExtentGeoTiff({
    width: msg.width,
    height: msg.height,
    bounds: msg.bounds,
    data: new Uint8Array(msg.extent)
  });
  const url = URL.createObjectURL(new Blob([buf], { type: "image/tiff" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `flood_extent_${msg.tile}_${currentQLabel()}.tif`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  log(`Saved ${a.download} · ${msg.flooded.toLocaleString()} flooded cells.`, "success");
}
$("btn-save-geotiff").addEventListener("click", () => {
  if (!workerReady || lastFloodedCells === 0) return;
  worker.postMessage({ type: "export", id: Date.now() });
});
syncLadderLabel();
initStreamStyleControls();

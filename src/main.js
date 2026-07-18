// Importing map.js stands the map up: it constructs the MapLibre instance on #map, registers the
// pmtiles protocol, and wires the basemap + layer pickers. This module owns everything layered on
// top of it — streams, flood mapping, charts, and the panel controls.
import {map} from "./map/map";
import {applyBasemap, BASEMAPS} from "./map/basemaps";
import {addRasterOverlays, applyLayerVisibility} from "./map/layers";
import {StreamAnimation} from "./map/streams/animation";
import {Selection} from "./map/fim/selection";
import {FimTilesLayer} from "./map/fim/tilesLayer";
import {FloodOverlay} from "./map/fim/overlay";
import {DEFAULT_FORECAST_DATE, FIM_DATA_URL} from "./constants";
import {flowsAtLadderPosition, uniformFlows} from "./map/fim/hydro";
import {legendGradient} from "./map/fim/colormap";
import {encodeExtentGeoTiff} from "./map/fim/geotiff";
import {heroIcon} from "./icons/heroicons";
import {setLanguage, t} from "./i18n/i18n";

// ═══════════════════════════════════════════════════════════════════════════
// Config · every env-driven value lives in src/constants.js
// ═══════════════════════════════════════════════════════════════════════════
let currentForecastDate = DEFAULT_FORECAST_DATE;

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════
// App state · flood worker, selection, and the forecast animation
// ═══════════════════════════════════════════════════════════════════════════
const worker = new Worker(new URL("./map/fim/worker.js", import.meta.url), {type: "module"});
let floodView = null;
let coverageSet = null;
let selectSeq = 0;
let flowsSpec = null;
let workerReady = false;
// The flood extent canvas layer, and the FIM data-tile footprints that drive coverage loading.
// Both own their map layers; see map/fim/overlay.js and map/fim/tilesLayer.js.
const floodOverlay = new FloodOverlay(map);
const fimTiles = new FimTilesLayer(map, {
  isReady: () => workerReady,
  onTiles: (tiles) => worker.postMessage({type: "viewport", tiles})
});
let frameInFlight = false;
let pendingFlood = false;
let floodEnabled = false;
let lastFloodedCells = 0;
let floodMappingMode = false;
let selectedRiverId = null;
let selectedRiverProps = null;
let selection = null;
let current = {selected: [], floodable: []};
// Which discharge drives the flood extent. "manual" = one number for every reach, "returnperiod" =
// the per-reach rating-curve ladder, "forecast"/"forecastmax" = the reaches' downloaded forecast
// hydrographs (animated over the horizon, or held at each reach's peak).
let floodStyle = "returnperiod";
// Downloaded forecast for the current (date, selection): see loadForecastFlows().
let forecastFlows = null;
let forecastFlowsKey = "";
let forecastLoading = false;
let fcStep = 0;
let fcPlaying = false;
let fcTimer = null;
let fcFps = 4;
let currentStyleset = "forecast15";
let sliderVisible = true;

// ═══════════════════════════════════════════════════════════════════════════
// Map lifecycle · app layers, click handling, and load wiring
// ═══════════════════════════════════════════════════════════════════════════
const anim = new StreamAnimation(map);
let mapLoaded = false;
map.on("load", async () => {
  anim.addStreamsLayer();
  applyLayerVisibility(map, "streams");
  addRasterOverlays(map);
  addInspectHighlightLayer();
  fimTiles.add();
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
  if (e?.error) console.error(`map: ${e.error.message}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Flood worker · messaging, the extent canvas, and depth queries
// ═══════════════════════════════════════════════════════════════════════════
worker.postMessage({type: "init", dataBase: FIM_DATA_URL});
worker.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "ready") {
    workerReady = true;
    $("legend-depth").style.background = `linear-gradient(to right, ${legendGradient()})`;
    console.log(`Flood index ready: ${msg.nTiles.toLocaleString()} tiles. Coverage loads from the map viewport.`);
    refreshControls();
    fimTiles.sync();
  } else if (msg.type === "coverage") {
    coverageSet = new Set(new Uint32Array(msg.coverage));
    selection?.setCoverage([...coverageSet]);
    console.log(`Flood coverage: ${msg.nRivers.toLocaleString()} river(s) across ${msg.nActiveTiles} loaded tile(s).`);
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
    floodView = {bounds: msg.bounds, width: msg.width, height: msg.height};
    flowsSpec = msg.flows;
    if (mapLoaded) floodOverlay.rebuild(floodView);
    const st = msg.stats;
    console.log(`Corridor slices: ${st.slices} river-slice(s) from ${st.tiles} tile(s), ${st.relations.toLocaleString()} relations.`);
    computeFlood();
  } else if (msg.type === "frame") {
    frameInFlight = false;
    // A frame that no longer matches the canvas is stale (the selection moved on) — paint() drops it.
    if (floodOverlay.paint(msg.rgba, msg.width, msg.height)) {
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
    console.error(`flood worker: ${msg.message}`);
    $("flood-status").textContent = msg.message;
    frameInFlight = false;
  }
};

function requestSelect() {
  if (!workerReady || current.floodable.length === 0) return;
  $("flood-status").textContent = "Fetching river slices…";
  worker.postMessage({type: "select", id: ++selectSeq, comids: current.floodable});
}

function queryFloodDepth(lngLat) {
  if (!floodView) return;
  const b = floodView.bounds;
  const {lng, lat} = lngLat;
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
  if (floodEnabled && workerReady && current.floodable.length > 0) {
    requestSelect();
    // The forecast is per-reach, so a changed selection needs a (cached-where-possible) refetch.
    if (floodStyle === "forecast" || floodStyle === "forecastmax") loadForecastFlows();
  } else clearFloodOverlay();
}

function clearFloodOverlay() {
  lastFloodedCells = 0;
  updateSaveButton();
  floodOverlay.clear();
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

// Per-reach discharge for the active flood style, or null when the style's data isn't ready yet
// (the forecast styles need their download to land first).
function flowsForFloodStyle() {
  if (floodStyle === "manual") return uniformFlows(flowsSpec, Number($("uniform").value));
  if (floodStyle === "returnperiod") return flowsAtLadderPosition(flowsSpec, Number($("ladder").value));
  if (!forecastFlows) return null;
  if (floodStyle === "forecastmax") return forecastFlows.peak;
  const out = /* @__PURE__ */ new Map();
  for (const [comid, q] of forecastFlows.series) {
    const v = q[Math.min(fcStep, q.length - 1)];
    if (Number.isFinite(v)) out.set(comid, v);
  }
  return out;
}

function computeFlood() {
  if (!floodEnabled || !flowsSpec || !floodView || !workerReady || current.floodable.length === 0) return;
  if (frameInFlight) {
    pendingFlood = true;
    return;
  }
  const full = flowsForFloodStyle();
  if (!full) return;
  const flows = [];
  for (const comid of current.floodable) if (full.has(comid)) flows.push([comid, full.get(comid)]);
  if (flows.length === 0) return;
  frameInFlight = true;
  $("flood-status").textContent = "Computing…";
  worker.postMessage({type: "frame", id: Date.now(), flows});
}

// ═══════════════════════════════════════════════════════════════════════════
// Flood styles · discharge source per style + the forecast player
// ═══════════════════════════════════════════════════════════════════════════
const ladderLabels = ["q3", "q8", "q12", "q15", "q18", "q22", "q25", "q28", "q30"];

function syncLadderLabel() {
  const t2 = Number($("ladder").value);
  const i = Math.min(Math.round(t2), ladderLabels.length - 1);
  $("ladder-val").textContent = flowsSpec?.ladderLabels?.[i] ?? ladderLabels[i];
}

// Per-style control panel. "forecastmax" has none — it needs no input beyond the selection.
const FLOOD_STYLE_CTL = {
  manual: "qctl-uniform",
  returnperiod: "qctl-ladder",
  forecast: "qctl-forecast"
};

function setFloodStyle(style) {
  floodStyle = style;
  for (const [name, id] of Object.entries(FLOOD_STYLE_CTL)) $(id).classList.toggle("hidden", name !== style);
  const usesForecast = style === "forecast" || style === "forecastmax";
  if (!usesForecast) {
    fcPause();
    computeFlood();
    return;
  }
  // Forecast styles need the selection's hydrographs; loadForecastFlows() computes once the
  // download lands (and is a no-op when the cached download already matches date + selection).
  if (style !== "forecast") fcPause();
  loadForecastFlows();
}

// ---- forecast-driven flood styles ----
// Download the ensemble-median hydrograph for every floodable reach at the selected forecast
// initialization date, then hand it to computeFlood(). Keyed on (date, reaches) so switching
// between the two forecast styles, or re-entering one, reuses the download.
async function loadForecastFlows() {
  if (current.floodable.length === 0) {
    forecastFlows = null;
    forecastFlowsKey = "";
    syncForecastPlayer();
    return;
  }
  const ids = [...current.floodable].sort((a, b) => a - b);
  const key = `${currentForecastDate}|${ids.join(",")}`;
  if (key === forecastFlowsKey && forecastFlows) {
    syncForecastPlayer();
    computeFlood();
    return;
  }
  // One download at a time. A selection change mid-flight is picked up by the staleness check
  // below, which re-runs this once the flag has been released.
  if (forecastLoading) return;
  forecastLoading = true;
  forecastFlows = null;
  syncForecastPlayer();
  $("flood-status").textContent = `Downloading forecast for ${ids.length} reach(es)…`;
  let stale = false;
  try {
    const {fetchForecastFlows} = await import("./forecastTimeseries");
    const fc = await fetchForecastFlows(currentForecastDate, ids, (done, total) => {
      $("flood-status").textContent = `Downloading forecast… ${done}/${total} reach(es)`;
    });
    // The selection (or date) may have moved on while the download was in flight.
    stale = `${currentForecastDate}|${[...current.floodable].sort((a, b) => a - b).join(",")}` !== key;
    if (stale) {
      // fall through to the retry below
    } else if (fc.series.size === 0) {
      console.error(`No selected reach is present in the ${currentForecastDate} forecast store.`);
      $("flood-status").textContent = "None of the selected reaches are in this forecast.";
    } else {
      forecastFlows = fc;
      forecastFlowsKey = key;
      fcStep = Math.min(fcStep, fc.datetime.length - 1);
      if (fc.missing.length) {
        console.log(`${fc.missing.length} selected reach(es) are absent from the ${currentForecastDate} forecast — skipped.`);
      }
      console.log(`Forecast flows: ${fc.series.size} reach(es) × ${fc.datetime.length} steps for ${currentForecastDate}.`);
      syncForecastPlayer();
      computeFlood();
    }
  } catch (e) {
    console.error(`forecast flows: ${e.message}`);
    $("flood-status").textContent = `Forecast download failed: ${e.message}`;
  } finally {
    forecastLoading = false;
  }
  // Released the flag first, so the retry actually runs instead of tripping the guard above.
  if (stale) loadForecastFlows();
}

function syncForecastPlayer() {
  const slider = $("fc-slider");
  const playBtn = $("btn-fc-play");
  const nSteps = forecastFlows?.datetime.length ?? 0;
  const ready = nSteps > 1;
  slider.disabled = !ready;
  playBtn.disabled = !ready;
  slider.max = String(Math.max(0, nSteps - 1));
  slider.value = String(fcStep);
  $("fc-step-label").textContent = nSteps ? `${fcStep + 1}/${nSteps}` : "–/–";
  const when = forecastFlows?.datetime[fcStep];
  $("fc-time-label").textContent = when ? when.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
  if (!ready) fcPause();
}

function fcSetStep(t) {
  const n = forecastFlows?.datetime.length ?? 0;
  if (!n) return;
  fcStep = (t % n + n) % n;
  syncForecastPlayer();
  computeFlood();
}

function fcPlay() {
  if (fcPlaying || floodStyle !== "forecast" || !forecastFlows) return;
  fcPlaying = true;
  $("btn-fc-play").textContent = "❚❚";
  // computeFlood() coalesces while a frame is in flight, so a step the worker can't keep up with
  // is simply dropped rather than queued — the animation stays in sync with wall-clock time.
  fcTimer = setInterval(() => fcSetStep(fcStep + 1), 1e3 / fcFps);
}

function fcPause() {
  fcPlaying = false;
  const btn = $("btn-fc-play");
  if (btn) btn.textContent = "▶";
  if (fcTimer) {
    clearInterval(fcTimer);
    fcTimer = null;
  }
}

function initFloodStyleControls() {
  const sel = $("flood-style");
  sel.value = floodStyle;
  sel.addEventListener("change", () => setFloodStyle(sel.value));
  $("btn-fc-play").addEventListener("click", () => fcPlaying ? fcPause() : fcPlay());
  $("fc-slider").addEventListener("input", () => {
    fcPause();
    fcSetStep(Number($("fc-slider").value));
  });
  $("fc-speed").addEventListener("change", () => {
    fcFps = Number($("fc-speed").value);
    if (fcPlaying) {
      fcPause();
      fcPlay();
    }
  });
  setFloodStyle(floodStyle);
}

// ═══════════════════════════════════════════════════════════════════════════
// Flood coverage · FIM data-tile footprints and flood mapping mode
// ═══════════════════════════════════════════════════════════════════════════

function setFloodMappingMode(on) {
  floodMappingMode = on;
  if (on) setInspectHighlight(null);
  const btn = $("btn-flood-mode");
  btn.classList.toggle("active", on);
  btn.textContent = t(on ? "flood.disable" : "flood.enable");
  $("flood-controls").classList.toggle("mode-off", !on);
  // Flood mode owns the stream rendering: the hydrology styler is locked and every reach drops to
  // one uniform width, so the selection highlights aren't competing with a variable-width network.
  anim.setFloodMode(on);
  $("stream-style").disabled = on;
  // Data-tile footprints follow the mode, and start/stop tracking the viewport with it.
  fimTiles.setActive(on);
  for (const id of ["fim-coverage", "sel-selected", "sel-floodable"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
}

$("btn-flood-mode").addEventListener("click", () => setFloodMappingMode(!floodMappingMode));

// ═══════════════════════════════════════════════════════════════════════════
// River inspection · attribute table and retrospective charts
// ═══════════════════════════════════════════════════════════════════════════
function renderAttrTable(props) {
  const keys = Object.keys(props).sort((a, b) => a === "riverId" ? -1 : b === "riverId" ? 1 : a.localeCompare(b));
  if (!keys.length) return '<div class="attr-empty">This feature carries no attributes.</div>';
  return `<table class="attr-table">${keys.map((k) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(String(props[k]))}</td></tr>`).join("")}</table>`;
}

async function loadRiverTimeseries(blockId) {
  const block = document.getElementById(blockId);
  if (!block) return;
  try {
    const [{fetchRiverTimeseries, DEV_RIVER_ID}, plots] = await Promise.all([
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
  return s.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
}

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

// ═══════════════════════════════════════════════════════════════════════════
// Charts dock · tabs, panels, and the inspect highlight
// ═══════════════════════════════════════════════════════════════════════════
const CHARTS_TABS = ["forecast", "retro", "details"];
const chartsRendered = {forecast: false, retro: false, details: false};

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
    const [{fetchForecastTimeseries}, {DEV_RIVER_ID}, plots] = await Promise.all([
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
    layout: {"line-cap": "round", "line-join": "round"},
    paint: {
      // Bright green, to clash with the blue stream network rather than blend into it.
      "line-color": "#33FF57",
      // Runs noticeably wider than the base streams line at every zoom so the inspected reach
      // reads as a distinct trace on top rather than a slightly recoloured stream.
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 5, 13, 9, 16, 14],
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

// ═══════════════════════════════════════════════════════════════════════════
// Panel controls · language, forecast date, and stream style
// ═══════════════════════════════════════════════════════════════════════════
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
    console.log(`Switching forecast date to ${date}…`);
    anim.setDate(date);
    // The flood forecast styles read the same initialization date, so they refetch too.
    if (floodStyle === "forecast" || floodStyle === "forecastmax") {
      fcPause();
      loadForecastFlows();
    }
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
        console.log(`“${label}” styleset is a placeholder — not available yet.`);
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
  if (floodStyle === "forecast" || floodStyle === "forecastmax") loadForecastFlows();
});

// ═══════════════════════════════════════════════════════════════════════════
// GeoTIFF export
// ═══════════════════════════════════════════════════════════════════════════
function updateSaveButton() {
  ;
  $("btn-save-geotiff").disabled = !(floodEnabled && lastFloodedCells > 0);
}

function currentQLabel() {
  if (floodStyle === "manual") return `${Number($("uniform").value)}cms`;
  if (floodStyle === "forecastmax") return `fcmax_${currentForecastDate}`;
  if (floodStyle === "forecast") return `fc_${currentForecastDate}_t${String(fcStep).padStart(2, "0")}`;
  const i = Math.min(Math.round(Number($("ladder").value)), ladderLabels.length - 1);
  return (flowsSpec?.ladderLabels?.[i] ?? ladderLabels[i]).replace(/[^\w.-]+/g, "");
}

function saveFloodGeoTiff(msg) {
  if (!msg.extent) {
    console.error("No flood map to export.");
    return;
  }
  const buf = encodeExtentGeoTiff({
    width: msg.width,
    height: msg.height,
    bounds: msg.bounds,
    data: new Uint8Array(msg.extent)
  });
  const url = URL.createObjectURL(new Blob([buf], {type: "image/tiff"}));
  const a = document.createElement("a");
  a.href = url;
  a.download = `flood_extent_${msg.tile}_${currentQLabel()}.tif`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  console.log(`Saved ${a.download} · ${msg.flooded.toLocaleString()} flooded cells.`);
}

$("btn-save-geotiff").addEventListener("click", () => {
  if (!workerReady || lastFloodedCells === 0) return;
  worker.postMessage({type: "export", id: Date.now()});
});

// ═══════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════
syncLadderLabel();
initStreamStyleControls();
initFloodStyleControls();

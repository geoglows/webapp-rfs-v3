import {Selection} from "./selection";
import {FloodMapsTilesLayer} from "./tilesLayer";
import {FloodOverlay} from "./overlay";
import {flowsAtLadderPosition, uniformFlows} from "./hydro";
import {legendGradient} from "./colormap";
import {getConfig} from "riverforecastsystem/v3";
import {t} from "../../../../shared/i18n/i18n";
import {onStreamsVisibility, streamsVisible} from "../layers";
import {$} from "../../../../shared/dom.js";


// What the ladder slider's stops are called before the worker has sent a spec carrying the real
// list. Must match LADDER_LABELS in mapper.js, which is where they are actually derived.
const LADDER_LABELS = ["q1", "q2", "q3", "q8", "q12", "q15", "q18", "q22", "q25", "q28", "q30"];

// Per-style control panel. "forecastmax" needs no input beyond the selection; "returnperiod" is in
// the picker but not built yet, so it has nothing to show either.
const FLOOD_STYLE_CTL = {
  manual: "qctl-uniform",
  ratingcurve: "qctl-ladder",
  forecast: "qctl-forecast"
};

// In the flood style picker, but with nothing behind it yet — selecting it says so rather than
// quietly drawing nothing. See flowsForFloodStyle().
const UNBUILT_STYLES = new Set(["returnperiod"]);

/**
 * Flood mapping: the worker protocol, the reach selection, the discharge styles that drive the
 * extent, the forecast player, and the GeoTIFF export. Owns the flood worker, the extent canvas
 * (overlay.js), the flood-map data-tile footprints (tilesLayer.js), and the reach picker (selection.js).
 *
 * getForecastDate() is read at fetch time so a date change is picked up without re-wiring.
 * isMapLoaded() guards the overlay rebuild, which needs the map's layers to exist.
 */
function createFloodController({map, streams, getForecastDate, isMapLoaded}) {
  // The worker is expensive to stand up (it fetches the flood-map manifest and pulls in the Zarr codec
  // WASM), and flood mapping is off until the user asks for it — so it's built on first use.
  let worker = null;
  let workerReady = false;
  let floodView = null;
  // Global coverage bitset from the flood root (bit riverIndex, little-endian): whether the library
  // holds a reach anywhere on earth, known once the worker is ready. Independent of the viewport.
  let coveredBits = null;
  const hasCoverage = (riverIndex) => coveredBits
    ? ((coveredBits[riverIndex >> 3] >> (riverIndex & 7)) & 1) === 1
    : false;
  let selectSeq = 0;
  let flowsSpec = null;
  let frameInFlight = false;
  let pendingFlood = false;
  let lastFloodedCells = 0;
  let mappingMode = false;
  let selection = null;
  let current = {selected: [], floodable: []};
  // Which discharge drives the flood extent. "ratingcurve" = the per-reach synthetic rating curve
  // ladder, "manual" = one number for every reach, "forecast"/"forecastmax" = the reaches'
  // downloaded forecast hydrographs (animated over the horizon, or held at each reach's peak).
  // "returnperiod" is offered but not built — see UNBUILT_STYLES.
  let floodStyle = "ratingcurve";
  // Downloaded forecast for the current (date, selection): see loadForecastFlows().
  let forecastFlows = null;
  let forecastFlowsKey = "";
  let forecastLoading = false;
  let fcStep = 0;
  let fcPlaying = false;
  let fcTimer = null;
  let fcFps = 4;

  const floodOverlay = new FloodOverlay(map);
  const floodMapsTiles = new FloodMapsTilesLayer(map, {
    isReady: () => workerReady,
    onTiles: (tiles) => worker?.postMessage({type: "viewport", tiles})
  });

  // ---- worker ----

  // Idempotent: the first caller stands the worker up, everyone after gets the existing one.
  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./worker.js", import.meta.url), {type: "module"});
    worker.onmessage = onWorkerMessage;
    // The worker has its own instance of the package's config, blank like every other, so the v3
    // root travels in the init message for the worker to configure() itself with. src/rfsConfig.js
    // has already run on this side, so getConfig() is the absolutized url this app is reading.
    worker.postMessage({type: "init", v3Base: getConfig().v3Base});
    return worker;
  }

  function onWorkerMessage(ev) {
    const msg = ev.data;
    if (msg.type === "ready") {
      workerReady = true;
      $("legend-depth").style.background = `linear-gradient(to right, ${legendGradient()})`;
      coveredBits = new Uint8Array(msg.covered);
      console.log(`Flood index ready: ${msg.nTiles.toLocaleString()} tiles, global coverage loaded. Highlights load from the map viewport.`);
      selection?.refresh();
      refreshControls();
      floodMapsTiles.sync();
    } else if (msg.type === "coverage") {
      // The viewport-derived set only drives the on-screen "unmappable" highlight; whether a reach
      // can be mapped is answered by coveredBits above.
      selection?.setCoverage([...new Uint32Array(msg.coverage)]);
      console.log(`Flood highlight set: ${msg.nRivers.toLocaleString()} river(s) across ${msg.nActiveTiles} loaded tile(s).`);
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
      // The spec names the ladder's stops, so this is the first point the slider can be sized from.
      syncLadderRange();
      if (isMapLoaded()) floodOverlay.rebuild(floodView);
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
      void saveFloodGeoTiff(msg).catch((e) => console.error(`geotiff export: ${e.message}`));
    } else if (msg.type === "query") {
      $("readout").textContent = msg.depth == null ? "no flooding at that pixel" : `depth ≈ ${msg.depth.toFixed(2)} m`;
    } else if (msg.type === "error") {
      console.error(`flood worker: ${msg.message}`);
      $("flood-status").textContent = msg.message;
      frameInFlight = false;
    }
  }

  function requestSelect() {
    if (!workerReady || current.floodable.length === 0) return;
    $("flood-status").textContent = "Fetching river slices…";
    worker.postMessage({type: "select", id: ++selectSeq, riverIndices: current.floodable});
  }

  function queryDepth(lngLat) {
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
    // Selecting a reach IS the request now — there is no separate "create" step to press.
    if (mappingMode && workerReady && current.floodable.length > 0) {
      requestSelect();
      // The forecast is per-reach, so a changed selection needs a (cached-where-possible) refetch.
      if (usesForecast()) loadForecastFlows();
    } else clearFloodOverlay();
  }

  function clearFloodOverlay() {
    lastFloodedCells = 0;
    updateSaveButton();
    floodOverlay.clear();
  }

  function refreshControls() {
    $("btn-clear").disabled = !mappingMode || current.selected.length === 0;
    if (!mappingMode) $("flood-status").textContent = "Turn on flood mapping mode, then click reaches.";
    // Outranks the reach-count messages below: with nothing behind the style, how many reaches are
    // selected is not why nothing is being drawn, and saying so would send people looking at that.
    else if (UNBUILT_STYLES.has(floodStyle)) $("flood-status").textContent = t("flood.style.returnperiod.pending");
    else if (!workerReady) $("flood-status").textContent = "Loading flood index…";
    else if (current.floodable.length === 0) {
      $("flood-status").textContent = current.selected.length
        ? "Selected reaches have no flood-library coverage."
        : "Click reaches on the map to select them.";
    } else {
      $("flood-status").textContent = `${current.floodable.length} reach(es) flooding live — move the slider.`;
    }
  }

  // ---- discharge styles ----

  const usesForecast = () => floodStyle === "forecast" || floodStyle === "forecastmax";

  /** The stop the ladder slider is nearest, named. Falls back to the built-in list pre-spec. */
  function ladderLabel() {
    const labels = flowsSpec?.ladderLabels ?? LADDER_LABELS;
    const i = Math.min(Math.max(Math.round(Number($("ladder").value)), 0), labels.length - 1);
    return labels[i];
  }

  function syncLadderLabel() {
    $("ladder-val").textContent = ladderLabel();
  }

  /**
   * Point the slider at the stops the spec actually carries. The markup ships a range matching the
   * built-in labels, but the worker is the authority on how many points the ladder has — so a spec
   * with a different count moves the top of the range rather than leaving part of it unreachable
   * (or letting the slider run off the end of the list).
   */
  function syncLadderRange() {
    const max = (flowsSpec?.ladderLabels ?? LADDER_LABELS).length - 1;
    const el = $("ladder");
    if (Number(el.max) === max) return;
    el.max = String(max);
    if (Number(el.value) > max) el.value = String(max);
    syncLadderLabel();
  }

  // Per-reach discharge for the active flood style, or null when the style's data isn't ready yet
  // (the forecast styles need their download to land first).
  function flowsForFloodStyle() {
    if (UNBUILT_STYLES.has(floodStyle)) return null;
    if (floodStyle === "manual") return uniformFlows(flowsSpec, Number($("uniform").value));
    if (floodStyle === "ratingcurve") return flowsAtLadderPosition(flowsSpec, Number($("ladder").value));
    if (!forecastFlows) return null;
    // forecasts is Map(riverIndex -> {riverIndex, median, peak, memberCount}) — the per-reach
    // median series and its peak, so both forecast styles read off the same entry.
    const out = new Map();
    for (const [riverIndex, entry] of forecastFlows.forecasts) {
      const v = floodStyle === "forecastmax"
        ? entry.peak
        : entry.median[Math.min(fcStep, entry.median.length - 1)];
      if (Number.isFinite(v)) out.set(riverIndex, v);
    }
    return out;
  }

  function computeFlood() {
    if (!mappingMode || !flowsSpec || !floodView || !workerReady || current.floodable.length === 0) return;
    if (frameInFlight) {
      pendingFlood = true;
      return;
    }
    const full = flowsForFloodStyle();
    if (!full) return;
    const flows = [];
    for (const riverIndex of current.floodable) if (full.has(riverIndex)) flows.push([riverIndex, full.get(riverIndex)]);
    if (flows.length === 0) return;
    frameInFlight = true;
    $("flood-status").textContent = "Computing…";
    worker.postMessage({type: "frame", id: Date.now(), flows});
  }

  function setFloodStyle(style) {
    floodStyle = style;
    for (const [name, id] of Object.entries(FLOOD_STYLE_CTL)) $(id).classList.toggle("hidden", name !== style);
    // Nothing behind this one yet: drop whatever the last style drew, rather than leaving its extent
    // on the map looking like this style's output, and say why in the status line.
    if (UNBUILT_STYLES.has(style)) {
      fcPause();
      clearFloodOverlay();
      refreshControls();
      return;
    }
    if (!usesForecast()) {
      fcPause();
      computeFlood();
      return;
    }
    // Forecast styles need the selection's hydrographs; loadForecastFlows() computes once the
    // download lands (and is a no-op when the cached download already matches date + selection).
    if (style !== "forecast") fcPause();
    loadForecastFlows();
  }

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
    // The selection is already in riverIndex, which is the forecast store's row axis — so the
    // download needs no id lookup at all, and its result map comes back keyed the same way.
    const ids = [...current.floodable].sort((a, b) => a - b);
    const date = getForecastDate();
    const key = `${date}|${ids.join(",")}`;
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
      const {forecastsBulk} = await import("riverforecastsystem/v3/discharge");
      const fc = await forecastsBulk({
        date,
        riverIndices: ids,
        onProgress: (done, total) => {
          $("flood-status").textContent = `Downloading forecast… ${done}/${total} reach(es)`;
        }
      });
      // The selection (or date) may have moved on while the download was in flight.
      stale = `${getForecastDate()}|${[...current.floodable].sort((a, b) => a - b).join(",")}` !== key;
      if (stale) {
        // fall through to the retry below
      } else if (fc.forecasts.size === 0) {
        console.error(`No selected reach is present in the ${date} forecast store.`);
        $("flood-status").textContent = "None of the selected reaches are in this forecast.";
      } else {
        forecastFlows = fc;
        forecastFlowsKey = key;
        fcStep = Math.min(fcStep, fc.time.length - 1);
        if (fc.missing.length) {
          console.log(`${fc.missing.length} selected reach(es) are absent from the ${date} forecast — skipped.`);
        }
        console.log(`Forecast flows: ${fc.forecasts.size} reach(es) × ${fc.time.length} steps for ${date}.`);
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

  // ---- forecast player ----

  function syncForecastPlayer() {
    const slider = $("fc-slider");
    const playBtn = $("btn-fc-play");
    const nSteps = forecastFlows?.time.length ?? 0;
    const ready = nSteps > 1;
    slider.disabled = !ready;
    playBtn.disabled = !ready;
    slider.max = String(Math.max(0, nSteps - 1));
    slider.value = String(fcStep);
    $("fc-step-label").textContent = nSteps ? `${fcStep + 1}/${nSteps}` : "–/–";
    const when = forecastFlows?.time[fcStep];
    $("fc-time-label").textContent = when ? when.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
    if (!ready) fcPause();
  }

  function fcSetStep(step) {
    const n = forecastFlows?.time.length ?? 0;
    if (!n) return;
    fcStep = (step % n + n) % n;
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

  // ---- GeoTIFF export ----

  function updateSaveButton() {
    $("btn-save-geotiff").disabled = !(mappingMode && lastFloodedCells > 0);
  }

  function currentQLabel() {
    if (floodStyle === "manual") return `${Number($("uniform").value)}cms`;
    if (floodStyle === "forecastmax") return `fcmax_${getForecastDate()}`;
    if (floodStyle === "forecast") return `fc_${getForecastDate()}_t${String(fcStep).padStart(2, "0")}`;
    return ladderLabel().replace(/[^\w.-]+/g, "");
  }

  // The encoder is only ever reached from the Save button, so it loads on demand rather than
  // riding along in the entry bundle.
  async function saveFloodGeoTiff(msg) {
    if (!msg.extent) {
      console.error("No flood map to export.");
      return;
    }
    const {encodeExtentGeoTiff} = await import("./geotiff");
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

  // ---- mode ----

  /**
   * Flood mapping mode. What it changes is what a click on a reach does — inspect it in the charts
   * dock, or add it to the flood selection (see the map click handler in main.js). Everything else
   * follows from that: the selection highlights, the data-tile footprints, and the flood raster
   * that selecting a reach now produces directly.
   */
  function setMappingMode(on) {
    mappingMode = on;
    // First entry into flood mode is what stands the worker up; see ensureWorker().
    if (on) {
      ensureWorker();
      streams.setInspectHighlight(null);
      // Drop the hydrology styler back to plain lines, so the coloured/variable-width network is
      // not competing with the selection highlights drawn over it. Routed through the select's own
      // change event rather than the styler, so the control and panelControls' state agree; the
      // control stays enabled, so any style can be picked back up from here.
      const styleSel = $("stream-style");
      if (styleSel && styleSel.value !== "standard") {
        styleSel.value = "standard";
        styleSel.dispatchEvent(new Event("change"));
      }
    }
    // One thickness for every reach while in flood mode, so the selection highlights read as the
    // only width on the map. Restored on the way out.
    streams.setUniformWidth(on);
    const btn = $("btn-flood-mode");
    btn.classList.toggle("active", on);
    btn.textContent = t(on ? "flood.disable" : "flood.enable");
    $("flood-controls").classList.toggle("mode-off", !on);
    // Data-tile footprints follow the mode, and start/stop tracking the viewport with it.
    floodMapsTiles.setActive(on);
    syncSelectionLayers();
    refreshControls();
    // A selection survives the mode being switched off, so coming back on has to re-raise it —
    // nothing else will, since no click happened. On the very first entry the worker isn't up yet
    // and there is nothing selected; the coverage message drives the first render instead.
    if (!on) clearFloodOverlay();
    else if (workerReady && current.floodable.length > 0) {
      requestSelect();
      if (usesForecast()) loadForecastFlows();
    }
  }

  // The selection/coverage highlights are streams too, so they carry both gates: flood mode draws
  // them at all, and the streams toggle (layers.js) decides whether any stream is on screen.
  function syncSelectionLayers() {
    const show = mappingMode && streamsVisible();
    for (const id of ["flood-maps-unmappable", "sel-selected", "sel-floodable", "sel-clicked"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    }
  }

  // ---- wiring ----

  $("btn-flood-mode").addEventListener("click", () => setMappingMode(!mappingMode));
  // Streams are shown/hidden from the layer picker (layers.js); the highlights drawn over them
  // have to follow, so this tracks that toggle rather than owning a control of its own.
  onStreamsVisibility(syncSelectionLayers);
  $("flood-style").addEventListener("change", (e) => setFloodStyle(e.target.value));
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
  $("ladder").addEventListener("input", () => {
    syncLadderLabel();
    computeFlood();
  });
  $("uniform").addEventListener("input", computeFlood);
  $("btn-save-geotiff").addEventListener("click", () => {
    if (!workerReady || lastFloodedCells === 0) return;
    worker.postMessage({type: "export", id: Date.now()});
  });

  $("flood-style").value = floodStyle;
  syncLadderLabel();
  setFloodStyle(floodStyle);
  refreshControls();

  /** Add the flood-related map layers and stand up the reach picker. Call once, on map load. */
  function onMapLoad() {
    // floodMapsTiles adds itself on first entry into flood mode — see FloodMapsTilesLayer.add().
    // Coverage is the set of riverIndex values the loaded tiles' river directories hold.
    selection = new Selection(map, onSelectionChange, hasCoverage);
    selection.addHighlightLayers();
  }

  return {
    onMapLoad,
    isMappingMode: () => mappingMode,
    /** Toggle a reach, given by riverIndex, in the flood selection. */
    selectReach: (riverIndex) => selection?.select(riverIndex),
    queryDepth,
    /** The forecast styles read the initialization date, so they refetch when it changes. */
    onForecastDateChange() {
      if (!usesForecast()) return;
      fcPause();
      loadForecastFlows();
    }
  };
}

export {createFloodController};

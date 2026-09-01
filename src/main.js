import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/explorer.css";
import "./account/auth.js";  // must be first: registers the auth listener before anything else runs
import "./settings/rfsConfig.js"
import {initLanguagePicker, initSettings, initThemeToggle, onSetting, TOOLS} from "./settings/settings.js";
import {startUserSync} from "./account/userSync.js";

import {initMap} from "./map/map";
import {initBasemapPicker} from "./map/basemaps.js";
import {
  addRasterLayer, applyStreamsVisibility, initLayerPicker, limitLayersToTools, streamLayers,
  syncLayerPicker
} from "./map/layers";
import {attachReferences, hoverRegions} from "./map/references.js";
import {Streams} from "./map/Streams.js";
import {focusRiver, frameRiverExtent, nearestFeature, snapToFeature, travelToRiver} from "./map/framing";
import {build, status} from "./data/riverIndex";
import {dropLegacyDatabase} from "./data/db.js";
import {watch as watchRiverNames} from "./data/riverNames";
import {hydrateIcons} from "./icons/icons";
import {onSavedRiversChange, savedRiverIds} from "./account/savedRivers.js";
import {closeAllDocks} from "./docks/dock.js";
import {createHelpDock} from "./docks/help.js";
import {createDataSettings} from "./ui/dataSettings";
import {createRiverSearch} from "./ui/riverSearch";
import {wireModals} from "./ui/modals.js";
import {$, whenIdle} from "./dom.js";


// ═══════════════════════════════════════════════════════════════════════════
// Toolchains · which sets of tools this build ships
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Take the toolchains this deployment left out off the page, before anything is wired.
 *
 * Removed rather than hidden: every feature below finds its controls by id, and an id that is
 * still in the document but belongs to a tool nobody asked for is exactly the sort of thing that
 * gets wired by accident. What is left is a page with no trace of the tools it does not have.
 *
 * Each toolchain's code is behind a dynamic import in boot(), so it is a chunk of its own that a
 * build without that tool never fetches.
 */
function dropDisabledTools() {
  for (const node of document.querySelectorAll("[data-tool]")) {
    if (!TOOLS[node.dataset.tool]) node.remove();
  }
  limitLayersToTools((name) => TOOLS[name]);
}

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

let currentForecastDate = "2026-07-10" // todo newestForecastExpected();
// Which styleset the network opens on. Standard is the one that leaves the network to the styling
// section, so a build without the forecast tools starts there.
let currentStyleset = TOOLS.forecast ? "max-flow" : "standard";
let mapLoaded = false;

// The map and everything built on it. Assigned by boot() once initMap() has resolved — the map is
// no longer made at import time, so the features that need one cannot be either. Everything above
// boot() reads these rather than closing over them, and the header chrome that is wired before the
// map exists (theme, language, the Settings modal) reaches them with `?.`.
let map = null;
let streams = null;
let flood = null;
let chartsDock = null;
let panelControls = null;
// The hydrography toolchains, when this build has either of them — see src/explorer/explorer.js.
let explorer = null;

// Counter monitors which selection/animation the camera belongs to.
// A move waiting on the panel can tell it has been overtaken by a later command.
let cameraSeq = 0;

/**
 * Point the app at a reach: open the charts for it, then move the camera to it.
 *
 * In that order, and never at once. The dock opening is what changes the size of the map, and a
 * camera animation running while that happens misses — MapLibre aims an ease at a screen point it
 * decided on before the map was resized. So the layout goes first and the camera last, with nothing
 * left afterward to move the reach out from under it. The wait costs nothing that is worth having:
 * the charts' downloads are already in flight from the line above, behind the spinner, and the panel
 * transition is the only thing being waited on.
 *
 * `move` is how this reach was arrived at — traveled to deliberately, or clicked on the map.
 */
async function showRiver(river, {location = river, target = river, move = travelToRiver} = {}) {
  // Without the forecast tools there are no charts to open, so the camera is the whole of it.
  if (!chartsDock) return void move(map, target);
  const seq = ++cameraSeq;
  await chartsDock.openForRiver(river, location);
  // Another reach was picked while the panel was widening — that one owns the camera now, and this
  // move would drag the view back off it.
  if (seq === cameraSeq) move(map, target);
}

/**
 * A river found by name arrives as a whole river: an extent to frame and a span of the network to
 * paint, both passed beside the reach rather than inside it. Everything else — a saved river, a
 * searched ID, a click — is one reach, travelled to as a point, and clears the highlight rather
 * than leaving the last named river lit under it.
 *
 * The explorer selects the same river, so its readouts and the attribute list follow a search the
 * way they follow a click — but the camera is this side's, since only this side knows the charts
 * are about to resize the map under it.
 */
const goToRiver = (river, named) => {
  streams.setNamedRiver(named?.span ?? null);
  explorer?.goToRiver(river, named, {camera: false});
  // The extent rides in `target`, which only the camera sees — never in `river`, which the charts
  // dock renders field by field as the reach's attributes.
  void showRiver(river, named?.bbox
    ? {target: {bbox: named.bbox, lat: river.lat, lon: river.lon}, move: frameRiverExtent}
    : {move: travelToRiver});
};

// ═══════════════════════════════════════════════════════════════════════════
// Background work · started once the app is up, never waited on
// ═══════════════════════════════════════════════════════════════════════════
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
// Chrome · wired before the map, because none of it waits on one
// ═══════════════════════════════════════════════════════════════════════════
dropDisabledTools();
hydrateIcons()
// The caches moved to a database shared with the hydrography explorer; the one this app used alone
// is dead weight on any device that ever searched by ID.
dropLegacyDatabase();
initSettings();

// The Settings data list. Constructed here rather than with the rest of the modal chrome because
// the background prefetch below has to be able to tell it to re-read — a download the panel didn't
// start still belongs on its row.
const dataSettings = createDataSettings();

// The text that walking [data-i18n] cannot reach: the slider and legend buttons, whose labels
// depend on their state, and the charts, whose axis titles are drawn into a canvas. Both are the
// map's, so both are absent until boot() has built them — a language switched before then is
// simply the language they are built in. The explorer's readouts, its On/Off pills and the styling
// editor are in the same position.
initLanguagePicker(() => {
  panelControls?.updateSliderVisibility();
  panelControls?.updateLegendButton();
  chartsDock?.rerenderCharts();
  explorer?.repaint();
  if (map) syncLayerPicker(map);
});

// Charts bake their axis/text/grid colors at construction, so any on screen need repainting.
initThemeToggle(() => chartsDock?.restyleCharts());

// The cog opens the dialog, ✕ and the backdrop and Escape close it. Escape closes the docks too,
// which is this app's own — the dialogs are the shared part.
wireModals({onEscape: () => map && closeAllDocks(map)});

// ═══════════════════════════════════════════════════════════════════════════
// Boot · the map, the features built on it, and the click handling
// ═══════════════════════════════════════════════════════════════════════════
async function boot() {
  map = await initMap();

  // The pickers that float over the map. They were called from map/map.js while the map was an
  // import-time singleton; they are UI, they need a map to act on, and this is where both are true.
  initBasemapPicker(map);
  initLayerPicker(map);

  streams = new Streams(map, {styleset: currentStyleset});
  streams.addStreamsLayer();
  applyStreamsVisibility(map);
  addRasterLayer(map);
  syncLayerPicker(map);
  // Reference geography, whatever tools this build ships: the catchments, the group boundaries and
  // HydroBASINS are map reference, and each attaches if and when its archive answers. Every arrival
  // re-reads the layer picker, so a layer stops reporting as unpublished the moment it is real.
  attachReferences({onChange: () => syncLayerPicker(map)});

  // The hydrography toolchains, if either is in this build. Dynamically imported so a deployment
  // without them does not ship the selection arithmetic or the style compiler at all.
  if (TOOLS.hydrography || TOOLS.styling) {
    const {initExplorer} = await import("./explorer/explorer.js");
    explorer = initExplorer({
      tools: TOOLS,
      styleset: currentStyleset,
      // What repaints the network when a forecast styleset takes it back off the style spec.
      onRepaintNetwork: () => streams.applyPaint(),
      // The style spec only draws the network under the Standard styleset, so opening the editor
      // asks for it — otherwise every rule and preset in there is a no-op on a forecast-coloured
      // network, with nothing on screen to say why.
      onStyleEditor: () => panelControls?.chooseStyleset("standard")
    });
  }

  if (TOOLS.flood) {
    const {createFloodController} = await import("./flood/floodController");
    flood = createFloodController({
      map,
      streams,
      getForecastDate: () => currentForecastDate,
      isMapLoaded: () => mapLoaded
    });
  }

  if (TOOLS.forecast) {
    const [{createChartsDock}, {createBookmarksDock, createSavedRiversDock}, {createPanelControls}] =
      await Promise.all([
        import("./docks/charts.js"),
        import("./docks/bookmarks.js"),
        import("./ui/panelControls.js")
      ]);
    chartsDock = createChartsDock({map, streams, getForecastDate: () => currentForecastDate});
    // A saved river arrives whole: id, position on the zarr riverId axis, and outlet coordinate. The
    // two lists are the same table over different rows — the app's defaults, and the user's own.
    createBookmarksDock({map, onSelectRiver: goToRiver});
    createSavedRiversDock({map, onSelectRiver: goToRiver});

    // The pink outline on saved reaches. Set now for what was saved in an earlier session and again
    // on every change; the map re-applies it as tiles arrive, so nothing here waits for the map.
    streams.setSavedRivers(savedRiverIds());
    onSavedRiversChange((saved) => streams.setSavedRivers(saved.map((e) => e.riverId)));

    panelControls = createPanelControls({
      streams,
      onStylesetChange: (styleset) => {
        currentStyleset = styleset;
        // Standard is the network as the styling section draws it; every other styleset paints it
        // from the forecast and takes the base layer back. Told after streams, whose repaint is
        // what the handing back lands on.
        explorer?.setStyleset(styleset);
      },
      onForecastDateChange: (date) => {
        currentForecastDate = date;
        flood?.onForecastDateChange();
      }
    });

    onSetting("shadedWarningLevels", () => chartsDock.rerenderCharts());
    // Fires before the layer is built, so Streams holds the answer and builds the layer with it.
    onSetting("savedHighlight", (on) => streams.setSavedHighlightVisible(on));
  }

  createHelpDock({map});

  onSetting("legend", (on) => {
    $("legend-overlay").classList.toggle("hidden", !on);
    panelControls?.updateLegendButton();
  });

  // A searched river arrives resolved to the same three things a saved one carries — id, index, and
  // where it is — so it is gone to the same way.
  createRiverSearch({
    onFound: goToRiver,
    onClear: () => {
      streams.setNamedRiver(null);
      explorer?.clearSelection();
    }
  });

  flood?.onMapLoad();
  console.log("Basemap + streams loaded.");
  mapLoaded = true;

  map.on("click", (e) => {
    const pad = 10;
    const box = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad]
    ];
    const feats = map.queryRenderedFeatures(box, {layers: streamLayers()});
    // Nearest to the pointer, not first in draw order — see nearestFeature.
    const hit = nearestFeature(feats.filter((f) => f.properties?.riverId != null), e.lngLat);
    if (flood?.isMappingMode()) {
      // In mapping mode the click is a reach selection, not a navigation — leave the view alone.
      // Flood mapping addresses reaches by riverIndex (the tile carries it), never by riverId.
      if (hit) {
        if (hit.properties.riverIndex != null) flood.selectReach(Number(hit.properties.riverIndex));
      } else {
        flood.queryDepth(e.lngLat);
      }
      return;
    }
    // The explorer reads the click first. Four of its five methods are answering a question about
    // the network — a reach, a watershed, an area of interest, a collection — and say so by taking
    // the click; the Data Browser does not, so the reach goes on to open its charts.
    if (explorer?.onMapClick(e, hit)) return;
    if (!hit) return;
    // The reach itself rather than where the pointer landed, which at low zoom are nowhere near
    // each other — the query box above is ±10px, and that is a couple of hundred kilometres of
    // tolerance when the whole world is on screen.
    const at = snapToFeature(hit, e.lngLat) ?? {lat: e.lngLat.lat, lon: e.lngLat.lng};
    // That point comes along as the reach's location: saving it from here then costs no lookup at
    // all, since the tile already carried the index and this is where it is.
    streams.setNamedRiver(null);
    void showRiver(hit.properties, {location: at, target: at, move: focusRiver});
  });

  // One pointer pass for both: what the cursor says a click would do, and the reference polygons
  // under it lighting up. On mousemove rather than on the layer's enter/leave, because the styling
  // section rebuilds the network's layers on every edit and a per-layer subscription would be left
  // watching layers that no longer exist.
  map.on("mousemove", (e) => {
    const over = map.queryRenderedFeatures(e.point, {layers: streamLayers()}).length > 0;
    map.getCanvas().style.cursor = over ? "pointer" : "";
    hoverRegions(e.point);
  });
  map.on("mouseout", () => hoverRegions(null));

  panelControls?.initForecastDatePicker({defaultDate: currentForecastDate});
  void streams.setDate(currentForecastDate);
  whenIdle(prefetchRiverIndex);
  // Not a prefetch: the names are fetched when the search box is first opened, and this only keeps
  // whatever copy the device has from going stale under a session left open past the 5th.
  watchRiverNames();
  startUserSync();
}

void boot();

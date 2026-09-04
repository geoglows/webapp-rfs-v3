import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/explorer.css";
import "./styles/report.css";
import "./account/auth.js";  // must be first: registers the auth listener before anything else runs
import "./settings/rfsConfig.js"
import {initLanguagePicker, initSettings, initThemeToggle, onSetting} from "./settings/settings.js";
import {startUserSync} from "./account/userSync.js";

import {initMap} from "./map/map";
import {initBasemapPicker} from "./map/basemaps.js";
import {addRasterLayer, applyStreamsVisibility, initLayerPicker, streamLayers, syncLayerPicker} from "./map/layers";
import {attachReferences, hoverRegions} from "./map/references.js";
import {Streams} from "./map/Streams.js";
import {focusRiver, frameRiverExtent, nearestFeature, snapToFeature, travelToRiver} from "./map/framing";
import {build, status} from "./data/riverIndex";
import {watch as watchRiverNames} from "./data/riverNames";
import {hydrateIcons} from "./icons/icons";
import {onSavedRiversChange, savedRiverIds} from "./account/savedRivers.js";
import {closeAllDocks} from "./docks/dock.js";
import {createHelpDock} from "./docks/help.js";
import {createDataSettings} from "./ui/dataSettings";
import {createRiverSearch} from "./ui/riverSearch";
import {wireModals} from "./ui/modals.js";
import {$, whenIdle} from "./dom.js";
import {initExplorer} from "./explorer/explorer.js";
import {createFloodController} from "./flood/floodController";
import {createChartsDock} from "./docks/charts.js";
import {createBookmarksDock, createSavedRiversDock} from "./docks/bookmarks.js";
import {createPanelControls} from "./ui/panelControls.js";
import {createReportModal} from "./reports/reports.js";

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

let currentForecastDate = newestForecastExpected();
// Which styleset the network opens on.
let currentStyleset = "max-flow";
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
// The hydrography explorer — see src/explorer/explorer.js.
let explorer = null;
let helpDock = null;

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
 *
 * `charts` is whether this reach is being asked about or only being shown. Off, the river is put on
 * the map and travelled to and nothing else: no dock opens, so nothing resizes the map and the
 * camera can go straight away.
 */
const goToRiver = (river, named, {charts = true} = {}) => {
  streams.setNamedRiver(named?.span ?? null);
  explorer?.goToRiver(river, named, {camera: false});
  // The extent rides in `target`, which only the camera sees — never in `river`, which the charts
  // dock renders field by field as the reach's attributes.
  const view = named?.bbox
    ? {target: {bbox: named.bbox, lat: river.lat, lon: river.lon}, move: frameRiverExtent}
    : {target: river, move: travelToRiver};
  if (!charts) {
    // Still claim the camera, so a move left waiting on a dock from a moment ago does not land
    // afterward and drag the view off this river.
    cameraSeq++;
    view.move(map, view.target);
    return;
  }
  void showRiver(river, view);
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
hydrateIcons()
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
  // …and the help dock's copies of those sections and buttons, which are clones of them.
  helpDock?.repaint();
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
  // Reference geography: the catchments, the group boundaries and HydroBASINS are map reference, and each attaches if and when its archive answers. Every arrival
  // re-reads the layer picker, so a layer stops reporting as unpublished the moment it is real.
  attachReferences({onChange: () => syncLayerPicker(map)});

  explorer = initExplorer({
    styleset: currentStyleset,
    // What repaints the network when a forecast styleset takes it back off the style spec.
    onRepaintNetwork: () => streams.applyPaint(),
    // The style spec only draws the network under the Standard styleset, so the two switches that
    // ask it to draw — the names coloring and the rule preview — ask for Standard too. Otherwise
    // they would be no-ops on a forecast-colored network, with nothing on screen to say why.
    onStyleEditor: () => panelControls?.chooseStyleset("standard"),
    // The explorer's Clear is the app's: the charts and the named-river highlight go with it.
    onClear: () => {
      chartsDock.clearSelection();
      streams.setNamedRiver(null);
    }
  });

  flood = createFloodController({
    map,
    streams,
    getForecastDate: () => currentForecastDate,
    isMapLoaded: () => mapLoaded
  });

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
      explorer.setStyleset(styleset);
    },
    onForecastDateChange: (date) => {
      currentForecastDate = date;
      flood.onForecastDateChange();
    }
  });

  onSetting("shadedWarningLevels", () => chartsDock.rerenderCharts());
  // Fires before the layer is built, so Streams holds the answer and builds the layer with it.
  onSetting("savedHighlight", (on) => streams.setSavedHighlightVisible(on));

  helpDock = createHelpDock({map});

  // Reports read the same forecast the panel is pointed at, and draw their figures with the same
  // chart code the dock does — which is module state, so a report destroys whatever chart the dock
  // had on screen. Repainting it afterwards is what onFinished is for.
  createReportModal({
    getForecastDate: () => currentForecastDate,
    onFinished: () => chartsDock?.rerenderCharts()
  });

  onSetting("legend", (on) => {
    $("legend-overlay").classList.toggle("hidden", !on);
    panelControls?.updateLegendButton();
  });

  // A searched river arrives resolved to the same three things a saved one carries — id, index, and
  // where it is — so it is gone to the same way. The charts only follow it in the Data Browser: the
  // other methods are asking about the network, and a search made while one of them is on is asking
  // where the river is, not for its forecast — the same split a map click is already read by.
  createRiverSearch({
    onFound: (river, named) => goToRiver(river, named, {charts: explorer.isBrowseMode()}),
    onClear: () => {
      streams.setNamedRiver(null);
      explorer.clearSelection();
    }
  });

  flood.onMapLoad();
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
    if (flood.isMappingMode()) {
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
    if (explorer.onMapClick(e, hit)) return;
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

  panelControls.initForecastDatePicker({defaultDate: currentForecastDate});
  void streams.setDate(currentForecastDate);
  whenIdle(prefetchRiverIndex);
  // Not a prefetch: the names are fetched when the search box is first opened, and this only keeps
  // whatever copy the device has from going stale under a session left open past the 5th.
  watchRiverNames();
  startUserSync();
}

void boot();

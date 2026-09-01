import "../../shared/styles/tokens.css";
import "../../shared/styles/base.css";
import "../../shared/styles/components.css";
import "./style.css";
import "./auth.js";  // must be first: registers the auth listener before anything else runs
import "../../shared/settings/rfsConfig.js"
import {initLanguagePicker, initSettings, initThemeToggle, onSetting} from "../../shared/settings/settings.js";
import {startUserSync} from "./userSync.js";

import {initMap} from "./map/map";
import {initBasemapPicker} from "../../shared/map/basemaps.js";
import {addRasterLayer, applyStreamsVisibility, initLayerPicker} from "./map/layers";
import {Streams} from "./map/Streams.js";
import {focusRiver, frameRiverExtent, nearestFeature, snapToFeature, travelToRiver} from "./map/framing";
import {createFloodController} from "./map/flood-maps/floodController";
import {build, status} from "../../shared/data/riverIndex";
import {dropLegacyDatabase} from "../../shared/data/db.js";
import {watch as watchRiverNames} from "../../shared/data/riverNames";
import {hydrateIcons} from "../../shared/icons/icons";
import {createChartsDock} from "./docks/charts.js";
import {createBookmarksDock, createSavedRiversDock} from "./docks/bookmarks.js";
import {onSavedRiversChange, savedRiverIds} from "./savedRivers.js";
import {closeAllDocks} from "./docks/dock.js";
import {createHelpDock} from "./docks/help.js";
import {createPanelControls} from "./ui/panelControls";
import {createDataSettings} from "../../shared/ui/dataSettings";
import {createRiverSearch} from "../../shared/ui/riverSearch";
import {wireModals} from "../../shared/ui/modals.js";
import {$} from "../../shared/dom.js";


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
 */
const goToRiver = (river, named) => {
  streams.setNamedRiver(named?.span ?? null);
  // The extent rides in `target`, which only the camera sees — never in `river`, which the charts
  // dock renders field by field as the reach's attributes.
  void showRiver(river, named?.bbox
    ? {target: {bbox: named.bbox, lat: river.lat, lon: river.lon}, move: frameRiverExtent}
    : {move: travelToRiver});
};

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
// Chrome · wired before the map, because none of it waits on one
// ═══════════════════════════════════════════════════════════════════════════
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
// simply the language they are built in.
initLanguagePicker(() => {
  panelControls?.updateSliderVisibility();
  panelControls?.updateLegendButton();
  chartsDock?.rerenderCharts();
});

// Charts bake their axis/text/grid colors at construction, so any on screen need repainting.
initThemeToggle(() => chartsDock?.restyleCharts());

// Escape closes the docks too, which is this page's own — the dialogs are the shared part.
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

  streams = new Streams(map);

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
  createHelpDock({map});

  // The pink outline on saved reaches. Set now for what was saved in an earlier session and again on
  // every change; the map re-applies it as tiles arrive, so nothing here waits for the map to load.
  streams.setSavedRivers(savedRiverIds());
  onSavedRiversChange((saved) => streams.setSavedRivers(saved.map((e) => e.riverId)));

  panelControls = createPanelControls({
    streams,
    onForecastDateChange: (date) => {
      currentForecastDate = date;
      flood.onForecastDateChange();
    }
  });

  onSetting("legend", (on) => {
    $("legend-overlay").classList.toggle("hidden", !on);
    panelControls.updateLegendButton();
  });
  onSetting("shadedWarningLevels", () => chartsDock.rerenderCharts());
  // Fires before the layer is built, so Streams holds the answer and builds the layer with it.
  onSetting("savedHighlight", (on) => streams.setSavedHighlightVisible(on));

  // A searched river arrives resolved to the same three things a saved one carries — id, index, and
  // where it is — so it is gone to the same way.
  createRiverSearch({onFound: goToRiver, onClear: () => streams.setNamedRiver(null)});

  streams.addStreamsLayer();
  applyStreamsVisibility(map);
  addRasterLayer(map);
  flood.onMapLoad();
  console.log("Basemap + streams loaded.");
  mapLoaded = true;
  map.on("click", (e) => {
    const pad = 10;
    const box = [
      [e.point.x - pad, e.point.y - pad],
      [e.point.x + pad, e.point.y + pad]
    ];
    const feats = map.queryRenderedFeatures(box, {layers: ["streams"]});
    // Nearest to the pointer, not first in draw order — see nearestFeature.
    const hit = nearestFeature(feats.filter((f) => f.properties?.riverId != null), e.lngLat);
    if (hit) {
      if (flood.isMappingMode()) {
        // In mapping mode the click is a reach selection, not a navigation — leave the view alone.
        // Flood mapping addresses reaches by riverIndex (the tile carries it), never by riverId.
        if (hit.properties.riverIndex != null) flood.selectReach(Number(hit.properties.riverIndex));
        return;
      }
      // The reach itself rather than where the pointer landed, which at low zoom are nowhere near
      // each other — the query box above is ±10px, and that is a couple of hundred kilometres of
      // tolerance when the whole world is on screen.
      const at = snapToFeature(hit, e.lngLat) ?? {lat: e.lngLat.lat, lon: e.lngLat.lng};
      // That point comes along as the reach's location: saving it from here then costs no lookup at
      // all, since the tile already carried the index and this is where it is.
      streams.setNamedRiver(null);
      void showRiver(hit.properties, {location: at, target: at, move: focusRiver});
      return;
    }
    if (flood.isMappingMode()) flood.queryDepth(e.lngLat);
  });
  map.on("mouseenter", "streams", () => map.getCanvas().style.cursor = "pointer")
  map.on("mouseleave", "streams", () => map.getCanvas().style.cursor = "");
  panelControls.initForecastDatePicker({defaultDate: currentForecastDate});
  void streams.setDate(currentForecastDate);
  whenIdle(prefetchRiverIndex);
  // Not a prefetch: the names are fetched when the search box is first opened, and this only keeps
  // whatever copy the device has from going stale under a session left open past the 5th.
  watchRiverNames();
  startUserSync();
}

void boot();

import {addProtocol, Map as MaplibreMap, NavigationControl, setWorkerUrl} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {Protocol} from "pmtiles";
import {basemapStyle, setBasemap} from "./basemaps.js";
import {logMapErrors} from "./errors.js";
import {mapReady} from "./ready.js";
import {MAP_CENTER, MAP_DEFAULT_BASEMAP, MAP_ZOOM} from "../settings/settings.js";

setWorkerUrl(maplibreWorkerUrl);

/**
 * The map, once initMap() has made it. A module-level binding rather than a return value alone
 * because the picker and the layer modules read it by import; nothing may touch it before the
 * promise resolves.
 */
let map = null;

/**
 * The one PMTiles protocol on the page. Exported because the hydrography archives are opened
 * directly as well as drawn — the stream attributes are read off `archive.getMetadata()`, and each
 * reference archive is probed before its layers are added — and `protocol.add()` is what makes the
 * instance doing the reading the same one the map's `pmtiles://` sources fetch through.
 */
const protocol = new Protocol({metadata: true});

/**
 * Build the map and wait for its first frame.
 *
 * The basemap raster sets are in the initial style rather than added on load — see
 * map/basemaps.js — so the ground is drawn before anything else, and every layer this app
 * adds afterwards lands above it without having to compute a `beforeId`. The Esri vector basemap
 * is the one that cannot be declared up front; when it is the configured default, setBasemap()
 * below starts fetching it and the map opens on whatever it has until it lands.
 */
async function initMap() {
  addProtocol("pmtiles", protocol.tile);

  const {sources, layers} = basemapStyle(MAP_DEFAULT_BASEMAP);

  map = new MaplibreMap({
    container: "map",
    style: {version: 8, sources, layers},
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    hash: "map",
    maxZoom: 13,
    // Flat, always. Nothing here reads better tilted — the streams, the flood extents and the raster
    // overlays are all draped on the ground — and a pitched view makes a reach harder to aim at. The
    // ceiling is what actually holds it flat, including against a pitch arriving in the URL hash; the
    // two gesture options stop a right-drag or a two-finger drag from trying in the first place.
    maxPitch: 0,
    pitchWithRotate: false,
    touchPitch: false,
    localIdeographFontFamily: "sans-serif",
    // esri environment basemap asks for some broken fonts which we need to correct
    transformRequest: (url) => {
      if (/\/fonts\/[^/]*(?:,|%2C)/i.test(url)) {
        return {url: url.replace(/\/fonts\/([^/]+)\//, (_, stack) => `/fonts/${stack.split(/,|%2C/i)[0]}/`)};
      }
      return undefined;
    }
  });

  // Registered before the wait below, so a failure during it is reported.
  logMapErrors(map);

  // Shift-click is how a river is added to the explorer's multi-select collection, and MapLibre's
  // box zoom eats the click that ends a shift-drag. Scroll and the +/- control already zoom.
  map.boxZoom.disable();

  map.addControl(new NavigationControl({showCompass: true, visualizePitch: false}), "top-left");
  await mapReady(map);
  // After the style is up, because switching a basemap is `setLayoutProperty` on layers that have
  // to exist — and not awaited, because the vector basemap is three portal-item fetches and
  // nothing else on the page is waiting to hear about the ground. For a raster default this is a
  // no-op: the initial style already has it switched on.
  void setBasemap(map, MAP_DEFAULT_BASEMAP);
  return map;
}

export {initMap, map, protocol};

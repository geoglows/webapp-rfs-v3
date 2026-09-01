import {addProtocol, Map as MaplibreMap, NavigationControl, setWorkerUrl} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {Protocol} from "pmtiles";
import {basemapStyle, setBasemap} from "../../../shared/map/basemaps.js";
import {mapReady} from "../../../shared/map/ready.js";
import {MAP_CENTER, MAP_DEFAULT_BASEMAP, MAP_ZOOM} from "../../../shared/settings/settings.js";

setWorkerUrl(maplibreWorkerUrl);

/**
 * The map, once initMap() has made it. A module-level binding rather than a return value alone
 * because the picker and the layer modules read it by import; nothing may touch it before the
 * promise resolves.
 */
let map = null;

/**
 * Build the map and wait for its first frame.
 *
 * The basemap raster sets are in the initial style rather than added on load — see
 * shared/map/basemaps.js — so the ground is drawn before anything else, and every layer this app
 * adds afterwards lands above it without having to compute a `beforeId`. The Esri vector basemap
 * is the one that cannot be declared up front; when it is the configured default, setBasemap()
 * below starts fetching it and the map opens on whatever it has until it lands.
 */
async function initMap() {
  const protocol = new Protocol({metadata: true});
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

  // MapLibre flattens every failure into a generic `error` event, so a bad tile fetch arrives as
  // nothing but "Bad response code: 404". The source id and url live on the event, not the message —
  // log them too, otherwise the console says something went wrong without saying what. Registered
  // here rather than by the caller, so a failure during the load this function waits on is reported.
  map.on("error", (e) => {
    if (!e?.error) return;
    const where = e.sourceId ? ` [${e.sourceId}]` : "";
    console.error(`map${where}: ${e.error.message}`, e.error.url ?? "");
  });

  map.addControl(new NavigationControl({showCompass: true, visualizePitch: false}), "top-left");
  await mapReady(map);
  // After the style is up, because switching a basemap is `setLayoutProperty` on layers that have
  // to exist — and not awaited, because the vector basemap is three portal-item fetches and
  // nothing else on the page is waiting to hear about the ground. For a raster default this is a
  // no-op: the initial style already has it switched on.
  void setBasemap(map, MAP_DEFAULT_BASEMAP);
  return map;
}

export {initMap, map};

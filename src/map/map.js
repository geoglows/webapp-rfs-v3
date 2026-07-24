import {addProtocol, Map as MaplibreMap, NavigationControl, setWorkerUrl} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// maplibre 6 finds its worker with `new URL("./maplibre-gl-worker.mjs", import.meta.url)`, which
// breaks once vite relocates the library (dep-optimizer in dev, hashed chunk in build) — tiles
// then silently never parse. Hand it a worker URL vite has bundled instead.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {Protocol} from "pmtiles";
import {initBasemapPicker} from "./basemaps";
import {initLayerPicker} from "./layers";
import {MAP_CENTER, MAP_ZOOM} from "../settings/settings.js";

// The map starts on an empty style; the real basemap (raster or vector) is injected by
// applyBasemap() so the two kinds share one code path. See basemaps.js.
const EMPTY_STYLE = {version: 8, sources: {}, layers: []};

setWorkerUrl(maplibreWorkerUrl);

const protocol = new Protocol({metadata: true});
addProtocol("pmtiles", protocol.tile);

const map = new MaplibreMap({
  container: "map",
  style: EMPTY_STYLE,
  // The opening camera, from the environment and defaulting to a global overview (lng 0, lat 20) —
  // see MAP_CENTER in settings/settings.js. The URL hash overrides it when present.
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  hash: "map",
  maxZoom: 13,
  // Non-Latin maps render locally, so labels don't rely on the fallback glyph collapsed below.
  localIdeographFontFamily: "sans-serif",
  // Esri's Environment styles ask for comma-joined font stacks (e.g. "Noto Sans Regular,Arial
  // Unicode MS Regular"), but its font server only serves single fonts — a stack 404s as JSON,
  // which MapLibre then fails to parse as a glyph PBF ("Unimplemented type: 3"). Collapse any Esri
  // glyph request to its primary font. Everything else falls through to default handling.
  transformRequest: (url) => {
    if (/\/fonts\/[^/]*(?:,|%2C)/i.test(url)) {
      return {url: url.replace(/\/fonts\/([^/]+)\//, (_, stack) => `/fonts/${stack.split(/,|%2C/i)[0]}/`)};
    }
    return undefined;
  }
});

// Zoom +/- plus the compass button, which resets bearing (and pitch) back to north-up on click.
map.addControl(new NavigationControl({showCompass: true, visualizePitch: true}), "top-left");

// Map-control dropdowns (top-right). Both are pure DOM + map calls, so they can be built before
// the style finishes loading; the basemap itself is applied on "load" by main.js.
initBasemapPicker(map);
initLayerPicker(map);

export {EMPTY_STYLE, map};

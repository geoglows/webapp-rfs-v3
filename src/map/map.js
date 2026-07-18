import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { initBasemapPicker } from "./basemaps";
import { initLayerPicker } from "./layers";

/**
 * The MapLibre instance and its chrome. Importing this module is enough to stand the map up:
 * the pmtiles protocol is registered, the map is constructed on #map, the navigation control and
 * the basemap/layer pickers are wired, and the map is exported for the app to build on.
 *
 * The app's own layers (streams, flood raster, selection highlights, FIM tile footprints) are NOT
 * added here — they're owned by the modules that drive them and are added on the map's "load"
 * event by main.js, which also slots the default basemap in beneath them.
 */

// The map starts on an empty style; the real basemap (raster or vector) is injected by
// applyBasemap() so the two kinds share one code path. See basemaps.js.
const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

const protocol = new Protocol({ metadata: true });
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  style: EMPTY_STYLE,
  // Global overview (lng 0, lat 20); the URL hash overrides this when present.
  center: [0, 20],
  zoom: 1.5,
  hash: "map",
  maxZoom: 13,
  // Non-Latin scripts render locally, so labels don't rely on the fallback glyph collapsed below.
  localIdeographFontFamily: "sans-serif",
  // Esri's Environment styles ask for comma-joined font stacks (e.g. "Noto Sans Regular,Arial
  // Unicode MS Regular"), but its font server only serves single fonts — a stack 404s as JSON,
  // which MapLibre then fails to parse as a glyph PBF ("Unimplemented type: 3"). Collapse any Esri
  // glyph request to its primary font. Everything else falls through to default handling.
  transformRequest: (url) => {
    if (/\/fonts\/[^/]*(?:,|%2C)/i.test(url)) {
      return { url: url.replace(/\/fonts\/([^/]+)\//, (_, stack) => `/fonts/${stack.split(/,|%2C/i)[0]}/`) };
    }
    return undefined;
  }
});

// Zoom +/- plus the compass button, which resets bearing (and pitch) back to north-up on click.
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-left");

// Map-control dropdowns (top-right). Both are pure DOM + map calls, so they can be built before
// the style finishes loading; the basemap itself is applied on "load" by main.js.
initBasemapPicker(map);
initLayerPicker(map);

export { EMPTY_STYLE, map };

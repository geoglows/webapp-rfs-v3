import {addProtocol, Map as MaplibreMap, NavigationControl, setWorkerUrl} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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

map.addControl(new NavigationControl({showCompass: true, visualizePitch: false}), "top-left");
initBasemapPicker(map);
initLayerPicker(map);

export {EMPTY_STYLE, map};

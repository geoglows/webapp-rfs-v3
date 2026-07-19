import {calciteIcon} from "../icons/icons";
import {t} from "../i18n/i18n";
import {wireMenu} from "./menu";

/**
 * Toggleable map overlays and their picker. Unlike basemaps these are independent on/off toggles —
 * many can be visible at once. `on` is the default visibility; `raster`, when present, is a source
 * spec addRasterOverlays() adds to the map (the streams and flood layers are created elsewhere,
 * and only have their visibility driven from here).
 *
 * streams/flood default on even though the flood layer starts empty — it's created lazily by
 * FloodOverlay.rebuild(), which reapplies this state so a toggle made before the layer exists sticks.
 */
const OVERLAYS = [
  {layerId: "streams", labelKey: "layers.streams", on: true},
  {layerId: "flood", labelKey: "layers.floodExtents", on: true},
  {
    layerId: "riverfld",
    labelKey: "layers.riverfld",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://floods.ssec.wisc.edu/tiles/RIVER-FLDglobal-composite_current/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: 'RIVER-FLD global flood composite © <a href="https://floods.ssec.wisc.edu/products/RIVER-FLDglobal-composite" target="_blank" rel="noopener">CIMSS/SSEC, UW–Madison</a> (VIIRS, George Mason University)'
    }
  },
  {
    layerId: "goes",
    labelKey: "layers.goes",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://earthlive.maptiles.arcgis.com/arcgis/rest/services/GOES/GOES31D/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "GOES / Himawari colorized IR © NOAA, via Esri Living Atlas"
    }
  },
  {
    layerId: "viirs",
    labelKey: "layers.viirs",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://modis.arcgis.com/arcgis/rest/services/VIIRS/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image"],
      tileSize: 256,
      attribution: "VIIRS true color © NASA Earthdata (GIBS), via Esri"
    }
  }
];

const layerVisible = Object.fromEntries(OVERLAYS.map((o) => [o.layerId, o.on]));

function applyLayerVisibility(map, layerId) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", layerVisible[layerId] ? "visible" : "none");
}

// Add the raster imagery/flood overlays. Inserted beneath the streams line layer (in reverse
// list order, so overlays listed higher in the picker also render visually on top) and start
// at their default visibility.
function addRasterOverlays(map) {
  const beforeId = map.getLayer("streams") ? "streams" : undefined;
  for (const ov of [...OVERLAYS].reverse()) {
    if (!ov.raster) continue;
    if (!map.getSource(ov.layerId)) map.addSource(ov.layerId, ov.raster);
    if (!map.getLayer(ov.layerId)) {
      map.addLayer({
        id: ov.layerId,
        type: "raster",
        source: ov.layerId,
        layout: {visibility: layerVisible[ov.layerId] ? "visible" : "none"}
      }, beforeId);
    }
  }
}

// Layer picker: independent on/off toggles (many overlays can be visible at once).
function initLayerPicker(map) {
  const btn = document.getElementById("layer-btn");
  const menu = document.getElementById("layer-menu");
  if (!btn || !menu) return;
  btn.replaceChildren(calciteIcon("layers"));
  menu.innerHTML = "";
  wireMenu(btn, menu);
  for (const ov of OVERLAYS) {
    const opt = document.createElement("button");
    opt.className = "layer-opt layer-toggle";
    opt.setAttribute("role", "menuitemcheckbox");
    opt.setAttribute("aria-checked", String(layerVisible[ov.layerId]));
    const check = document.createElement("span");
    check.className = "check";
    check.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.setAttribute("data-i18n", ov.labelKey);
    label.textContent = t(ov.labelKey);
    opt.append(check, label);
    opt.addEventListener("click", () => {
      const next = !layerVisible[ov.layerId];
      layerVisible[ov.layerId] = next;
      applyLayerVisibility(map, ov.layerId);
      opt.setAttribute("aria-checked", String(next));
    });
    menu.appendChild(opt);
  }
}

export {OVERLAYS, addRasterOverlays, applyLayerVisibility, initLayerPicker, layerVisible};

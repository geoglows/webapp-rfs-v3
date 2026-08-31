import {calciteIcon} from "../../../shared/icons/calcite.js";
import {t} from "../../../shared/i18n/i18n";
import {wireMenu} from "../../../shared/ui/menu.js";

const LAYERS = [
  {layerId: "streams", labelKey: "layers.streams", on: true},
  {layerId: "flood", labelKey: "layers.floodExtents", on: true},
  {
    layerId: "riverfld",
    labelKey: "layers.riverfld",
    on: false,
    raster: {
      type: "raster",
      tiles: ["https://floods.ssec.wisc.edu/tiles/RIVER-FLDglobal-composite_current/{z}/{x}/{y}.png"],
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
      attribution: "VIIRS true color © NASA Earthdata, via Esri Living Atlas"
    }
  }
];

const layerVisible = Object.fromEntries(LAYERS.map((o) => [o.layerId, o.on]));

// Everything else that draws the stream network and is not owned by this module: the inspect
// highlight, and the flood-mode selection/coverage highlights (which carry a mode gate of their
// own, so they subscribe below rather than being switched from here).
const streamsWatchers = new Set();

function applyLayerVisibility(map, layerId) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", layerVisible[layerId] ? "visible" : "none");
}

const streamsVisible = () => layerVisible.streams;

/**
 * Show/hide the whole stream network — the base lines and every highlight drawn over them, so
 * turning it off leaves the flood extent on the basemap with nothing painted across it. Reaches
 * can't be clicked while it's off (they aren't rendered), which is why it's a toggle and not a
 * mode: the selection survives untouched and comes back when it's turned on again.
 */
function setStreamsVisible(map, visible) {
  if (layerVisible.streams === visible) return;
  layerVisible.streams = visible;
  applyStreamsVisibility(map);
  for (const fn of streamsWatchers) fn(visible);
}

/** Push the current stream visibility onto the layers this module owns. Also the call that gives
 * newly-added stream layers the state they were born too late to receive. */
function applyStreamsVisibility(map) {
  applyLayerVisibility(map, "streams");
  if (map.getLayer("inspect-highlight")) {
    map.setLayoutProperty("inspect-highlight", "visibility", layerVisible.streams ? "visible" : "none");
  }
}

/** Subscribe to stream-visibility changes; called immediately with the current value. */
function onStreamsVisibility(fn) {
  streamsWatchers.add(fn);
  fn(layerVisible.streams);
}

// Add the raster imagery/flood overlays. Inserted beneath the streams line layer (in reverse
// list order, so overlays listed higher in the picker also render visually on top) and start
// at their default visibility.
function addRasterLayer(map) {
  const beforeId = map.getLayer("streams") ? "streams" : undefined;
  for (const ov of [...LAYERS].reverse()) {
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
  LAYERS.forEach(layer => {
    const opt = document.createElement("button");
    opt.className = "opt";
    opt.setAttribute("role", "menuitemcheckbox");
    opt.setAttribute("aria-checked", String(layerVisible[layer.layerId]));
    const check = document.createElement("span");
    check.className = "check";
    check.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.setAttribute("data-i18n", layer.labelKey);
    label.textContent = t(layer.labelKey);
    opt.append(check, label);
    // Streams route through setStreamsVisible so the highlights follow the base lines, and so the
    // flood panel's own Hide-streams button and this entry stay two views of one state.
    if (layer.layerId === "streams") {
      opt.addEventListener("click", () => setStreamsVisible(map, !layerVisible.streams));
      onStreamsVisibility((on) => opt.setAttribute("aria-checked", String(on)));
    } else {
      opt.addEventListener("click", () => {
        const next = !layerVisible[layer.layerId];
        layerVisible[layer.layerId] = next;
        applyLayerVisibility(map, layer.layerId);
        opt.setAttribute("aria-checked", String(next));
      });
    }
    menu.appendChild(opt);
  })
}

export {
  LAYERS,
  addRasterLayer,
  applyLayerVisibility,
  applyStreamsVisibility,
  initLayerPicker,
  layerVisible,
  onStreamsVisibility,
  setStreamsVisible,
  streamsVisible
};

/**
 * The one layer picker, over the map's top-right corner.
 *
 * Everything drawn over the basemap is switched from here: the stream network, the flood extents,
 * the three hydrography reference archives (catchments, group boundaries, HydroBASINS) and the
 * imagery overlays. Independent on/off switches, because any number of them can be drawn at once.
 *
 * Three things read the list — the menu row that switches a layer on, the legend row naming its
 * colour, and the sync that greys out both when the open dataset does not publish those tiles — so
 * it lives here rather than in the markup.
 */
import {calciteIcon} from "../icons/calcite.js";
import {t} from "../i18n/i18n";
import {wireMenu} from "../ui/menu.js";
import {el} from "../dom.js";

/**
 * Which layers draw the network. Just `streams` until the styling section loads, which compiles
 * the network into a base layer plus one per rule and rebuilds them on every edit — so this is a
 * function, not a list: the ids are only knowable when asked.
 */
let streamLayerIds = () => ["streams"];

/** Called by the styling section once it owns the network's layers. */
const registerStreamLayers = (fn) => {
  streamLayerIds = fn;
};

/** Which layers a click or a hover has to query to find a reach. */
const streamLayers = () => streamLayerIds();

const LAYERS = [
  // No legend row for the network: what its colour means is the forecast scale above the legend,
  // or the styling section, and a swatch saying "streams" beside either only takes up the corner.
  {layerId: "streams", labelKey: "layers.streams", on: true, swatch: "stream", legend: false, layers: () => streamLayerIds()},
  {layerId: "flood", labelKey: "layers.floodExtents", on: true},
  {
    layerId: "catchments",
    optional: true,
    labelKey: "explorer.layers.catchments",
    titleKey: "explorer.layers.catchments.about",
    on: false,
    swatch: "catchment",
    layers: () => ["catchment-fill", "catchment-outlet", "catchment-line"]
  },
  {
    layerId: "groups",
    optional: true,
    labelKey: "explorer.layers.groups",
    on: false,
    swatch: "poly",
    layers: () => ["group-fill", "group-line"]
  },
  {
    layerId: "basins",
    optional: true,
    labelKey: "explorer.layers.basins",
    titleKey: "explorer.layers.basins.about",
    on: false,
    swatch: "poly basin",
    layers: () => ["basin-fill", "basin-line"]
  },
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

/** The maplibre layer ids one entry stands for. A raster entry is its own single layer. */
const idsOf = (entry) => (entry.layers ? entry.layers() : [entry.layerId]);

function applyLayerVisibility(map, layerId) {
  const entry = LAYERS.find((o) => o.layerId === layerId);
  const visible = layerVisible[layerId] ? "visible" : "none";
  for (const id of entry ? idsOf(entry) : [layerId]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible);
  }
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

/**
 * Push the current stream visibility onto the layers this module owns. Also the call that gives
 * newly-added stream layers the state they were born too late to receive — which the styling
 * section leans on, since every edit tears the rule layers down and builds them again visible.
 */
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

/**
 * Is this entry switchable? Only the reference archives can fail to be — each is a separate PMTiles
 * file that a dataset may simply not publish, and its row says so rather than looking broken when
 * clicking it does nothing. Everything else is built by the app and is either there or on its way,
 * so a check would only grey the row out for the moment before its layer is added.
 */
const isPresent = (map, entry) => !entry.optional || idsOf(entry).some((id) => !!map.getLayer(id));

/**
 * Point the switches and the legend at what the map is actually drawing. Called as each reference
 * archive lands, and after every restyle of the network.
 */
function syncLayerPicker(map) {
  for (const entry of LAYERS) {
    if (!entry.opt) continue;
    const present = isPresent(map, entry);
    const on = present && layerVisible[entry.layerId];
    entry.opt.setAttribute("aria-checked", String(on));
    entry.opt.disabled = !present;
    // Not data-i18n-title: the row's tooltip is two sentences joined only when the layer is
    // missing, so it is written here and rewritten by the language picker's repaint.
    entry.opt.title = [
      entry.titleKey ? t(entry.titleKey) : null,
      present ? null : t("explorer.layers.missing")
    ].filter(Boolean).join("\n\n");
    entry.legendRow?.classList.toggle("hidden", !on);
  }
}

// Layer picker: independent on/off toggles (many overlays can be visible at once).
function initLayerPicker(map) {
  const btn = document.getElementById("layer-btn");
  const menu = document.getElementById("layer-menu");
  const legend = document.getElementById("layer-legend-items");
  if (!btn || !menu) return;
  btn.replaceChildren(calciteIcon("layers"));
  menu.replaceChildren();
  wireMenu(btn, menu);
  for (const layer of LAYERS) {
    const opt = el("button", {
      class: "opt",
      role: "menuitemcheckbox",
      "aria-checked": String(layerVisible[layer.layerId])
    }, [
      el("span", {class: "check", "aria-hidden": "true"}),
      el("span", {"data-i18n": layer.labelKey, text: t(layer.labelKey)}),
      layer.swatch && el("span", {class: `swatch ${layer.swatch}`})
    ]);
    // Streams route through setStreamsVisible so the highlights follow the base lines, and so the
    // flood panel's own Hide-streams button and this entry stay two views of one state.
    opt.addEventListener("click", () => {
      if (layer.layerId === "streams") setStreamsVisible(map, !layerVisible.streams);
      else {
        layerVisible[layer.layerId] = !layerVisible[layer.layerId];
        applyLayerVisibility(map, layer.layerId);
      }
      syncLayerPicker(map);
    });
    if (layer.layerId === "streams") onStreamsVisibility(() => syncLayerPicker(map));
    menu.appendChild(opt);
    layer.opt = opt;

    // The legend row for the same layer, hidden until the layer is on: a colour is worth naming
    // only while there is something on the map wearing it. Only the entries that have a swatch —
    // the imagery overlays are their own legend.
    if (layer.swatch && layer.legend !== false && legend) {
      const row = el("div", {class: "legend-item hidden"}, [
        el("span", {class: `swatch ${layer.swatch}`}),
        el("span", {"data-i18n": layer.labelKey, text: t(layer.labelKey)})
      ]);
      if (layer.titleKey) row.setAttribute("data-i18n-title", layer.titleKey);
      legend.appendChild(row);
      layer.legendRow = row;
    }
  }
  syncLayerPicker(map);
}

export {
  LAYERS,
  addRasterLayer,
  applyLayerVisibility,
  applyStreamsVisibility,
  initLayerPicker,
  layerVisible,
  onStreamsVisibility,
  registerStreamLayers,
  setStreamsVisible,
  streamLayers,
  streamsVisible,
  syncLayerPicker
};

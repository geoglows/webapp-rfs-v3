import {VectorTileLayer} from "@esri/maplibre-arcgis";
import {calciteIcon} from "../icons/calcite.js";
import {wireMenu} from "./menu";
import {MAP_DEFAULT_BASEMAP} from "../settings/settings.js";

const BASEMAPS = [
  {
    id: "environment",
    label: "Environment (Esri)",
  },
  {
    id: "light",
    label: "Light grey (Carto)",
    maxzoom: 20,
    tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`),
    attribution: "© OpenStreetMap contributors © CARTO"
  },
  {
    id: "dark",
    label: "Dark (Carto)",
    maxzoom: 20,
    tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
    attribution: "© OpenStreetMap contributors © CARTO"
  },
  {
    id: "streetsOSM",
    label: "Streets (OSM)",
    maxzoom: 19,
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors"
  },
  {
    id: "satelliteEsri",
    label: "Satellite (Esri)",
    maxzoom: 19,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
  },
  {
    id: "topoEsri",
    label: "Topographic (Esri)",
    maxzoom: 19,
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, FAO, NOAA, © OpenStreetMap contributors, and the GIS User Community"
  },
  {
    id: "topoUsgs",
    label: "Topographic (USGS)",
    maxzoom: 16,
    tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"],
    attribution: "USGS — The National Map: 3DEP, NHD, GNIS, NLCD, NTD, and others"
  }
];

/**
 * The basemap the app opens on — the deployment's configured id (VITE_MAP_DEFAULT_BASEMAP), or the
 * first in the list. Read by both the caller that applies it on load and the picker that marks it
 * active, so the two cannot disagree; an id that isn't in the list falls back here rather than
 * leaving the map with no basemap at all.
 */
const defaultBasemap = () => BASEMAPS.find((bm) => bm.id === MAP_DEFAULT_BASEMAP) ?? BASEMAPS[0];

// keep track of layers used in the current basemap so switching can fully remove it before adding the new one
let basemapLayerIds = [];
let basemapSourceIds = [];

// the logic for creating the environment basemap should be its own function and the applyBasemap function
// should call it if that map is selected rather than having the logic in the applyBasemap function.
// This will make it easier to maintain and update the environment basemap in the future and keep the pattern simpler

async function createEnvironmentBasemap({map, beforeId}) {
  const envMapConf = {
    id: "environment",
    label: "Environment (Esri)",
    vector: true,
    itemIds: [
      "005b8960ddd04ae781df8d471b6726b3", // Environment Base
      "3bfd1065c1a748c5ae2f9408c3fb1078", // Environment Watersheds
      "8b8862d9cc894f5db44231a67ee0e41b"  // Environment Detail and Label
    ],
    attribution: "Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community",
    hillshade: {
      id: "hillshade",
      tiles: ["https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"],
      maxzoom: 23,
      attribution: "Hillshade: Esri, Airbus DS, USGS, NGA, NASA, CGIAR, N Robinson, NCEAS, NLS, OS, NMA, Geodatastyrelsen, Rijkswaterstaat, GSA, Geoland, FEMA, Intermap, and the GIS user community"
    }
  }

  const items = await Promise.all(envMapConf.itemIds.map((id) => VectorTileLayer.fromPortalItem(id)));
  const styles = items.map((it) => it.style);
  if (styles[0].glyphs) map.setGlyphs(styles[0].glyphs);
  if (styles[0].sprite) map.setSprite(styles[0].sprite);

  // this is the hillshade raster added separately and below the vector layers
  map.addSource(envMapConf.hillshade.id, {
    type: "raster",
    tiles: envMapConf.hillshade.tiles,
    tileSize: 256,
    attribution: envMapConf.hillshade.attribution,
    maxzoom: envMapConf.hillshade.maxzoom ?? 19
  });
  map.addLayer({id: envMapConf.hillshade.id, type: "raster", source: envMapConf.hillshade.id}, beforeId);
  basemapSourceIds.push(envMapConf.hillshade.id);
  basemapLayerIds.push(envMapConf.hillshade.id);

  // The items share sources (e.g. "esri"), so dedupe by id; hang the attribution off the first.
  let firstVectorSource = true;
  for (const style of styles) {
    for (const [sid, src] of Object.entries(style.sources ?? {})) {
      if (map.getSource(sid)) continue;
      map.addSource(sid, firstVectorSource ? {...src, attribution: envMapConf.attribution} : src);
      basemapSourceIds.push(sid);
      firstVectorSource = false;
    }
  }
  // Lay layers down item-by-item, in listed order, so later items stack above earlier ones.
  for (const style of styles) {
    for (const layer of style.layers ?? []) {
      map.addLayer(layer, beforeId);
      basemapLayerIds.push(layer.id);
    }
  }
}

async function applyBasemap(map, bm) {
  for (const id of basemapLayerIds) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of basemapSourceIds) if (map.getSource(id)) map.removeSource(id);
  basemapLayerIds = [];
  basemapSourceIds = [];
  // Insert beneath the lowest existing layer so the basemap always renders on the bottom.
  const beforeId = map.getStyle().layers?.[0]?.id;
  if (bm.id === "environment") {
    await createEnvironmentBasemap({map, beforeId});
  } else {
    map.addSource("basemap", {type: "raster", tiles: bm.tiles, tileSize: 256, attribution: bm.attribution, maxzoom: bm.maxzoom ?? 19});
    map.addLayer({id: "basemap", type: "raster", source: "basemap"}, beforeId);
    basemapSourceIds.push("basemap");
    basemapLayerIds.push("basemap");
  }
}

function setBasemap(map, id) {
  return applyBasemap(map, BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0]);
}

// Basemap picker: single-choice radio group (only one basemap at a time).
function initBasemapPicker(map) {
  const btn = document.getElementById("basemap-btn");
  const menu = document.getElementById("basemap-menu");
  if (!btn || !menu) return;
  btn.replaceChildren(calciteIcon("basemap"));
  menu.innerHTML = "";
  const closeMenu = wireMenu(btn, menu);
  for (const bm of BASEMAPS) {
    const opt = document.createElement("button");
    opt.className = "layer-opt";
    opt.setAttribute("role", "menuitemradio");
    opt.textContent = bm.label;
    const active = bm.id === defaultBasemap().id;
    opt.setAttribute("aria-checked", String(active));
    opt.classList.toggle("active", active);
    opt.addEventListener("click", () => {
      setBasemap(map, bm.id);
      menu.querySelectorAll('[role="menuitemradio"]').forEach((o) => {
        o.classList.remove("active");
        o.setAttribute("aria-checked", "false");
      });
      opt.classList.add("active");
      opt.setAttribute("aria-checked", "true");
      closeMenu();
    });
    menu.appendChild(opt);
  }
}

export {BASEMAPS, applyBasemap, defaultBasemap, initBasemapPicker, setBasemap};

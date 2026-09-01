/**
 * The basemaps, and the one mechanism both pages switch them with. Every raster set is declared in
 * the initial style and switched by `visibility`: nothing is torn down, so a switch cannot lose the
 * layer order the rest of the app was inserted into, and already-fetched tiles stay cached.
 *
 * The Esri vector basemap is the exception. `setGlyphs` and `setSprite` are *global* map state, so
 * its style can only be adopted once — it is added the first time it is chosen and toggled after.
 *
 * The list is shared; the basemap a page *opens* on is not, and each passes its own to basemapStyle().
 */
import {VectorTileLayer} from "@esri/maplibre-arcgis";
import {el} from "../dom.js";
import {calciteIcon} from "../icons/calcite.js";
import {t} from "../i18n/i18n.js";
import {wireMenu} from "../ui/menu.js";

/** One entry per service rather than per basemap: the grey canvases are a base plus a labels layer,
 * and Imagery is offered bare and labelled, so several basemaps name the same set. */
const TILE_SETS = {
  "gray-light": {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 16,
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community"
  },
  "gray-light-labels": {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 16,
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community"
  },
  "gray-dark": {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 16,
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community"
  },
  "gray-dark-labels": {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 16,
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community"
  },
  imagery: {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 19,
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  },
  places: {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 19,
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors"
  },
  topo: {
    tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 19,
    attribution: "Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, FAO, NOAA, © OpenStreetMap contributors, and the GIS User Community"
  },
  "topo-usgs": {
    tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 16,
    attribution: "USGS — The National Map: 3DEP, NHD, GNIS, NLCD, NTD, and others"
  },
  osm: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    maxzoom: 19,
    attribution: "© OpenStreetMap contributors"
  },
  // OpenTopoMap renders from its own servers and asks that its tiles not be hammered; it stops at
  // z17, which is well past the zooms either app is read at.
  opentopo: {
    tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    maxzoom: 17,
    attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)"
  }
};

/** Esri's Environment basemap: three vector tile layers off portal items over a raster hillshade.
 * Not a tile set — it is a style, and adopting one can only happen once. See addEnvironment(). */
const ENVIRONMENT = {
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
};

/** Every basemap either page offers, in the order the picker lists them. */
const BASEMAPS = [
  {id: "environment", labelKey: "basemap.environment", vector: ENVIRONMENT},
  {id: "gray-light", labelKey: "basemap.grayLight", tileSets: ["gray-light", "gray-light-labels"]},
  {id: "gray-dark", labelKey: "basemap.grayDark", tileSets: ["gray-dark", "gray-dark-labels"]},
  {id: "imagery", labelKey: "basemap.imagery", tileSets: ["imagery"]},
  {id: "imagery-labels", labelKey: "basemap.imageryLabels", tileSets: ["imagery", "places"]},
  {id: "topo", labelKey: "basemap.topoEsri", tileSets: ["topo"]},
  {id: "topo-usgs", labelKey: "basemap.topoUsgs", tileSets: ["topo-usgs"]},
  {id: "osm", labelKey: "basemap.osm", tileSets: ["osm"]},
  {id: "opentopo", labelKey: "basemap.opentopo", tileSets: ["opentopo"]}
];

/** A tile set's source and layer share one id, because there is exactly one layer per set. */
const tileSetId = (key) => `basemap-${key}`;

const basemapById = (id) => BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];

let active = BASEMAPS[0].id;
// Whether `active` is a choice somebody made rather than the page's default. The picker is wired
// before the map on the hydrography page, so a click can land first; basemapStyle() must not then
// overwrite it with the default it was going to open on.
let chosen = false;

/** The id of the basemap the map is showing — what the picker marks and the pages log. */
const currentBasemap = () => active;

function basemapStyle(defaultId) {
  if (!chosen) active = basemapById(defaultId).id;
  const on = basemapById(active).tileSets ?? [];
  return {
    sources: Object.fromEntries(Object.entries(TILE_SETS).map(([key, ts]) => [tileSetId(key), {
      type: "raster", tiles: ts.tiles, tileSize: 256, maxzoom: ts.maxzoom, attribution: ts.attribution
    }])),
    layers: Object.keys(TILE_SETS).map((key) => ({
      id: tileSetId(key),
      type: "raster",
      source: tileSetId(key),
      layout: {visibility: on.includes(key) ? "visible" : "none"}
    }))
  };
}

// What addEnvironment() put on the map, and whether each layer was visible in Esri's own style —
// so toggling the basemap back on restores that rather than switching on layers Esri had off.
let envLayers = null;
let envLoading = null;

function setEnvironmentVisible(map, on) {
  for (const {id, visible} of envLayers ?? []) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on && visible ? "visible" : "none");
  }
}

async function addEnvironment(map, conf) {
  const items = await Promise.all(conf.itemIds.map((id) => VectorTileLayer.fromPortalItem(id)));
  const styles = items.map((it) => it.style);
  // Global map state, which is why this whole function runs at most once per page.
  if (styles[0].glyphs) map.setGlyphs(styles[0].glyphs);
  if (styles[0].sprite) map.setSprite(styles[0].sprite);

  const bottom = map.getStyle().layers?.[0]?.id;
  const added = [];

  const hs = conf.hillshade;
  if (!map.getSource(hs.id)) {
    map.addSource(hs.id, {
      type: "raster", tiles: hs.tiles, tileSize: 256, attribution: hs.attribution, maxzoom: hs.maxzoom ?? 19
    });
  }
  map.addLayer({id: hs.id, type: "raster", source: hs.id, layout: {visibility: "none"}}, bottom);
  added.push({id: hs.id, visible: true});

  let firstVectorSource = true;
  for (const style of styles) {
    for (const [sid, src] of Object.entries(style.sources ?? {})) {
      if (map.getSource(sid)) continue;
      map.addSource(sid, firstVectorSource ? {...src, attribution: conf.attribution} : src);
      firstVectorSource = false;
    }
  }
  for (const style of styles) {
    for (const layer of style.layers ?? []) {
      map.addLayer({...layer, layout: {...layer.layout, visibility: "none"}}, bottom);
      added.push({id: layer.id, visible: layer.layout?.visibility !== "none"});
    }
  }
  return added;
}

async function showEnvironment(map, bm) {
  if (!envLoading) {
    envLoading = addEnvironment(map, bm.vector)
      .then((added) => {
        envLayers = added;
      })
      .catch((err) => {
        // Not fatal: the map keeps whichever raster basemap is under it, and a later pick can try
        // again — which is why the in-flight promise is dropped rather than left resolved.
        console.warn(`[basemap] the Esri vector basemap could not be loaded: ${err.message}`);
        envLoading = null;
        envLayers = [];
      });
  }
  await envLoading;
  // Somebody picked another basemap while the portal items were in flight — that choice wins.
  if (active === bm.id) setEnvironmentVisible(map, true);
}

async function setBasemap(map, id) {
  const pick = basemapById(id);
  active = pick.id;
  chosen = true;
  // No map yet — the picker is wired before one exists, so that an archive that never answers
  // cannot take the controls down with it. `active` is the whole answer here: basemapStyle() reads
  // it when the map is finally built, and opens on it.
  if (!map) return;
  try {
    const on = pick.tileSets ?? [];
    for (const key of Object.keys(TILE_SETS)) {
      const lid = tileSetId(key);
      if (map.getLayer(lid)) {
        map.setLayoutProperty(lid, "visibility", on.includes(key) ? "visible" : "none");
      }
    }
    if (pick.vector) await showEnvironment(map, pick);
    else setEnvironmentVisible(map, false);
  } catch (err) {
    console.warn(`[basemap] could not switch to "${pick.id}": ${err.message}`);
  }
}

function initBasemapPicker(map) {
  const mapNow = () => (typeof map === "function" ? map() : map);
  const btn = document.getElementById("basemap-btn");
  const menu = document.getElementById("basemap-menu");
  if (!btn || !menu) return;
  btn.replaceChildren(calciteIcon("basemap"));
  menu.replaceChildren();
  const close = wireMenu(btn, menu);
  const options = new Map();
  const sync = () => {
    for (const [id, opt] of options) {
      opt.classList.toggle("active", id === active);
      opt.setAttribute("aria-checked", String(id === active));
    }
  };
  for (const bm of BASEMAPS) {
    const opt = el("button", {
      class: "opt",
      role: "menuitemradio",
      "data-i18n": bm.labelKey,
      text: t(bm.labelKey),
      onclick: () => {
        void setBasemap(mapNow(), bm.id);
        sync();
        close();
      }
    });
    menu.append(opt);
    options.set(bm.id, opt);
  }
  sync();
}

export {BASEMAPS, basemapStyle, currentBasemap, initBasemapPicker, setBasemap};

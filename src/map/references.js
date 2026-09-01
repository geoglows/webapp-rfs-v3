/**
 * The reference geography drawn under the network: HydroBASINS level 2, the v3 catchments, and the
 * publication group boundaries.
 *
 * Each is a separate PMTiles archive that may be absent, so none of them may hold the boot up: the
 * map is built from what is certain — basemaps and the stream network — and each of these attaches
 * if and when its archive answers. A 404 is skipped with a warning; one that never answers never
 * attaches and costs nothing but its own layers. `onChange` fires as each lands, which is how the
 * layer picker stops reporting them as unpublished.
 *
 * They are loaded whatever toolchains the build ships: they are map reference, not a tool. The
 * catchment colouring is the one part that belongs to the hydrography explorer, and it arrives
 * through setCatchmentSelection() rather than being read from here.
 */
import {PMTiles} from "pmtiles";
import {map, protocol} from "./map.js";
import {URLS} from "../explorer/config.js";
import {COLORS, inRangeExpr} from "../explorer/streamStyle.js";

const GROUP_SOURCE = "group";
const GROUP = "#F97316";
let groupLayer = "groups";
let groupIdField = "groupId";

const BASIN_SOURCE = "basins";
const BASIN = "#14b8a6";
let basinLayer = "hydrobasins_level2";
let basinIdField = "HYBAS_ID";

const CATCHMENT_SOURCE = "catchments";
let catchmentFillLayer = "catchments";
const catchmentLineLayer = "catchment_lines";
let catchmentLines = true;
const CATCHMENT = "#D55E00";
const CATCHMENT_EDGE = "#000000";
const CATCHMENT_OPACITY = 0.16;
const CATCHMENT_UP_OPACITY = 0.32;

/** The polygon regions a hover highlights, outermost first. `sourceLayer` is a getter because each
 * archive's layer name is only known once it has attached. */
const REGIONS = [
  {key: "basin", source: BASIN_SOURCE, layer: "basin-fill", sourceLayer: () => basinLayer},
  {key: "group", source: GROUP_SOURCE, layer: "group-fill", sourceLayer: () => groupLayer}
];

const hovered = {basin: [], group: []};

async function openArchive(url, label) {
  const pmtiles = new PMTiles(url);
  protocol.add(pmtiles);
  try {
    return (await pmtiles.getMetadata()) ?? {};
  } catch (err) {
    console.warn(`[map] ${label} is unavailable (${err.message}) — ${url} — ` +
      "its layers are left off the map");
    return null;
  }
}

/** A region archive's layer name and id field, read off the archive rather than assumed. */
function readRegionArchive(md, file, candidates, fallback) {
  const layer = md?.vector_layers?.[0];
  if (!layer) {
    console.warn(`[map] ${file} declares no vector layers — ` +
      `assuming layer "${fallback.layer}" keyed by "${fallback.idField}"`);
    return fallback;
  }
  const fields = Object.keys(layer.fields ?? {});
  const idField = candidates.find((f) => fields.includes(f)) ?? fields[0] ?? fallback.idField;
  console.info(`[map] ${file}: layer "${layer.id}", region id from "${idField}"`);
  return {layer: layer.id, idField};
}

function readCatchmentArchive(md) {
  const ids = (md?.vector_layers ?? []).map((l) => l.id);
  if (!ids.length) return true;
  if (!ids.includes(catchmentFillLayer)) {
    const pick = ids.find((id) => id !== catchmentLineLayer);
    if (!pick) {
      console.warn(`[map] catchments.pmtiles has no polygon layer (it has ${ids.join(", ")}) — ` +
        "the catchments are left off the map");
      return false;
    }
    console.warn(`[map] catchments.pmtiles has no "${catchmentFillLayer}" layer ` +
      `(it has ${ids.join(", ")}) — drawing "${pick}"`);
    catchmentFillLayer = pick;
  }
  catchmentLines = ids.includes(catchmentLineLayer);
  return true;
}

const REFERENCES = [
  {
    file: "hydrobasins_level2.pmtiles",
    url: () => URLS.basinsPmtiles,
    id: BASIN_SOURCE,
    read: (md) => {
      ({layer: basinLayer, idField: basinIdField} = readRegionArchive(md,
        "hydrobasins_level2.pmtiles", ["HYBAS_ID", "hybas_id", "HYBAS_ID2", "id"],
        {layer: basinLayer, idField: basinIdField}));
    },
    source: () => ({
      type: "vector", url: `pmtiles://${URLS.basinsPmtiles}`,
      promoteId: {[basinLayer]: basinIdField}, attribution: "HydroSHEDS HydroBASINS"
    }),
    layers: () => [
      {
        id: "basin-fill", type: "fill", source: BASIN_SOURCE, "source-layer": basinLayer,
        layout: {visibility: "none"},
        paint: {
          "fill-color": BASIN,
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.12, 0.05]
        }
      },
      {
        id: "basin-line", type: "line", source: BASIN_SOURCE, "source-layer": basinLayer,
        layout: {visibility: "none"},
        paint: {
          "line-color": BASIN, "line-opacity": 0.75,
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, 1.6]
        }
      }
    ]
  },
  {
    file: "catchments.pmtiles",
    url: () => URLS.catchmentsPmtiles,
    id: CATCHMENT_SOURCE,
    read: readCatchmentArchive,
    source: () => ({
      type: "vector", url: `pmtiles://${URLS.catchmentsPmtiles}`, attribution: "GEOGLOWS RFS v3"
    }),
    layers: () => [
      {
        id: "catchment-fill", type: "fill", source: CATCHMENT_SOURCE,
        "source-layer": catchmentFillLayer,
        layout: {visibility: "none"},
        paint: {"fill-color": CATCHMENT, "fill-opacity": CATCHMENT_OPACITY}
      },
      {
        id: "catchment-outlet", type: "fill", source: CATCHMENT_SOURCE,
        "source-layer": catchmentFillLayer,
        layout: {visibility: "none"},
        filter: ["==", ["get", "riverId"], -1],
        paint: {"fill-color": COLORS.outlet, "fill-opacity": 0.35}
      },
      ...(catchmentLines ? [{
        id: "catchment-line", type: "line", source: CATCHMENT_SOURCE,
        "source-layer": catchmentLineLayer,
        layout: {visibility: "none"},
        paint: {
          "line-color": CATCHMENT_EDGE,
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.9, 10, 1.6, 14, 2.6]
        }
      }] : [])
    ],
    // A watershed selected before the catchments landed still has to colour them.
    after: () => syncCatchmentHighlight()
  },
  {
    file: "groups.pmtiles",
    url: () => URLS.groupsPmtiles,
    id: GROUP_SOURCE,
    read: (md) => {
      ({layer: groupLayer, idField: groupIdField} = readRegionArchive(md, "groups.pmtiles",
        ["groupId", "group_id", "group", "id"], {layer: groupLayer, idField: groupIdField}));
    },
    source: () => ({
      type: "vector", url: `pmtiles://${URLS.groupsPmtiles}`,
      promoteId: {[groupLayer]: groupIdField}, attribution: "GEOGLOWS RFS v3"
    }),
    layers: () => [
      // Off until asked for, like the other two reference layers: the Group boundaries cut the
      // world into arbitrary publishing units, and a network read against them by default reads as
      // though the lines meant something about the rivers.
      {
        id: "group-fill", type: "fill", source: GROUP_SOURCE, "source-layer": groupLayer,
        layout: {visibility: "none"},
        paint: {
          "fill-color": GROUP,
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.07, 0.045]
        }
      },
      {
        id: "group-line", type: "line", source: GROUP_SOURCE, "source-layer": groupLayer,
        layout: {visibility: "none"},
        paint: {
          "line-color": GROUP, "line-opacity": 0.7,
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 2.2]
        }
      }
    ]
  }
];

/**
 * Where the reference layers belong relative to each other, bottom first. They arrive in whatever
 * order their archives answer, so each is inserted *under* the first layer above it in this list
 * that is already on the map. The stream network and its casings are above all of them.
 */
const REFERENCE_STACK = [
  "basin-fill", "basin-line",
  "catchment-fill", "catchment-outlet", "catchment-line",
  "group-fill", "group-line"
];

/** The bottom of the app's own drawing, which no reference polygon may cover. */
const NETWORK_STACK = ["saved-highlight", "named-highlight", "streams"];

const beneath = (id) => {
  const above = REFERENCE_STACK.slice(REFERENCE_STACK.indexOf(id) + 1);
  return above.find((other) => map.getLayer(other))
    ?? NETWORK_STACK.find((other) => map.getLayer(other));
};

/**
 * Read one reference archive and, if it answers with something usable, put it on the map. Nothing
 * awaits this, so every failure has to end here: a 404, an archive with nothing drawable, and a
 * layer the style rejects — the last would otherwise become an unhandled rejection.
 */
async function attachOne(ref, onChange) {
  try {
    const md = await openArchive(ref.url(), ref.file);
    if (md === null) return;
    if (ref.read(md) === false) return;
    // A slow archive can still be in flight when the page is being torn down.
    if (!map || map.getSource(ref.id)) return;
    map.addSource(ref.id, ref.source());
    for (const layer of ref.layers()) map.addLayer(layer, beneath(layer.id));
    ref.after?.();
    onChange?.();
  } catch (err) {
    console.warn(`[map] ${ref.file} answered but could not be drawn (${err.message}) — ` +
      "its layers are left off the map");
  }
}

/** Start every reference archive. Deliberately not awaited — see the note at the top. */
export function attachReferences({onChange} = {}) {
  for (const ref of REFERENCES) void attachOne(ref, onChange);
}

// ── the catchments ───────────────────────────────────────────────────────────
/** Whatever the explorer has selected, so a catchment under it is coloured with it. */
let selection = null;

function syncCatchmentHighlight() {
  if (!map?.getLayer("catchment-fill")) return;
  const up = selection ? inRangeExpr(selection) : null;
  map.setPaintProperty("catchment-fill", "fill-color",
    up ? ["case", up, COLORS.upstream, CATCHMENT] : CATCHMENT);
  map.setPaintProperty("catchment-fill", "fill-opacity",
    up ? ["case", up, CATCHMENT_UP_OPACITY, CATCHMENT_OPACITY] : CATCHMENT_OPACITY);
  map.setFilter("catchment-outlet", ["==", ["get", "riverId"], selection?.outlet ?? -1]);
}

/** The hydrography explorer's current selection, or null. Colours the catchments under it. */
export function setCatchmentSelection(next) {
  selection = next;
  syncCatchmentHighlight();
}

// ── the region polygons: Groups and HydroBASINS ──────────────────────────────
/** Only layers that are on the map answer a query, so a region that is switched off is inert. */
const drawnRegions = () => REGIONS.filter((r) => map?.getLayer(r.layer));

/** Highlight every region under `point`; pass null to drop the highlight. */
export function hoverRegions(point) {
  const hits = point && drawnRegions().length
    ? map.queryRenderedFeatures(point, {layers: drawnRegions().map((r) => r.layer)})
    : [];
  for (const r of REGIONS) {
    if (!map?.getSource(r.source)) continue;
    const ids = [...new Set(hits.filter((h) => h.layer.id === r.layer)
      .map((h) => h.id).filter((id) => id != null))];
    if (ids.join() === hovered[r.key].join()) continue;
    const target = (id) => ({source: r.source, sourceLayer: r.sourceLayer(), id});
    for (const id of hovered[r.key]) map.setFeatureState(target(id), {hover: false});
    for (const id of ids) map.setFeatureState(target(id), {hover: true});
    hovered[r.key] = ids;
  }
}

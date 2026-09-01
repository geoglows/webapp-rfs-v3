import {addProtocol, Map as MaplibreMap, NavigationControl, ScaleControl, setWorkerUrl} from 'maplibre-gl';
import {PMTiles, Protocol} from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {MAX_ZOOM, URLS} from './config.js';
import {BASE_LAYER_ID, COLORS, compileLayers, defaultSpec, inRangeExpr} from './streamStyle.js';
import {basemapStyle} from '../../shared/map/basemaps.js';
import {mapReady} from '../../shared/map/ready.js';

// MapLibre 6 ships its worker as a separate module and locates it by resolving
// ./maplibre-gl-worker.mjs against its own import.meta.url. That finds it inside node_modules under
// `vite dev` and finds nothing in a build, where the library is bundled into assets/ and has no
// such sibling — a map that never finishes loading its first tile. Handing it the URL Vite emits
// removes the guess. Same reason, same line, as webapp-rfs-v3/src/map/map.js.
setWorkerUrl(maplibreWorkerUrl);

/**
 * The basemap this page opens on.
 *
 * Dark grey rather than the shared list's first entry, because the network is drawn in light
 * saturated colours that were chosen against a dark ground — on a light basemap they sit at about
 * 1.8:1 and wash out. The list itself is shared with the forecast page and keeps its own order:
 * light grey still reads first in the picker, where the order is about finding a basemap, not about
 * which one you start on.
 */
const DEFAULT_BASEMAP = 'gray-dark';

const GROUP_SOURCE = 'group';
const GROUP = '#F97316';
let groupLayer = 'groups';
let groupIdField = 'groupId';

const BASIN_SOURCE = 'basins';
const BASIN = '#14b8a6';
let basinLayer = 'hydrobasins_level2';
let basinIdField = 'HYBAS_ID';

/**
 * The polygon regions a hover highlights, outermost first.
 *
 * The layer name of each archive is read off the archive when it attaches, so `sourceLayer` is a
 * getter rather than a value — by the time anything calls it the archive has been opened.
 */
const REGIONS = [
  {
    key: 'basin', source: BASIN_SOURCE, layer: 'basin-fill', sourceLayer: () => basinLayer,
  },
  {
    key: 'group', source: GROUP_SOURCE, layer: 'group-fill', sourceLayer: () => groupLayer,
  },
];

const hovered = {basin: [], group: []};

async function openArchive(protocol, url, label) {
  const pmtiles = new PMTiles(url);
  protocol.add(pmtiles);
  try {
    return (await pmtiles.getMetadata()) ?? {};
  } catch (err) {
    console.warn(`[map] ${label} is unavailable (${err.message}) — ${url} — ` +
      'its layers are left off the map');
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
  const idField = candidates.find(f => fields.includes(f)) ?? fields[0] ?? fallback.idField;
  console.info(`[map] ${file}: layer "${layer.id}", region id from "${idField}"`);
  return {layer: layer.id, idField};
}

function readCatchmentArchive(md) {
  const ids = (md?.vector_layers ?? []).map(l => l.id);
  if (!ids.length) return true;
  if (!ids.includes(catchmentFillLayer)) {
    const pick = ids.find(id => id !== catchmentLineLayer);
    if (!pick) {
      console.warn(`[map] catchments.pmtiles has no polygon layer (it has ${ids.join(', ')}) — ` +
        'the catchments are left off the map');
      return false;
    }
    console.warn(`[map] catchments.pmtiles has no "${catchmentFillLayer}" layer ` +
      `(it has ${ids.join(', ')}) — drawing "${pick}"`);
    catchmentFillLayer = pick;
  }
  catchmentLines = ids.includes(catchmentLineLayer);
  return true;
}

/** Rule layers are inserted under this one, so the selected outlet is never painted over. */
const TOP_LAYER = 'outlet';

/** The multi-select collection: every picked watershed, and the outlet reach of each. */
const PICK_UP_LAYER = 'picked-upstream';
const PICK_LAYER = 'picked-outlet';

/** The AOI subsetter's inlets: the reaches the selection is cut off above. */
const INLET_LAYER = 'aoi-inlet';

/**
 * What the restyled rule layers are inserted under. Everything in here paints the app's own state
 * — what is selected, what is collected, where an AOI is cut — and none of it may be painted over
 * by a style rule. Listed bottom to top: rule layers go under the first of them that exists.
 */
const OVERLAYS = [PICK_UP_LAYER, PICK_LAYER, TOP_LAYER, INLET_LAYER];

/** A filter that matches no reach — how a highlight layer is switched off. */
const NOTHING = ['==', ['get', 'riverId'], -1];

const CATCHMENT_SOURCE = 'catchments';
let catchmentFillLayer = 'catchments';
const catchmentLineLayer = 'catchment_lines';
let catchmentLines = true;
const CATCHMENT = '#D55E00';
const CATCHMENT_EDGE = '#000000';
const CATCHMENT_OPACITY = 0.16;
const CATCHMENT_UP_OPACITY = 0.32;

export let map = null;
export let archive = null;
let layerOrder = [BASE_LAYER_ID];
let applied = new Map();

/**
 * The reference geography: the polygons drawn under the network, none of which the app needs in
 * order to work.
 *
 * Each is a separate PMTiles archive on a separate URL, and each may be absent — HydroBASINS is
 * published beside the hydrography rather than inside a group, the catchments are optional, and a
 * dataset under construction may have none of them yet. **So none of them is allowed to hold the
 * boot up.** They used to be read with a `Promise.all` before the map was built, which meant one
 * unreachable reference layer cost the whole column: no map, no styling editor, no search, and no
 * way to tell that anything had gone wrong.
 *
 * Now the map is built from what is certain — the basemaps and the stream network — and each of
 * these attaches itself if and when its archive answers. An archive that 404s is skipped with a
 * warning. One that never answers at all simply never attaches, and costs nothing but its own
 * layers: no deadline to guess at, nothing cancelled, and an archive that takes thirty seconds
 * still gets its layers rather than being declared dead at some arbitrary second.
 *
 * `read` takes the archive metadata and settles the layer name and id field, which are read off the
 * archive rather than assumed; returning false means the archive answered but has nothing usable.
 * `source` and `layers` are functions because both depend on what `read` just settled.
 */
const REFERENCES = [
  {
    file: 'hydrobasins_level2.pmtiles',
    url: () => URLS.basinsPmtiles,
    id: BASIN_SOURCE,
    read: (md) => {
      ({layer: basinLayer, idField: basinIdField} = readRegionArchive(md,
        'hydrobasins_level2.pmtiles', ['HYBAS_ID', 'hybas_id', 'HYBAS_ID2', 'id'],
        {layer: basinLayer, idField: basinIdField}));
    },
    source: () => ({
      type: 'vector', url: `pmtiles://${URLS.basinsPmtiles}`,
      promoteId: {[basinLayer]: basinIdField}, attribution: 'HydroSHEDS HydroBASINS',
    }),
    layers: () => [
      {
        id: 'basin-fill', type: 'fill', source: BASIN_SOURCE, 'source-layer': basinLayer,
        layout: {visibility: 'none'},
        paint: {
          'fill-color': BASIN,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0.05],
        },
      },
      {
        id: 'basin-line', type: 'line', source: BASIN_SOURCE, 'source-layer': basinLayer,
        layout: {visibility: 'none'},
        paint: {
          'line-color': BASIN, 'line-opacity': 0.75,
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4, 1.6],
        },
      },
    ],
  },
  {
    file: 'catchments.pmtiles',
    url: () => URLS.catchmentsPmtiles,
    id: CATCHMENT_SOURCE,
    read: readCatchmentArchive,
    source: () => ({
      type: 'vector', url: `pmtiles://${URLS.catchmentsPmtiles}`, attribution: 'GEOGLOWS RFS v3',
    }),
    layers: () => [
      {
        id: 'catchment-fill', type: 'fill', source: CATCHMENT_SOURCE,
        'source-layer': catchmentFillLayer,
        layout: {visibility: 'none'},
        paint: {'fill-color': CATCHMENT, 'fill-opacity': CATCHMENT_OPACITY},
      },
      {
        id: 'catchment-outlet', type: 'fill', source: CATCHMENT_SOURCE,
        'source-layer': catchmentFillLayer,
        layout: {visibility: 'none'},
        filter: ['==', ['get', 'riverId'], -1],
        paint: {'fill-color': COLORS.outlet, 'fill-opacity': 0.35},
      },
      ...(catchmentLines ? [{
        id: 'catchment-line', type: 'line', source: CATCHMENT_SOURCE,
        'source-layer': catchmentLineLayer,
        layout: {visibility: 'none'},
        paint: {
          'line-color': CATCHMENT_EDGE,
          'line-opacity': 0.55,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 10, 1.6, 14, 2.6],
        },
      }] : []),
    ],
    // A watershed selected before the catchments landed still has to colour them.
    after: () => syncCatchmentHighlight(),
  },
  {
    file: 'groups.pmtiles',
    url: () => URLS.groupsPmtiles,
    id: GROUP_SOURCE,
    read: (md) => {
      ({layer: groupLayer, idField: groupIdField} = readRegionArchive(md, 'groups.pmtiles',
        ['groupId', 'group_id', 'group', 'id'], {layer: groupLayer, idField: groupIdField}));
    },
    source: () => ({
      type: 'vector', url: `pmtiles://${URLS.groupsPmtiles}`,
      promoteId: {[groupLayer]: groupIdField}, attribution: 'GEOGLOWS RFS v3',
    }),
    layers: () => [
      // Off until asked for, like the other two reference layers: the Group boundaries cut the
      // world into arbitrary publishing units, and a network read against them by default reads as
      // though the lines meant something about the rivers.
      {
        id: 'group-fill', type: 'fill', source: GROUP_SOURCE, 'source-layer': groupLayer,
        layout: {visibility: 'none'},
        paint: {
          'fill-color': GROUP,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.07, 0.045],
        },
      },
      {
        id: 'group-line', type: 'line', source: GROUP_SOURCE, 'source-layer': groupLayer,
        layout: {visibility: 'none'},
        paint: {
          'line-color': GROUP, 'line-opacity': 0.7,
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 5, 2.2],
        },
      },
    ],
  },
];

/**
 * Where the reference layers belong relative to each other, bottom first.
 *
 * They no longer arrive in a known order — whichever archive answers first attaches first — so the
 * stack cannot come from the order of insertion. Each layer is instead inserted *under* the first
 * layer above it in this list that is already on the map, which puts them in the same order however
 * the network behaves. The stream network is above all of them, and is the backstop.
 */
const REFERENCE_STACK = [
  'basin-fill', 'basin-line',
  'catchment-fill', 'catchment-outlet', 'catchment-line',
  'group-fill', 'group-line',
];

const beneath = (id) => {
  const above = REFERENCE_STACK.slice(REFERENCE_STACK.indexOf(id) + 1);
  return above.find(other => map.getLayer(other))
    ?? layerOrder.find(other => map.getLayer(other))
    ?? OVERLAYS.find(other => map.getLayer(other));
};

/**
 * Read one reference archive and, if it answers with something usable, put it on the map.
 *
 * Nothing awaits this and nothing checks whether it worked, so every way it can fail has to end
 * here: an archive that 404s (openArchive says so and returns null), one that answers with nothing
 * this app can draw (`read` returns false), and one that answers with a layer the style then
 * rejects — a source-layer name that is not in the tiles, say. The last is the one that has to be
 * caught rather than left to become an unhandled rejection.
 */
async function attachReference(protocol, ref, onChange) {
  try {
    const md = await openArchive(protocol, ref.url(), ref.file);
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
      'its layers are left off the map');
  }
}

/**
 * Build the map from what is certain, and hand it back as soon as its style is up.
 *
 * `onReferenceLayers` fires each time one of the optional archives lands, so the layer switches can
 * stop reporting it as unpublished.
 */
export async function initMap({onReferenceLayers} = {}) {
  const protocol = new Protocol({metadata: true});
  archive = new PMTiles(URLS.streamsPmtiles);
  protocol.add(archive);
  addProtocol('pmtiles', protocol.tile);

  // Every raster basemap, with this page's default switched on and the rest hidden — the shared
  // list, on the shared visibility mechanism. See shared/map/basemaps.js.
  const ground = basemapStyle(DEFAULT_BASEMAP);

  const streamLayers = compileLayers(defaultSpec(), {highlight: true});
  for (const l of streamLayers) applied.set(l.id, l);
  layerOrder = streamLayers.map(l => l.id);

  map = new MaplibreMap({
    container: 'map',
    hash: 'map',
    center: [0, 20],
    zoom: 2,
    maxZoom: MAX_ZOOM,
    pitch: 0,
    bearing: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    style: {
      version: 8,
      sources: {
        ...ground.sources,
        streams: {
          type: 'vector', url: `pmtiles://${URLS.streamsPmtiles}`,
          promoteId: {streams: 'riverId'}, attribution: 'GEOGLOWS RFS v3',
        },
      },
      layers: [
        ...ground.layers,
        ...streamLayers,
        {
          id: PICK_UP_LAYER, type: 'line', source: 'streams', 'source-layer': 'streams',
          filter: NOTHING,
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': COLORS.upstream,
            'line-opacity': 0.95,
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 9, 3.2, 14, 5.5],
          },
        },
        {
          id: PICK_LAYER, type: 'line', source: 'streams', 'source-layer': 'streams',
          filter: NOTHING,
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': COLORS.outlet,
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 9, 5.5, 14, 9],
          },
        },
        {
          id: TOP_LAYER, type: 'line', source: 'streams', 'source-layer': 'streams',
          filter: ['==', ['get', 'riverId'], -1],
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': COLORS.outlet,
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 5.5, 9, 8.5, 14, 12],
          },
        },
        {
          // Over the outlet, because an inlet can be the outlet's own reach on a one-reach AOI,
          // and because it is the thing you are placing while you are placing it.
          id: INLET_LAYER, type: 'line', source: 'streams', 'source-layer': 'streams',
          filter: NOTHING,
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            // The outlet's own dark orange, and narrower than the outlet: an inlet is the other
            // end of the same selection, without outweighing the reach it drains to.
            'line-color': COLORS.outlet,
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 9, 6, 14, 8],
          },
        },
      ],
    },
  });

  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // Shift-click is how a river is added to the multi-select collection, and MapLibre's box zoom
  // eats the click that ends a shift-drag. Scroll and the +/- control already do the zooming.
  map.boxZoom.disable();
  const northUp = () => {
    if (map.getBearing()) map.setBearing(0);
  };
  map.on('rotate', northUp);
  northUp();
  // Zoom top left, the app's own pickers top right, the scale bar bottom left. The credits stay
  // where MapLibre puts them, along the bottom right, and the legend sits above them.
  map.addControl(new NavigationControl({showCompass: false}), 'top-left');
  map.addControl(new ScaleControl({unit: 'metric'}), 'bottom-left');
  await mapReady(map);
  // Started, never awaited: see REFERENCES.
  for (const ref of REFERENCES) void attachReference(protocol, ref, onReferenceLayers);
  return map;
}

// ── the styled stream layers ─────────────────────────────────────────────────
/** Every layer currently drawing the network, for `queryRenderedFeatures` and for the tests. */
export const streamLayerIds = () => layerOrder.filter(id => map?.getLayer(id));

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function applyStreamStyle(layers) {
  const ids = layers.map(l => l.id);
  if (!same(ids, layerOrder)) {
    for (const id of layerOrder) {
      if (id !== BASE_LAYER_ID && map.getLayer(id)) map.removeLayer(id);
    }
    applied = new Map(applied.has(BASE_LAYER_ID) ? [[BASE_LAYER_ID, applied.get(BASE_LAYER_ID)]] : []);
    layerOrder = ids;
  }

  const under = OVERLAYS.find(id => map.getLayer(id));
  for (const l of layers) {
    if (!map.getLayer(l.id)) {
      map.addLayer(l, under);
      applied.set(l.id, l);
      continue;
    }
    const prev = applied.get(l.id) ?? {};
    if (!same(prev.filter, l.filter)) map.setFilter(l.id, l.filter ?? null);
    if (prev.minzoom !== l.minzoom || prev.maxzoom !== l.maxzoom) {
      map.setLayerZoomRange(l.id, l.minzoom ?? 0, l.maxzoom ?? 24);
    }
    for (const [k, v] of Object.entries(l.paint)) {
      if (!same(prev.paint?.[k], v)) map.setPaintProperty(l.id, k, v);
    }
    applied.set(l.id, l);
  }

  // Layers added above start visible; if the network is switched off, put it back off.
  if (!streamsOn) setLayersVisible(ids, false);
}

/** The selected outlet's own line. Off when the panel is previewing the style without app state. */
export function setSelectionHighlightVisible(visible) {
  // The inlets go with the outlet: they are both the app painting what is selected, and a style
  // previewed with the highlight off should not still have red reaches over it.
  for (const id of [TOP_LAYER, INLET_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

// ── layer visibility ─────────────────────────────────────────────────────────
/**
 * Whether the network is drawn at all.
 *
 * Kept here rather than read off the map, because the stream layers are torn down and rebuilt
 * whenever the style changes - a rule edit, a selection, the names mode going on - and a layer that
 * has just been added is visible. Without somewhere to remember the choice, the network would come
 * back every time anything else was touched. `applyStreamStyle` re-applies it on the way out.
 */
let streamsOn = true;

/** Show or hide the whole network. Survives the restyles that rebuild the layers. */
export function setStreamsVisible(visible) {
  streamsOn = visible;
  setLayersVisible(streamLayerIds(), visible);
}

export function setLayersVisible(ids, visible) {
  const v = visible ? 'visible' : 'none';
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
}

export const layersVisible = ids =>
  ids.some(id => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');

export const layersPresent = ids => ids.some(id => !!map?.getLayer(id));

// ── the upstream highlight ───────────────────────────────────────────────────
let selection = null;

export const currentSelection = () => selection;

/** Select `outlet` and everything in `range`; `onStyle` recompiles the stream layers around it. */
export function applyHighlight(range, outlet, onStyle) {
  selection = range ? {...range, outlet} : null;
  map.setFilter(TOP_LAYER, ['==', ['get', 'riverId'], outlet ?? -1]);
  onStyle?.();
  syncCatchmentHighlight();
}

export function clearHighlight(onStyle) {
  applyHighlight(null, null, onStyle);
}

/** Draw the AOI's inlets — the reaches the selection stops above. Pass [] to draw none. */
export function applyInlets(ids) {
  if (!map?.getLayer(INLET_LAYER)) return;
  map.setFilter(INLET_LAYER, ids.length
    ? ['in', ['get', 'riverId'], ['literal', ids]]
    : NOTHING);
}

// ── the multi-select collection ──────────────────────────────────────────────
let picked = [];

/**
 * Paint every collected watershed: the whole upstream network of each in the pick colour, with the
 * outlet reach of each drawn over it. Both come off one `riverIndex` range per pick, the same range
 * the single selection is drawn from, so a collected watershed looks like a selected one that
 * stayed.
 */
export function applyPicks(list) {
  picked = list ?? [];
  if (!map?.getLayer(PICK_LAYER)) return;
  map.setFilter(PICK_LAYER, picked.length
    ? ['in', ['get', 'riverId'], ['literal', picked.map(p => p.outletId)]]
    : NOTHING);
  map.setFilter(PICK_UP_LAYER, picked.length
    ? ['any', ...picked.map(inRangeExpr)]
    : NOTHING);
}

/** Bring one pick into view without changing how far in the map is already zoomed. */
export function flyToPick({lon, lat}) {
  if (!map || lon == null || lat == null) return;
  map.easeTo({center: [lon, lat], zoom: Math.max(map.getZoom(), 8), duration: 700});
}

/**
 * A river found by name, which is a whole river rather than a reach — so the camera frames its
 * published extent instead of travelling to a point on it.
 *
 * The names table carries the bounding box of every reach the name covers, which is the only way
 * either app can frame a river at all: the reaches are in vector tiles that are not loaded until the
 * camera is already looking at them. Flying to the mouth instead would put the Amazon on screen as
 * an estuary, with the river off the west edge.
 *
 * Falls back to the point when a row carries no box — an older release of the table has none, and a
 * river is still worth going to.
 */
export function fitRiverBounds(bbox, at) {
  if (!map) return;
  if (!bbox || bbox.length !== 4) return flyToPick(at ?? {});
  const [west, south, east, north] = bbox;
  const {width} = map.getContainer().getBoundingClientRect();
  map.fitBounds([[west, south], [east, north]], {
    // A river narrower than the padding cannot be fitted at all, so the padding is capped at a
    // share of the window rather than being a flat number of pixels.
    padding: Math.min(80, Math.round(width * 0.12)),
    // A single short reach has a near-degenerate box, and fitting one lands the camera at z22 on a
    // stream. 8 is the zoom flyToPick treats as close enough to read one.
    maxZoom: 8,
  });
}

// ── the catchments ───────────────────────────────────────────────────────────
function syncCatchmentHighlight() {
  if (!map?.getLayer('catchment-fill')) return;
  const up = selection ? inRangeExpr(selection) : null;
  map.setPaintProperty('catchment-fill', 'fill-color',
    up ? ['case', up, COLORS.upstream, CATCHMENT] : CATCHMENT);
  map.setPaintProperty('catchment-fill', 'fill-opacity',
    up ? ['case', up, CATCHMENT_UP_OPACITY, CATCHMENT_OPACITY] : CATCHMENT_OPACITY);
  map.setFilter('catchment-outlet', ['==', ['get', 'riverId'], selection?.outlet ?? -1]);
}

// ── the region polygons: Groups and HydroBASINS ──────────────────────────────
/** Only layers that are on the map answer a query, so a region that is switched off is inert. */
const drawnRegions = () => REGIONS.filter(r => map?.getLayer(r.layer));

/** Highlight every region under `point`; pass null to drop the highlight. */
export function hoverRegions(point) {
  const hits = point && drawnRegions().length
    ? map.queryRenderedFeatures(point, {layers: drawnRegions().map(r => r.layer)})
    : [];
  for (const r of REGIONS) {
    if (!map?.getSource(r.source)) continue;
    const ids = [...new Set(hits.filter(h => h.layer.id === r.layer)
      .map(h => h.id).filter(id => id != null))];
    if (ids.join() === hovered[r.key].join()) continue;
    const target = id => ({source: r.source, sourceLayer: r.sourceLayer(), id});
    for (const id of hovered[r.key]) map.setFeatureState(target(id), {hover: false});
    for (const id of ids) map.setFeatureState(target(id), {hover: true});
    hovered[r.key] = ids;
  }
}

/**
 * What the hydrography explorer draws on the shared map: the selection, the AOI's inlets, the
 * multi-select collection, and the styled stream layers the styling section compiles.
 *
 * The map itself belongs to map/map.js — there is one map, one `streams` source
 * and one base `streams` layer, and this module adds to them rather than building its own.
 */
import {map} from '../map/map.js';
import {setCatchmentSelection} from '../map/references.js';
import {applyStreamsVisibility, syncLayerPicker} from '../map/layers.js';
import {BASE_LAYER_ID, COLORS, inRangeExpr} from './streamStyle.js';
import {inFilter, noMatch, streamLine, zoomInterp} from '../map/streamFilters.js';

export {map};

/** Rule layers are inserted under this one, so the selected outlet is never painted over. */
const TOP_LAYER = 'outlet';

/** The amber wash over every reach the current selection holds. Its own layer rather than a color
 * folded into the network's paint, so a watershed stays visible under a forecast styleset too —
 * the styling section only draws the network while the stream style is Standard. */
const SEL_UP_LAYER = 'selection-upstream';

/** The multi-select collection: every picked watershed, and the outlet reach of each. */
const PICK_UP_LAYER = 'picked-upstream';
const PICK_LAYER = 'picked-outlet';

/** The AOI subsetter's inlets: the reaches the selection is cut off above. */
const INLET_LAYER = 'aoi-inlet';

/** What rule layers are inserted under: everything painting the app's own state, which no style rule
 * may cover. Bottom to top — rule layers go under the first of them that exists. */
const OVERLAYS = [SEL_UP_LAYER, PICK_UP_LAYER, PICK_LAYER, TOP_LAYER, INLET_LAYER];

const line = (id, color, width, opacity) => streamLine({
  id, color, opacity,
  width: zoomInterp(width),
  filter: noMatch('riverId'),
});

/** The width ramp a whole watershed is washed in, selected or collected — the two look alike on
 * purpose: a collected watershed is one that stayed selected. */
const UPSTREAM_WIDTH = [3, 1.6, 9, 3.2, 14, 5.5];

/** Every layer currently drawing the network. Just the base until a style is compiled over it. */
let layerOrder = [BASE_LAYER_ID];
let applied = new Map();

/**
 * Put the explorer's own layers on the map, above the network and its casings. Called once, after
 * the stream layer exists, so `addLayer` with no `beforeId` puts them where they belong.
 */
export function attachExplorerLayers() {
  const layers = [
    line(SEL_UP_LAYER, COLORS.upstream, UPSTREAM_WIDTH, 0.95),
    line(PICK_UP_LAYER, COLORS.upstream, UPSTREAM_WIDTH, 0.95),
    line(PICK_LAYER, COLORS.outlet, [3, 3, 9, 5.5, 14, 9]),
    line(TOP_LAYER, COLORS.outlet, [3, 5.5, 9, 8.5, 14, 12]),
    // Over the outlet, because an inlet can be the outlet's own reach on a one-reach AOI, and
    // because it is the thing you are placing while you are placing it. The outlet's own dark
    // orange, and narrower than the outlet: an inlet is the other end of the same selection,
    // without outweighing the reach it drains to.
    line(INLET_LAYER, COLORS.outlet, [3, 4, 9, 6, 14, 8]),
  ];
  for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l);
}

// ── the styled stream layers ─────────────────────────────────────────────────
/** Every layer currently drawing the network, for `queryRenderedFeatures` and for the tests. */
export const streamLayerIds = () => layerOrder.filter(id => map?.getLayer(id));

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Draw the network as the styling section compiled it. The base layer is the app's own `streams`
 * layer — it is repainted, never rebuilt — and each rule becomes a layer above it, under whatever
 * the app is painting on top.
 */
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

  // Layers added above start visible; if the network is switched off, put it back off. The picker
  // is told too — the ids it counts as "the network" have just changed.
  applyStreamsVisibility(map);
  syncLayerPicker(map);
}

/**
 * Hand the network back to whoever painted it before: every rule layer goes, and the base layer
 * loses the filter and zoom range the spec gave it. What repaints it is the caller's — the forecast
 * styleset that has just been switched on.
 */
export function clearStreamStyle() {
  for (const id of layerOrder) {
    if (id !== BASE_LAYER_ID && map.getLayer(id)) map.removeLayer(id);
  }
  layerOrder = [BASE_LAYER_ID];
  applied = new Map();
  if (map.getLayer(BASE_LAYER_ID)) {
    map.setFilter(BASE_LAYER_ID, null);
    map.setLayerZoomRange(BASE_LAYER_ID, 0, 24);
  }
  applyStreamsVisibility(map);
  syncLayerPicker(map);
}

/** The selected outlet's own line, the reaches above it, and the AOI's inlets. Off when the panel
 * is previewing the style without app state. */
export function setSelectionHighlightVisible(visible) {
  for (const id of [SEL_UP_LAYER, TOP_LAYER, INLET_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

// ── the upstream highlight ───────────────────────────────────────────────────
let selection = null;

export const currentSelection = () => selection;

/** Select `outlet` and everything in `range`; `onStyle` recompiles the stream layers around it. */
export function applyHighlight(range, outlet, onStyle) {
  selection = range ? {...range, outlet} : null;
  if (map.getLayer(SEL_UP_LAYER)) {
    map.setFilter(SEL_UP_LAYER, selection ? inRangeExpr(selection) : noMatch('riverIndex'));
  }
  if (map.getLayer(TOP_LAYER)) {
    map.setFilter(TOP_LAYER, inFilter('riverId', outlet == null ? [] : [outlet]));
  }
  onStyle?.();
  setCatchmentSelection(selection);
}

export function clearHighlight(onStyle) {
  applyHighlight(null, null, onStyle);
}

/** Draw the AOI's inlets — the reaches the selection stops above. Pass [] to draw none. */
export function applyInlets(ids) {
  if (!map?.getLayer(INLET_LAYER)) return;
  map.setFilter(INLET_LAYER, inFilter('riverId', ids));
}

// ── the multi-select collection ──────────────────────────────────────────────
let picked = [];

/** Paint every collected watershed in the pick color with its outlet drawn over it, off the same
 * one `riverIndex` range the single selection uses — so a collected watershed looks like one that
 * stayed selected. */
export function applyPicks(list) {
  picked = list ?? [];
  if (!map?.getLayer(PICK_LAYER)) return;
  map.setFilter(PICK_LAYER, inFilter('riverId', picked.map(p => p.outletId)));
  map.setFilter(PICK_UP_LAYER, picked.length
    ? ['any', ...picked.map(inRangeExpr)]
    : noMatch('riverIndex'));
}

/** Bring one pick into view without changing how far in the map is already zoomed. */
export function flyToPick({lon, lat}) {
  if (!map || lon == null || lat == null) return;
  map.easeTo({center: [lon, lat], zoom: Math.max(map.getZoom(), 8), duration: 700});
}

/**
 * A river found by name is a whole river, so the camera frames its published extent. The names table
 * carries the bounding box, which is the only way to frame one at all — the reaches live in tiles not
 * loaded until the camera is already there, and flying to the mouth would show the Amazon as an
 * estuary. Falls back to the point when a row carries no box.
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

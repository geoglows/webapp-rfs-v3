/**
 * Where the camera goes when the app is pointed at a reach.
 *
 * Both moves here are meant to run *after* the left panel has finished widening — see reflowMap()
 * in docks/dock.js. A camera animation and the panel transition overlapping is not a cosmetic
 * problem: MapLibre fixes the screen point an ease travels toward when the ease is created, so a
 * map that changes size mid-flight lands the reach wherever the old middle used to be.
 */

// Close enough that a reach fills the view rather than being a thread across it. Also the zoom the
// search box and the saved rivers travel to, so every way of arriving at a reach frames it alike.
const INSPECT_ZOOM = 10;
// How much of each edge counts as "nearly off screen". A reach inside this box is left where it is;
// one outside it is centered, which is what keeps a click near the panel edge from being swallowed
// when the dock takes its half of the window.
const EDGE_MARGIN = 0.15;

/**
 * The point on a clicked reach nearest the pointer, which is the thing to aim at — not the click.
 *
 * The map is queried with a ±10px box so a line a few pixels wide can be hit at all, and at low zoom
 * that tolerance is enormous on the ground: ~200 km a side at z3, against the ~60 km a z10 viewport
 * spans. Centering the click point can therefore leave the reach it found off screen entirely. The
 * geometry comes back from queryRenderedFeatures in lng/lat, clipped to the tile, which is all this
 * needs — the answer wanted is the part of the reach under the cursor.
 *
 * Returns null for a feature carrying no line, leaving the caller to fall back to the click. The
 * point carries `dist2`, its squared planar distance from the click in latitude-scaled degrees —
 * meaningless as a length, but comparable across features, which is what nearestFeature needs.
 */
function snapToFeature(feature, {lng, lat}) {
  const {type, coordinates} = feature?.geometry ?? {};
  const lines = type === "LineString" ? [coordinates] : type === "MultiLineString" ? coordinates : null;
  if (!lines?.length) return null;
  // Degrees of longitude are shorter than degrees of latitude everywhere but the equator, so compare
  // distances in a plane scaled for this latitude. Over the span of one tile that is exact enough to
  // pick the right vertex, which is the only judgement being made.
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestDist = Infinity;
  const consider = (lon, la) => {
    const dx = (lng - lon) * kx;
    const dy = lat - la;
    const dist = dx * dx + dy * dy;
    if (dist >= bestDist) return;
    bestDist = dist;
    best = {lat: la, lon, dist2: dist};
  };
  for (const line of lines) {
    if (!line?.length) continue;
    // A single-vertex line has no segment to project onto; it is still a candidate point.
    consider(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const dx = (bx - ax) * kx;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      // Where along this segment the pointer falls, clamped to its ends so the answer stays on the
      // reach rather than on the infinite line through it.
      const t = len2 ? Math.max(0, Math.min(1, (((lng - ax) * kx * dx) + (lat - ay) * dy) / len2)) : 0;
      consider(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return best;
}

/**
 * Of the features a box query returned, the one whose line actually passes closest to the click.
 *
 * queryRenderedFeatures hands back everything inside the box in draw order, so once zoomed in far
 * enough for reaches to sit a few pixels apart, taking the first one selects whichever neighbour
 * happens to be painted on top rather than the one under the pointer. Features without a line
 * still count, but only when nothing better is there.
 */
function nearestFeature(features, lngLat) {
  let best = null;
  let bestDist = Infinity;
  for (const f of features) {
    const d = snapToFeature(f, lngLat)?.dist2 ?? Infinity;
    if (best === null || d < bestDist) { best = f; bestDist = d; }
  }
  return best;
}

/** Is the point well inside the map that is left, or is it at an edge — or behind the panel? */
function isFramed(map, center) {
  const {width, height} = map.getContainer().getBoundingClientRect();
  const {x, y} = map.project(center);
  return x > width * EDGE_MARGIN && x < width * (1 - EDGE_MARGIN)
    && y > height * EDGE_MARGIN && y < height * (1 - EDGE_MARGIN);
}

/**
 * A reach the user went looking for — searched by id, or picked off one of the saved lists. They
 * asked to be taken there, so the camera travels whatever the view was showing before.
 */
function travelToRiver(map, {lat, lon}) {
  if (lat == null || lon == null) return;
  map.flyTo({center: [lon, lat], zoom: Math.max(map.getZoom(), INSPECT_ZOOM)});
}

/**
 * A river the user found by name, which is a whole river rather than a reach — so the camera frames
 * its published extent instead of travelling to a point on it.
 *
 * A name found in the table comes with the bounding box of every reach it covers, which is the only
 * way this app can frame a river at all: the reaches are in vector tiles that are not loaded until
 * the camera is already looking at them. Flying to the mouth instead would put the Amazon on screen
 * as an estuary, with the river off the west edge.
 *
 * The padding keeps the river off the window edges and, on the left, out from under the panel that
 * is opening as this runs. Falls back to the point when a row carries no box — an older release of
 * the names table has none, and a river is still worth going to.
 */
function frameRiverExtent(map, {bbox, lat, lon}) {
  if (!bbox || bbox.length !== 4) return travelToRiver(map, {lat, lon});
  const [west, south, east, north] = bbox;
  const {width} = map.getContainer().getBoundingClientRect();
  map.fitBounds([[west, south], [east, north]], {
    // A river narrower than the padding cannot be fitted at all, so the padding is capped at a
    // share of the window rather than being a flat number of pixels.
    padding: Math.min(80, Math.round(width * 0.12)),
    // A single short reach has a near-degenerate box, and fitting one lands the camera at z22 on a
    // stream. This is the zoom a reach is inspected at everywhere else in the app.
    maxZoom: INSPECT_ZOOM
  });
}

/**
 * A reach the user clicked, which they are already looking at — so the view moves only when it has
 * to. Too far out to read a single stream: zoom in on it. Close enough already: hold the view still
 * unless the reach is at an edge, where the panel that just widened may have taken it.
 */
function focusRiver(map, {lat, lon}) {
  if (lat == null || lon == null) return;
  const center = [lon, lat];
  if (map.getZoom() < INSPECT_ZOOM) {
    map.easeTo({center, zoom: INSPECT_ZOOM, duration: 600});
    return;
  }
  if (!isFramed(map, center)) map.easeTo({center, duration: 400});
}

export {focusRiver, frameRiverExtent, snapToFeature, travelToRiver, nearestFeature};

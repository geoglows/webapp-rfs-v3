import {urls} from "rfsjs/v3";

/**
 * The FLDPLN data-tile footprints, and the viewport → coverage bridge built on them.
 *
 * Two layers come from one pmtiles source: an invisible fill used purely as a hit-test target,
 * and a dashed outline shown only in flood mapping mode so you can see where library data exists.
 * Whenever the visible set of tiles changes, `onTiles(names)` fires so the caller can ask the
 * flood worker to load that coverage.
 *
 * Callbacks rather than shared state, so this stays independent of the app's flood-mode plumbing:
 *   isReady() — is the worker up? (no point asking for coverage before it is)
 *   onTiles(names) — the sorted tile names now under the viewport
 */
class FloodMapsTilesLayer {
  constructor(map, {isReady, onTiles}) {
    this.map = map;
    this.isReady = isReady;
    this.onTiles = onTiles;
    // Gated off until flood mapping mode turns it on, so normal browsing never fetches tile headers.
    this.active = false;
    this.lastKey = "";
  }

  /** Add the source + both layers, and start watching for viewport/tile-load changes. Called
   * lazily on first entry into flood mode, not at map load: addSource() fetches the pmtiles
   * header immediately, and normal browsing should never pay for (or 404 on) that archive. */
  add() {
    const map = this.map;
    if (map.getSource("flood-maps-tiles")) return;
    map.addSource("flood-maps-tiles", {type: "vector", url: `pmtiles://${urls.floodMapsTileBoundaries()}`});
    // Keep the footprints under the selection highlights, which were added back at map load.
    const beforeId = map.getLayer("flood-maps-coverage") ? "flood-maps-coverage" : undefined;
    // Invisible fill = the viewport hit-test target. A line layer would miss a viewport sitting
    // entirely inside one tile with no edge on screen; a fill at opacity 0 still renders, so
    // queryRenderedFeatures returns it wherever the viewport lands.
    map.addLayer({
      id: "flood-maps-tiles-hit",
      type: "fill",
      source: "flood-maps-tiles",
      // "fim_tiles" is the layer name inside the published pmtiles — it stays until that archive is
      // rebuilt by references/map-styles/build_flood_maps_tile_boundaries.mjs and redeployed.
      "source-layer": "fim_tiles",
      paint: {"fill-opacity": 0}
    }, beforeId);
    // Faint outline, shown only in flood mode, so the data-tile footprint is visible.
    map.addLayer({
      id: "flood-maps-tiles-outline",
      type: "line",
      source: "flood-maps-tiles",
      "source-layer": "fim_tiles",
      layout: {visibility: this.active ? "visible" : "none"},
      paint: {"line-color": "#38bdf8", "line-width": 1, "line-opacity": 0.5, "line-dasharray": [2, 2]}
    }, beforeId);
    map.on("sourcedata", (e) => {
      if (e.sourceId === "flood-maps-tiles" && e.isSourceLoaded) this.sync();
    });
    map.on("moveend", () => this.sync());
  }

  /** Flood mapping mode on/off: show the footprints and start (or stop) tracking the viewport.
   * The first `on` is also what creates the source and layers — same lazy pattern as the flood
   * worker, so nothing is fetched until the user actually enters flood mode. */
  setActive(on) {
    this.active = on;
    if (on) this.add();
    if (this.map.getLayer("flood-maps-tiles-outline")) {
      this.map.setLayoutProperty("flood-maps-tiles-outline", "visibility", on ? "visible" : "none");
    }
    if (on) this.sync();
  }

  /** Which flood-data tiles overlap the current viewport → hand them to the caller. Deduped
   * against the last report, so panning within one tile doesn't re-request anything. */
  sync() {
    const map = this.map;
    if (!this.active || !this.isReady() || !map.getLayer("flood-maps-tiles-hit")) return;
    if (map.getZoom() < 7) return;
    const names = [...new Set(
      map.queryRenderedFeatures({layers: ["flood-maps-tiles-hit"]}).map((f) => f.properties.name)
    )].sort();
    const key = names.join(",");
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (names.length) this.onTiles(names);
  }
}

export {FloodMapsTilesLayer};

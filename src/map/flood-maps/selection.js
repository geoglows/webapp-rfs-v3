import {floodNetwork} from "./network";
import {MAX_FLOOD_REACHES, MIN_FLOOD_MAPS_ZOOM} from "../../settings/settings.js";

const NO_MATCH = ["in", ["get", "riverId"], ["literal", []]];
const inFilter = (ids) => ids.length ? ["in", ["get", "riverId"], ["literal", ids]] : NO_MATCH;

class Selection {
  /**
   * Corridor reach picker: click two reaches and everything on the river between them comes with
   * them; click more to extend the corridor, click a chosen reach again to drop it.
   *
   * Two sets, and the difference matters for both the highlights and the toggling: `clicked` is
   * what the user actually picked, `corridor` is what that means on the river (RiverNetwork's
   * between(), from riverforecastsystem/v3/hydrography). Only `clicked` is toggled — clicking a reach the
   * corridor merely passes through pins it, so it survives dropping the click that pulled it in.
   *
   * hasCoverage(riverId): whether a reach has flood-library data in the loaded (viewport) tiles.
   * It arrives async and grows as you pan, so call refresh() when it updates.
   */
  constructor(map, onChange, hasCoverage = () => false) {
    this.map = map;
    this.onChange = onChange;
    this.hasCoverage = hasCoverage;
    document.getElementById("btn-clear")?.addEventListener("click", () => this.clear());
    // The graph is optional (see network.js) and only arrives after the first clicks are possible,
    // so it is folded in whenever it lands rather than waited on.
    void floodNetwork().then((net) => {
      if (!net) return;
      this.network = net;
      if (this.clicked.size) this.recompute();
    });
  }

  map;
  onChange;
  hasCoverage;
  network = null;
  clicked = new Set();
  corridor = new Set();
  warnEl = document.getElementById("warning");

  /** Re-derive floodable/highlights (e.g. once the coverage set has grown after a pan). */
  refresh() {
    this.recompute();
  }

  coverageIds = [];

  /** Highlight layers on top of the animated `streams` layer. Hidden until flood mode turns
   * them on. Bottom → top: reaches that CANNOT flood (no library coverage), the corridor, the
   * subset of it that's ready to flood, and what you actually clicked. */
  addHighlightLayers() {
    const line = (id, color, width, opacity, dash, minzoom) => {
      this.map.addLayer({
        id,
        type: "line",
        source: "geoglows",
        "source-layer": "streams",
        filter: NO_MATCH,
        ...minzoom ? {minzoom} : {},
        layout: {"line-cap": "round", "line-join": "round", visibility: "none"},
        paint: {
          "line-color": color,
          // grow with zoom (matching the base streams' high-zoom widening) so a highlighted
          // reach stays clearly visible on top when zoomed in
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, width * 0.6, 8, width, 13, width * 1.8, 16, width * 3.2],
          "line-opacity": opacity,
          ...dash ? {"line-dasharray": dash} : {}
        }
      });
    };
    // Base `streams` lines are LIGHT BLUE — highlights MUST clash (dark/contrasting), never
    // light blue. Reaches with NO flood library = solid RED; corridor = amber; ready = green; the
    // reaches actually clicked are dashed white on top of all of it, so it stays obvious which
    // ones are yours to click off again once a corridor has filled in around them.
    // Marking absence means matching nearly every reach on screen, so this one carries a minzoom:
    // zoomed out past where flood mapping works there is no library loaded to compare against and
    // every river on earth would qualify. The others match only what is selected and need none.
    line("flood-maps-unmappable", "#dc2626", 3, 0.95, null, MIN_FLOOD_MAPS_ZOOM);
    line("sel-selected", "#f59e0b", 3, 0.95);
    line("sel-floodable", "#22c55e", 4, 0.95);
    line("sel-clicked", "#ffffff", 1.5, 1, [2, 2]);
    this.setCoverage(this.coverageIds);
  }

  /**
   * Mark every reach the flood library does NOT hold, so what is left unmarked is what can be
   * mapped. The filter is the complement of the coverage set — there is no list of absent rivers
   * to match on, only the list of present ones to exclude.
   *
   * Nothing is marked until at least one data tile's coverage has loaded. An empty set would
   * otherwise mean "no river anywhere is in the library", painting the whole network red on the
   * way into flood mode and everywhere outside the library's footprint — which reads as a broken
   * map rather than as an answer. The set only grows as tiles load with panning.
   */
  setCoverage(ids) {
    this.coverageIds = ids;
    if (!this.map.getLayer("flood-maps-unmappable")) return;
    if (!this.map.isStyleLoaded()) {
      this.map.once("idle", () => this.setCoverage(this.coverageIds));
      return;
    }
    this.map.setFilter("flood-maps-unmappable", ids.length ? ["!", inFilter(ids)] : NO_MATCH);
    this.logSelection([...this.corridor].filter((id) => this.hasCoverage(id)).length);
  }

  /** The corridor the current clicks imply. Without the graph it is just the clicks — see network.js. */
  computeCorridor() {
    return this.network
      ? this.network.between([...this.clicked])
      : {corridor: new Set(this.clicked), junctions: [], detached: [...this.clicked]};
  }

  /**
   * Toggle a reach in/out of the picked set, then re-derive the corridor it implies.
   *
   * A click pulls in everything between it and the other clicks, so one reach can take the total
   * from a handful to hundreds. That is refused rather than clamped: there is no sensible way to
   * keep "part of" a corridor, so the click that crossed the line is undone and the selection is
   * left exactly as it was. Removing a reach can only shrink the corridor, so it never checks.
   */
  select(rid) {
    const added = !this.clicked.has(rid);
    if (added) this.clicked.add(rid);
    else this.clicked.delete(rid);
    const between = this.computeCorridor();
    if (added && between.corridor.size > MAX_FLOOD_REACHES) {
      this.clicked.delete(rid);
      this.warn(`That reach would make ${between.corridor.size.toLocaleString()} reaches — the limit is ${MAX_FLOOD_REACHES}. Selection unchanged.`);
      console.warn(`Rejected reach ${rid}: corridor would span ${between.corridor.size} reaches (max ${MAX_FLOOD_REACHES}).`);
      return;
    }
    this.recompute(between);
  }

  clear() {
    this.clicked.clear();
    this.recompute();
  }

  recompute(between = this.computeCorridor()) {
    this.corridor = between.corridor;
    this.detached = between.detached;
    const floodable = [...this.corridor].filter((id) => this.hasCoverage(id));
    this.updateFilters(floodable);
    this.logSelection(floodable.length);
    this.clearWarning();
    // The corridor is the selection as far as everything downstream of here is concerned: it is
    // what gets flooded, and the clicks are only how it was described.
    this.onChange({selected: [...this.corridor], floodable, clicked: [...this.clicked]});
  }

  updateFilters(floodable) {
    if (!this.map.isStyleLoaded()) {
      this.map.once("idle", () => this.updateFilters(floodable));
      return;
    }
    this.map.setFilter("sel-selected", inFilter([...this.corridor]));
    this.map.setFilter("sel-floodable", inFilter(floodable));
    this.map.setFilter("sel-clicked", inFilter([...this.clicked]));
  }

  /** The one thing the panel still says: that a click was refused. Cleared by the next accepted one. */
  warn(message) {
    if (!this.warnEl) return;
    this.warnEl.textContent = `⚠ ${message}`;
    this.warnEl.classList.remove("hidden");
  }

  clearWarning() {
    this.warnEl?.classList.add("hidden");
  }

  /** Selection state goes to the console rather than the panel — the map already shows it, in the
   * colours of the highlight layers. */
  logSelection(floodableCount) {
    const n = this.corridor.size;
    const parts = [`Selection: ${this.clicked.size} clicked → ${n} in corridor, ${floodableCount} floodable`,
                   `${this.coverageIds.length} reach(es) with coverage loaded`];
    if (this.detached?.length && this.clicked.size > 1) {
      parts.push(`${this.detached.length} click(es) on a separate branch — no river runs between those and the rest`);
    }
    console.log(parts.join(" · "));
  }
}

export {
  NO_MATCH,
  Selection,
  inFilter
};

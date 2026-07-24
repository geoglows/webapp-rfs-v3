const WARN_THRESHOLD = 30;
const NO_MATCH = ["in", ["get", "riverId"], ["literal", []]];
const inFilter = (ids) => ids.length ? ["in", ["get", "riverId"], ["literal", ids]] : NO_MATCH;

class Selection {
  /**
   * Manual reach picker: click a reach to toggle it into the flood-map selection. The topology-
   * assisted methods (inlet/outlet corridor, click-radius) were removed until the streams carry
   * the attributes those methods need — see the package's v3.hydrography (RiverNetwork), kept
   * dormant for their return.
   *
   * hasCoverage(riverId): whether a reach has flood-library data in the loaded (viewport) tiles.
   * It arrives async and grows as you pan, so call refresh() when it updates.
   */
  constructor(map, onChange, hasCoverage = () => false) {
    this.map = map;
    this.onChange = onChange;
    this.hasCoverage = hasCoverage;
    document.getElementById("btn-clear")?.addEventListener("click", () => this.clear());
  }

  map;
  onChange;
  hasCoverage;
  selected = new Set();
  infoEl = document.getElementById("selection-info");
  warnEl = document.getElementById("warning");

  /** Re-derive floodable/highlights (e.g. once the coverage set has grown after a pan). */
  refresh() {
    this.recompute();
  }

  coverageIds = [];

  /** Highlight layers on top of the animated `streams` layer. Hidden until flood mode turns
   * them on (see setFloodMappingMode). Bottom → top: reaches that CAN flood (library coverage),
   * what you clicked, and the subset that's ready to flood. */
  addHighlightLayers() {
    const line = (id, color, width, opacity, dash) => {
      this.map.addLayer({
        id,
        type: "line",
        source: "geoglows",
        "source-layer": "streams",
        filter: NO_MATCH,
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
    // light blue. Flood-mappable coverage = solid RED; selected = amber; ready = green.
    line("flood-maps-coverage", "#dc2626", 3, 0.95);
    line("sel-selected", "#f59e0b", 3, 0.95);
    line("sel-floodable", "#22c55e", 4, 0.95);
    this.setCoverage(this.coverageIds);
  }

  /** Highlight every reach that has flood-library coverage in the loaded tiles, so the user can
   * see which reaches are worth clicking. The set grows as more tiles load with panning. */
  setCoverage(ids) {
    this.coverageIds = ids;
    if (!this.map.getLayer("flood-maps-coverage")) return;
    if (!this.map.isStyleLoaded()) {
      this.map.once("idle", () => this.setCoverage(this.coverageIds));
      return;
    }
    this.map.setFilter("flood-maps-coverage", inFilter(ids));
    this.updateInfo([...this.selected].filter((id) => this.hasCoverage(id)).length);
  }

  /** Toggle a reach in/out of the flood-map selection. */
  select(rid) {
    if (this.selected.has(rid)) this.selected.delete(rid);
    else this.selected.add(rid);
    this.recompute();
  }

  clear() {
    this.selected.clear();
    this.recompute();
  }

  recompute() {
    const floodable = [...this.selected].filter((id) => this.hasCoverage(id));
    this.updateFilters(floodable);
    this.updateInfo(floodable.length);
    this.onChange({selected: [...this.selected], floodable});
  }

  updateFilters(floodable) {
    if (!this.map.isStyleLoaded()) {
      this.map.once("idle", () => this.updateFilters(floodable));
      return;
    }
    this.map.setFilter("sel-selected", inFilter([...this.selected]));
    this.map.setFilter("sel-floodable", inFilter(floodable));
  }

  setInfo(html) {
    this.infoEl.innerHTML = html;
  }

  updateInfo(floodableCount) {
    const n = this.selected.size;
    const haveCoverage = this.coverageIds.length > 0;
    console.log(`Selection: ${n} selected, ${floodableCount} floodable, ${this.coverageIds.length} with coverage`);
    const parts = [`Selected: <span class="count">${n.toLocaleString()}</span> reach(es)`];
    if (floodableCount) parts.push(`<span class="hint">${floodableCount} with flood-library coverage — ready to compute.</span>`);
    else if (haveCoverage) parts.push('<span class="hint">None of these are in the flood library — click the red-highlighted reaches instead.</span>');
    else parts.push('<span class="hint">No flood-library coverage loaded here yet — pan/zoom into an outlined tile.</span>');
    this.setInfo(parts.join("<br>"));
    if (floodableCount > WARN_THRESHOLD) {
      this.warnEl.textContent = `⚠ ${floodableCount.toLocaleString()} reaches ready (> ${WARN_THRESHOLD}). Flood computation may be slow.`;
      this.warnEl.classList.remove("hidden");
    } else {
      this.warnEl.classList.add("hidden");
    }
  }
}

export {
  NO_MATCH,
  Selection,
  WARN_THRESHOLD,
  inFilter
};

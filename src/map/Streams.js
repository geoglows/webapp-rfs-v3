import {urls} from "rfsjs/v3";
import {inFilter, NO_MATCH} from "./flood-maps/selection";
import {SAVED_RIVERS} from "../settings/settings.js";

const RET_COLORS = ["#3182bd", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026", "#7a0177"];
// Uniform stream color for the "Standard" styleset (matches the normal-flow return-period blue).
const STANDARD_COLOR = "#3182bd";
// Width of the smallest reaches, and the single width every reach takes in flood mapping mode.
const WIDTH_BASE = 4;
// The saved-river outline, all three of them configurable per deployment (VITE_SAVED_RIVERS_* — see
// SAVED_RIVERS in settings/settings.js). The colour falls back to the stylesheet's dark-theme
// --saved so an unconfigured deployment looks exactly as it did before there was a setting.
const SAVED_COLOR = SAVED_RIVERS.color || "#ff4fa3";
const SAVED_BORDER = SAVED_RIVERS.borderWidth;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fetchOk = async url => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText} for ${url}`);
  return resp;
};

class Streams {
  map;
  meta = null;
  cube = null;
  // [N*T], row-major, delta undone
  N = 0;
  T = 0;
  step = 0;
  playing = false;
  timer = null;
  fps = 4;
  styleset = "max-flow";
  currentDate = null;
  idFi = new Map();
  // riverId -> riverIndex (cube row; -1 = no forecast)
  savedIds = [];
  // Whether the saved-river outline is drawn. The deployment's default until the Settings
  // subscription reports what this device actually chose, which happens before the map loads.
  savedHighlightVisible = SAVED_RIVERS.highlight;
  appliedStep = -1;
  applyScheduled = false;
  // player DOM
  sliderEl = document.getElementById("slider");
  timeEl = document.getElementById("time-label");
  stepEl = document.getElementById("step-label");
  playBtn = document.getElementById("btn-play");
  progEl = document.getElementById("progress-bar");
  speedEl = document.getElementById("speed");

  constructor(map) {
    this.map = map;
    this.wirePlayer();
  }

  /** Add the animated global streams source + line layer on top of the loaded basemap. */
  addStreamsLayer() {
    this.map.addSource("geoglows", {
      type: "vector",
      url: `pmtiles://${urls.streamsPmtiles()}`,
      promoteId: {streams: "riverId"},
      attribution: "GEOGLOWS"
    });
    this.map.addLayer({
      id: "streams",
      type: "line",
      source: "geoglows",
      "source-layer": "streams",
      layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.65, 9, 0.95]}
    });
    // Color and width belong to whichever styleset is active, including the one the app opens on —
    // applyPaint is the only thing that knows how to pick them.
    this.applyPaint();
    // Any tile arrival schedules a discovery pass — waiting for isSourceLoaded too would only
    // fire when the last tile's own event closes out the source, which tile arrival order
    // doesn't guarantee. scheduleApply dedupes to one pass per frame, so per-tile is cheap.
    this.map.on("sourcedata", (e) => {
      if (this.cube && e.sourceId === "geoglows" && e.tile) this.scheduleApply();
    });
    this.addSavedHighlightLayer();
    this.addInspectHighlightLayer();
  }

  /**
   * The pink outline around every river the user has saved.
   *
   * Added *beneath* `streams` and drawn wider than it, so the streams line covers the middle and
   * what is left showing is a border down both sides. Above it instead would hide the reach's own
   * colour, which is the forecast — the thing the map is for.
   *
   * A declarative filter on riverId, like the other highlights: the saved set is set once and the
   * outline paints itself onto tiles as they arrive, with nothing to re-run on pan or zoom.
   */
  addSavedHighlightLayer() {
    if (this.map.getLayer("saved-highlight")) return;
    this.map.addLayer({
      id: "saved-highlight",
      type: "line",
      source: "geoglows",
      "source-layer": "streams",
      filter: NO_MATCH,
      // The layer is always built, shown or not: the Settings toggle flips it many times over a
      // session, and hiding a layer is far cheaper than adding and removing one. Its starting
      // state is whatever the setting already resolved to — see setSavedHighlightVisible().
      layout: {
        "line-cap": "round",
        "line-join": "round",
        visibility: this.savedHighlightVisible ? "visible" : "none"
      },
      paint: {
        "line-color": SAVED_COLOR,
        "line-width": this.savedWidthExpr(this.animatedWidth()),
        "line-opacity": 1
      }
    }, "streams");
    this.setSavedRivers(this.savedIds);
  }

  /** The active streams width plus a border on each side — see addSavedHighlightLayer(). */
  savedWidthExpr(animated) {
    return this.streamWidthExpr(animated, 2 * SAVED_BORDER);
  }

  /**
   * Show or hide the saved-river outline. Driven by the Settings checkbox, which starts from
   * VITE_SAVED_RIVERS_HIGHLIGHT and is then the user's to change.
   *
   * Called before the map has loaded as well as after — the setting is read at startup, long
   * before there is a layer to set anything on — so the answer is kept here for
   * addSavedHighlightLayer() to build the layer with.
   */
  setSavedHighlightVisible(on) {
    this.savedHighlightVisible = on;
    if (!this.map.getLayer("saved-highlight")) return;
    this.map.setLayoutProperty("saved-highlight", "visibility", on ? "visible" : "none");
  }

  /** The reaches to outline as saved. Pass an empty array to clear. */
  setSavedRivers(ids) {
    this.savedIds = ids ?? [];
    if (!this.map.getLayer("saved-highlight")) return;
    if (!this.map.isStyleLoaded()) {
      this.map.once("idle", () => this.setSavedRivers(this.savedIds));
      return;
    }
    this.map.setFilter("saved-highlight", inFilter(this.savedIds));
  }

  /**
   * The single-reach highlight used when inspecting a river (clicking one outside flood mode).
   * Distinct from the flood selection highlights in flood-maps/selection.js, which can hold many
   * reaches — this one tracks whatever the charts dock is currently showing.
   */
  addInspectHighlightLayer() {
    if (this.map.getLayer("inspect-highlight")) return;
    this.map.addLayer({
      id: "inspect-highlight",
      type: "line",
      source: "geoglows",
      "source-layer": "streams",
      filter: NO_MATCH,
      layout: {"line-cap": "round", "line-join": "round"},
      paint: {
        "line-color": "#33FF57",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 5, 13, 9, 16, 14],
        "line-opacity": 0.95
      }
    });
  }

  /** Pass null to clear the highlight. */
  setInspectHighlight(riverId) {
    if (!this.map.getLayer("inspect-highlight")) return;
    this.map.setFilter("inspect-highlight", riverId == null ? NO_MATCH : inFilter([riverId]));
  }

  /** Return-period line-color expression driven by each reach's `ret` feature-state. */
  streamColorExpr() {
    const colorMatch = ["match", ["coalesce", ["feature-state", "ret"], 0]];
    for (let i = 0; i < RET_COLORS.length; i++) colorMatch.push(i, RET_COLORS[i]);
    colorMatch.push(RET_COLORS[0]);
    return colorMatch;
  }

  /** Zoom-scaled line-width expression. When `animated`, thickness comes from the per-reach `thk`
   * feature-state (falling back to strahlerOrder); otherwise it comes straight from strahlerOrder
   * so a non-animated styleset ignores any stale animation state. Per-zoom scale runs z3 global,
   * z7 regional, z12 local, and keeps growing past z12 for an easy-to-click hit box.
   *
   * `pad` widens every stop by a constant — for the saved-river casing, which has to track this
   * width exactly. It is folded into the stops rather than added around the whole expression
   * because MapLibre only accepts ["zoom"] as the input to a top-level step/interpolate: wrapping
   * this in ["+", …, pad] is a style error, not a wider line. */
  streamWidthExpr(animated, pad = 0) {
    const thkSource = animated
      ? ["coalesce", ["feature-state", "thk"], ["get", "strahlerOrder"]]
      : ["get", "strahlerOrder"];
    const THK = ["max", 1, ["min", 6, thkSource]];
    const RAMP = ["step", THK, WIDTH_BASE, 3, 9, 5, 10];
    const at = (scale) => (pad ? ["+", ["*", scale, RAMP], pad] : ["*", scale, RAMP]);
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      at(0.25),
      7,
      at(0.5),
      12,
      at(1),
      16,
      at(2.2)
    ];
  }

  /** Line-color for the time-to-peak styleset: warm (imminent) → cool (late), grey for no data. */
  ttpColorExpr() {
    return [
      "case",
      ["==", ["coalesce", ["feature-state", "ttp"], 255], 255], "#334155",
      ["interpolate", ["linear"], ["feature-state", "ttp"],
        0, "#d73027", 12, "#fdae61", 28, "#fee08b", 52, "#74add1", 80, "#4575b4"]
    ];
  }

  /** Line-color for the below-q95 styleset: below Q95 → red, at/above → blue, no data → grey. */
  q95ColorExpr() {
    return ["match", ["coalesce", ["feature-state", "q95dir"], 255], 1, "#dc2626", 0, "#3182bd", "#334155"];
  }

  /** Per-reach feature-state for a decoded style byte, keyed to the active styleset. */
  featureStateFor(b) {
    if (this.styleset === "time-to-peak") return {ttp: b};
    if (this.styleset === "below-q95") return {q95dir: b};
    return {ret: b >> 3, thk: (b & 7) + 1};
  }

  /** Whether the active styleset drives line thickness from per-reach feature-state. */
  animatedWidth() {
    return this.styleset === "timeseries" || this.styleset === "max-flow";
  }

  /** Set the streams line-color/line-width paint for the active styleset. */
  applyPaint() {
    if (!this.map.getLayer("streams")) return;
    const s = this.styleset;
    const retWidth = this.animatedWidth();
    let color;
    if (retWidth) color = this.streamColorExpr();
    else if (s === "time-to-peak") color = this.ttpColorExpr();
    else if (s === "below-q95") color = this.q95ColorExpr();
    else color = STANDARD_COLOR;
    this.map.setPaintProperty("streams", "line-color", color);
    this.map.setPaintProperty("streams", "line-width", this.streamWidthExpr(retWidth));
    // The saved outline is sized off the streams line it sits under, so it follows every width
    // change — a styleset that stops driving thickness from feature-state would otherwise leave the
    // border thick where the reach beneath it went thin.
    if (this.map.getLayer("saved-highlight")) {
      this.map.setPaintProperty("saved-highlight", "line-width", this.savedWidthExpr(retWidth));
    }
  }

  /** Switch styleset: repaint and (re)load its data. `standard` needs no data (uniform blue);
   * `timeseries` is the only animated one. Stale feature-state from other stylesets is harmless —
   * each styleset's paint reads only its own field. */
  setStyleset(styleset) {
    this.styleset = styleset;
    this.pause();
    this.applyPaint();
    if (styleset === "standard") {
      this.cube = null;
      return;
    }
    this.loadData();
  }

  /** Set the forecast-initialization date and (re)load the active styleset for it. */
  setDate(date) {
    this.currentDate = date;
    return this.loadData();
  }

  /** Re-apply feature-state to every already-discovered reach from the current data + step (used
   * when the styleset or date changes; new tiles are still handled by discoverAndApply). */
  applyAll() {
    if (!this.cube) return;
    const t = this.step;
    for (const [rid, fi] of this.idFi) {
      if (fi < 0) continue;
      this.map.setFeatureState(
        {source: "geoglows", sourceLayer: "streams", id: rid},
        this.featureStateFor(this.cube[fi * this.T + t])
      );
    }
    this.appliedStep = t;
  }

  /** Fetch + decode styles.{json,bin} for the active styleset + current date, then apply. Handles
   * both the animated cube (T>1, delta-encoded) and single-frame stylesets (T=1). riverIndex row
   * order is shared across every styleset, so the discovery cache (idFi) is reused, not cleared. */
  async loadData() {
    const styleset = this.styleset;
    const date = this.currentDate;
    if (styleset === "standard" || !date) return;
    // null for any styleset with no style tables of its own.
    const stylesBase = urls.streamsStyles({date, styleset});
    const t0 = performance.now();
    this.cube = null;
    this.appliedStep = -1;
    try {
      this.meta = await (await fetchOk(`${stylesBase}.json`)).json();
      this.N = this.meta.n_reaches;
      this.T = this.meta.n_steps ?? 1;
      let inflated;
      try {
        const resp = await fetchOk(`${stylesBase}.bin`);
        inflated = await new Response(resp.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
      } catch {
        const raw = (await (await fetchOk(`${stylesBase}.bin`)).body).pipeThrough(new DecompressionStream("deflate-raw"));
        inflated = await new Response(raw).arrayBuffer();
      }
      const cube = new Uint8Array(inflated);
      if (cube.length !== this.N * this.T) {
        throw new Error(`styles.bin decoded to ${cube.length} bytes, expected ${this.N * this.T}`);
      }
      // undo delta-over-time (no-op for single-frame T=1 stylesets)
      for (let i = 0, base2 = 0; i < this.N; i++, base2 += this.T) {
        let acc = cube[base2];
        for (let t = 1; t < this.T; t++) {
          acc = acc + cube[base2 + t] & 255;
          cube[base2 + t] = acc;
        }
      }
      this.cube = cube;
      this.buildLegend();
      this.sliderEl.max = String(Math.max(0, this.T - 1));
      this.sliderEl.disabled = this.T <= 1;
      if (this.T > 1) document.getElementById("player")?.classList.add("ready");
      this.setStep(0, false);
      this.applyAll();
      this.scheduleApply();
      // todo remove performance counter
      console.log(`  ${styleset} ready (${((performance.now() - t0) / 1e3).toFixed(1)}s)`);
    } catch (e) {
      console.error(`  ${styleset} (${date}): ${e.message}`);
    }
  }

  // color NEWLY-seen reaches to the current step (runs on tile load). The cube row comes
  // straight from the tile's `riverIndex` property — no riverId lookup table / binary search.
  discoverAndApply() {
    if (!this.cube) return;
    // The style is often mid-update right after a zoom. Dropping the pass here would leave the
    // newly loaded reaches unstyled with nothing to retry, so re-arm on the next idle instead.
    // Stacked handlers are harmless: they all funnel into scheduleApply's per-frame dedupe.
    if (!this.map.isStyleLoaded()) {
      this.map.once("idle", () => this.scheduleApply());
      return;
    }
    let feats;
    try {
      feats = this.map.querySourceFeatures("geoglows", {sourceLayer: "streams"});
    } catch {
      this.map.once("idle", () => this.scheduleApply());
      return;
    }
    const t = this.step;
    for (const f of feats) {
      const rid = f.id != null ? Number(f.id) : f.properties && Number(f.properties.riverId);
      if (rid == null || Number.isNaN(rid) || this.idFi.has(rid)) continue;
      const raw = f.properties?.riverIndex;
      const fi = raw == null ? -1 : Number(raw);
      const valid = fi >= 0 && fi < this.N;
      this.idFi.set(rid, valid ? fi : -1);
      if (!valid) continue;
      this.map.setFeatureState(
        {source: "geoglows", sourceLayer: "streams", id: rid},
        this.featureStateFor(this.cube[fi * this.T + t])
      );
    }
    if (this.appliedStep < 0) this.appliedStep = t;
  }

  // update ONLY reaches whose value differs from the previously-applied step
  applyStepChange() {
    if (!this.cube) return;
    const t = this.step;
    const p = this.appliedStep;
    if (p === t) return;
    if (p < 0) {
      this.scheduleApply();
      return;
    }
    for (const [rid, fi] of this.idFi) {
      if (fi < 0) continue;
      const b = this.cube[fi * this.T + t];
      if (b === this.cube[fi * this.T + p]) continue;
      this.map.setFeatureState(
        {source: "geoglows", sourceLayer: "streams", id: rid},
        this.featureStateFor(b)
      );
    }
    this.appliedStep = t;
  }

  scheduleApply() {
    if (this.applyScheduled) return;
    this.applyScheduled = true;
    requestAnimationFrame(() => {
      this.applyScheduled = false;
      this.discoverAndApply();
    });
  }

  // ---- player ----
  fmtStamp(s) {
    const p = s.split("-");
    if (p.length < 4) return s;
    return `${MONTHS[+p[1] - 1] || p[1]} ${+p[2]}, ${p[0]} · ${p[3]}:00 UTC`;
  }

  renderLabels() {
    const ts = this.meta?.timestamps?.[this.step];
    this.timeEl.textContent = ts ? this.fmtStamp(ts) : "—";
    this.stepEl.textContent = this.T > 1 ? `${this.step + 1}/${this.T}` : "";
    this.sliderEl.value = String(this.step);
    this.progEl.style.width = (this.T > 1 ? this.step / (this.T - 1) * 100 : 0) + "%";
  }

  setStep(t, apply = true) {
    this.step = (t % this.T + this.T) % this.T;
    this.renderLabels();
    if (apply) this.applyStepChange();
  }

  play() {
    if (this.playing || !this.cube || this.styleset !== "timeseries") return;
    this.playing = true;
    this.playBtn.textContent = "❚❚";
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.setStep(this.step + 1), 1e3 / this.fps);
  }

  pause() {
    this.playing = false;
    this.playBtn.textContent = "▶";
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  togglePlay() {
    this.playing ? this.pause() : this.play();
  }

  wirePlayer() {
    this.playBtn.addEventListener("click", () => this.togglePlay());
    this.sliderEl.addEventListener("input", () => {
      this.pause();
      this.setStep(+this.sliderEl.value);
    });
    this.speedEl.addEventListener("change", () => {
      this.fps = +this.speedEl.value;
      if (this.playing) {
        this.pause();
        this.play();
      }
    });
    document.addEventListener("keydown", (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (this.styleset !== "timeseries") return;
      if (e.code === "Space") {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === "ArrowRight") {
        this.pause();
        this.setStep(this.step + 1);
      } else if (e.code === "ArrowLeft") {
        this.pause();
        this.setStep(this.step - 1);
      }
    });
  }

  buildLegend() {
    const box = document.getElementById("legend-items");
    if (!box) return;
    const titleEl = document.querySelector("#legend-overlay h2");
    const s = this.styleset;
    box.innerHTML = "";
    const add = (color, label) => {
      const row = document.createElement("div");
      row.className = "legend-item";
      row.innerHTML = `<span class="swatch" style="background:${color}"></span>${label}`;
      box.appendChild(row);
    };
    if (s === "below-q95") {
      if (titleEl) titleEl.textContent = "Q95 low flow";
      add("#dc2626", "Below Q95 (rare low flow)");
      add("#3182bd", "At or above Q95");
      add("#334155", "No data");
    } else if (s === "time-to-peak") {
      if (titleEl) titleEl.textContent = "Time to peak";
      const h = this.meta?.step_hours ?? 3;
      add("#d73027", "Now / imminent");
      add("#fee08b", `~${Math.round(28 * h / 24)} days`);
      add("#4575b4", `~${Math.round(80 * h / 24)} days`);
      add("#334155", "No data");
    } else {
      if (titleEl) titleEl.textContent = s === "max-flow" ? "Max forecast return period" : "Forecast return period";
      const vals = this.meta?.ret_per_values ?? [0, 2, 5, 10, 25, 50, 100];
      vals.forEach((v, i) => add(RET_COLORS[i], v === 0 ? "Normal (&lt; 2-yr)" : `${v}-year`));
    }
  }
}

export {
  Streams
};

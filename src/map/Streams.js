import {urls} from "riverforecastsystem/v3";
import {inFilter, noMatch, spanFilter, streamLine, whenStyleReady, zoomInterp} from "./streamFilters.js";
import {SAVED_RIVERS} from "../settings/settings.js";

// The inspect and saved-river highlights address reaches by riverId — the charts dock and the saved
// list are keyed on it. A named river is a contiguous run of riverIndex — every reach upstream of
// its mouth — selected as a range rather than a list of ids, which is the whole reason the names
// table can name a river at all: two bounds instead of the hundreds of thousands of ids between
// them. Both filter shapes come from streamFilters.js, keyed by what each highlight matches on.

const RET_COLORS = ["#3182bd", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026", "#7a0177"];
// Uniform stream color for the "Standard" styleset (matches the normal-flow return-period blue).
const STANDARD_COLOR = "#3182bd";
// Width of the smallest reaches, and the single width every reach takes in flood mapping mode.
const WIDTH_BASE = 4;
// The thickness ramp runs WIDTH_BASE → WIDTH_MAX; flood mode flattens it to one thin width.
const WIDTH_MAX = 10;
const WIDTH_UNIFORM = 5;
const THK_DOMAIN = [1, 6];
const ORDER_DOMAIN = [2, 10];
// WIDTH_BASE at the bottom of `domain`, WIDTH_MAX at the top, linear between and flat outside —
// interpolate clamps to its end stops, which is the clamp the old ["min", ...] was doing by hand.
const widthRamp = (value, [lo, hi]) =>
  ["interpolate", ["linear"], ["to-number", value], lo, WIDTH_BASE, hi, WIDTH_MAX];
// The saved-river outline, all three of them configurable per deployment (VITE_SAVED_RIVERS_* — see
// SAVED_RIVERS in settings/settings.js). The color falls back to the stylesheet's dark-theme
// --saved so an unconfigured deployment looks exactly as it did before there was a setting.
const SAVED_COLOR = SAVED_RIVERS.color || "#ff4fa3";
const SAVED_BORDER = SAVED_RIVERS.borderWidth;
// The river found by name. Not on the return-period scale, not the saved pink, not the inspect
// green and not the amber a flood corridor uses — a named river is a different kind of answer from
// all of them, and the one thing it must never be mistaken for is a reading of the forecast.
const NAMED_COLOR = "#ff5f1f";
const NAMED_WIDTH = WIDTH_MAX + 4;
// The network's own fade at low zoom. Named because applyPaint() has to be able to put it back
// after the styling section has drawn the layer with an opacity of its own.
const BASE_OPACITY = ["interpolate", ["linear"], ["zoom"], 3, 0.65, 9, 0.95];
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
  uniformWidth = false;  // flood mode flattens the thickness ramp — see setUniformWidth()
  playing = false;
  timer = null;
  fps = 4;
  styleset = "max-flow";
  currentDate = null;
  idFi = new Map();
  // riverId -> riverIndex (cube row; -1 = no forecast)
  savedIds = [];
  // The riverIndex range of the river last found by name, or null. Held like savedIds so the layer
  // can be rebuilt with it after a style change.
  namedSpan = null;
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

  constructor(map, {styleset = "max-flow"} = {}) {
    this.map = map;
    // The styleset the network opens on, set before the layer is built rather than switched into
    // afterwards: setStyleset() reloads the data, and at boot there is nothing to reload from yet.
    this.styleset = styleset;
    this.wirePlayer();
  }

  /** Add the animated global streams source + line layer on top of the loaded basemap. */
  addStreamsLayer() {
    this.map.addSource("streams", {
      type: "vector",
      url: `pmtiles://${urls.streamsPmtiles()}`,
      promoteId: {streams: "riverId"},
      attribution: "GEOGLOWS"
    });
    this.map.addLayer({
      id: "streams",
      type: "line",
      source: "streams",
      "source-layer": "streams",
      layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-opacity": BASE_OPACITY}
    });
    // Color and width belong to whichever styleset is active, including the one the app opens on —
    // applyPaint is the only thing that knows how to pick them.
    this.applyPaint();
    // Any tile arrival schedules a discovery pass — waiting for isSourceLoaded too would only
    // fire when the last tile's own event closes out the source, which tile arrival order
    // doesn't guarantee. scheduleApply dedupes to one pass per frame, so per-tile is cheap.
    this.map.on("sourcedata", (e) => {
      if (this.cube && e.sourceId === "streams" && e.tile) this.scheduleApply();
    });
    this.addSavedHighlightLayer();
    this.addNamedHighlightLayer();
    this.addInspectHighlightLayer();
  }

  /**
   * The pink outline around every river the user has saved.
   *
   * Added *beneath* `streams` and drawn wider than it, so the streams line covers the middle and
   * what is left showing is a border down both sides. Above it instead would hide the reach's own
   * color, which is the forecast — the thing the map is for.
   *
   * A declarative filter on riverId, like the other highlights: the saved set is set once and the
   * outline paints itself onto tiles as they arrive, with nothing to re-run on pan or zoom.
   */
  addSavedHighlightLayer() {
    if (this.map.getLayer("saved-highlight")) return;
    // The layer is always built, shown or not: the Settings toggle flips it many times over a
    // session, and hiding a layer is far cheaper than adding and removing one. Its starting
    // state is whatever the setting already resolved to — see setSavedHighlightVisible().
    this.map.addLayer(streamLine({
      id: "saved-highlight",
      color: SAVED_COLOR,
      width: this.savedWidthExpr(this.animatedWidth()),
      opacity: 1,
      filter: noMatch("riverId"),
      visibility: this.savedHighlightVisible ? "visible" : "none"
    }), "streams");
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
    whenStyleReady(this.map, () =>
      this.map.setFilter("saved-highlight", inFilter("riverId", this.savedIds)));
  }

  /**
   * The neon orange casing under the whole of a river found by name.
   *
   * Beneath `streams` and wider than it, like the saved-river outline: the streams line covers the
   * middle, so what shows is a border down both sides and the reach keeps its own forecast color.
   * Above it instead would paint over the forecast for the length of the Amazon.
   *
   * One filter over a riverIndex range does the whole river — 233,398 reaches for the Amazon — and
   * paints itself onto tiles as they arrive, so panning along a river needs nothing re-run.
   */
  addNamedHighlightLayer() {
    if (this.map.getLayer("named-highlight")) return;
    this.map.addLayer(streamLine({
      id: "named-highlight",
      color: NAMED_COLOR,
      // The streams ramp's own zoom scale, so the casing keeps its proportion to the network at
      // every zoom, but with a flat width in place of the strahlerOrder step.
      width: zoomInterp([3, 0.25 * NAMED_WIDTH, 7, 0.5 * NAMED_WIDTH, 12, NAMED_WIDTH, 16, 2.2 * NAMED_WIDTH]),
      opacity: 0.9,
      filter: spanFilter("riverIndex", null)
    }), "streams");
    this.setNamedRiver(this.namedSpan);
  }

  /** The riverIndex range to outline as a named river, `{lo, hi}`. Pass null to clear. */
  setNamedRiver(span) {
    this.namedSpan = span ?? null;
    if (!this.map.getLayer("named-highlight")) return;
    whenStyleReady(this.map, () =>
      this.map.setFilter("named-highlight", spanFilter("riverIndex", this.namedSpan)));
  }

  /**
   * The single-reach highlight used when inspecting a river (clicking one outside flood mode).
   * Distinct from the flood selection highlights in flood/selection.js, which can hold many
   * reaches — this one tracks whatever the charts dock is currently showing.
   */
  addInspectHighlightLayer() {
    if (this.map.getLayer("inspect-highlight")) return;
    this.map.addLayer(streamLine({
      id: "inspect-highlight",
      color: "#33FF57",
      width: zoomInterp([3, 3, 8, 5, 13, 9, 16, 14]),
      opacity: 0.95,
      filter: noMatch("riverId")
    }));
  }

  /** Pass null to clear the highlight. */
  setInspectHighlight(riverId) {
    if (!this.map.getLayer("inspect-highlight")) return;
    this.map.setFilter("inspect-highlight", inFilter("riverId", riverId == null ? [] : [riverId]));
  }

  /** Return-period line-color expression driven by each reach's `ret` feature-state. */
  streamColorExpr() {
    const colorMatch = ["match", ["coalesce", ["feature-state", "ret"], 0]];
    for (let i = 0; i < RET_COLORS.length; i++) colorMatch.push(i, RET_COLORS[i]);
    colorMatch.push(RET_COLORS[0]);
    return colorMatch;
  }

  /** Zoom-scaled line-width expression. When `animated`, thickness comes from the per-reach `thk`
   * feature-state, on its own 1–6 scale; otherwise — and for any reach the animation has no state
   * for yet — it comes from strahlerOrder on the 2–10 scale the tiles actually carry, so a
   * non-animated styleset ignores any stale animation state. Per-zoom scale runs z3 global,
   * z7 regional, z12 local, and keeps growing past z12 for an easy-to-click hit box.
   *
   * `pad` widens every stop by a constant — for the saved-river casing, which has to track this
   * width exactly. It is folded into the stops rather than added around the whole expression
   * because MapLibre only accepts ["zoom"] as the input to a top-level step/interpolate: wrapping
   * this in ["+", …, pad] is a style error, not a wider line. */
  streamWidthExpr(animated, pad = 0) {
    // In flood mode every reach is the same thickness: the selection highlights are the signal
    // there, and a network varying in width underneath them only competes.
    const RAMP = this.uniformWidth ? WIDTH_UNIFORM : this.thicknessRamp(animated);
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

  /** WIDTH_BASE → WIDTH_MAX across whichever thickness scale the active styleset reads. The two
   * scales cannot share one ramp — see THK_DOMAIN / ORDER_DOMAIN. A reach the animation has not
   * reached yet reads 0 from the coalesce, which is outside the packed 1–6 range, and falls back
   * to its Strahler order rather than to the bottom of the thickness ramp. */
  thicknessRamp(animated) {
    const byOrder = widthRamp(["get", "strahlerOrder"], ORDER_DOMAIN);
    if (!animated) return byOrder;
    const thk = ["to-number", ["coalesce", ["feature-state", "thk"], 0]];
    return ["case", [">", thk, 0], widthRamp(thk, THK_DOMAIN), byOrder];
  }

  /** Line-color for the time-to-peak styleset: warm (imminent) → cool (late), gray for no data. */
  ttpColorExpr() {
    return [
      "case",
      ["==", ["coalesce", ["feature-state", "ttp"], 255], 255], "#334155",
      ["interpolate", ["linear"], ["feature-state", "ttp"],
        0, "#d73027", 12, "#fdae61", 28, "#fee08b", 52, "#74add1", 80, "#4575b4"]
    ];
  }

  /** Line-color for the below-q95 styleset: below Q95 → red, at/above → blue, no data → gray. */
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

  /** Flatten (or restore) the per-reach thickness ramp — see streamWidthExpr(). */
  setUniformWidth(on) {
    this.uniformWidth = on;
    this.applyPaint();
  }

  /**
   * Set the streams line paint for the active styleset.
   *
   * All three properties, every time, because this is also how the layer is taken *back* from the
   * styling section: under the Standard styleset the network is drawn by the style spec, and
   * switching to a forecast styleset hands the base layer here with whatever color, width and
   * opacity that spec left on it.
   */
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
    this.map.setPaintProperty("streams", "line-opacity", BASE_OPACITY);
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
      // Nothing to load, so nothing would otherwise repaint the legend and the forecast scale the
      // last styleset left up would stand over a network that is no longer reporting one.
      this.buildLegend();
      return;
    }
    void this.loadData();
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
        {source: "streams", sourceLayer: "streams", id: rid},
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
      feats = this.map.querySourceFeatures("streams", {sourceLayer: "streams"});
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
        {source: "streams", sourceLayer: "streams", id: rid},
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
        {source: "streams", sourceLayer: "streams", id: rid},
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
    // `thickness` draws the swatch at the weight the map draws that reach at. Every forecast
    // styleset leaves it at the stylesheet's own 3px — there the color is the reading and a swatch
    // varying in weight would imply a second one. Standard is the styleset where weight *is* the
    // reading, so its swatches are the ramp.
    const add = (color, label, thickness = 0) => {
      const row = document.createElement("div");
      row.className = "legend-item";
      const style = `background:${color}` + (thickness ? `;height:${thickness}px` : "");
      row.innerHTML = `<span class="swatch" style="${style}"></span>${label}`;
      box.appendChild(row);
    };
    if (s === "standard") {
      // No forecast is being read here, so the network is one blue and the only thing the map is
      // saying is how big each river is. The three swatches are the ends of the width ramp and its
      // middle — see streamWidthExpr(). Order 2 is the smallest the tiles carry, 10 the largest.
      if (titleEl) titleEl.textContent = "Stream order";
      add(STANDARD_COLOR, "Order 2 (headwaters)", WIDTH_BASE);
      add(STANDARD_COLOR, "Order 6", (WIDTH_BASE + WIDTH_MAX) / 2);
      add(STANDARD_COLOR, "Order 10 (main stems)", WIDTH_MAX);
    } else if (s === "below-q95") {
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

const STREAMS_PMTILES = import.meta.env.VITE_STREAMS_PMTILES ?? `${location.origin}/data/streams.pmtiles`;
const FORECAST15_BASE = (import.meta.env.VITE_FORECAST15_BASE ?? `${location.origin}/data/forecast15`).replace(/\/+$/, "");
const STYLES_JSON = import.meta.env.VITE_FORECAST_STYLES_JSON ?? "styles.json";
const STYLES_BIN = import.meta.env.VITE_FORECAST_STYLES_BIN ?? "styles.bin";
function summaryBase(date, sub) {
  const [y, m, d] = date.split("-");
  return `${FORECAST15_BASE}/year=${y}/month=${m}/day=${d}/summaries/${sub}`;
}
// Which summaries/<sub> folder each styleset loads its styles.{json,bin} from.
const STYLESET_SUB = { forecast15: "app-styles", maxflow: "max-flow", timetopeak: "time-to-peak", q95: "q95" };
const RET_COLORS = ["#3182bd", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026", "#7a0177"];
// Uniform stream color for the "Standard" styleset (matches the normal-flow return-period blue).
const STANDARD_COLOR = "#3182bd";
// Width of the smallest reaches, and the single width every reach takes in flood mapping mode.
const WIDTH_BASE = 4;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
class StreamAnimation {
  map;
  log;
  meta = null;
  cube = null;
  // [N*T], row-major, delta undone
  N = 0;
  T = 0;
  step = 0;
  playing = false;
  timer = null;
  fps = 4;
  // which styleset drives the streams: "forecast15" (animated timeseries) is the only one that
  // colors by return period and uses the player; the others show a uniform blue network.
  styleset = "forecast15";
  // Flood mapping mode flattens the network to one uniform width (see streamWidthExpr).
  floodMode = false;
  currentDate = null;
  idFi = /* @__PURE__ */ new Map();
  // riverId -> riverIndex (cube row; -1 = no forecast)
  appliedStep = -1;
  applyScheduled = false;
  // player DOM
  sliderEl = document.getElementById("slider");
  timeEl = document.getElementById("time-label");
  stepEl = document.getElementById("step-label");
  playBtn = document.getElementById("btn-play");
  progEl = document.getElementById("progress-bar");
  speedEl = document.getElementById("speed");
  constructor(map, log) {
    this.map = map;
    this.log = log;
    this.wirePlayer();
  }
  /** Add the animated global streams source + line layer on top of the loaded basemap. */
  addStreamsLayer() {
    this.map.addSource("geoglows", {
      type: "vector",
      url: `pmtiles://${STREAMS_PMTILES}`,
      promoteId: { streams: "riverId" },
      // riverId -> feature.id, so setFeatureState keys on it
      attribution: "GEOGLOWS / TDX-Hydro"
    });
    const animated = this.styleset === "forecast15";
    this.map.addLayer({
      id: "streams",
      type: "line",
      source: "geoglows",
      "source-layer": "streams",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": animated ? this.streamColorExpr() : STANDARD_COLOR,
        "line-width": this.streamWidthExpr(animated),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.65, 9, 0.95]
      }
    });
    this.map.on("sourcedata", (e) => {
      const ev = e;
      if (this.cube && e.sourceId === "geoglows" && e.isSourceLoaded && ev.tile) this.scheduleApply();
    });
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
   * so a non-animated styleset ignores any stale animation state. In flood mapping mode the
   * per-river tiers are dropped entirely and every reach draws at the base width, so the selection
   * highlights and flood raster read on top of an even network. Per-zoom scale runs z3 global,
   * z7 regional, z12 local, and keeps growing past z12 for an easy-to-click hit box. */
  streamWidthExpr(animated) {
    let RAMP = WIDTH_BASE;
    if (!this.floodMode) {
      const thkSource = animated
        ? ["coalesce", ["feature-state", "thk"], ["get", "strahlerOrder"]]
        : ["get", "strahlerOrder"];
      const THK = ["max", 1, ["min", 6, thkSource]];
      RAMP = ["step", THK, WIDTH_BASE, 3, 9, 5, 10];
    }
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      ["*", 0.25, RAMP],
      7,
      ["*", 0.5, RAMP],
      12,
      ["*", 1, RAMP],
      16,
      ["*", 2.2, RAMP]
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
  /** Line-color for the q95 styleset: below Q95 → red, at/above → blue, no data → grey. */
  q95ColorExpr() {
    return ["match", ["coalesce", ["feature-state", "q95dir"], 255], 1, "#dc2626", 0, "#3182bd", "#334155"];
  }
  /** Per-reach feature-state for a decoded style byte, keyed to the active styleset. */
  featureStateFor(b) {
    if (this.styleset === "timetopeak") return { ttp: b };
    if (this.styleset === "q95") return { q95dir: b };
    return { ret: b >> 3, thk: (b & 7) + 1 };
  }
  /** Set the streams line-color/line-width paint for the active styleset. */
  applyPaint() {
    if (!this.map.getLayer("streams")) return;
    const s = this.styleset;
    let color, retWidth = false;
    if (s === "forecast15" || s === "maxflow") { color = this.streamColorExpr(); retWidth = true; }
    else if (s === "timetopeak") color = this.ttpColorExpr();
    else if (s === "q95") color = this.q95ColorExpr();
    else color = STANDARD_COLOR;
    this.map.setPaintProperty("streams", "line-color", color);
    this.map.setPaintProperty("streams", "line-width", this.streamWidthExpr(retWidth));
  }
  /** Switch styleset: repaint and (re)load its data. `standard` needs no data (uniform blue);
   * `forecast15` is the only animated one. Stale feature-state from other stylesets is harmless —
   * each styleset's paint reads only its own field. */
  setStyleset(styleset) {
    this.styleset = styleset;
    this.pause();
    this.applyPaint();
    if (styleset === "standard") { this.cube = null; return; }
    this.loadData();
  }
  /** Flood mapping mode: flatten the network to one uniform width. Colors are left alone — only
   * the width tiers go away, so the reach highlights stand out against an even network. */
  setFloodMode(on) {
    if (this.floodMode === on) return;
    this.floodMode = on;
    this.applyPaint();
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
        { source: "geoglows", sourceLayer: "streams", id: rid },
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
    const sub = STYLESET_SUB[styleset];
    if (!sub) return;
    const t0 = performance.now();
    this.cube = null;
    this.appliedStep = -1;
    const base = summaryBase(date, sub);
    this.log(`Loading ${styleset} styles for ${date}…`, "info");
    try {
      this.meta = await (await fetch(`${base}/${STYLES_JSON}`)).json();
      this.N = this.meta.n_reaches;
      this.T = this.meta.n_steps ?? 1;
      this.log(`  ${this.N.toLocaleString()} reaches × ${this.T} step(s)`, "success");
      let inflated;
      try {
        const resp = await fetch(`${base}/${STYLES_BIN}`);
        inflated = await new Response(resp.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
      } catch {
        const raw = (await (await fetch(`${base}/${STYLES_BIN}`)).body).pipeThrough(new DecompressionStream("deflate-raw"));
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
      this.log(`  ${styleset} ready (${((performance.now() - t0) / 1e3).toFixed(1)}s)`, "success");
    } catch (e) {
      this.log(`  ${styleset} (${date}): ${e.message}`, "error");
    }
  }
  // color NEWLY-seen reaches to the current step (runs on tile load). The cube row comes
  // straight from the tile's `riverIndex` property — no comid.bin / binary search.
  discoverAndApply() {
    if (!this.cube || !this.map.isStyleLoaded()) return;
    let feats;
    try {
      feats = this.map.querySourceFeatures("geoglows", { sourceLayer: "streams" });
    } catch {
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
        { source: "geoglows", sourceLayer: "streams", id: rid },
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
        { source: "geoglows", sourceLayer: "streams", id: rid },
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
    if (this.playing || !this.cube || this.styleset !== "forecast15") return;
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
      if (this.styleset !== "forecast15") return;
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
    if (s === "q95") {
      if (titleEl) titleEl.textContent = "Q95 low flow";
      add("#dc2626", "Below Q95 (rare low flow)");
      add("#3182bd", "At or above Q95");
      add("#334155", "No data");
    } else if (s === "timetopeak") {
      if (titleEl) titleEl.textContent = "Time to peak";
      const h = this.meta?.step_hours ?? 3;
      add("#d73027", "Now / imminent");
      add("#fee08b", `~${Math.round(28 * h / 24)} days`);
      add("#4575b4", `~${Math.round(80 * h / 24)} days`);
      add("#334155", "No data");
    } else {
      if (titleEl) titleEl.textContent = s === "maxflow" ? "Max forecast return period" : "Forecast return period";
      const vals = this.meta?.ret_per_values ?? [0, 2, 5, 10, 25, 50, 100];
      vals.forEach((v, i) => add(RET_COLORS[i], v === 0 ? "Normal (&lt; 2-yr)" : `${v}-year`));
    }
  }
}
export {
  StreamAnimation
};

/**
 * animation.ts — global GEOGLOWS forecast stream animation.
 *
 * Ported from hydrofabric-subsetter `app/animation.html`: a bit-packed timeseries "cube"
 * (styles.bin = DEFLATE(delta-over-time(uint8[reach][step])), byte = ret<<3 | (thk-1)) is
 * inflated with the native DecompressionStream, un-delta'd in place, and applied to the
 * vector `streams` layer via MapLibre setFeatureState — change-only, so each 3-hourly step
 * touches only the ~0.35% of reaches whose value changed.
 *
 * Asset locations default to the site's own origin under /data (so a self-contained bucket
 * deploy needs no config); dev overrides them to GEOGLOWS CloudFront via .env so
 * you don't need the 2.4 GB pmtiles + cube locally. See README "Deploying".
 *   <base>/data/streams.pmtiles           global stream vector tiles (carry `riverIndex` = cube row)
 *   <forecast15>/year=YYYY/month=MM/day=DD/summaries/app-styles/styles.json   cube metadata
 *   <forecast15>/…/summaries/app-styles/styles.bin                            bit-packed forecast cube
 * The app-styles set is chosen by forecast-initialization date: each forecast day is a
 * Hive-partitioned folder under the forecast15 root. loadCube(date) picks the day.
 * No comid.bin: each tile feature's `riverIndex` property IS its cube row, so there is no
 * client-side riverId->row lookup. The cube (styles.bin) MUST be ordered to match `riverIndex`.
 */
import type { Map as MlMap, MapSourceDataEvent } from 'maplibre-gl'

const STREAMS_PMTILES = (import.meta.env.VITE_STREAMS_PMTILES as string | undefined)
  ?? `${location.origin}/data/streams.pmtiles`
// 15-day forecast root; app-styles for one day hang off a year=/month=/day= partition below it.
const FORECAST15_BASE = ((import.meta.env.VITE_FORECAST15_BASE as string | undefined)
  ?? `${location.origin}/data/forecast15`).replace(/\/+$/, '')
// cube metadata + bit-packed cube file names (env is the source of truth)
const STYLES_JSON = (import.meta.env.VITE_FORECAST_STYLES_JSON as string | undefined) ?? 'styles.json'
const STYLES_BIN = (import.meta.env.VITE_FORECAST_STYLES_BIN as string | undefined) ?? 'styles.bin'

/** URL of the app-styles folder for a forecast-initialization date (`YYYY-MM-DD`). */
function appStylesBase(date: string): string {
  const [y, m, d] = date.split('-')
  return `${FORECAST15_BASE}/year=${y}/month=${m}/day=${d}/summaries/app-styles`
}

// return-period index (0..6) -> line color; index i == styles.json ret_per_values[i].
const RET_COLORS = ['#3182bd', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026', '#7a0177']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface StylesMeta {
  n_reaches: number
  n_steps: number
  timestamps: string[]
  ret_per_values: number[]
  thickness_values: number[]
}

type Log = (msg: string, cls?: string) => void

export class StreamAnimation {
  private map: MlMap
  private log: Log
  private meta: StylesMeta | null = null
  private cube: Uint8Array | null = null // [N*T], row-major, delta undone
  private N = 0
  private T = 0
  private step = 0
  private playing = false
  private timer: ReturnType<typeof setInterval> | null = null
  private fps = 4
  private readonly idFi = new Map<number, number>() // riverId -> riverIndex (cube row; -1 = no forecast)
  private appliedStep = -1
  private applyScheduled = false

  // player DOM
  private sliderEl = document.getElementById('slider') as HTMLInputElement
  private timeEl = document.getElementById('time-label') as HTMLElement
  private stepEl = document.getElementById('step-label') as HTMLElement
  private playBtn = document.getElementById('btn-play') as HTMLButtonElement
  private progEl = document.getElementById('progress-bar') as HTMLElement
  private speedEl = document.getElementById('speed') as HTMLSelectElement

  constructor(map: MlMap, log: Log) {
    this.map = map
    this.log = log
    this.wirePlayer()
  }

  /** Add the animated global streams source + line layer on top of the loaded basemap. */
  addStreamsLayer(): void {
    this.map.addSource('geoglows', {
      type: 'vector',
      url: `pmtiles://${STREAMS_PMTILES}`,
      promoteId: { streams: 'riverId' }, // riverId -> feature.id, so setFeatureState keys on it
      attribution: 'GEOGLOWS / TDX-Hydro',
    })
    // thickness (flow) in 3 categories: thk {1,2}→4, {3,4}→10, {5,6}→12 units; strahlerOrder
    // (clamped to 1..6) is the pre-animation fallback. Matches the v3 animation build.
    const THK: unknown = ['max', 1, ['min', 6, ['coalesce', ['feature-state', 'thk'], ['get', 'strahlerOrder']]]]
    const RAMP: unknown = ['step', THK, 4, 3, 10, 5, 12]
    const colorMatch: unknown[] = ['match', ['coalesce', ['feature-state', 'ret'], 0]]
    for (let i = 0; i < RET_COLORS.length; i++) colorMatch.push(i, RET_COLORS[i])
    colorMatch.push(RET_COLORS[0])
    this.map.addLayer({
      id: 'streams',
      type: 'line',
      source: 'geoglows',
      'source-layer': 'streams',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colorMatch as never,
        // per-zoom scale of the thickness ramp (z3 global, z7 regional, z12 local). Lines keep
        // growing past z12 so reaches present a wide, easy-to-click hit box when zoomed in.
        'line-width': ['interpolate', ['linear'], ['zoom'],
          3, ['*', 0.25, RAMP], 7, ['*', 0.5, RAMP], 12, ['*', 1.0, RAMP], 16, ['*', 2.2, RAMP]] as never,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.65, 9, 0.95] as never,
      },
    })
    // Recolor freshly-loaded tiles to the current step. Gate on `e.tile` so this fires only on
    // real tile loads, NOT on feature-state repaints (which would loop forever and peg the CPU).
    this.map.on('sourcedata', (e: MapSourceDataEvent) => {
      const ev = e as MapSourceDataEvent & { tile?: unknown }
      if (this.cube && e.sourceId === 'geoglows' && e.isSourceLoaded && ev.tile) this.scheduleApply()
    })
  }

  /** Fetch styles.json + styles.bin for a forecast-initialization date (`YYYY-MM-DD`), inflate,
   * undo delta-over-time. Re-callable: switching the date resets the per-reach state cache and
   * re-applies the current step to whatever streams are already on screen. (No comid.bin — the
   * streams tiles carry each reach's cube row as the `riverIndex` feature property.) */
  async loadCube(date: string): Promise<void> {
    const t0 = performance.now()
    // reloading for a new date: drop the old cube + its per-reach state so tiles recolor fresh
    this.cube = null
    this.idFi.clear()
    this.appliedStep = -1
    const base = appStylesBase(date)
    this.log(`Loading forecast timeseries for ${date}…`, 'info')
    this.meta = (await (await fetch(`${base}/${STYLES_JSON}`)).json()) as StylesMeta
    this.N = this.meta.n_reaches
    this.T = this.meta.n_steps
    this.log(`  ${this.N.toLocaleString()} reaches × ${this.T} steps`, 'success')

    const resp = await fetch(`${base}/${STYLES_BIN}`)
    let inflated: ArrayBuffer
    try {
      inflated = await new Response(
        (resp.body as ReadableStream).pipeThrough(new DecompressionStream('deflate')),
      ).arrayBuffer()
    } catch {
      const raw = (await (await fetch(`${base}/${STYLES_BIN}`)).body as ReadableStream)
        .pipeThrough(new DecompressionStream('deflate-raw'))
      inflated = await new Response(raw).arrayBuffer()
    }
    const cube = new Uint8Array(inflated)
    if (cube.length !== this.N * this.T) {
      throw new Error(`styles.bin decoded to ${cube.length} bytes, expected ${this.N * this.T}`)
    }
    // undo delta-over-time in place: value[t] = value[t-1] + delta[t] (uint8 wrap)
    for (let i = 0, base = 0; i < this.N; i++, base += this.T) {
      let acc = cube[base]
      for (let t = 1; t < this.T; t++) { acc = (acc + cube[base + t]) & 0xff; cube[base + t] = acc }
    }
    this.cube = cube
    this.buildLegend()
    this.sliderEl.max = String(this.T - 1)
    this.sliderEl.disabled = false
    document.getElementById('player')?.classList.add('ready')
    this.setStep(0, false)
    this.scheduleApply()
    this.log(`  animation ready (${((performance.now() - t0) / 1000).toFixed(1)}s)`, 'success')
  }

  // color NEWLY-seen reaches to the current step (runs on tile load). The cube row comes
  // straight from the tile's `riverIndex` property — no comid.bin / binary search.
  private discoverAndApply(): void {
    if (!this.cube || !this.map.isStyleLoaded()) return
    let feats
    try { feats = this.map.querySourceFeatures('geoglows', { sourceLayer: 'streams' }) } catch { return }
    const t = this.step
    for (const f of feats) {
      const rid = f.id != null ? Number(f.id) : (f.properties && Number(f.properties.riverId))
      if (rid == null || Number.isNaN(rid) || this.idFi.has(rid)) continue
      const raw = f.properties?.riverIndex
      const fi = raw == null ? -1 : Number(raw)
      const valid = fi >= 0 && fi < this.N
      this.idFi.set(rid, valid ? fi : -1) // cache (incl. misses) so we never re-look-up
      if (!valid) continue
      const b = this.cube[fi * this.T + t]
      this.map.setFeatureState(
        { source: 'geoglows', sourceLayer: 'streams', id: rid },
        { ret: b >> 3, thk: (b & 7) + 1 },
      )
    }
    if (this.appliedStep < 0) this.appliedStep = t
  }

  // update ONLY reaches whose value differs from the previously-applied step
  private applyStepChange(): void {
    if (!this.cube) return
    const t = this.step
    const p = this.appliedStep
    if (p === t) return
    if (p < 0) { this.scheduleApply(); return }
    for (const [rid, fi] of this.idFi) {
      if (fi < 0) continue
      const b = this.cube[fi * this.T + t]
      if (b === this.cube[fi * this.T + p]) continue
      this.map.setFeatureState(
        { source: 'geoglows', sourceLayer: 'streams', id: rid },
        { ret: b >> 3, thk: (b & 7) + 1 },
      )
    }
    this.appliedStep = t
  }

  private scheduleApply(): void {
    if (this.applyScheduled) return
    this.applyScheduled = true
    requestAnimationFrame(() => { this.applyScheduled = false; this.discoverAndApply() })
  }

  // ---- player ----
  private fmtStamp(s: string): string {
    const p = s.split('-')
    if (p.length < 4) return s
    return `${MONTHS[+p[1] - 1] || p[1]} ${+p[2]}, ${p[0]} · ${p[3]}:00 UTC`
  }

  private renderLabels(): void {
    this.timeEl.textContent = this.meta ? this.fmtStamp(this.meta.timestamps[this.step]) : '—'
    this.stepEl.textContent = `${this.step + 1}/${this.T}`
    this.sliderEl.value = String(this.step)
    this.progEl.style.width = (this.T > 1 ? (this.step / (this.T - 1)) * 100 : 0) + '%'
  }

  setStep(t: number, apply = true): void {
    this.step = ((t % this.T) + this.T) % this.T
    this.renderLabels()
    if (apply) this.applyStepChange()
  }

  play(): void {
    if (this.playing || !this.cube) return
    this.playing = true
    this.playBtn.textContent = '❚❚'
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => this.setStep(this.step + 1), 1000 / this.fps)
  }

  pause(): void {
    this.playing = false
    this.playBtn.textContent = '▶'
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private togglePlay(): void { this.playing ? this.pause() : this.play() }

  private wirePlayer(): void {
    this.playBtn.addEventListener('click', () => this.togglePlay())
    this.sliderEl.addEventListener('input', () => { this.pause(); this.setStep(+this.sliderEl.value) })
    this.speedEl.addEventListener('change', () => {
      this.fps = +this.speedEl.value
      if (this.playing) { this.pause(); this.play() }
    })
    document.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT') return
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay() }
      else if (e.code === 'ArrowRight') { this.pause(); this.setStep(this.step + 1) }
      else if (e.code === 'ArrowLeft') { this.pause(); this.setStep(this.step - 1) }
    })
  }

  private buildLegend(): void {
    const box = document.getElementById('legend-items')
    if (!box) return
    const vals = this.meta?.ret_per_values ?? [0, 2, 5, 10, 25, 50, 100]
    box.innerHTML = ''
    vals.forEach((v, i) => {
      const row = document.createElement('div')
      row.className = 'legend-item'
      row.innerHTML = `<span class="swatch" style="background:${RET_COLORS[i]}"></span>` +
        (v === 0 ? 'Normal (&lt; 2-yr)' : `${v}-year`)
      box.appendChild(row)
    })
  }
}

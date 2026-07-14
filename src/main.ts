import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {Protocol} from 'pmtiles'
import {StreamAnimation} from './map/streams/animation'
import {loadNetwork} from './map/fim/topology'
import {Selection, type SelectionState} from './map/fim/selection'
import {flowsAtLadderPosition, uniformFlows} from './map/fim/hydro'
import {legendGradient} from './map/fim/colormap'
import {encodeExtentGeoTiff} from './map/fim/geotiff'
import {calciteIcon} from './icons/icons'
import {heroIcon} from './icons/heroicons'
import {setLanguage, t} from './i18n/i18n'
// timeseries fetch (zarrita) and the plot suite (Chart.js) load lazily on first river click —
// see loadRiverTimeseries — so they stay out of the initial bundle.
import type {FlowsSpec, TileMeta} from './map/fim/tileData'

// Where the flood tile (data/v1/…) is hosted. Defaults to the site's own origin under /data,
// so a co-located static deploy (dist/ + data/ in one bucket) needs no config. Dev overrides
// this to the range-capable http-server via .env (VITE_DATA_URL=http://localhost:8090).
const DATA_BASE = (import.meta.env.VITE_DATA_URL as string | undefined) ?? `${location.origin}/data`
const NETWORK_GRAPH_URL = (import.meta.env.VITE_NETWORK_GRAPH_URL as string | undefined)
    ?? `${DATA_BASE}/network_graph.json`

// Flood-library tile: the env file is the source of truth. The tile directory URL and the four
// asset file names each come from env (with derived fallbacks so a bare VITE_DATA_URL still
// works), and are handed to the worker, which fetches them directly.
const TILE_NAME = (import.meta.env.VITE_FLOOD_TILE_NAME as string | undefined) ?? 'N40W104_demo'
const FLOOD_TILE_URL = (import.meta.env.VITE_FLOOD_TILE_URL as string | undefined) ?? `${DATA_BASE}/v1/tiles/${TILE_NAME}`
const FLOOD_TILE_FILES = {
    meta: (import.meta.env.VITE_FLOOD_TILE_META as string | undefined) ?? 'meta.json',
    flows: (import.meta.env.VITE_FLOOD_TILE_FLOWS as string | undefined) ?? 'flows.json',
    library: (import.meta.env.VITE_FLOOD_TILE_LIBRARY as string | undefined) ?? 'library.parquet',
    streams: (import.meta.env.VITE_FLOOD_TILE_STREAMS as string | undefined) ?? 'streams.parquet',
}

// The forecast animation styles are chosen by forecast-initialization date. In production the
// app assumes the current UTC day; for this demo VITE_FORECAST_DEFAULT_DATE pins the one day
// styles were produced for (July 10, 2026), since they aren't generated continuously.
function todayUtc(): string {
    const d = new Date()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    return `${d.getUTCFullYear()}-${mm}-${dd}`
}

const DEFAULT_FORECAST_DATE = (import.meta.env.VITE_FORECAST_DEFAULT_DATE as string | undefined) ?? todayUtc()
// The forecast-init date currently selected in the picker; the charts modal's Forecast tab reads
// the ensemble store for this date (kept in sync by initForecastDatePicker).
let currentForecastDate = DEFAULT_FORECAST_DATE

// Token-free raster basemaps. Raster avoids the glyph/sprite/relative-URL pitfalls of vector
// styles (the old Esri vector style declared tiles as the unresolvable relative path
// `tile/{z}/{x}/{y}.pbf`). Switching swaps only this bottom layer; overlays stay intact.
interface Basemap {
    id: string;
    label: string;
    tiles: string[];
    attribution: string;
    maxzoom?: number
}

const BASEMAPS: Basemap[] = [
    {
        id: 'light', label: 'Light grey (Carto)', maxzoom: 20,
        tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`),
        attribution: '© OpenStreetMap contributors © CARTO'
    },
    {
        id: 'dark', label: 'Dark (Carto)', maxzoom: 20,
        tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
        attribution: '© OpenStreetMap contributors © CARTO'
    },
    {
        id: 'streets', label: 'Streets (OSM)', maxzoom: 19,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        attribution: '© OpenStreetMap contributors'
    },
    {
        id: 'satellite', label: 'Satellite (Esri)', maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
    },
]
const basemapStyle = (bm: Basemap): maplibregl.StyleSpecification => ({
    version: 8,
    sources: {basemap: {type: 'raster', tiles: bm.tiles, tileSize: 256, attribution: bm.attribution, maxzoom: bm.maxzoom ?? 19}},
    layers: [{id: 'basemap', type: 'raster', source: 'basemap'}],
})

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const logEl = $('log')

function log(msg: string, cls = ''): void {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = msg + '\n'
    logEl.appendChild(s)
    logEl.parentElement!.scrollTop = logEl.parentElement!.scrollHeight
}

// ---------- flood worker ----------
const worker = new Worker(new URL('./map/fim/worker.ts', import.meta.url), {type: 'module'})
let floodMeta: TileMeta | null = null
let flowsSpec: FlowsSpec | null = null
let workerReady = false
let floodCanvas: HTMLCanvasElement | null = null
let floodCtx: CanvasRenderingContext2D | null = null
let frameInFlight = false
let pendingFlood = false // a recompute was requested while a frame was in flight (latest wins)
let floodEnabled = false // no flood map is drawn until the user presses "Create flood map"
let lastFloodedCells = 0 // flooded-cell count of the flood map currently on screen (gates GeoTIFF export)
let floodMappingMode = false // off by default: river clicks open an attribute modal, not select
let selectedRiverId: number | null = null // last river inspected via click; gates the charts modal
let selectedRiverProps: Record<string, unknown> | null = null // its pmtiles attributes (Details tab)

// ---------- selection state ----------
let selection: Selection | null = null
let current: SelectionState = {inlets: [], outlets: [], corridor: [], floodable: []}

// ---------- Q control ----------
type QMode = 'ladder' | 'uniform'
let qmode: QMode = 'ladder'

// ============================================================
// MAP
// ============================================================
const protocol = new Protocol({metadata: true})
maplibregl.addProtocol('pmtiles', protocol.tile)

const map = new maplibregl.Map({
    container: 'map',
    style: basemapStyle(BASEMAPS[0]),
    center: [-103.8, 40.27], // over the demo tile, so flood coverage is discoverable on load
    zoom: 4,
    hash: 'map',
    maxZoom: 13,
})
map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-left')

// Swap the basemap raster layer beneath all overlays (streams/flood/highlights), so switching
// never disturbs them or the animation feature-state. beforeId = the lowest non-basemap layer.
function setBasemap(id: string): void {
    const bm = BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0]
    if (map.getLayer('basemap')) map.removeLayer('basemap')
    if (map.getSource('basemap')) map.removeSource('basemap')
    map.addSource('basemap', {type: 'raster', tiles: bm.tiles, tileSize: 256, attribution: bm.attribution, maxzoom: bm.maxzoom ?? 19})
    const beforeId = (map.getStyle().layers ?? []).find((l) => l.id !== 'basemap')?.id
    map.addLayer({id: 'basemap', type: 'raster', source: 'basemap'}, beforeId)
}

// Basemap picker as a floating "Layers" popover over the top-right of the map.
function initBasemapPicker(): void {
    const btn = document.getElementById('layer-btn') as HTMLButtonElement | null
    const menu = document.getElementById('layer-menu')
    if (!btn || !menu) return
    btn.replaceChildren(calciteIcon('layers')) // Calcite "layers" icon, imported in icons.ts
    menu.innerHTML = ''
    for (const bm of BASEMAPS) {
        const opt = document.createElement('button')
        opt.className = 'layer-opt'
        opt.setAttribute('role', 'menuitemradio')
        opt.textContent = bm.label
        opt.classList.toggle('active', bm.id === BASEMAPS[0].id)
        opt.addEventListener('click', () => {
            setBasemap(bm.id)
            menu.querySelectorAll('.layer-opt').forEach((o) => o.classList.remove('active'))
            opt.classList.add('active')
            closeMenu()
        })
        menu.appendChild(opt)
    }
    const closeMenu = (): void => {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false')
    }
    btn.addEventListener('click', () => {
        const open = menu.classList.toggle('hidden')
        btn.setAttribute('aria-expanded', String(!open))
    })
    // dismiss the popover on an outside click
    document.addEventListener('click', (e) => {
        const t = e.target as Node
        if (!menu.contains(t) && !btn.contains(t)) closeMenu()
    })
}

initBasemapPicker()

const anim = new StreamAnimation(map, log)
let mapLoaded = false

map.on('load', async () => {
    anim.addStreamsLayer()
    addInspectHighlightLayer() // dark-blue trace of the reach whose charts are open
    log('Basemap + streams loaded.', 'success')
    mapLoaded = true
    maybeInitFloodOverlay() // if the worker was already ready, add the overlay now

    // reach selection: query a small box around the click so thin lines are easy to hit
    map.on('click', (e) => {
        const pad = 10
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [
            [e.point.x - pad, e.point.y - pad],
            [e.point.x + pad, e.point.y + pad],
        ]
        const feats = map.queryRenderedFeatures(box, {layers: ['streams']})
        const hit = feats.find((f) => f.properties?.riverId != null)
        if (hit) {
            // flood mapping mode gates whether a river click marks inlets/outlets or just inspects it
            if (floodMappingMode) selection?.select(Number(hit.properties!.riverId))
            else openChartsModal(hit.properties!)
            return
        }
        if (floodMappingMode) queryFloodDepth(e.lngLat)
    })
    map.on('mouseenter', 'streams', () => {
        map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'streams', () => {
        map.getCanvas().style.cursor = ''
    })

    // topology graph -> selection
    try {
        const net = await loadNetwork(NETWORK_GRAPH_URL)
        log(`Network: ${net.meta.total_streams.toLocaleString()} reaches, VPU ${net.meta.vpu}.`, 'success')
        selection = new Selection(map, net, onSelectionChange)
        selection.addHighlightLayers()
    } catch (err) {
        log(`network graph: ${(err as Error).message}`, 'error')
    }

    // forecast animation cube (large; runs after the rest is interactive). Date-driven: the
    // picker chooses which forecast-initialization day's app-styles to load.
    initForecastDatePicker()
    anim.loadCube(DEFAULT_FORECAST_DATE).catch((err) => log(`animation: ${(err as Error).message}`, 'error'))
})
map.on('error', (e) => {
    if (e?.error) log(`map: ${e.error.message}`, 'error')
})

// ============================================================
// FLOOD WORKER
// ============================================================
worker.postMessage({type: 'init', tileUrl: FLOOD_TILE_URL, files: FLOOD_TILE_FILES})
worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data
    if (msg.type === 'ready') {
        floodMeta = msg.meta as TileMeta
        flowsSpec = msg.flows as FlowsSpec
        workerReady = true
        maybeInitFloodOverlay() // guarded: needs the map style + `streams` layer to exist first
        log(`Flood tile ${TILE_NAME}: ${msg.stats.libraryRows.toLocaleString()} library rows.`, 'success')
        refreshControls()
    } else if (msg.type === 'frame') {
        frameInFlight = false
        if (floodCtx && floodMeta) {
            const img = new ImageData(new Uint8ClampedArray(msg.rgba), msg.width, msg.height)
            floodCtx.putImageData(img, 0, 0)
            refreshFloodCanvas()
            lastFloodedCells = msg.floodedCells as number
            updateSaveButton()
            $('flood-status').textContent =
                `${(msg.floodedCells as number).toLocaleString()} flooded cells · ${(msg.computeMs as number).toFixed(1)} ms`
        }
        if (pendingFlood) {
            pendingFlood = false;
            computeFlood()
        } // apply the latest slider value
    } else if (msg.type === 'export') {
        saveFloodGeoTiff(msg)
    } else if (msg.type === 'query') {
        $('readout').textContent = msg.depth == null
            ? 'no flooding at that pixel'
            : `depth ≈ ${(msg.depth as number).toFixed(2)} m`
    } else if (msg.type === 'error') {
        log(`flood worker: ${msg.message}`, 'error')
    }
}

// The flood raster overlay needs both the map style loaded (so addSource/addLayer are legal)
// and the `streams` layer present (it is the beforeId). The worker `ready` message and the map
// `load` event race, so add the overlay only once both have happened.
let floodOverlayAdded = false

function maybeInitFloodOverlay(): void {
    if (floodOverlayAdded || !mapLoaded || !workerReady || !floodMeta) return
    floodOverlayAdded = true
    initFloodOverlay()
}

function initFloodOverlay(): void {
    if (!floodMeta) return
    const b = floodMeta.bounds
    floodCanvas = document.createElement('canvas')
    floodCanvas.width = floodMeta.ncols
    floodCanvas.height = floodMeta.nrows
    floodCtx = floodCanvas.getContext('2d')
    map.addSource('flood', {
        type: 'canvas',
        canvas: floodCanvas,
        animate: false,
        coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]],
    })
    // flood raster under the animated stream lines + highlights
    map.addLayer({
        id: 'flood', type: 'raster', source: 'flood',
        paint: {'raster-fade-duration': 0, 'raster-resampling': 'nearest'},
    }, 'streams')
    $('legend-depth').style.background = `linear-gradient(to right, ${legendGradient()})`
}

function refreshFloodCanvas(): void {
    const src = map.getSource('flood') as maplibregl.CanvasSource | undefined
    if (!src) return
    src.play()
    requestAnimationFrame(() => src.pause())
}

function queryFloodDepth(lngLat: maplibregl.LngLat): void {
    if (!floodMeta) return
    const b = floodMeta.bounds
    const {lng, lat} = lngLat
    if (lng < b.west || lng > b.east || lat < b.south || lat > b.north) return
    const col = Math.floor(((lng - b.west) / (b.east - b.west)) * floodMeta.ncols)
    const row = Math.floor(((b.north - lat) / (b.north - b.south)) * floodMeta.nrows)
    worker.postMessage({type: 'query', fpp: row * floodMeta.ncols + col})
}

// ============================================================
// SELECTION -> FLOOD
// ============================================================
function onSelectionChange(s: SelectionState): void {
    current = s
    refreshControls()
    // once flood mapping is enabled, keep the overlay in sync with the corridor
    if (floodEnabled && workerReady && current.floodable.length > 0) computeFlood()
    else clearFloodOverlay()
}

function clearFloodOverlay(): void {
    lastFloodedCells = 0 // nothing on screen -> disable GeoTIFF export
    updateSaveButton()
    if (!floodCtx || !floodCanvas) return
    floodCtx.clearRect(0, 0, floodCanvas.width, floodCanvas.height)
    refreshFloodCanvas()
}

/** Enable/label the "Create flood map" button and set the status line to match state. */
function refreshControls(): void {
    const btn = $('btn-create-flood') as HTMLButtonElement
    const hasFloodable = workerReady && current.floodable.length > 0
    btn.disabled = !hasFloodable
    btn.textContent = floodEnabled ? 'Flood mapping on — live' : 'Create flood map'
    if (!workerReady) $('flood-status').textContent = 'Loading flood tile…'
    else if (current.floodable.length === 0) {
        $('flood-status').textContent = current.corridor.length
            ? 'Corridor has no flood-library coverage (select the highlighted demo reaches).'
            : 'Select an inlet and an outlet on the map.'
    } else if (!floodEnabled) {
        $('flood-status').textContent = `${current.floodable.length} reach(es) ready — press “Create flood map”.`
    } else {
        $('flood-status').textContent = `${current.floodable.length} reach(es) flooding live — move the slider.`
    }
}

function computeFlood(): void {
    if (!floodEnabled || !flowsSpec || !workerReady || current.floodable.length === 0) return
    if (frameInFlight) {
        pendingFlood = true;
        return
    } // coalesce: recompute after the in-flight frame
    const full = qmode === 'ladder'
        ? flowsAtLadderPosition(flowsSpec, Number(($('ladder') as HTMLInputElement).value))
        : uniformFlows(flowsSpec, Number(($('uniform') as HTMLInputElement).value))
    // scope the flood to the corridor: only floodable COMIDs carry a discharge
    const flows: Array<[number, number]> = []
    for (const comid of current.floodable) if (full.has(comid)) flows.push([comid, full.get(comid)!])
    if (flows.length === 0) return
    frameInFlight = true
    $('flood-status').textContent = 'Computing…'
    worker.postMessage({type: 'frame', id: Date.now(), flows})
}

// ============================================================
// UI WIRING
// ============================================================
const ladderLabels = ['q3', 'q8', 'q12', 'q15', 'q18', 'q22', 'q25', 'q28', 'q30']

function syncLadderLabel(): void {
    const t = Number(($('ladder') as HTMLInputElement).value)
    const i = Math.min(Math.round(t), ladderLabels.length - 1)
    $('ladder-val').textContent = flowsSpec?.ladderLabels?.[i] ?? ladderLabels[i]
}

function setQMode(m: QMode): void {
    qmode = m
    $('qmode-ladder').classList.toggle('active', m === 'ladder')
    $('qmode-uniform').classList.toggle('active', m === 'uniform')
    $('qctl-ladder').classList.toggle('hidden', m !== 'ladder')
    $('qctl-uniform').classList.toggle('hidden', m !== 'uniform')
    computeFlood()
}

// ---------- flood mapping mode toggle ----------
// Off (default): clicking a river opens the attribute modal. On: clicking marks inlets/outlets
// and clicking away queries flood depth. Gating lives in the map `click` handler above.
function setFloodMappingMode(on: boolean): void {
    floodMappingMode = on
    if (on) setInspectHighlight(null) // drop the inspect trace so it doesn't clash with inlet/outlet colors
    const btn = $('btn-flood-mode') as HTMLButtonElement
    btn.classList.toggle('active', on)
    btn.textContent = t(on ? 'flood.disable' : 'flood.enable')
    $('flood-mode-hint').textContent = t(on ? 'flood.hintOn' : 'flood.hintOff')
    $('flood-controls').classList.toggle('mode-off', !on)
}

$('btn-flood-mode').addEventListener('click', () => setFloodMappingMode(!floodMappingMode))

// ---------- reach inspection helpers (consumed by the consolidated charts modal below) ----------
// A map river-click and the header charts button both open one modal (openChartsModal); these render
// its Details attribute table and Retrospective chart panel.

/** pmtiles feature properties as a table: riverId first, then the rest alphabetically. */
function renderAttrTable(props: Record<string, unknown>): string {
    const keys = Object.keys(props).sort((a, b) =>
        a === 'riverId' ? -1 : b === 'riverId' ? 1 : a.localeCompare(b))
    if (!keys.length) return '<div class="attr-empty">This feature carries no attributes.</div>'
    return `<table class="attr-table">${keys.map((k) =>
        `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(String(props[k]))}</td></tr>`).join('')}</table>`
}

/** Fetch the (dev-fixed) river's retrospective discharge and render the full v2 chart suite.
 * The heavy modules (zarrita fetch + Chart.js plots) are imported lazily here so they stay out
 * of the initial bundle. */
async function loadRiverTimeseries(blockId: string): Promise<void> {
    const block = document.getElementById(blockId)
    if (!block) return
    try {
        const [{fetchRiverTimeseries, DEV_RIVER_ID}, plots] = await Promise.all([
            import('./timeseries'),
            import('./plots/orchestrator'),
        ])
        const ts = await fetchRiverTimeseries() // clicked id ignored during dev; uses DEV_RIVER_ID
        if (!document.getElementById(blockId)) {
            plots.clearPlots();
            return
        } // modal closed while loading
        block.className = ''
        block.innerHTML =
            `<p class="hint">Dev river ${DEV_RIVER_ID} · ${ts.discharge.length.toLocaleString()} daily steps ` +
            `(clicked reach ignored during model development).</p><div class="ts-charts"></div>`
        plots.plotAllRetro(block.querySelector('.ts-charts')!, ts)
    } catch (e) {
        block.className = 'ts-error'
        block.textContent = `Failed to load time series: ${(e as Error).message}`
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!))
}

// ---------- header info / settings / language icons + modals ----------
// heroicons injected here so their provenance lives in code (see heroicons.ts)
$('btn-info').replaceChildren(heroIcon('information-circle'))
$('btn-settings').replaceChildren(heroIcon('cog-6-tooth'))
$('btn-language').replaceChildren(heroIcon('language'))

// ---------- hydrology-prediction action buttons ----------
// Charts opens the discharge-charts modal (wired below); bookmarks & reports are placeholders.
$('btn-search-river').replaceChildren(heroIcon('magnifying-glass-solid'))
$('btn-charts').replaceChildren(heroIcon('chart-bar-solid'))
$('btn-bookmarks').replaceChildren(heroIcon('bookmark-solid'))
$('btn-reports').replaceChildren(heroIcon('clipboard-document-list-solid'))

// ---------- light / dark theme toggle ----------
// Sets `data-theme` on <html>, which flips the CSS custom-property palette (see style.css).
// The button shows the icon of the theme you'd switch TO (sun while dark, moon while light).
type Theme = 'dark' | 'light'

function applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme)
    // sun = "switch to light" (shown in dark), moon = "switch to dark" (shown in light)
    $('btn-theme').replaceChildren(heroIcon(theme === 'dark' ? 'sun' : 'moon'))
}

let currentTheme: Theme = localStorage.getItem('rfs-theme') === 'light' ? 'light' : 'dark'
applyTheme(currentTheme)
$('btn-theme').addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('rfs-theme', currentTheme)
    applyTheme(currentTheme)
})
const openModal = (id: string): void => $(id).classList.remove('hidden')
const closeModal = (id: string): void => $(id).classList.add('hidden')
$('btn-info').addEventListener('click', () => openModal('info-modal'))
$('btn-settings').addEventListener('click', () => openModal('settings-modal'))
// [data-close] ✕ buttons and backdrop clicks dismiss their modal
document.querySelectorAll<HTMLElement>('[data-close]').forEach((el) =>
    el.addEventListener('click', () => closeModal(el.dataset.close!)))
for (const id of ['info-modal', 'settings-modal', 'charts-modal']) {
    $(id).addEventListener('click', (e) => {
        if (e.target === $(id)) closeModal(id)
    })
}

// ---------- consolidated charts modal (map river-click OR Hydrology predictions → chart button) ----------
// The single modal for an inspected reach. Three tabs: Forecast (the GEOGLOWS 15-day ensemble
// hydrograph for the current forecast date), Retrospective (the full daily Chart.js suite), and
// Details (the reach's pmtiles attributes). Each panel renders lazily on first activation and is
// rebuilt on every open (retro/details track the selected river; forecast tracks the forecast date).
type ChartsTab = 'forecast' | 'retro' | 'details'
const CHARTS_TABS: ChartsTab[] = ['forecast', 'retro', 'details']
const chartsRendered: Record<ChartsTab, boolean> = { forecast: false, retro: false, details: false }

// Forecast panel: load and plot the ensemble forecast for the fixed dev river (clicked reach
// ignored during model development, exactly like the retrospective panel).
function renderForecastCharts(): void {
    $('charts-panel-forecast').innerHTML =
        `<div id="charts-fc-block" class="ts-loading"><span class="spinner"></span>Loading forecast…</div>`
    loadForecastTimeseries('charts-fc-block')
}

/** Fetch the ensemble forecast for the current forecast date and render its hydrograph. Heavy
 * modules (zarrita fetch + Chart.js) are imported lazily so they stay out of the initial bundle. */
async function loadForecastTimeseries(blockId: string): Promise<void> {
    const block = document.getElementById(blockId)
    if (!block) return
    try {
        const [{ fetchForecastTimeseries }, { DEV_RIVER_ID }, plots] = await Promise.all([
            import('./forecastTimeseries'),
            import('./timeseries'),
            import('./plots/orchestrator'),
        ])
        const fc = await fetchForecastTimeseries(currentForecastDate) // clicked reach ignored during dev
        if (!document.getElementById(blockId)) { plots.clearPlots(); return } // modal closed while loading
        block.className = ''
        block.innerHTML =
            `<p class="hint">Dev river ${DEV_RIVER_ID} · forecast initialized ` +
            `${fc.initDate.toISOString().slice(0, 10)} · ${fc.ensembleIds.length} members · ` +
            `${fc.datetime.length} steps (clicked reach ignored during model development).</p>` +
            `<div class="ts-charts"></div>`
        plots.plotAllForecast(block.querySelector('.ts-charts')!, fc)
    } catch (e) {
        block.className = 'ts-error'
        block.textContent = `Failed to load forecast: ${(e as Error).message}`
    }
}

// Retrospective panel: prompt to pick a river, or load the full v2 chart suite for the selected one.
function renderRetroCharts(): void {
    if (selectedRiverId == null) {
        // No river inspected yet: prompt the user instead of loading plots for an arbitrary reach.
        $('charts-panel-retro').innerHTML =
            `<div class="charts-empty">` +
            `<p>${t('charts.empty.title')}</p>` +
            `<p class="hint">${t('charts.empty.hint')}</p></div>`
    } else {
        $('charts-panel-retro').innerHTML =
            `<div id="charts-ts-block" class="ts-loading"><span class="spinner"></span>Loading time series…</div>`
        loadRiverTimeseries('charts-ts-block')
    }
}

// Details panel: the clicked reach's pmtiles attributes, or a prompt when nothing's been inspected.
function renderChartsDetails(): void {
    $('charts-panel-details').innerHTML = selectedRiverProps
        ? renderAttrTable(selectedRiverProps)
        : `<div class="charts-empty">` +
          `<p>${t('charts.empty.title')}</p>` +
          `<p class="hint">${t('charts.empty.hint')}</p></div>`
}

function activateChartsTab(tab: ChartsTab): void {
    for (const name of CHARTS_TABS) {
        const on = name === tab
        $(`charts-tab-${name}`).classList.toggle('active', on)
        $(`charts-tab-${name}`).setAttribute('aria-selected', String(on))
        $(`charts-panel-${name}`).hidden = !on
    }
    if (!chartsRendered[tab]) {
        if (tab === 'forecast') renderForecastCharts()
        else if (tab === 'retro') renderRetroCharts()
        else renderChartsDetails()
        chartsRendered[tab] = true
    }
}
for (const name of CHARTS_TABS) $(`charts-tab-${name}`).addEventListener('click', () => activateChartsTab(name))

// ---------- inspected-reach highlight ----------
// A dark-blue trace of the reach whose charts are open, drawn on top of the animated `streams`
// layer (added once the `geoglows` source exists). Its filter is swapped to the clicked riverId
// when the charts modal opens and cleared when it closes or flood-mapping mode begins.
const INSPECT_NO_MATCH = ['in', ['get', 'riverId'], ['literal', []]] as never

function addInspectHighlightLayer(): void {
    if (map.getLayer('inspect-highlight')) return
    map.addLayer({
        id: 'inspect-highlight',
        type: 'line',
        source: 'geoglows',
        'source-layer': 'streams',
        filter: INSPECT_NO_MATCH,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {
            'line-color': '#00d1ff', // dark blue, distinct from the streams' return-period palette
            // widen with zoom so the trace stays clearly on top of the base streams line
            'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 8, 3, 13, 5.5, 16, 9] as never,
            'line-opacity': 0.95,
        },
    })
}

/** Trace the given reach in dark blue on top of `streams`; pass null to clear the trace. */
function setInspectHighlight(riverId: number | null): void {
    if (!map.getLayer('inspect-highlight')) return
    map.setFilter('inspect-highlight', riverId == null
        ? INSPECT_NO_MATCH
        : (['in', ['get', 'riverId'], ['literal', [riverId]]] as never))
}

/** Open the consolidated charts modal. Pass a river feature's `props` (from a map click) to bind the
 * modal to that reach; omit it (header charts button) to reopen for the last-inspected river. */
function openChartsModal(props?: Record<string, unknown>): void {
    if (props) {
        selectedRiverProps = props
        if (props.riverId != null) selectedRiverId = Number(props.riverId)
    }
    setInspectHighlight(selectedRiverId) // trace the reach these charts belong to
    $('charts-modal-title').textContent = selectedRiverId != null
        ? `${t('river.heading')} ${selectedRiverId}`
        : t('charts.heading')
    // rebuild every panel on open (retro/details track the selected river; forecast the current date)
    for (const name of CHARTS_TABS) chartsRendered[name] = false
    activateChartsTab('forecast') // Forecast leads (matches the hydrology-prediction workflow)
    openModal('charts-modal')
}
$('btn-charts').addEventListener('click', () => openChartsModal())
// tearing down the Chart.js instances on close frees the canvases and chart state. The map trace
// is left in place on purpose: the modal covers the map, so the highlight is only visible once
// the modal is closed. It persists until the next river is clicked or flood-mapping mode begins.
$('charts-modal').addEventListener('click', (e) => {
    if (e.target === $('charts-modal')) void import('./plots/orchestrator').then((m) => m.clearPlots())
})
$('charts-modal').querySelector('[data-close]')!
    .addEventListener('click', () => void import('./plots/orchestrator').then((m) => m.clearPlots()))
// Escape closes whichever modal is open
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.add('hidden'))
})

// settings: toggle the forecast return-period legend overlay
const legendToggle = document.getElementById('set-legend') as HTMLInputElement | null
legendToggle?.addEventListener('change', () =>
    document.getElementById('legend-overlay')?.classList.toggle('hidden', !legendToggle.checked))

// ---------- language picker (header dropdown) ----------
// Selects the UI language: applies the dictionary (see i18n.ts) to every `data-i18n*` element and
// persists the choice. The available languages are the `[data-lang]` option buttons authored in
// index.html — that markup is the source of truth; this just wires whatever options are present.
function initLanguagePicker(): void {
    const btn = $('btn-language') as HTMLButtonElement
    const menu = $('lang-menu')
    const options = [...menu.querySelectorAll<HTMLButtonElement>('.layer-opt[data-lang]')]
    const current = localStorage.getItem('rfs-lang') ?? 'en'
    setLanguage(current) // render the static UI in the saved language on startup
    for (const opt of options) {
        const code = opt.dataset.lang!
        opt.classList.toggle('active', code === current)
        opt.addEventListener('click', () => {
            setLanguage(code)
            localStorage.setItem('rfs-lang', code)
            options.forEach((o) => o.classList.remove('active'))
            opt.classList.add('active')
            closeMenu()
        })
    }
    const closeMenu = (): void => {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false')
    }
    btn.addEventListener('click', () => {
        const open = menu.classList.toggle('hidden')
        btn.setAttribute('aria-expanded', String(!open))
    })
    document.addEventListener('click', (e) => {
        const target = e.target as Node
        if (!menu.contains(target) && !btn.contains(target)) closeMenu()
    })
}

initLanguagePicker()

// ---------- forecast-initialization date picker ----------
// Chooses which day's app-styles the animation loads (and which run the charts modal's Forecast tab
// reads). Defaults to DEFAULT_FORECAST_DATE (the demo's July 10, 2026); changing it reloads the cube
// for that forecast day.
function initForecastDatePicker(): void {
    const input = document.getElementById('forecast-date') as HTMLInputElement | null
    if (!input) return
    input.value = DEFAULT_FORECAST_DATE
    input.addEventListener('change', () => {
        const date = input.value
        if (!date) return
        currentForecastDate = date // the Forecast charts tab reads this on next open
        log(`Switching forecast date to ${date}…`, 'info')
        anim.loadCube(date).catch((err) => log(`animation (${date}): ${(err as Error).message}`, 'error'))
    })
}

$('qmode-ladder').addEventListener('click', () => setQMode('ladder'))
$('qmode-uniform').addEventListener('click', () => setQMode('uniform'))
// live recompute as the discharge controls change (latest value wins via pendingFlood)
$('ladder').addEventListener('input', () => {
    syncLadderLabel();
    computeFlood()
})
$('uniform').addEventListener('input', computeFlood)
// gate: no flood map until the user commits their selection with this button; then live
$('btn-create-flood').addEventListener('click', () => {
    if (!workerReady || current.floodable.length === 0) return
    floodEnabled = true
    refreshControls()
    computeFlood()
})

// ---------- GeoTIFF export ----------
// Enabled only while a flood map with >0 flooded cells is on screen. On click we ask the worker
// for the current binary extent grid (1 = flooded, 0 = dry), encode a georeferenced single-band
// GeoTIFF in-browser (see geotiff.ts), and download it. The exported grid is the geographic
// (EPSG:4326) frame the kernel computes in — not the Mercator-remapped display canvas — so it
// registers correctly in GIS.
interface ExportMsg {
    extent: ArrayBuffer | null
    width: number
    height: number
    bounds: { west: number; south: number; east: number; north: number }
    tile: string
    flooded: number
}

function updateSaveButton(): void {
    ;($('btn-save-geotiff') as HTMLButtonElement).disabled = !(floodEnabled && lastFloodedCells > 0)
}

/** Filesystem-safe tag for the current discharge setting (used in the download filename). */
function currentQLabel(): string {
    if (qmode === 'uniform') return `${Number(($('uniform') as HTMLInputElement).value)}cms`
    const i = Math.min(Math.round(Number(($('ladder') as HTMLInputElement).value)), ladderLabels.length - 1)
    return (flowsSpec?.ladderLabels?.[i] ?? ladderLabels[i]).replace(/[^\w.-]+/g, '')
}

function saveFloodGeoTiff(msg: ExportMsg): void {
    if (!msg.extent) {
        log('No flood map to export.', 'error');
        return
    }
    const buf = encodeExtentGeoTiff({
        width: msg.width, height: msg.height, bounds: msg.bounds,
        data: new Uint8Array(msg.extent),
    })
    const url = URL.createObjectURL(new Blob([buf], {type: 'image/tiff'}))
    const a = document.createElement('a')
    a.href = url
    a.download = `flood_extent_${msg.tile}_${currentQLabel()}.tif`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    log(`Saved ${a.download} · ${msg.flooded.toLocaleString()} flooded cells.`, 'success')
}

$('btn-save-geotiff').addEventListener('click', () => {
    if (!workerReady || lastFloodedCells === 0) return
    worker.postMessage({type: 'export', id: Date.now()})
})

syncLadderLabel()

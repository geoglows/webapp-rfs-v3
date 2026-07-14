/**
 * selection.ts — inlet/outlet picking, corridor computation, and map highlighting.
 *
 * Uses the ported RiverNetwork topology (topology.ts) to turn clicked inlets + outlets into
 * the corridor of segments between them (downstream(inlets) ∩ upstream(outlets)), highlights
 * inlets / outlets / corridor / flood-library reaches on the shared `geoglows` streams source
 * via the subsetter's filter-swap pattern, and warns when the corridor exceeds 30 segments.
 */
import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl'
import type { RiverNetwork } from './topology'

/** The reaches for which a FLDPLN flood library exists (the N40W104 demo tile). */
export const LIBRARY_COMIDS = [760694679, 760703001, 760732952]

/** Warn once a corridor is larger than this many segments (performance). */
export const WARN_THRESHOLD = 30

export type SelectMode = 'inlet' | 'outlet'

export interface SelectionState {
  inlets: number[]
  outlets: number[]
  corridor: number[]
  /** corridor reaches that actually have flood-library coverage */
  floodable: number[]
}

const NO_MATCH: ExpressionSpecification = ['in', ['get', 'riverId'], ['literal', []]]
const inFilter = (ids: number[]): ExpressionSpecification =>
  ids.length ? ['in', ['get', 'riverId'], ['literal', ids]] : NO_MATCH

export class Selection {
  private map: MlMap
  private net: RiverNetwork
  private onChange: (s: SelectionState) => void

  private mode: SelectMode = 'inlet'
  readonly inlets = new Set<number>()
  readonly outlets = new Set<number>()
  private corridor = new Set<number>()

  // DOM
  private infoEl = document.getElementById('selection-info') as HTMLElement
  private warnEl = document.getElementById('warning') as HTMLElement
  private modeInletBtn = document.getElementById('mode-inlet') as HTMLButtonElement
  private modeOutletBtn = document.getElementById('mode-outlet') as HTMLButtonElement

  constructor(map: MlMap, net: RiverNetwork, onChange: (s: SelectionState) => void) {
    this.map = map
    this.net = net
    this.onChange = onChange
    this.modeInletBtn.addEventListener('click', () => this.setMode('inlet'))
    this.modeOutletBtn.addEventListener('click', () => this.setMode('outlet'))
    document.getElementById('btn-clear')?.addEventListener('click', () => this.clear())
  }

  /** Highlight layers on top of the animated `streams` layer. Library first (bottom), endpoints last (top). */
  addHighlightLayers(): void {
    const line = (id: string, color: string, width: number, dash?: number[]): void => {
      this.map.addLayer({
        id, type: 'line', source: 'geoglows', 'source-layer': 'streams', filter: NO_MATCH,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color,
          // grow with zoom (and keep pace with the base streams' high-zoom widening) so a
          // highlighted reach stays clearly visible on top when zoomed in
          'line-width': ['interpolate', ['linear'], ['zoom'],
            3, width * 0.6, 8, width, 13, width * 1.8, 16, width * 3.2] as never,
          'line-opacity': 0.95,
          ...(dash ? { 'line-dasharray': dash as never } : {}),
        },
      })
    }
    // flood-library reaches: always visible so users can find where flood works
    line('library-reaches', '#38bdf8', 2.4, [1.5, 1.5])
    this.map.setFilter('library-reaches', inFilter(LIBRARY_COMIDS))
    line('sel-corridor', '#fbbf24', 3)
    line('sel-inlet', '#34d399', 4)
    line('sel-outlet', '#f472b6', 4)
  }

  setMode(mode: SelectMode): void {
    this.mode = mode
    this.modeInletBtn.classList.toggle('active', mode === 'inlet')
    this.modeOutletBtn.classList.toggle('active', mode === 'outlet')
  }

  /** Handle a click on a reach: toggle it in the active role, recompute, redraw. */
  select(rid: number): void {
    if (!this.net.has(rid)) {
      this.setInfo(`Reach ${rid} is outside the loaded network (no topology/flood coverage here).`)
      return
    }
    const active = this.mode === 'inlet' ? this.inlets : this.outlets
    const other = this.mode === 'inlet' ? this.outlets : this.inlets
    other.delete(rid) // a reach is inlet or outlet, not both
    if (active.has(rid)) active.delete(rid)
    else active.add(rid)
    this.recompute()
  }

  clear(): void {
    this.inlets.clear()
    this.outlets.clear()
    this.recompute()
  }

  private recompute(): void {
    this.corridor = this.net.segmentsBetween(this.inlets, this.outlets)
    const libSet = new Set(LIBRARY_COMIDS)
    const floodable = [...this.corridor].filter((id) => libSet.has(id))
    this.updateFilters()
    this.updateInfo(floodable.length)
    this.onChange({
      inlets: [...this.inlets],
      outlets: [...this.outlets],
      corridor: [...this.corridor],
      floodable,
    })
  }

  private updateFilters(): void {
    if (!this.map.isStyleLoaded()) { this.map.once('idle', () => this.updateFilters()); return }
    // corridor minus the endpoints (drawn separately on top)
    const corridorOnly = [...this.corridor].filter((id) => !this.inlets.has(id) && !this.outlets.has(id))
    this.map.setFilter('sel-corridor', inFilter(corridorOnly))
    this.map.setFilter('sel-inlet', inFilter([...this.inlets]))
    this.map.setFilter('sel-outlet', inFilter([...this.outlets]))
  }

  private setInfo(html: string): void { this.infoEl.innerHTML = html }

  private updateInfo(floodableCount: number): void {
    if (this.inlets.size === 0 && this.outlets.size === 0) {
      this.setInfo('No reaches selected.')
    } else {
      const parts = [
        `Inlets: <span class="inlet">${this.inlets.size}</span>`,
        `Outlets: <span class="outlet">${this.outlets.size}</span>`,
        `Corridor: <span class="corridor count">${this.corridor.size.toLocaleString()}</span> segments`,
      ]
      if (this.inlets.size && this.outlets.size && this.corridor.size === 0) {
        parts.push('<span class="hint">No path connects these — the inlet must be upstream of an outlet.</span>')
      } else if (this.corridor.size) {
        parts.push(floodableCount
          ? `<span class="hint">${floodableCount} in the flood library — ready to compute.</span>`
          : '<span class="hint">None of these have flood-library coverage (only the highlighted demo reaches do).</span>')
      }
      this.setInfo(parts.join('<br>'))
    }
    // >30-segment performance warning
    if (this.corridor.size > WARN_THRESHOLD) {
      this.warnEl.textContent =
        `⚠ Corridor has ${this.corridor.size.toLocaleString()} segments (> ${WARN_THRESHOLD}). ` +
        'Flood computation may be slow.'
      this.warnEl.classList.remove('hidden')
    } else {
      this.warnEl.classList.add('hidden')
    }
  }
}

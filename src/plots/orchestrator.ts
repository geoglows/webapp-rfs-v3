/**
 * plots/orchestrator.ts — lifecycle + composition for the plot suites.
 *
 * The single entry point the app calls: build a chart set into a container, track the live Chart
 * instances, and tear them down on clear. Each chart lives in its own module (dailyTimeseries,
 * forecastHydrograph, …) so the bundle can code-split; this file wires them together.
 *
 * The retrospective and forecast suites track their instances separately so rendering one (e.g.
 * switching charts-modal tabs) never destroys the other; `clearPlots()` tears down both, so the
 * modal-close cleanup stays a single call.
 */
import type { Chart } from 'chart.js'
import type { RiverTimeseries } from '../timeseries'
import type { ForecastTimeseries } from '../forecastTimeseries'
import { deriveForecast } from '../forecastTimeseries'
import { refreshChartTheme } from './shared'
import { deriveRetro } from './derive'
import { renderDailyTimeseries } from './dailyTimeseries'
import { renderMonthlyStatus } from './monthlyStatus'
import { renderFlowDurationCurve } from './flowDurationCurve'
import { renderYearlyVolumes } from './yearlyVolumes'
import { renderYearlyPeaks } from './yearlyPeaks'
import { renderRasterHydrograph } from './rasterHydrograph'
import { renderCumulativeVolume } from './cumulativeVolume'
import { renderForecastHydrograph } from './forecastHydrograph'

let activeRetro: Chart[] = []
let activeForecast: Chart[] = []

const destroy = (list: Chart[]): void => list.forEach((c) => c.destroy())

/** Destroy every live chart in both suites and forget them. Safe to call when none exist. */
export function clearPlots(): void {
  destroy(activeRetro); activeRetro = []
  destroy(activeForecast); activeForecast = []
}

// append a host block for one chart to the root
function block(root: HTMLElement): HTMLElement {
  const host = document.createElement('div')
  host.className = 'plot-block'
  root.appendChild(host)
  return host
}

/** Clear the retrospective plots and render the full retrospective suite into `root`. */
export function plotAllRetro(root: HTMLElement, ts: RiverTimeseries): void {
  destroy(activeRetro); activeRetro = []
  refreshChartTheme() // repoint the palette at the current light/dark theme before building
  root.innerHTML = ''
  const d = deriveRetro(ts)
  activeRetro.push(
    renderDailyTimeseries(block(root), ts),
    renderMonthlyStatus(block(root), d),
    renderFlowDurationCurve(block(root), d),
    renderYearlyVolumes(block(root), d),
    renderYearlyPeaks(block(root), d),
    renderRasterHydrograph(block(root), d),
    renderCumulativeVolume(block(root), d),
  )
}

/** Clear the forecast plots and render the ensemble forecast suite into `root`. */
export function plotAllForecast(root: HTMLElement, fc: ForecastTimeseries): void {
  destroy(activeForecast); activeForecast = []
  refreshChartTheme()
  root.innerHTML = ''
  const b = deriveForecast(fc)
  activeForecast.push(renderForecastHydrograph(block(root), fc.riverId, b))
}

/**
 * plots/flowDurationCurve.ts — flow-duration curve for the whole record plus per-month curves
 * (hidden by default, toggled from the legend).
 */
import { Chart, axis, commonPlugins, VIRIDIS7, chartCanvas, type ChartConfiguration } from './shared'
import { MONTH_NAMES, PERCENTILES, type RetroDerived } from './derive'

export function renderFlowDurationCurve(host: HTMLElement, d: RetroDerived): Chart {
  const pts = (ys: number[]) => PERCENTILES.map((x, i) => ({ x, y: ys[i] }))
  const monthly = MONTH_NAMES.map((name, i) => ({
    label: name, data: pts(d.monthlyFdc[String(i + 1).padStart(2, '0')]),
    borderColor: VIRIDIS7[i % VIRIDIS7.length], borderWidth: 1, pointRadius: 0, hidden: true,
  }))
  return new Chart(chartCanvas(host), {
    type: 'line',
    data: { datasets: [
      { label: 'All months', data: pts(d.fdc), borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0 },
      ...monthly,
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: commonPlugins('Flow duration curve'),
      scales: { x: axis('Percentile (%)', { type: 'linear', min: 0, max: 100 }), y: axis('Flow (m³/s)', { beginAtZero: true }) },
    },
  } as ChartConfiguration)
}

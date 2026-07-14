/**
 * plots/yearlyPeaks.ts — annual peak discharge plotted by day-of-year vs year, colored by peak
 * magnitude (viridis bins), with the circular-median peak day and IQR temporal outliers marked.
 */
import { ScatterController } from 'chart.js'
import { Chart, AXIS, axis, commonPlugins, doyMonthAxis, VIRIDIS5, chartCanvas, type ChartConfiguration } from './shared'
import type { RetroDerived } from './derive'

Chart.register(ScatterController)

export function renderYearlyPeaks(host: HTMLElement, d: RetroDerived): Chart {
  const now = new Date().getUTCFullYear()
  const peaks = d.yearlyPeaks.filter((p) => p.year < now && Number.isFinite(p.peak))
  const minYear = Math.min(...peaks.map((p) => p.year))
  const maxYear = Math.max(...peaks.map((p) => p.year))
  const mags = peaks.map((p) => p.peak)
  const vmin = Math.min(...mags); const vmax = Math.max(...mags)
  const bin = (v: number) => Math.min(4, Math.max(0, Math.floor(((v - vmin) / (vmax - vmin || 1)) * 5)))

  // circular median day-of-year + IQR outlier detection (ported from v2)
  const ang = peaks.map((p) => (2 * Math.PI * (p.doy - 1)) / 365)
  const cdist = (a: number, b: number) => Math.min(Math.abs(a - b), 2 * Math.PI - Math.abs(a - b))
  const medAng = ang.reduce((best, a) => {
    const t = ang.reduce((s, x) => s + cdist(x, a), 0)
    return t < best.dist ? { a, dist: t } : best
  }, { a: 0, dist: Infinity }).a
  const medianDoy = Math.round((medAng / (2 * Math.PI)) * 365) + 1
  const dist = ang.map((a) => cdist(a, medAng) * (365 / (2 * Math.PI)))
  const sorted = [...dist].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]; const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const thresh = q3 + 1.5 * (q3 - q1)
  const isOutlier = (i: number) => dist[i] > thresh && dist[i] > 30

  const binSets = VIRIDIS5.map((color, b) => ({
    type: 'scatter' as const, label: `bin ${b + 1}`, backgroundColor: color, pointRadius: 5,
    data: peaks.filter((p) => bin(p.peak) === b).map((p) => ({ x: p.doy, y: p.year, peak: p.peak })),
  }))
  const outliers = {
    type: 'scatter' as const, label: 'Temporal outlier', backgroundColor: 'rgba(0,0,0,0)',
    borderColor: '#ef4444', borderWidth: 2, pointRadius: 8,
    data: peaks.filter((_, i) => isOutlier(i)).map((p) => ({ x: p.doy, y: p.year })),
  }
  const medianLine = {
    type: 'line' as const, label: 'Median day', borderColor: '#e2e8f0', borderDash: [5, 5], borderWidth: 1,
    pointRadius: 0, data: [{ x: medianDoy, y: minYear - 1 }, { x: medianDoy, y: maxYear + 1 }],
  }
  return new Chart(chartCanvas(host), {
    type: 'scatter',
    data: { datasets: [...binSets, outliers, medianLine] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        ...commonPlugins('Yearly peak discharge'),
        tooltip: { callbacks: { label: (c) => {
          const r = c.raw as { x: number; y: number; peak?: number }
          return r.peak != null ? `${r.y}: ${r.peak.toFixed(1)} m³/s (day ${r.x})` : ''
        } } },
      },
      scales: {
        x: { ...doyMonthAxis(), title: { display: true, text: 'Day of peak', color: AXIS } },
        y: axis('Year', { min: minYear - 1, max: maxYear + 1, ticks: { color: AXIS, stepSize: 1, precision: 0 } }),
      },
    },
  } as ChartConfiguration)
}

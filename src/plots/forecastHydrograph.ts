/**
 * plots/forecastHydrograph.ts — GEOGLOWS 15-day ensemble forecast hydrograph.
 *
 * Shaded min–max and 25–75% bands over the probabilistic members, the ensemble median, and the
 * high-resolution deterministic run. Drag-box zoom + shift-drag pan via chartjs-plugin-zoom.
 */
import zoomPlugin from 'chartjs-plugin-zoom'
import { Chart, AXIS, GRID, TEXT, rgba, chartCanvas } from './shared'
import { t } from '../i18n/i18n'
import type { ForecastBands } from '../forecastTimeseries'

Chart.register(zoomPlugin)

const SKY = 'rgb(56,189,248)'
const HIRES = '#f59e0b'
// {x,y} points with the NaN steps dropped. The 51-member ensemble is 3-hourly while the
// high-resolution member is hourly, so the two suites carry different step counts on the shared
// time axis; dropping NaNs lets each render at its native cadence (and keeps the band fill — which
// pairs max↔min by index — aligned, since all band series share the ensemble's finite steps).
const pts = (dates: Date[], ys: number[]) =>
  dates.map((d, i) => ({ x: d.getTime(), y: ys[i] })).filter((p) => Number.isFinite(p.y))

/** Render the ensemble forecast hydrograph into `host`, returning the Chart (destroy when done). */
export function renderForecastHydrograph(host: HTMLElement, riverId: number, b: ForecastBands): Chart {
  const canvas = chartCanvas(host)
  const x = b.datetime
  const firstX = x.length ? x[0].getTime() : 0
  const lastX = x.length ? x[x.length - 1].getTime() : firstX

  // Dataset order matters for the area fills: each band's upper bound fills DOWN to its lower bound
  // (the immediately-following dataset). Lower-bound datasets draw invisibly and are hidden from the
  // legend (label prefixed "_"); all band datasets are non-hoverable (pointHitRadius 0) so the
  // nearest-point tooltip only ever reports the median or high-res line. Later datasets paint on
  // top, so the tighter IQR sits over the full range.
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Range (min–max)', data: pts(x, b.max), parsing: false, fill: '+1',
          backgroundColor: rgba(SKY, .12), borderWidth: 0, pointRadius: 0, pointHitRadius: 0, tension: .2 },
        { label: '_min', data: pts(x, b.min), parsing: false, fill: false,
          borderWidth: 0, pointRadius: 0, pointHitRadius: 0, tension: .2 },
        { label: 'IQR (25–75%)', data: pts(x, b.p75), parsing: false, fill: '+1',
          backgroundColor: rgba(SKY, .25), borderWidth: 0, pointRadius: 0, pointHitRadius: 0, tension: .2 },
        { label: '_p25', data: pts(x, b.p25), parsing: false, fill: false,
          borderWidth: 0, pointRadius: 0, pointHitRadius: 0, tension: .2 },
        { label: 'Ensemble median', data: pts(x, b.median), parsing: false, fill: false,
          borderColor: SKY, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: .2 },
        { label: 'High-res forecast', data: pts(x, b.highRes), parsing: false, fill: false,
          borderColor: HIRES, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, pointHitRadius: 6, tension: .2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      // nearest (not index): the ensemble and high-res series have different step counts, so an
      // index-aligned tooltip would pair mismatched times. nearest reports the single closest point.
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: {
          position: 'right',
          labels: { color: TEXT, boxWidth: 12, font: { size: 11 }, filter: (i) => !i.text.startsWith('_') },
        },
        title: { display: true, color: TEXT, text: `15-day ensemble forecast · river ${riverId}` },
        tooltip: {
          callbacks: {
            title: (items) =>
              new Date(items[0].parsed.x as number).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
            label: (it) => ` ${it.dataset.label}: ${(it.parsed.y as number).toFixed(2)} m³/s`,
          },
        },
        zoom: {
          zoom: {
            drag: { enabled: true, backgroundColor: rgba(SKY, .15), borderColor: rgba(SKY, .6), borderWidth: 1 },
            wheel: { enabled: false }, pinch: { enabled: true }, mode: 'xy',
          },
          pan: { enabled: true, mode: 'xy', modifierKey: 'shift' },
          limits: { x: { min: firstX, max: lastX } },
        },
      },
      scales: {
        x: {
          type: 'time', time: { unit: 'day', displayFormats: { day: 'MMM d' } },
          min: firstX, max: lastX,
          title: { display: true, text: t('charts.axis.datetime'), color: AXIS },
          ticks: { color: AXIS, maxRotation: 0 }, grid: { color: GRID },
        },
        y: {
          // auto-scale (not beginAtZero): a forecast's ensemble spread and rise/fall are the point,
          // and baseflow can dwarf them — let Chart.js frame the data range with a little padding.
          title: { display: true, text: 'Discharge (m³/s)', color: AXIS },
          grace: '5%', ticks: { color: AXIS }, grid: { color: GRID },
        },
      },
    },
  })
  return chart
}

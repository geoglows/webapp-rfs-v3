/**
 * plots/monthlyStatus.ts — monthly flow-status bands (percentile envelopes per calendar month)
 * with the long-term monthly average and the current + previous year's monthly averages.
 */
import { Chart, axis, commonPlugins, rgba, chartCanvas, TEXT } from './shared'
import { MONTH_NAMES, STATUS_LABELS, STATUS_COLORS, type RetroDerived } from './derive'

export function renderMonthlyStatus(host: HTMLElement, d: RetroDerived): Chart {
  const bands = STATUS_LABELS.map((label, idx) => ({
    label, data: d.monthlyStatus[label], borderWidth: 0, pointRadius: 0,
    backgroundColor: rgba(STATUS_COLORS[idx], 0.5),
    fill: idx < STATUS_LABELS.length - 1 ? ('+1' as const) : ('origin' as const),
  }))
  const years = Array.from(new Set(Object.keys(d.monthlyAverageTimeseries).map((k) => k.slice(0, 4)))).sort()
  // Only the current year and the prior year; [current, previous] after reverse. Current is drawn
  // solid in the theme text color (black/near-white); previous is a lighter dashed slate line.
  const recent = years.slice(-2).reverse().map((y, i) => ({
    label: `Year ${y}`,
    borderColor: i === 0 ? TEXT : '#64748b', borderWidth: i === 0 ? 2 : 1.5,
    borderDash: i === 0 ? [] : [6, 4], pointRadius: 0, fill: false,
    data: MONTH_NAMES.map((_, m) => d.monthlyAverageTimeseries[`${y}-${String(m + 1).padStart(2, '0')}`] ?? null),
  }))
  return new Chart(chartCanvas(host), {
    type: 'line',
    data: {
      labels: MONTH_NAMES,
      datasets: [
        ...bands,
        { label: 'Monthly average', data: d.monthlyAverages.map((m) => m.value), borderColor: '#009dff', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false },
        ...recent,
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: commonPlugins('Monthly flow status'),
      scales: { x: axis('Month'), y: axis('Flow (m³/s)', { beginAtZero: true }) },
    },
  })
}

/**
 * plots/shared.ts — Chart.js setup + theme helpers shared by every plot module.
 *
 * Registers the Chart.js pieces every plot uses and the date-fns time adapter. Chart-specific
 * controllers (bar, scatter, matrix) and the zoom plugin register in the individual plot module
 * that needs them, so a future forecast bundle only pulls what it references. Exports the theme
 * palette, axis/plugin/section helpers, and the Chart class so plot modules import from here.
 */
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, TimeScale,
  Filler, Legend, Tooltip, Title,
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import { MONTH_NAMES, MONTH_START_DOY } from './derive'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, TimeScale, Filler, Legend, Tooltip, Title)
Chart.defaults.plugins.title.font = { ...Chart.defaults.plugins.title.font, size: 18 }
Chart.defaults.plugins.legend.position = 'right'
// Axis (scale) titles: a step up from the 12px tick default and bold, set globally so every chart's
// x/y titles match — individual plots only supply the title text + color. Cast past the typed union
// for Chart.defaults.scale (it includes radialLinear, which has no `title`).
;(Chart.defaults.scale as unknown as { title: { font: { size: number; weight: string } } })
  .title.font = { size: 14, weight: 'bold' }

export { Chart }
export type { ChartConfiguration } from 'chart.js'

// Theme-aware chart palette. These are live `let` bindings (ES-module exports stay reactive for
// importers) recomputed by refreshChartTheme() before every render, so axis/tick/title/legend
// text tracks the app's light/dark theme. Light mode uses near-black (--text) for strong contrast
// against the white chart background; the earlier light grey was too faint.
export let AXIS = '#94a3b8'
export let GRID = 'rgba(148,163,184,.12)'
export let TEXT = '#e2e8f0'

/** Re-read the current `data-theme` (set on <html>) and repoint the chart palette. Called from
 * the orchestrator just before it (re)builds the charts so a theme toggle is picked up on reopen. */
export function refreshChartTheme(): void {
  const light = document.documentElement.dataset.theme === 'light'
  AXIS = light ? '#0f172a' : '#94a3b8'  // axis titles + ticks
  TEXT = light ? '#0f172a' : '#e2e8f0'  // chart titles + legend labels
  GRID = light ? 'rgba(15,23,42,.14)' : 'rgba(148,163,184,.12)'
}
export const VIRIDIS5 = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']
export const VIRIDIS7 = ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#bddf26', '#fde725']
export const rgba = (rgb: string, a: number): string => rgb.replace('rgb(', 'rgba(').replace(')', `, ${a})`)

/** A themed linear/whatever axis with a title. */
export const axis = (text: string, opts: Record<string, unknown> = {}) => ({
  title: { display: true, text, color: AXIS }, ticks: { color: AXIS }, grid: { color: GRID }, ...opts,
})
/** Themed legend + title plugin block. */
export const commonPlugins = (title: string, legend = true) => ({
  legend: { display: legend, labels: { color: TEXT, boxWidth: 12, font: { size: 11 } } },
  title: { display: true, text: title, color: TEXT },
})
/** A day-of-year x-axis whose ticks are pinned to the first of each month. */
export const doyMonthAxis = () => ({
  type: 'linear' as const, min: 0.5, max: 366.5,
  afterBuildTicks: (a: { ticks: { value: number }[] }) => { a.ticks = MONTH_START_DOY.map((value) => ({ value })) },
  ticks: { color: AXIS, callback: (v: string | number) => MONTH_NAMES[MONTH_START_DOY.indexOf(Number(v))] ?? '' },
  grid: { color: GRID },
})

/** Append a `.chart-canvas` wrapper + `<canvas>` to `host` and return the canvas. */
export function chartCanvas(host: HTMLElement): HTMLCanvasElement {
  const wrap = document.createElement('div'); wrap.className = 'chart-canvas'
  const canvas = document.createElement('canvas'); wrap.appendChild(canvas)
  host.appendChild(wrap)
  return canvas
}

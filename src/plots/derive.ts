/**
 * retro.ts — derive the summary series the v2 hydroviewer plots from a raw retrospective record.
 *
 * Ported from geoglows-apps/rfs-v2-hydroviewer src/plots.js (plotAllRetro): monthly values →
 * monthly averages / status percentiles / flow-duration curves, yearly volumes + 5-year averages,
 * yearly peaks, a year×day-of-year raster, and per-year cumulative volumes. Kept transform-only so
 * the Chart.js rendering (the plots/*.ts modules) stays presentation-only.
 */
import type { RiverTimeseries } from '../timeseries'

export const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// day-of-year for the 1st of each month (non-leap) — axis ticks for doy-based charts
export const MONTH_START_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]

// flow-regime status categories (high → low) and the desc-sorted percentile that bounds each
export const STATUS_LABELS = ['High', 'Above normal', 'Normal', 'Below normal', 'Low']
export const STATUS_PERCENTILES = [0, 13, 28, 72, 87]
export const STATUS_COLORS = [
  'rgb(44, 125, 205)', 'rgb(142, 206, 238)', 'rgb(231, 226, 188)', 'rgb(255, 168, 133)', 'rgb(205, 35, 63)',
]

const SECONDS_PER_YEAR = 60 * 60 * 24 * 365.25
export const PERCENTILES = Array.from({ length: 51 }, (_, i) => i * 2) // 0,2,…,100
const sortedToPercentiles = (arr: number[]): number[] =>
  [...PERCENTILES].reverse().map((p) => arr[Math.floor((arr.length * p) / 100) - (p === 100 ? 1 : 0)])

export interface YearPeak { year: number; date: Date; doy: number; peak: number }
export interface RetroDerived {
  fdc: number[]
  monthlyFdc: Record<string, number[]>
  monthlyAverages: { month: string; value: number }[]
  monthlyStatus: Record<string, number[]>
  monthlyAverageTimeseries: Record<string, number>
  yearlyVolumes: { year: number; value: number }[]
  fiveYearAverages: { period: number; average: number }[]
  yearlyPeaks: YearPeak[]
  raster: { years: number[]; z: (number | null)[][] }
  cumulative: Record<number, { x: number[]; y: number[] }>
}

/** Compute every derived retrospective series in one pass over the record. */
export function deriveRetro(ts: RiverTimeseries): RetroDerived {
  const { datetime, discharge } = ts

  // group discharge by YYYY-MM
  const monthlyValues: Record<string, number[]> = {}
  for (let i = 0; i < datetime.length; i++) {
    if (!Number.isFinite(discharge[i])) continue
    const key = datetime[i].toISOString().slice(0, 7)
    ;(monthlyValues[key] ??= []).push(discharge[i])
  }

  const fdc = sortedToPercentiles([...discharge].filter(Number.isFinite).sort((a, b) => a - b))

  // annual peak (max) discharge with its day-of-year
  const dateToDoy = (d: Date): number => Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000)
  const peaksByYear: Record<number, YearPeak> = {}
  for (let i = 0; i < datetime.length; i++) {
    const v = discharge[i]
    if (!Number.isFinite(v)) continue
    const d = datetime[i]; const year = d.getUTCFullYear()
    if (!peaksByYear[year] || v > peaksByYear[year].peak) peaksByYear[year] = { year, date: d, doy: dateToDoy(d), peak: v }
  }
  const yearlyPeaks = Object.values(peaksByYear).sort((a, b) => a.year - b.year)

  // monthly averages (need ≥20 samples in the month, mirroring v2)
  const monthlyAverageTimeseries: Record<string, number> = {}
  for (const k of Object.keys(monthlyValues)) {
    if (monthlyValues[k].length < 20) { delete monthlyValues[k]; continue }
    monthlyAverageTimeseries[k] = monthlyValues[k].reduce((a, b) => a + b, 0) / monthlyValues[k].length
  }

  // per calendar month: status percentiles, long-term average, month FDC
  const monthlyStatus: Record<string, number[]> = {}
  STATUS_LABELS.forEach((l) => { monthlyStatus[l] = [] })
  const monthlyAverages: { month: string; value: number }[] = []
  const monthlyFdc: Record<string, number[]> = {}
  for (const month of MONTHS) {
    const values = Object.keys(monthlyValues).filter((k) => k.endsWith(`-${month}`))
      .flatMap((k) => monthlyValues[k]).sort((a, b) => b - a) // descending
    STATUS_PERCENTILES.forEach((p, idx) => monthlyStatus[STATUS_LABELS[idx]].push(values[Math.floor((values.length * p) / 100)]))
    monthlyAverages.push({ month, value: values.reduce((a, b) => a + b, 0) / values.length })
    monthlyFdc[month] = sortedToPercentiles([...values].reverse())
  }

  // annual volume (Mm³) for years with all 12 monthly averages, + 5-year period averages
  const years = Array.from(new Set(Object.keys(monthlyValues).map((k) => k.slice(0, 4)))).sort()
  const yearlyVolumes: { year: number; value: number }[] = []
  for (const y of years) {
    const yv = Object.keys(monthlyAverageTimeseries).filter((k) => k.startsWith(`${y}-`)).map((k) => monthlyAverageTimeseries[k])
    if (yv.length === 12) yearlyVolumes.push({ year: +y, value: (yv.reduce((a, b) => a + b, 0) / 12) * SECONDS_PER_YEAR / 1e6 })
  }
  const groups: Record<number, { total: number; count: number }> = {}
  for (const { year, value } of yearlyVolumes) {
    const period = Math.floor(year / 5) * 5
    ;(groups[period] ??= { total: 0, count: 0 })
    groups[period].total += value; groups[period].count += 1
  }
  const fiveYearAverages = Object.keys(groups).map(Number).sort((a, b) => a - b)
    .map((period) => ({ period, average: groups[period].total / groups[period].count }))

  // year × day-of-year raster (assumes contiguous daily record, as v2 does)
  const firstYear = datetime[0].getUTCFullYear()
  const lastYear = datetime[datetime.length - 1].getUTCFullYear()
  const nYears = lastYear + 1 - firstYear
  const rasterYears = Array.from({ length: nYears }, (_, i) => firstYear + i)
  const z: (number | null)[][] = Array.from({ length: nYears }, () => Array<number | null>(366).fill(null))
  let curYear = firstYear; let yearIdx = 0; let doyIdx = -1
  for (let i = 0; i < datetime.length; i++) {
    const yr = datetime[i].getUTCFullYear()
    if (yr !== curYear) { curYear = yr; doyIdx = 0; yearIdx += 1 } else { doyIdx += 1 }
    if (yearIdx < nYears && doyIdx < 366) z[yearIdx][doyIdx] = Number.isFinite(discharge[i]) ? discharge[i] : null
  }

  // per-year cumulative volume, x mapped onto a common year (2000) so years overlay
  const cumulative: Record<number, { x: number[]; y: number[] }> = {}
  for (let i = 0; i < datetime.length; i++) {
    const d = datetime[i]; const yr = d.getUTCFullYear()
    const c = (cumulative[yr] ??= { x: [], y: [] })
    const prev = c.y.length ? c.y[c.y.length - 1] : 0
    c.x.push(Date.UTC(2000, d.getUTCMonth(), d.getUTCDate()))
    c.y.push(prev + (Number.isFinite(discharge[i]) ? discharge[i] : 0) * 86400)
  }

  return {
    fdc, monthlyFdc, monthlyAverages, monthlyStatus, monthlyAverageTimeseries,
    yearlyVolumes, fiveYearAverages, yearlyPeaks, raster: { years: rasterYears, z }, cumulative,
  }
}

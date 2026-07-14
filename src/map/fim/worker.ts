/**
 * worker.ts — owns tile data and the per-frame compute + paint.
 *
 * Protocol (postMessage):
 *   -> { type: 'init', dataBase, tile }         load parquet + meta
 *   <- { type: 'ready', meta, flows, stats }
 *   -> { type: 'frame', id, flows: [comid, q][] }
 *   <- { type: 'frame', id, rgba: ArrayBuffer (transfer), width, height,
 *        floodedCells, computeMs }
 *   -> { type: 'query', id, fpp }
 *   <- { type: 'query', id, depth: number | null }
 */
import { asyncBufferFromUrl } from 'hyparquet'
import { computeDof, reduceToGrid } from './kernel'
import type { LibraryData, StreamsData } from './kernel'
import { loadLibrary, loadStreams } from './tileData'
import type { FlowsSpec, TileMeta } from './tileData'
import { buildLut, lutIndex } from './colormap'
import { buildMercatorRowMap } from './mercator'

let lib: LibraryData | null = null
let streams: StreamsData | null = null
let meta: TileMeta | null = null
let dof: Float32Array
let grid: Float32Array          // depth per pixel, NaN = dry (touched pixel set is fixed)
let srcRgba: Uint32Array        // colormapped, geographic rows
let outRgba: Uint32Array        // mercator-remapped rows (sent to main thread)
let rowMap: Int32Array
let lut: Uint32Array
let scratch: { wse: Float64Array }

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data
  try {
    if (msg.type === 'init') {
      // The tile directory URL and asset file names come from the env-driven config in main.ts.
      const base = (msg.tileUrl as string).replace(/\/+$/, '')
      const files = msg.files as { meta: string; flows: string; library: string; streams: string }
      meta = await (await fetch(`${base}/${files.meta}`)).json() as TileMeta
      const flows = await (await fetch(`${base}/${files.flows}`)).json() as FlowsSpec
      const [libBuf, strBuf] = await Promise.all([
        asyncBufferFromUrl({ url: `${base}/${files.library}`, byteLength: meta.bytes.library }),
        asyncBufferFromUrl({ url: `${base}/${files.streams}`, byteLength: meta.bytes.streams }),
      ])
      lib = await loadLibrary(libBuf)
      streams = await loadStreams(strBuf, meta.nFsp)
      dof = new Float32Array(meta.nFsp)
      grid = new Float32Array(meta.nrows * meta.ncols).fill(NaN)
      srcRgba = new Uint32Array(meta.nrows * meta.ncols)
      outRgba = new Uint32Array(meta.nrows * meta.ncols)
      rowMap = buildMercatorRowMap(meta.bounds.north, meta.bounds.south, meta.nrows, meta.nrows)
      lut = buildLut()
      scratch = { wse: new Float64Array(streams.n) }
      self.postMessage({
        type: 'ready', meta, flows,
        stats: { libraryRows: lib.n, visits: streams.n, nFsp: meta.nFsp },
      })
    } else if (msg.type === 'frame') {
      if (!lib || !streams || !meta) throw new Error('worker not initialized')
      const t0 = performance.now()
      const flowMap = new Map<number, number>(msg.flows as Array<[number, number]>)
      computeDof(streams, flowMap, dof, scratch)
      const floodedCells = reduceToGrid(lib, dof, grid)

      // colormap into geographic-row RGBA (only library FPPs ever change;
      // srcRgba starts zeroed = transparent everywhere else)
      const { n, fpp } = lib
      for (let i = 0; i < n; i++) {
        const p = fpp[i]
        if (i > 0 && p === fpp[i - 1]) continue
        const d = grid[p]
        srcRgba[p] = Number.isNaN(d) ? 0 : lut[lutIndex(d)]
      }
      // mercator row remap: outRgba row r <- srcRgba row rowMap[r]
      const w = meta.ncols
      for (let r = 0; r < meta.nrows; r++) {
        const src = rowMap[r] * w
        outRgba.set(srcRgba.subarray(src, src + w), r * w)
      }
      const computeMs = performance.now() - t0
      // transfer a copy so outRgba stays reusable
      const buf = outRgba.slice().buffer
      ;(self as unknown as Worker).postMessage(
        { type: 'frame', id: msg.id, rgba: buf, width: w, height: meta.nrows,
          floodedCells, computeMs },
        [buf],
      )
    } else if (msg.type === 'query') {
      const d = grid && msg.fpp >= 0 && msg.fpp < grid.length ? grid[msg.fpp] : NaN
      self.postMessage({ type: 'query', id: msg.id, depth: Number.isNaN(d) ? null : d })
    } else if (msg.type === 'export') {
      // Snapshot the current flood map as a binary extent grid (1 = flooded, 0 = dry),
      // in the geographic (plate-carrée) frame the kernel computes in — row 0 = north,
      // matching a north-up EPSG:4326 GeoTIFF exactly (see geotiff.ts). The grid holds a
      // depth for flooded cells and NaN everywhere else, so flooded <=> !isNaN.
      if (!meta || !grid) { self.postMessage({ type: 'export', id: msg.id, extent: null }); return }
      const extent = new Uint8Array(grid.length)
      let flooded = 0
      for (let i = 0; i < grid.length; i++) {
        if (!Number.isNaN(grid[i])) { extent[i] = 1; flooded++ }
      }
      const buf = extent.buffer
      ;(self as unknown as Worker).postMessage(
        { type: 'export', id: msg.id, extent: buf, width: meta.ncols, height: meta.nrows,
          bounds: meta.bounds, tile: meta.tile, flooded },
        [buf],
      )
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message ?? String(err) })
  }
}

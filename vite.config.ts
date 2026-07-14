import { defineConfig, type Plugin } from 'vite'
import { createReadStream, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'

/**
 * Dev-only static server for the local `data/` tree, mounted at `/data`.
 *
 * In development the app fetches its runtime assets from `/data/...` (see .env.development,
 * which points every host at the Vite origin). Those assets — Parquet flood tiles and the
 * PMTiles stream archive — are read with HTTP Range requests by hyparquet and pmtiles, so this
 * handler MUST honour `Range` and reply 206 with a correct `Content-Range`. Vite's built-in
 * static serving is not used for this tree (it lives outside publicDir and must not be copied
 * into the production bundle — prod serves it from CloudFront). apply:'serve' keeps this out of
 * the build entirely.
 */
function serveDataDir(dir: string): Plugin {
  const root = resolve(dir)
  const TYPES: Record<string, string> = {
    '.json': 'application/json',
    '.parquet': 'application/octet-stream',
    '.pmtiles': 'application/octet-stream',
    '.bin': 'application/octet-stream',
  }
  return {
    name: 'serve-data-dir',
    apply: 'serve',
    configureServer(server) {
      // Registered directly (not via a returned function) so it runs BEFORE Vite's internal
      // middlewares — the SPA/HTML fallback must never intercept a /data asset request.
      server.middlewares.use('/data', (req, res, next) => {
        try {
          // connect strips the '/data' mount, so req.url is already relative to the tree
          const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
          const filePath = normalize(join(root, rel))
          if (filePath !== root && !filePath.startsWith(root + sep)) { // path-traversal guard
            res.statusCode = 403; res.end('Forbidden'); return
          }
          let st
          try { st = statSync(filePath) } catch { next(); return }   // missing -> let Vite 404
          if (st.isDirectory()) { next(); return }

          const dot = filePath.lastIndexOf('.')
          res.setHeader('Content-Type', (dot >= 0 && TYPES[filePath.slice(dot).toLowerCase()]) || 'application/octet-stream')
          res.setHeader('Accept-Ranges', 'bytes')
          res.setHeader('Cache-Control', 'no-cache') // never gzip/transform: Range + styles.bin need raw bytes

          const size = st.size
          const range = req.headers.range
          const m = range && /^bytes=(\d*)-(\d*)$/.exec(range)
          if (m) {
            let start = m[1] === '' ? NaN : parseInt(m[1], 10)
            let end = m[2] === '' ? NaN : parseInt(m[2], 10)
            if (Number.isNaN(start)) { start = Math.max(0, size - (end || 0)); end = size - 1 } // suffix range
            else if (Number.isNaN(end) || end >= size) end = size - 1
            if (start > end || start >= size) {
              res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return
            }
            res.statusCode = 206
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
            res.setHeader('Content-Length', String(end - start + 1))
            if (req.method === 'HEAD') { res.end(); return }
            createReadStream(filePath, { start, end }).pipe(res)
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Length', String(size))
          if (req.method === 'HEAD') { res.end(); return }
          createReadStream(filePath).pipe(res)
        } catch (err) {
          res.statusCode = 500; res.end((err as Error).message)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [serveDataDir('data')],
  worker: { format: 'es' },
  server: {
    // Dev-only proxy for the ensemble forecast Zarr store. That CloudFront distribution
    // (d14ritg1bypdp7) returns `Access-Control-Allow-Origin: *` but does NOT `Vary: Origin`, so
    // whether a cached object carries the CORS header depends on whether the request that first
    // populated the edge cache sent an `Origin` — unreliable, and the browser trips over the
    // CORS-less copies. Proxying makes the browser talk to the same-origin Vite server (no CORS
    // check) while Vite fetches from CloudFront server-side. .env.development points
    // VITE_FORECAST_ZARR_BASE here; production hits CloudFront directly (see README / that store
    // needs a response-headers policy that always emits the CORS header).
    proxy: {
      '/forecast-zarr': {
        target: 'https://d14ritg1bypdp7.cloudfront.net',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/forecast-zarr/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    testTimeout: 120_000,
  },
} as Parameters<typeof defineConfig>[0])

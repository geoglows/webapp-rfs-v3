import {defineConfig} from "vite";
import {createReadStream, statSync} from "node:fs";
import {join, normalize, resolve, sep} from "node:path";

const PACKAGE_ROOT = resolve("../rfsjs");
// This app no longer imports zarrita: every zarr store it reads — flood library tiles and discharge
// alike — is read through rfsjs, whose build bundles one zarrita with numcodecs' lz4 and zstd wasm
// stubbed out (see its rollup.config.js). blosc is left as a bare external there, which is the only
// reason numcodecs is a direct dependency here: it must resolve to exactly one copy.

function serveDataDir(dir) {
  const root = resolve(dir);
  const TYPES = {
    ".json": "application/json",
    ".parquet": "application/octet-stream",
    ".pmtiles": "application/octet-stream",
    ".bin": "application/octet-stream"
  };
  return {
    name: `serve-data-dir:${dir}`,
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(`/${dir}`, (req, res, next) => {
        try {
          const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const filePath = normalize(join(root, rel));
          if (filePath !== root && !filePath.startsWith(root + sep)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          // 404 rather than next(). Falling through hands the SPA's index.html to whatever asked —
          // with a 200 — so a missing zarr chunk surfaces as "Failed to decode JSON" from inside a
          // decoder, and a missing pmtiles as a byte-serving complaint. Neither names the file.
          let st;
          try {
            st = statSync(filePath);
          } catch {
            res.statusCode = 404;
            res.end(`Not found: ${rel}`);
            return;
          }
          // This mount serves files, not listings; a directory hit is a caller's bad path, not a
          // request for the app shell.
          if (st.isDirectory()) {
            res.statusCode = 404;
            res.end(`Not a file: ${rel}`);
            return;
          }
          const dot = filePath.lastIndexOf(".");
          res.setHeader("Content-Type", dot >= 0 && TYPES[filePath.slice(dot).toLowerCase()] || "application/octet-stream");
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Cache-Control", "no-cache");
          const size = st.size;
          const range = req.headers.range;
          const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
          if (m) {
            let start = m[1] === "" ? NaN : parseInt(m[1], 10);
            let end = m[2] === "" ? NaN : parseInt(m[2], 10);
            if (Number.isNaN(start)) {
              start = Math.max(0, size - (end || 0));
              end = size - 1;
            } else if (Number.isNaN(end) || end >= size) end = size - 1;
            if (start > end || start >= size) {
              res.statusCode = 416;
              res.setHeader("Content-Range", `bytes */${size}`);
              res.end();
              return;
            }
            res.statusCode = 206;
            res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
            res.setHeader("Content-Length", String(end - start + 1));
            if (req.method === "HEAD") {
              res.end();
              return;
            }
            createReadStream(filePath, {start, end}).pipe(res);
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Length", String(size));
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          createReadStream(filePath).pipe(res);
        } catch (err) {
          res.statusCode = 500;
          res.end(err.message);
        }
      });
    }
  };
}

let vite_config_default = defineConfig({
  plugins: [serveDataDir("data")],
  resolve: {
    dedupe: ["chart.js", "chartjs-adapter-date-fns", "chartjs-chart-matrix", "chartjs-plugin-zoom", "date-fns", "numcodecs"],
  },
  worker: {format: "es"},
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{name: "maplibre", test: /node_modules[/\\]maplibre-gl[/\\]/}]
        }
      }
    }
  },
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok.app", ".ngrok.io", "tunnel.hales.app"],
    watch: {ignored: ["**/data/**"]},
    fs: {allow: [".", PACKAGE_ROOT]}
  },
  test: {
    environment: "node",
    testTimeout: 12e4,
    include: ["tests/**/*.test.js"]
  }
});
export {
  vite_config_default as default
};

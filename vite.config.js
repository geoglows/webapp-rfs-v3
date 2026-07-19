import {defineConfig} from "vite";
import {createReadStream, statSync} from "node:fs";
import {join, normalize, resolve, sep} from "node:path";
const PACKAGE_ROOT = resolve("../clients-rfsjs");

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
          let st;
          try {
            st = statSync(filePath);
          } catch {
            next();
            return;
          }
          if (st.isDirectory()) {
            next();
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

var vite_config_default = defineConfig({
  plugins: [serveDataDir("data")],
  resolve: {
    dedupe: ["chart.js", "chartjs-adapter-date-fns", "chartjs-chart-matrix", "chartjs-plugin-zoom", "date-fns", "zarrita"]
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
    // The package is a sibling checkout, outside this project root, and file: deps are symlinked,
    // so the dev server has to be told it may serve from the real path.
    fs: {allow: [".", PACKAGE_ROOT]}
  },
  test: {
    environment: "node",
    testTimeout: 12e4,
    // references/ is vendored read-only code with its own unfulfilled deps — not ours to run.
    include: ["src/**/*.test.js"]
  }
});
export {
  vite_config_default as default
};

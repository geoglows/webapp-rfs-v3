import {defineConfig} from "vite";
import {createHash} from "node:crypto";
import {createReadStream, existsSync, readFileSync, realpathSync, statSync} from "node:fs";
import {createRequire} from "node:module";
import {basename, dirname, extname, join, normalize, sep} from "node:path";
import {fileURLToPath} from "node:url";

const entry = (p) => fileURLToPath(new URL(p, import.meta.url));

// ./data is a symlink to wherever the v3 artifacts actually live. Serving it from the Vite server
// is the point: PMTiles, the metadata parquets and the zarr chunks are all read by byte range — so
// one server does the app and the data, with no second process and no CORS. The artifacts are
// gigabytes and deliberately not copied into dist/.
//
// Resolved against this file rather than process.cwd(), so running Vite from anywhere still finds
// the link, and realpath'd up front so a dangling link is a build-time warning instead of a
// mystery 404 on every request.
const here = fileURLToPath(new URL(".", import.meta.url));
const DATA_MOUNT = "/data";
const dataLink = `${here}data`;
const dataRoot = existsSync(dataLink) ? realpathSync(dataLink) : null;

const TYPES = {
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".parquet": "application/vnd.apache.parquet",
  ".pmtiles": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8"
};

/**
 * Range-aware static file serving, in the ~40 lines it actually takes.
 *
 * Everything this app reads it reads by byte range, so **206 with a correct `Content-Range` is the
 * whole job** — a server that answers 200 with the entire file makes PMTiles refuse the response
 * outright ("content-length exceeding request") and makes a parquet footer read pull the whole
 * gigabyte. That is the one behaviour worth being careful about, and it is small enough not to be
 * worth a dependency.
 *
 * The 416 path matters too: PMTiles probes an archive it does not know the length of and reads the
 * size back out of `Content-Range: bytes * /size` on the refusal.
 */
const serveRange = (root, req, res, next) => {
  try {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    // Normalising an *absolute* path clamps at "/" — `/a/../../../etc/passwd` collapses to
    // `/etc/passwd` rather than climbing above it — so forcing the leading slash is what stops a
    // traversal, and the prefix check below is the second lock rather than the only one.
    const path = join(root, normalize(`/${rel}`));
    if (path !== root && !path.startsWith(root + sep)) {
      res.statusCode = 403;
      return res.end("forbidden\n");
    }
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();

    const size = stat.size;
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("content-type", TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
    // No caching: this serves whatever the symlink points at right now, which during a pipeline run
    // is a file that changes under you.
    res.setHeader("cache-control", "no-cache");

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = size - 1;
    if (m) {
      // "bytes=-500" is the last 500 bytes; "bytes=500-" is everything from 500 on.
      if (m[1] === "") start = Math.max(0, size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
      }
      if (!(start <= end) || start >= size) {
        res.statusCode = 416;
        res.setHeader("content-range", `bytes */${size}`);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
    }
    res.setHeader("content-length", end - start + 1);
    if (req.method === "HEAD") return res.end();
    createReadStream(path, {start, end}).on("error", () => res.destroy()).pipe(res);
  } catch (err) {
    // A malformed percent-escape throws out of decodeURIComponent; without this it lands in
    // connect's default handler and the response says nothing useful about which file was asked for.
    res.statusCode = 500;
    res.end(err.message);
  }
};

/**
 * Mount ./data on both the dev server and the preview server.
 *
 * The same middleware for both, rather than leaning on `server.fs.allow` in dev, so the two behave
 * identically and there is only one thing to reason about — and `fs.allow` would not help the
 * preview server at all, which serves dist/ and nothing else. Preview mattering is not theoretical:
 * it is the only way to exercise a production build against real artifacts.
 *
 * The explicit 404 matters more than it looks. Vite's SPA fallback rewrites any unmatched path to
 * index.html, so a missing artifact would come back as **200 with a page of HTML** — PMTiles then
 * fails on a malformed header and a parquet read on a bad magic number, neither of which says
 * "that file is not there". Ending the request here keeps a missing file looking like a missing
 * file. Registering in configureServer (not its returned post-hook) puts this ahead of the
 * fallback.
 */
const serveData = () => {
  const mount = (server) => {
    if (!dataRoot) return;
    server.middlewares.use(DATA_MOUNT, (req, res) => serveRange(dataRoot, req, res, () => {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end(`no such file under ${DATA_MOUNT}: ${req.url}\n`);
    }));
  };
  return {
    name: "serve-data-symlink",
    configureServer: mount,
    configurePreviewServer: mount,
    buildStart() {
      if (!dataRoot) {
        this.warn(`./data is missing or dangling — the app will have no v3 artifacts to read. ` +
          `Symlink it: ln -s <path-to-v3-data> ${dataLink}`);
      }
    }
  };
};

/**
 * Serve /hydrography/ as /hydrography/index.html on the dev and preview servers.
 *
 * A multi-page build emits the second entry at dist/hydrography/index.html, and the deployed URL
 * for it is a directory URL — so without this, the sub-page is reachable in production (where
 * CloudFront resolves the directory index) but 404s locally, which is exactly backwards for
 * catching problems. Lifted from apps.geoglows/vite.config.js, which solves the same thing for its
 * own /profile/, /terms/ and /licenses/ pages.
 */
const cleanUrls = () => {
  const rewrite = (dir) => (req, res, next) => {
    const [pathname, search] = req.url.split("?");
    const page = `${pathname.replace(/\/$/, "")}/index.html`;
    if (!pathname.includes(".") && existsSync(entry(`./${dir}${page}`))) {
      req.url = search ? `${page}?${search}` : page;
    }
    next();
  };
  return {
    name: "clean-urls",
    configureServer: (server) => void server.middlewares.use(rewrite(".")),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite("dist"))
  };
};

/**
 * `<!-- @include -->`: one copy of the HTML both entry pages share.
 *
 * Two pages meant two hand-maintained copies of the same head, the same header, the same language
 * menu, the same search modal and the same settings modal — and they had already drifted (a logo
 * hard-coded on one page and read from the environment on the other, two different English
 * fallbacks under one i18n key). Consolidating the apps was supposed to end that, so the shared
 * markup now lives once in src/shared/html/ and is inlined into both pages.
 *
 *   <!-- @include button-theme.html -->                          a whole partial, verbatim
 *   <!-- @include head.html title="RFS" script="/src/x.js" -->   with parameters
 *   <!-- @include settings-modal.html class="wide" -->           with a slot: everything up to
 *     <label>…</label>                                           the matching @endinclude is the
 *   <!-- @endinclude settings-modal.html -->                     partial's {{children}}
 *
 * Inside a partial, `{{name}}` is the parameter of that name and `{{children}}` is the slot; an
 * unpassed parameter is empty. Partials may include other partials, and a slot may contain them
 * too. Everything is resolved before Vite sees the page, so the two entries stay ordinary HTML
 * files: `%VITE_*%` substitution, `<script src>` rewriting and asset hashing all still apply to
 * what came out of a partial, because this runs as a `pre` hook and Vite's own passes come after.
 *
 * Chosen over a template engine because a dependency would have to earn 60 lines, and over
 * server-side JS templating because these pages are static: nothing here needs to survive to
 * runtime, and the built HTML should read exactly like the hand-written HTML it replaces.
 */
const PARTIALS = `${here}src/shared/html/`;

// `^[ \t]*` is optional rather than required so an include can sit mid-line; when it does match it
// is the indentation the expansion is re-indented to, which is what keeps the built page readable.
const DIRECTIVE = /(^[ \t]*)?<!--\s*@(include|endinclude)\s+([\w.\-/]+)((?:\s+[\w-]+="[^"]*")*)\s*-->/gm;
const PARAM = /([ \t]*)\{\{\s*([\w-]+)\s*\}\}/g;

// Re-indent a block to sit at `indent`, having first stripped whatever indentation it arrived with.
// Cosmetic — HTML does not care — but a page whose source is unreadable is a page nobody edits.
const reindent = (text, indent) => {
  const lines = text.replace(/^[ \t]*\n/, "").replace(/\s+$/, "").split("\n");
  const written = lines.filter((l) => l.trim());
  const common = written.length ? Math.min(...written.map((l) => l.match(/^[ \t]*/)[0].length)) : 0;
  // The first line is already sitting after the directive's own indentation, and a blank line is
  // left blank rather than being padded out to a line of trailing spaces.
  return lines
    .map((l, i) => (!l.trim() ? "" : i === 0 ? l.slice(common) : indent + l.slice(common)))
    .join("\n");
};

// A partial opens with a comment saying what it is and which parameters it takes. That is a note to
// whoever edits the partial, not to whoever reads the page, so it is dropped on the way in;
// comments written *inside* the markup are about the markup and are kept.
const readPartial = (file) => readFileSync(file, "utf8").replace(/^\s*<!--[^]*?-->\n/, "");

const expandHtml = (text, params, chain) => {
  const filled = text.replace(PARAM, (_, indent, key) => {
    const value = params[key];
    return value ? indent + reindent(value, indent) : "";
  });

  const tokens = [...filled.matchAll(DIRECTIVE)].map((m) => ({
    kind: m[2],
    name: m[3],
    attrs: m[4] ?? "",
    indent: m[1] ?? "",
    start: m.index,
    end: m.index + m[0].length
  }));

  // Pair the block includes. An @endinclude closes the nearest *unclosed* @include naming the same
  // partial, so a self-closing include of a partial used with a slot elsewhere on the page is not
  // mistaken for the opening half of that block; every include left unpaired is self-closing.
  const closes = new Map();
  const open = [];
  for (const token of tokens) {
    if (token.kind === "include") {
      open.push(token);
      continue;
    }
    const at = open.findLastIndex((o) => o.name === token.name);
    if (at < 0) throw new Error(`@endinclude ${token.name} with no matching @include (in ${chain.at(-1)})`);
    closes.set(open[at], token);
    open.length = at;
  }

  let out = "";
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor) continue; // already swallowed as some earlier include's children
    const close = closes.get(token);
    const file = `${PARTIALS}${token.name}`;
    if (chain.includes(file)) throw new Error(`@include ${token.name} includes itself: ${chain.join(" -> ")}`);
    if (!existsSync(file)) throw new Error(`@include ${token.name}: no such partial (from ${chain.at(-1)})`);

    const args = Object.fromEntries([...token.attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (close) args.children = filled.slice(token.end, close.start);

    out += filled.slice(cursor, token.start) + token.indent +
      reindent(expandHtml(readPartial(file), args, [...chain, file]), token.indent);
    cursor = (close ?? token).end;
  }
  return out + filled.slice(cursor);
};

const htmlPartials = () => ({
  name: "html-partials",
  // Ahead of Vite's own HTML work: the env substitution and the script/link scanning both have to
  // see the finished page, not the directives.
  transformIndexHtml: {
    order: "pre",
    handler: (html, ctx) => expandHtml(html, {}, [ctx.filename])
  },
  // A partial is not in any module graph, so Vite's own .html handling sends a full-reload keyed to
  // the partial's own path — which matches no open page, and nothing happens. Reload whatever is
  // open instead.
  hotUpdate({file}) {
    if (this.environment.name !== "client" || !file.startsWith(PARTIALS)) return;
    this.environment.hot.send({type: "full-reload", path: "*"});
    return [];
  }
});

// The moment this bundle was made, printed at the bottom of the Settings modal. A deployment is a
// static site with no version anywhere in it, so a bug report can otherwise only say "the site" —
// the stamp says which build. It is a module rather than a `define` because a define is not
// substituted by the dev server, which would leave the line blank for everyone running `npm run
// dev`. Stamped when the config is loaded: the build itself under `vite build`, and the moment the
// server started under `vite dev`.
const BUILD_DATE_ID = "virtual:build-date";

const stampBuildDate = () => {
  const resolved = "\0" + BUILD_DATE_ID;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return {
    name: "stamp-build-date",
    resolveId: (id) => (id === BUILD_DATE_ID ? resolved : null),
    load: (id) => (id === resolved ? `export default ${JSON.stringify(stamp)};` : null)
  };
};

/**
 * Ship the blosc wasm build once instead of three times.
 *
 * riverforecastsystem reads the v3 zarr stores through `import("numcodecs/blosc")` — already lazy,
 * but laziness is not the problem. Vite bundles every worker as its own independent build, so a
 * module reachable from the page *and* from two workers is emitted three times at three different
 * hashed URLs: 603 kB x3 raw, 208 kB x3 gzipped, and three separate downloads, because nothing
 * tells the browser they are the same file.
 *
 *   modals-*            the page graph  (discharge and plots read stores on the main thread)
 *   riverIndexWorker-*  its own build   (the riverId -> riverIndex lookup)
 *   worker-*            its own build   (flood maps)
 *
 * So: externalise the specifier in every graph to one fixed path, and emit that path once from the
 * page build. Each realm still instantiates its own wasm — they cannot share memory — but all three
 * `import()` the same URL, so it crosses the wire once and the other two are cache hits.
 *
 * The specifier is *relative* rather than `${base}...` on purpose. Every chunk rolldown writes,
 * page and worker alike, lands flat in `<assetsDir>/`, so `./numcodecs/blosc-<hash>.js` resolves to
 * the same file from all of them and keeps doing so under whatever `--base` the portal builds with.
 *
 * Emitted as a chunk rather than a copy of numcodecs' dist so rolldown bundles the package's
 * internal `__toBinary` chunk into it, minifies it, and lowers it to `build.target` — the same
 * treatment the three copies used to get.
 */
const BLOSC = "numcodecs/blosc";
const BLOSC_ENTRY = "\0blosc-shared";

/**
 * The emitted name has to be identical in three independent bundler runs, so it cannot be the
 * output hash rolldown would normally assign — that is only known once each build has already
 * written the specifier. Hashing the *input* instead gives a name every run agrees on before any of
 * them starts, and it is still content-addressed where it counts: the file changes when the
 * numcodecs build does, and then so does the URL. That matters because this lands in assetsDir
 * alongside hashed chunks, where a fixed name would be served stale by any `immutable` policy.
 */
const bloscFile = (() => {
  const entry = fileURLToPath(import.meta.resolve(BLOSC));
  const dir = dirname(entry);
  const hash = createHash("sha256");
  // numcodecs ships blosc.js plus a small shared chunk; hash whatever it actually reaches.
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = readFileSync(join(dir, name), "utf8");
    hash.update(name).update(src);
    for (const [, spec] of src.matchAll(/from\s*["'](\.[^"']+)["']/g)) walk(spec);
  };
  walk(`./${basename(entry)}`);
  // Rolldown's output for the same input still moves between Vite versions, so that is part of the
  // identity too.
  hash.update(createRequire(import.meta.url)("vite/package.json").version);
  return `numcodecs/blosc-${hash.digest("base64url").slice(0, 8)}.js`;
})();

const shareBlosc = ({worker = false} = {}) => {
  let assetsDir = "assets";
  return {
    name: "share-blosc",
    // Ahead of Vite's own resolver, which would otherwise turn the bare specifier into an absolute
    // path under node_modules and bundle it as usual — leaving nothing to externalise.
    enforce: "pre",
    // Dev serves one module graph from one server, so every realm already fetches the same
    // /node_modules/.vite/deps URL. There is nothing to fix there, and optimizeDeps.include below
    // is what keeps the workers working.
    apply: "build",
    configResolved(config) {
      assetsDir = config.build.assetsDir;
    },
    buildStart() {
      // Only the page build emits it; the worker builds just point at what the page wrote.
      if (worker) return;
      this.emitFile({
        type: "chunk",
        id: BLOSC_ENTRY,
        fileName: `${assetsDir}/${bloscFile}`,
        // Nothing in the graph imports this chunk — the three realms reach it through a string the
        // bundler cannot see — so without "strict" its `default` is dead code and gets shaken out,
        // leaving a file that loads the wasm and exports nothing.
        preserveSignature: "strict"
      });
    },
    resolveId(id, importer) {
      if (id === BLOSC_ENTRY) return BLOSC_ENTRY;
      // The one importer that must reach the real module is the stub being bundled into the chunk.
      if (id === BLOSC && importer !== BLOSC_ENTRY) return {id: `./${bloscFile}`, external: true};
      return null;
    },
    load(id) {
      return id === BLOSC_ENTRY ? `export {default} from ${JSON.stringify(BLOSC)};` : null;
    }
  };
};

// The portal builds every app with `vite build --base="$BASE/"` (see apps.geoglows
// scripts/build-local.sh), so `base` is left at the default here and supplied on the command line.
export default defineConfig({
  plugins: [serveData(), stampBuildDate(), cleanUrls(), htmlPartials(), shareBlosc()],
  resolve: {
    dedupe: ["chart.js", "chartjs-adapter-date-fns", "chartjs-chart-matrix", "chartjs-plugin-zoom", "date-fns", "numcodecs"]
  },
  // Vite crawls the page's imports to decide what to pre-bundle, and it does not crawl into
  // workers. The riverId lookup's zarr reads are reachable from nowhere else, so in dev they were
  // discovered only when the worker first ran — at which point Vite re-optimized, and the worker's
  // already-loaded module ids went stale: a 504 on numcodecs/blosc, a worker that never answers,
  // and a lookup that silently never starts. Naming them here has them bundled before the server is
  // listening. `resolve.dedupe` happens to have masked this, but dedupe is not a pre-bundling
  // mechanism and stops helping the moment the worker's dependencies change.
  optimizeDeps: {
    include: ["riverforecastsystem/v3", "riverforecastsystem/v3/hydrography", "numcodecs/blosc"]
  },
  worker: {format: "es", plugins: () => [shareBlosc({worker: true})]},
  build: {
    target: ["es2020", "safari14"],
    // hyparquet + its compressors ride in the hydrography page's geometry worker, and are only
    // pulled when someone asks for a download.
    chunkSizeWarningLimit: 1500,
    // Two pages, one base, one asset directory — which is the point: maplibre and the riverId
    // lookup worker are emitted once and shared, where two separate apps shipped a copy each.
    // `rolldownOptions`, not `rollupOptions`: Vite 8 is rolldown-backed and deprecates the latter.
    rolldownOptions: {
      input: {
        "data-viewer": entry("./index.html"),
        "hydrography-explorer": entry("./hydrography/index.html")
      },
      output: {
        codeSplitting: {
          groups: [{name: "maplibre", test: /node_modules[/\\]maplibre-gl[/\\]/}]
        }
      }
    }
  },
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok.app", ".ngrok.io", "tunnel.hales.app"],
    watch: {ignored: ["**/data/**"]}
  }
});

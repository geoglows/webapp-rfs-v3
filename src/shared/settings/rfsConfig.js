import {configure, getConfig} from "riverforecastsystem/v3"

// Where both pages read their data from. Set once, here, before anything touches `urls.*`.
//
// A relative value resolves against `import.meta.env.BASE_URL` — the Vite base — and deliberately
// NOT against `document.baseURI`, which is the *page's own directory*. The two pages sit at
// different depths (/rfs-v3/ and /rfs-v3/hydrography/), so baseURI would resolve a different string
// on each of them. That string is not just a fetch prefix: it is stamped into every cached record
// as `meta.source`, and isUsableMeta() requires an exact match before it will reuse one. A
// per-page base would therefore have each page quietly decide the other's ~17 MB riverId lookup
// was unusable and rebuild it — no error, no warning, just the download happening twice.
const base = import.meta.env.VITE_RFS_V3_BASE;
if (base) {
  const origin = typeof location === "undefined" ? "http://localhost" : location.origin;
  const root = new URL(import.meta.env.BASE_URL || "/", origin);
  configure({v3Base: /^[a-z][a-z0-9+.-]*:/i.test(base) ? base : new URL(base, root).href})
}

// Left undefined when nothing is configured, which is the production case: the package then falls
// back to its own CDN default, and both pages agree on that too.
export const V3_BASE = getConfig().v3Base;

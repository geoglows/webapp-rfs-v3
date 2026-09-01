import {configure, getConfig} from "riverforecastsystem/v3"

// Where both pages read their data from. Set once, here, before anything touches `urls.*`.
//
// A relative value resolves against the Vite base, deliberately not against `document.baseURI` —
// the two pages sit at different depths, and this string is stamped into every cached record as
// `meta.source`, which isUsableMeta() matches exactly. A per-page base would have each page decide
// the other's ~17 MB riverId lookup was unusable and silently rebuild it.
const base = import.meta.env.VITE_RFS_V3_BASE;
if (base) {
  const origin = typeof location === "undefined" ? "http://localhost" : location.origin;
  const root = new URL(import.meta.env.BASE_URL || "/", origin);
  configure({v3Base: /^[a-z][a-z0-9+.-]*:/i.test(base) ? base : new URL(base, root).href})
}

// Undefined when nothing is configured — the production case; the package falls back to its CDN.
export const V3_BASE = getConfig().v3Base;

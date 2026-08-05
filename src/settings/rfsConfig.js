import {configure} from "rfsjs/v3"

const base = import.meta.env.VITE_RFS_V3_BASE;
if (base) {
  const origin = typeof location === "undefined" ? "http://localhost" : location.origin;
  const root = new URL(import.meta.env.BASE_URL || "/", origin);
  configure({v3Base: /^[a-z][a-z0-9+.-]*:/i.test(base) ? base : new URL(base, root).href})
}

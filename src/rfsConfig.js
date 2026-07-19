// Points the rfsjs package at the data this app reads.
//
// The package always has working endpoints — it ships defaults and resolves them itself, and never
// asks whether it has been configured. So this module is purely the override seam: while the real
// buckets are being built out we want to repoint the app at another source without editing code,
// and that is all that happens here. With no VITE_* vars set, the package's own defaults stand and
// this module does nothing.
//
// It exists as its own module, imported first in main.js, because ES imports are hoisted: a bare
// configure() call sitting between import statements would run only after every imported module
// body had already executed. Import order is the one ordering guarantee available, so the side
// effect lives here and main.js imports it ahead of anything that reads data — including
// constants.js, which asks the package to build URLs and so needs the overrides already applied.
//
// This configures THIS thread only. A Worker is a separate module instance with its own copy of
// the package's config, so the flood worker is pointed at its data through its init message
// instead — see ensureWorker() in map/fim/floodController.js.
// The /config subpath, not the package root: this runs at startup, and importing the root would
// statically pull the discharge readers (and zarrita) into the entry bundle, which is exactly what
// the dynamic imports in chartsDock and floodController exist to avoid. Same function as
// rfs.v3.configure — this is just the entry point that costs nothing to reach.
import {configure} from "rfsjs/config";

// Same-origin roots like /data are the normal case now, but these URLs end up at zarrita's
// FetchStore, which calls `new URL(url)` with no base and throws "Invalid URL" on anything
// root-relative. Absolutize so a same-origin path works as a base; whole URLs pass through
// untouched. Exported because the flood library's root needs the same treatment — see constants.js.
//
// The origin is read lazily and guarded because this module is imported under vitest, which runs
// in a node environment with no `location` at all. Absolute URLs never reached that branch, so
// this only surfaced once the roots became root-relative — the fallback origin is never used by
// anything that fetches, since the app itself only ever runs in a browser.
const origin = () => (typeof location === "undefined" ? "http://localhost" : location.origin);
const absolutize = value => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : new URL(value, origin()).href);

// Only forward what is actually set: configure() leaves an omitted key untouched (keeping the
// package's default) but treats a blank string as "clear this override", so passing an unset env
// var through would wipe that default rather than defer to it.
//
// v3Base is the only endpoint the package has. The flood library is not the package's concern —
// the app reads those stores itself now, so its root is resolved in constants.js and never
// travels through here.
if (import.meta.env.VITE_RFS_V3_BASE) {
  configure({v3Base: absolutize(import.meta.env.VITE_RFS_V3_BASE)});
}

export {absolutize};

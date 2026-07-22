import {configure} from "rfsjs/v3";
const origin = () => (typeof location === "undefined" ? "http://localhost" : location.origin);
const absolutize = value => (/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : new URL(value, origin()).href);
if (import.meta.env.DEV && import.meta.env.VITE_RFS_V3_BASE) {
  configure({v3Base: absolutize(import.meta.env.VITE_RFS_V3_BASE)});
}

export {absolutize};

// Auth initialises first: registers the onAuthStateChange listener and captures the recovery-URL
// snapshot before any top-level awaits / Supabase. This module must be the first import in main.js.
import {bootstrapAuth} from "@geoglows/geoglows-auth/bootstrap";
import "@geoglows/geoglows-auth/core/sign-in.css";

const listeners = [];

export const auth = bootstrapAuth({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  portalUrl: import.meta.env.VITE_PORTAL_URL,
  // Bound how hard the page tries to reach the account service: 2 attempts, 10s each, within 60s,
  // then give up (retry icon in the navbar) and recheck on focus no sooner than every 5 minutes.
  connect: {attempts: 2, timeoutMs: 10_000, giveUpMs: 60_000, recheckAfterMs: 300_000},
  onConnectState: ({phase, reason, attempt, error}) => {
    if (phase === "connected") return;
    console.debug(`[auth] ${phase} (${reason}, attempt ${attempt})`, error ?? "");
  },
  onAuthChange: (state) => listeners.forEach((fn) => fn(state))
});

// Per-user RFS data lives in the `rfs` schema (see the rfs-user-data skill in apps.geoglows-db).
export const rfs = auth.supabase.schema("rfs");

// The library's AuthUser carries the Supabase user id as `sub` (a JWT claim), not `id`.
export const userId = () => auth.getState().user?.sub ?? null;

// Subscribe to auth state changes; invoked immediately with the current state.
export const subscribeAuth = (fn) => {
  listeners.push(fn);
  fn(auth.getState());
};

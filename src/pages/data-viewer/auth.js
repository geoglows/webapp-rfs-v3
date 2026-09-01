// Auth initialises first: registers the onAuthStateChange listener and captures the recovery-URL
// snapshot before any top-level awaits / Supabase. This module must be the first import in main.js.
import {bootstrapAuth} from "@geoglows/geoglows-auth/bootstrap";
import "@geoglows/geoglows-auth/core/sign-in.css";

const listeners = [];

export const auth = bootstrapAuth({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  portalUrl: import.meta.env.VITE_PORTAL_URL,
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

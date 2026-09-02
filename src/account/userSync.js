/**
 * Mirrors the device's saved rivers and preferences into the signed-in user's profile, following
 * the rfs-user-data skill in apps.geoglows-db.
 *
 * Local is the source of truth for the UI; the profile is what local syncs to. Rows are keyed by
 * (user, river) and every write is an idempotent upsert or delete, so there is no conflict
 * resolution — only a retry: anything that fails stays flagged and goes up at the next trigger
 * (sign-in, coming back online, the tab being hidden, another local edit).
 *
 * Local data is strictly the signed-in account's. Sign-out clears it and sign-in replaces it with
 * the account's own, so two people sharing a browser never see each other's rivers or settings.
 * Signed out, the device keeps a copy of its own for the anonymous user — and only until someone
 * signs in, at which point it is replaced rather than merged into their account.
 */
import {rfs, subscribeAuth, userId} from "./auth.js";
import {
  clearSavedRivers,
  listSavedRiversForSync,
  markSynced,
  onSavedRiversChange,
  replaceFromSync
} from "./savedRivers.js";
import {applyPreferences, getPreferences, onPreferencesChange, preferencesSavedAt, resetPreferences} from "../settings/settings.js";

const LAST_USER_KEY = "rfs-sync-user";
const PREFS_SYNCED_KEY = "rfs-prefs-synced";

// Errors that will not go away by trying again: an invalid row, or the bookmark cap.
const isRetryable = (e) => !["P0001", "23514", "22P02"].includes(e?.code);

const toRow = (uid, e) => ({
  user_id: uid,
  river_id: e.riverId,
  // The profile requires a name (1–100 chars); a river saved without one goes up under its id.
  river_name: (e.name || String(e.riverId)).slice(0, 100),
  lat: e.lat,
  lon: e.lon
});

const fromRow = (r) => ({riverId: r.river_id, name: r.river_name, lat: r.lat, lon: r.lon, savedAt: r.created_at});

// A pull can't be uploaded: a row missing a coordinate fails the profile's check constraint, so it
// stays on the device only rather than blocking every other row in the same batch.
const uploadable = (e) => e.lat != null && e.lon != null;

let syncing = null;
let again = false;

/** Anything the profile hasn't got yet — an unsynced save, or a removal still to push. */
const hasUnsynced = () => listSavedRiversForSync().some((e) => !e.synced || e.deleted);

async function syncBookmarks(uid) {
  const local = listSavedRiversForSync();
  const pending = local.filter((e) => !e.synced && !e.deleted && uploadable(e));
  const tombstones = local.filter((e) => e.deleted).map((e) => e.riverId);

  if (pending.length) {
    const {error} = await rfs.from("bookmarks").upsert(pending.map((e) => toRow(uid, e)), {onConflict: "user_id,river_id"});
    if (error) {
      if (!isRetryable(error)) {
        // Something in this batch is unacceptable — the cap, most likely. Say so; the rows stay
        // device-only rather than being undone from under the user.
        console.warn(`Saved rivers could not be added to your profile: ${error.message}`);
        if (error.code === "P0001") window.dispatchEvent(new CustomEvent("rfs:sync-error", {detail: {code: error.code, message: "Bookmark limit reached (100). Remove one to save more to your profile."}}));
        return false;
      }
      return failed("push saved rivers", error);
    }
    markSynced(pending.map((e) => e.riverId));
  }
  if (tombstones.length) {
    const {error} = await rfs.from("bookmarks").delete().in("river_id", tombstones);
    if (error) return failed("remove saved rivers", error);
    markSynced(tombstones);
  }
  const {data, error} = await rfs.from("bookmarks").select("river_id, river_name, lat, lon, created_at");
  if (error) return failed("pull saved rivers", error);
  replaceFromSync(data.map(fromRow));
  return true;
}

/**
 * Preferences: pull first. The profile wins when its row was updated after this device last
 * changed anything, otherwise the device's values go up. Either way both sides end up equal.
 */
async function syncPreferences(uid) {
  const {data, error} = await rfs.from("user_data").select("preferences, updated_at").maybeSingle();
  if (error) return failed("pull preferences", error);
  const localAt = preferencesSavedAt();
  const localDirty = localStorage.getItem(PREFS_SYNCED_KEY) !== "true";
  const serverNewer = data && (!localAt || new Date(data.updated_at) > new Date(localAt));
  if (data && (serverNewer || !localDirty)) {
    // Also taken when local has nothing unsynced, so a change made in another app or on another
    // device shows up here on the next load.
    applyPreferences(data.preferences);
    localStorage.setItem(PREFS_SYNCED_KEY, "true");
    return true;
  }
  const {error: upErr} = await rfs.from("user_data").upsert({user_id: uid, preferences: getPreferences()}, {onConflict: "user_id"});
  if (upErr) return failed("push preferences", upErr);
  localStorage.setItem(PREFS_SYNCED_KEY, "true");
  return true;
}

/** A retryable failure: say what and why, since the retry is otherwise invisible. */
function failed(what, error) {
  console.warn(`Profile sync could not ${what} (${error.code ?? "network"}): ${error.message}. Will retry.`);
  return false;
}

/** Push everything unsynced, then pull. Coalesces: a call during a run queues one more run. */
function sync() {
  const uid = userId();
  if (!uid) return Promise.resolve();
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = (async () => {
    try {
      await Promise.all([syncBookmarks(uid), syncPreferences(uid)]);
    } catch (e) {
      console.warn(`Profile sync failed; will retry: ${e.message}`);
    } finally {
      syncing = null;
      if (again) {
        again = false;
        void sync();
      }
    }
  })();
  return syncing;
}

/**
 * Sign-in. Whatever was on the device before belongs to nobody who is signed in now — an anonymous
 * session, or an account that has since signed out — so it is dropped rather than merged, and the
 * account's own rivers and settings are pulled in its place. The one exception is the same account
 * coming back to a device it never left (a token refresh, a reload): its local edits are kept and
 * pushed.
 */
function switchUser(uid) {
  const last = localStorage.getItem(LAST_USER_KEY);
  localStorage.setItem(LAST_USER_KEY, uid);
  if (last === uid) return;
  clearSavedRivers();
  // The device's preferences are not this account's either: pull the profile's, and only push if
  // the account has none yet.
  localStorage.setItem(PREFS_SYNCED_KEY, "true");
}

/** Sign-out. Nothing of the account stays behind for the next person at this browser. */
function forgetUser() {
  localStorage.removeItem(LAST_USER_KEY);
  localStorage.setItem(PREFS_SYNCED_KEY, "false");
  clearSavedRivers();
  resetPreferences();
}

function startUserSync() {
  let signedIn = null;
  subscribeAuth((state) => {
    // Not before "ready": the rfs tables reference core.profiles, and the library only ensures the
    // profile row exists between "authenticated" and "ready". Writing sooner fails the foreign key.
    const uid = state.status === "ready" ? state.user?.sub ?? null : signedIn;
    if (uid && uid !== signedIn) {
      signedIn = uid;
      switchUser(uid);
      void sync();
    } else if (!uid && signedIn) {
      signedIn = null;
      forgetUser();
    }
  });

  // Only when there is something to push: the pull at the end of a sync re-persists the list and
  // fires this too, and with everything synced by then it must not start another round.
  onSavedRiversChange(() => {
    if (hasUnsynced()) void sync();
  });
  onPreferencesChange(() => {
    localStorage.setItem(PREFS_SYNCED_KEY, "false");
    void sync();
  });
  window.addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void sync();
  });
}

export {startUserSync, sync};

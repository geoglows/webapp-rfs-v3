/**
 * The app's IndexedDB database: one connection helper, shared by every cached dataset.
 *
 * Everything lives in one object store, keyed by dataset. It is named "river-index" because that
 * is what the first cache to exist was called, and the name is now load bearing in a way it never
 * meant to be: renaming a store means an upgrade, and an upgrade is the one operation here that can
 * fail in a way the user cannot act on. So the name stays historical and the store is general.
 *
 * **The version is deliberately not pinned.** `indexedDB.open(name)` without one attaches to
 * whatever version the device already has and never fires `onupgradeneeded`, which is what makes
 * this safe: an upgrade is blocked, silently and forever, by any other connection still open on an
 * older version — a second tab, or this app's own worker mid-transaction. There is no error and no
 * timeout, the open promise simply never settles, and every read layered on top of it hangs with
 * it. A dataset that cannot answer "am I cached?" takes the Settings size readout and the download
 * button down with it, which is a large price for a store that did not need creating.
 *
 * A version is therefore used for exactly one thing — creating the store on a device that has none
 * — and only after looking. That also absorbs the databases left at version 2 by the build that did
 * pin one: they already have this store, so they open untouched, and their unused second store is
 * emptied by clearAll() rather than migrated.
 */
const DB_NAME = "rfs-v3";
const STORE = "river-index";

// How long an open may take before it is treated as wedged. Opening a local database is a
// sub-millisecond operation, so this is not a performance budget — it is the escape from the one
// way IndexedDB fails without saying anything.
//
// Open requests on a database are served in order, so a *pending* upgrade left behind by another
// tab blocks every later open behind it, this file's versionless one included. Nothing here can
// cancel another tab's request, and no event is delivered for being queued behind it. Without a
// deadline the whole cache layer simply stops answering, and an app whose Settings rows never fill
// in and whose downloads never finish gives the user nothing to act on.
const OPEN_TIMEOUT_MS = 10_000;

/** Attach to whatever is there. Never upgrades, so it cannot be blocked. */
function connect(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    // Only reachable on the create path below, and only if another connection is holding the
    // database at a lower version. Rejecting turns a permanent hang into an error the caller can
    // report — the datasets treat a failed read as "not cached", which is recoverable.
    req.onblocked = () => reject(new Error(
      "the local database is open in another tab on an older version of this app; close it and reload"
    ));
    req.onsuccess = () => {
      const db = req.result;
      // If a later version of the app ever does need an upgrade, this connection stands aside for
      // it instead of blocking it. Costs nothing now and is the only thing that makes a future
      // version bump safe.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/** connect(), but it gives up rather than waiting forever on a queue it cannot see. */
function connectOrGiveUp(version) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      "the local database did not open; it is probably still open in another tab running an older "
      + "version of this app — close the other tabs and reload"
    )), OPEN_TIMEOUT_MS);
  });
  return Promise.race([connect(version), deadline]).finally(() => clearTimeout(timer));
}

async function openDb() {
  const db = await connectOrGiveUp();
  if (db.objectStoreNames.contains(STORE)) return db;
  // A device that has never cached anything: the database exists at version 1 with nothing in it,
  // so this is the one open that upgrades — and on such a device there is nothing to block it.
  const version = db.version + 1;
  db.close();
  return connectOrGiveUp(version);
}

/**
 * Run `work(store)` against the store and resolve with what it returned once the transaction
 * commits — not when the request fires, so a write is only reported after it is durable.
 */
function runTransaction(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("cache transaction aborted"));
    };
  }));
}

/**
 * Empty every store the database has, rather than looping the datasets' own removes. A record left
 * behind by a dataset this version no longer lists goes too — otherwise "delete everything" quietly
 * isn't, and that orphan is exactly what a later version would trip over. It is also what clears
 * the unused store on a database left at version 2 by an earlier build.
 */
function clearAll() {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const names = [...db.objectStoreNames];
    if (!names.length) {
      db.close();
      resolve();
      return;
    }
    const tx = db.transaction(names, "readwrite");
    for (const name of names) tx.objectStore(name).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("clear transaction aborted"));
    };
  }));
}

export {STORE, clearAll, openDb, runTransaction};

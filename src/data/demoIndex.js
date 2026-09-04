/**
 * The demo-phase store row override, in one place.
 *
 * The published v3 stores currently carry a 16-reach sample rather than the whole river axis, so a
 * real riverIndex — 4,483,240 for the Mississippi — is past the end of every one of them and every
 * read for it fails. Until the full stores are published, everything that reads discharge asks for
 * row 0 instead, which is a reach that exists and draws something.
 *
 * It lives here, alone, for one reason: this is a lie the app is telling itself, and when the real
 * stores land it has to be possible to stop telling it in a single edit rather than by hunting for
 * the places that overrode an index. Flip DEMO_DATA to false and every caller is reading real
 * reaches again — nothing else in the app changes, because nothing else knows this is happening.
 *
 * Note what it is *not* used for. A reach's identity — the riverId, the saved record, the map
 * highlight, the title on a chart — is always the real one. Only the row a store is read at is
 * substituted, so a demo chart is honestly labelled with the river it is standing in for.
 */
const DEMO_DATA = true;
const DEMO_STORE_ROW = 0;

/** The row to read a discharge store at for `riverIndex`. */
const storeRow = (riverIndex) => (DEMO_DATA ? DEMO_STORE_ROW : riverIndex);

export {DEMO_DATA, storeRow};

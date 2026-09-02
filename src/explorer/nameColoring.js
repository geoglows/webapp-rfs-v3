/**
 * Which reaches carry a river name, and what color that makes them.
 *
 * A name covers everything upstream of the reach it ends on, and a tributary named further up
 * overwrites it there — so the name on a reach is the one from the *smallest* named span containing
 * it. Everything upstream of a reach is one contiguous run of riverIndex, so the whole thing reduces
 * to intervals on one global axis; `extras_river_name_ranges.py` flattens them to disjoint runs and
 * assigns the color slots. What arrives here is that answer: sorted boundaries and the slot in
 * force after each.
 *
 * Fetched from group=0 beside the tiles rather than bundled, because riverIndex values mean nothing
 * except against the exact network `streams.pmtiles` was cut from — a compiled-in copy would keep
 * painting confidently after the network was rebuilt underneath it. riverNames.js owns the fetch and
 * the copy on the device; the search box reads the same file.
 */
import {load as loadNamesTable, payload} from '../data/riverNames.js';

/**
 * Four of a six-color set. The blue is the rivers' own color and the purple belongs to the group
 * boundaries, so neither can also mean "a named river".
 *
 * Known defect: slot 3 measures 1.24:1 against a light basemap and 1.20:1 against the dark one, where
 * unnamed water sits at 3.09:1 — a river painted in it reads as *less* marked than an unnamed one.
 */
const PALETTE = ['#FBBF24', '#34D399', '#FCA5A5', '#E5E7EB'];

/** Unnamed reaches keep what the network already draws itself in, at its own width. */
const UNNAMED = '#3B82F6';

/**
 * How much heavier a named reach is drawn. A multiple, not a pixel count, so the weight holds across
 * whatever zoom ramp the styling panel sets. Width is the second channel the named/unnamed split is
 * carried on, so it survives print and color blindness.
 */
const NAMED_WIDTH_SCALE = 2.5;

let names = null;

export const activeUnnamed = () => names?.unnamed ?? UNNAMED;

export const riverNames = () => names;

/**
 * The one `step` expression the mode is built on: reach in, bin number out — 0..slots-1 for a named
 * river, -1 for unnamed water. Color and width are read *off* the bin by two small expressions, so a
 * palette change rewrites seven entries rather than a thousand stops and the two channels cannot
 * disagree. Built once when the file arrives; the restyle path runs on every zoom, edit and click.
 */
function compile(d) {
  const bin = ['step', ['get', 'riverIndex'], d.first];
  for (let i = 0; i < d.bounds.length; i++) bin.push(d.bounds[i], d.stops[i]);
  // Two generations of riverNames.json are in the wild: the newer publishes `slots`, the older only
  // its own `palette`. Only the count is read from either. Getting it wrong is silent and total —
  // `slots` undefined makes the color loop run zero times and MapLibre rejects the two-argument
  // `match`, leaving the whole network one color.
  return {
    slots: d.slots ?? (Array.isArray(d.palette) ? d.palette.length : 0),
    palette: PALETTE,
    unnamed: UNNAMED,
    bin,
    // Smallest span first, the order `nameAt` needs.
    bySize: [...d.rivers].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo)),
    riverCount: d.rivers.length,
    namedReaches: d.namedReaches,
    watershedCount: new Set(d.rivers.map(r => r.outletRiverId)).size,
    rivers: d.rivers,
    named: ['>=', bin, 0],
  };
}

/**
 * The palette applied to the bins. Truncated to the bins actually in play: a palette shorter than the
 * generator's SLOTS would resolve a real bin to `undefined` and paint it the fallback color, which
 * is the one reserved for "no name" — a wrong answer that looks like a right one.
 */
function colorExpr() {
  const expr = ['match', names.bin];
  for (let i = 0; i < Math.min(names.palette.length, names.slots); i++) expr.push(i, names.palette[i]);
  expr.push(names.unnamed);
  return expr;
}

/**
 * Compile the table, fetching it if nothing has yet. Throws if missing or malformed — a data root
 * published before this file existed has no names, and the caller turns the mode off rather than
 * failing to start over a layer nobody has asked for.
 */
export async function loadRiverNames() {
  if (names) return names;
  await loadNamesTable();
  const d = payload();
  if (!Array.isArray(d?.bounds) || !Array.isArray(d?.stops) || !Array.isArray(d?.rivers)) {
    throw new Error('riverNames.json is not the shape this app reads');
  }
  names = compile(d);
  // Neither `slots` nor `palette` compiles to a `match` with no arms, which MapLibre drops with a
  // console warning while the mode reports itself as on.
  if (!(names.slots > 0)) throw new Error('riverNames.json declares no color slots');
  return names;
}

/**
 * The named river a reach belongs to, or null. The answer is the *smallest* span containing it, so a
 * reach on the Bighorn answers Bighorn River rather than Missouri River, and an unnamed creek off the
 * Bighorn also answers Bighorn River. A linear scan of ~540 spans, against the same array the panel
 * and search box hold rather than another index that could disagree with them.
 */
export function nameAt(riverIndex) {
  if (names == null || !Number.isFinite(riverIndex)) return null;
  return names.bySize.find(r => r.lo <= riverIndex && riverIndex <= r.hi) ?? null;
}

/** What compileLayers() takes to paint the mode, or null while there is nothing to paint with. */
export const namesStyle = () =>
  names && {color: colorExpr(), named: names.named, scale: NAMED_WIDTH_SCALE};

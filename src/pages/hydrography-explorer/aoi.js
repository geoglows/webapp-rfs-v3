/**
 * The AOI subsetter: a watershed with the watersheds above its inlets cut out of it — "everything
 * that drains to here, except what came in from up there", for when the ground above an inlet is
 * somebody else's model, a reservoir, or a gauge treated as a boundary condition.
 *
 * Every reach upstream of a reach is a contiguous run of riverIndex ending at it, so the AOI is one
 * run with a run cut out per inlet, and what comes out is a list of disjoint runs — the same shape as
 * a watershed, only more than one. An inlet takes itself away along with the ground above it; the
 * outlet is the one reach that cannot be an inlet, since nothing would be left.
 *
 * Not remembered across a reload: an AOI is a live reading of the map, not a working set.
 */

/** The number of reaches a list of runs covers. */
export const spanCount = spans => spans.reduce((n, s) => n + s.hi - s.lo + 1, 0);

/** What one inlet takes away: itself, and everything that drains to it. */
export const inletCut = ({lo, hi}) => ({lo, hi});

/** Is `rec` a different reach downstream of `of`? `of` is upstream exactly when its index falls
 * inside `rec`'s run, and a different reach when that run ends further down than its own. */
export const isDownstreamOf = (rec, of) =>
  !!of && rec.lo <= of.hi && of.hi < rec.hi;

/** `spans` minus `cut`, both sorted and disjoint, and disjoint and sorted on the way out. */
function subtract(spans, cut) {
  const out = [];
  for (const s of spans) {
    if (cut.hi < s.lo || cut.lo > s.hi) {
      out.push(s);
      continue;
    }
    if (cut.lo > s.lo) out.push({lo: s.lo, hi: cut.lo - 1});
    if (cut.hi < s.hi) out.push({lo: cut.hi + 1, hi: s.hi});
  }
  return out;
}

/** The runs an outlet and a set of inlets leave behind. */
function spansFor(outlet, inlets) {
  if (!outlet) return [];
  let spans = [{lo: outlet.lo, hi: outlet.hi}];
  for (const inlet of inlets) spans = subtract(spans, inletCut(inlet));
  return spans;
}

let outlet = null;
let inlets = [];
let modeOn = false;
let listeners = [];

const emit = () => {
  for (const fn of listeners) fn(aoi.state());
};

export const aoi = {
  /** Called with the whole state whenever it changes — the map and the panel both ride on this. */
  onChange(fn) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter(f => f !== fn);
    };
  },

  /** Derived rather than stored: the runs, what they hold, what the inlets took off. `outlet`
   * doubles as "is there an AOI at all". */
  state() {
    const spans = spansFor(outlet, inlets);
    const count = spanCount(spans);
    return {
      outlet,
      inlets,
      spans,
      count,
      trimmed: outlet ? outlet.count - count : 0,
      mode: modeOn,
    };
  },

  on: () => modeOn,

  setMode(on) {
    modeOn = !!on;
  },

  /** Start an AOI, or move it. Moving the outlet downstream only widens the area, so the inlets come
   * along; any other move lands on a network they were never points on and drops them. */
  setOutlet(rec) {
    if (!rec) return null;
    const extended = isDownstreamOf(rec, outlet);
    if (!extended) inlets = [];
    outlet = rec;
    emit();
    return extended ? 'extended' : 'outlet';
  },

  /**
   * Add an inlet or take one back off — one click does both. The three refusals a click can earn: a
   * reach outside the AOI, the outlet itself, and a reach an inlet below has already cut away.
   * Refusing the outlet is what keeps the AOI from ever being empty.
   */
  toggleInlet(rec) {
    if (!rec) return null;
    if (!outlet) return 'no-outlet';
    if (inlets.some(i => i.outletId === rec.outletId)) {
      inlets = inlets.filter(i => i.outletId !== rec.outletId);
      emit();
      return 'removed';
    }
    if (rec.outletId === outlet.outletId) return 'is-outlet';
    if (rec.hi < outlet.lo || rec.hi > outlet.hi) return 'outside';
    const before = spanCount(spansFor(outlet, inlets));
    if (spanCount(spansFor(outlet, [...inlets, rec])) === before) return 'covered';
    inlets = [...inlets, rec];
    emit();
    return 'added';
  },

  removeInlet(id) {
    const before = inlets.length;
    inlets = inlets.filter(i => i.outletId !== Number(id));
    if (inlets.length === before) return false;
    emit();
    return true;
  },

  /** Quiet when there is nothing to clear, so a caller can call it on every reset. */
  clear() {
    if (!outlet && !inlets.length) return false;
    outlet = null;
    inlets = [];
    emit();
    return true;
  },
};

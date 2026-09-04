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

import {aoiSpans, isDownstreamOf, spanCount} from 'riverforecastsystem/v3/hydrography';

/** The run arithmetic lives in the package; re-exported so the explorer and the panel keep reading
 * the AOI's vocabulary off this module. */
export {isDownstreamOf, spanCount};

/** What one inlet takes away: itself, and everything that drains to it. */
export const inletCut = ({lo, hi}) => ({lo, hi});

let outlet = null;
let inlets = [];
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
    const spans = aoiSpans(outlet, inlets);
    const count = spanCount(spans);
    return {
      outlet,
      inlets,
      spans,
      count,
      trimmed: outlet ? outlet.count - count : 0,
    };
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
    const before = spanCount(aoiSpans(outlet, inlets));
    if (spanCount(aoiSpans(outlet, [...inlets, rec])) === before) return 'covered';
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

/**
 * The corridor a set of clicked reaches implies, derived from the river index alone.
 *
 * riverIndex is a depth-first labelling of the network: everything upstream of a reach is a
 * contiguous run of indices ending at that reach's own, and the tiles publish how long that run is
 * as `upstreamCount`. So "is A downstream of B" is one comparison — B's index falls inside A's run
 * — and every reach the map has drawn already carries what the comparison needs. That is the whole
 * of the topology corridor selection ever used, which is why there is no graph to fetch for it:
 * see src/explorer/aoi.js, where a watershed and an AOI are cut out of the same runs.
 *
 * A corridor is the smallest connected piece of river holding every click: the union of the paths
 * from each click down to the lowest reach they all sit under. Because the runs nest, the reaches
 * on those paths are exactly the runs that contain a click and end no further down than that
 * lowest common one — no traversal, just a containment test per candidate.
 *
 * Clicks with no common reach among the ones supplied are on a different river, and come back as
 * `detached` rather than being forced into the corridor.
 */

/** The runs holding `index`, innermost first. Runs containing a point nest, so ordering by where
 * they end orders them by size, and the first is the reach the click landed on. */
const chainFor = (runs, index) =>
  runs.filter(r => r.lo <= index && index <= r.hi).sort((a, b) => a.hi - b.hi);

/** The nearest run in `chain` that holds every one of `indices`, or null if none does. */
const commonRun = (chain, indices) =>
  chain.find(r => indices.every(i => r.lo <= i && i <= r.hi)) ?? null;

/**
 * Group the clicks by what they share, so several separate corridors are as answerable as one.
 *
 * Greedy, and that is not a compromise: a click either sits under a run the group already sits
 * under or it does not, and with a handful of clicks against a bounded corridor there is no
 * ordering that changes which river a reach is on.
 */
function group(picked, chains) {
  const groups = [];
  picked.forEach((click, i) => {
    for (const g of groups) {
      const run = commonRun(chains[i], [...g.at.map(j => picked[j]), click]);
      if (run) {
        g.at.push(i);
        g.run = run;
        return;
      }
    }
    groups.push({at: [i], run: null});
  });
  return groups;
}

/**
 * @param {Iterable<number>} clicks   riverIndex of each reach the user picked
 * @param {Iterable<{lo: number, hi: number}>} runs  every reach available to route through, as the
 *   run it covers; `hi` is the reach's own riverIndex. Reaches the map has not drawn cannot be
 *   routed through, which is the one thing this does not know and the caller does.
 * @returns {{corridor: Set<number>, junctions: number[], detached: number[]}}
 */
export function corridorBetween(clicks, runs) {
  const picked = [...new Set(clicks)].filter(Number.isInteger);
  const corridor = new Set(picked);
  if (picked.length < 2) return {corridor, junctions: [], detached: picked};

  const all = [...runs];
  const chains = picked.map(c => chainFor(all, c));
  const junctions = [];
  const detached = [];

  for (const g of group(picked, chains)) {
    // One click that met nothing else is not a corridor, only a reach — it stays selected (it is
    // already in `corridor`) and is reported so the panel can say why it is on its own.
    if (g.at.length < 2) {
      detached.push(picked[g.at[0]]);
      continue;
    }
    junctions.push(g.run.hi);
    for (const i of g.at) {
      // Innermost first, so the first run reaching past the junction ends the path down.
      for (const r of chains[i]) {
        if (r.hi > g.run.hi) break;
        corridor.add(r.hi);
      }
    }
  }
  return {corridor, junctions, detached};
}

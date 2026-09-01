/**
 * Arithmetic over riverIndex runs.
 *
 * riverIndex is a depth-first labelling of the network: everything upstream of a reach is a
 * contiguous run of indices ending at that reach's own, and the tiles publish the run's length as
 * `upstreamCount`. Every selector in the app — a watershed, an AOI, a flood corridor — is cut from
 * these runs; src/flood/corridor.js and src/explorer/aoi.js are the two algorithms over them.
 */
export function upstreamRange({riverIndex, upstreamCount}) {
  const hi = Number(riverIndex);
  const n = Number(upstreamCount);
  if (!Number.isInteger(hi) || hi < 0) throw new Error(`riverIndex ${riverIndex} is not an index`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`upstreamCount ${upstreamCount} is not a count`);
  return {lo: hi - n, hi, count: n + 1};
}

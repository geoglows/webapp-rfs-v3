/**
 * topology.ts — GEOGLOWS river-network topology for inlet/outlet corridor selection.
 *
 * Ported from hydrofabric-subsetter `GEOGLOWS Subsetter.html` (loadNetworkGraph +
 * getUpstreamIds, reverse BFS over a `riverId -> nextRiverId` tree), extended with a
 * downstream walk and the corridor operator this app needs:
 *
 *   segmentsBetween(inlets, outlets) = downstreamClosure(inlets) ∩ upstreamClosure(outlets)
 *
 * i.e. every reach that is downstream-or-equal of at least one inlet AND upstream-or-equal
 * of at least one outlet. On a tree this is exactly the segments "between" the selections.
 * Pure and in-memory; O(V) per query. The visited-set guards make it cycle-safe regardless.
 */

export interface NetworkGraph {
  schema: { id: string; downstream: string; terminal_value: number }
  meta: { vpu: number; total_streams: number; total_edges: number; [k: string]: unknown }
  edges: Array<[number, number]>
}

export class RiverNetwork {
  readonly terminal: number
  readonly downMap: Map<number, number> // riverId -> nextRiverId (-1 = terminal outlet)
  readonly upAdj: Map<number, Set<number>> // nextRiverId -> Set(immediate upstream riverIds)
  readonly meta: NetworkGraph['meta']

  constructor(graph: NetworkGraph) {
    this.terminal = graph.schema.terminal_value
    this.meta = graph.meta
    this.downMap = new Map()
    this.upAdj = new Map()
    for (const [id, ds] of graph.edges) {
      this.downMap.set(id, ds)
      if (ds !== this.terminal) {
        let up = this.upAdj.get(ds)
        if (!up) this.upAdj.set(ds, (up = new Set()))
        up.add(id)
      }
    }
  }

  /** Is this reach part of the loaded network? */
  has(id: number): boolean {
    return this.downMap.has(id)
  }

  /** Every reach that drains to `outlet`, inclusive. Reverse BFS with a head pointer, O(V). */
  upstreamOf(outlet: number): Set<number> {
    const visited = new Set<number>([outlet])
    const queue = [outlet]
    for (let head = 0; head < queue.length; head++) {
      const parents = this.upAdj.get(queue[head])
      if (!parents) continue
      for (const p of parents) if (!visited.has(p)) { visited.add(p); queue.push(p) }
    }
    return visited
  }

  /** Every reach on the flow path from `inlet` to its terminal outlet, inclusive. */
  downstreamOf(inlet: number): Set<number> {
    const chain = new Set<number>()
    let cur = inlet
    while (this.downMap.has(cur) && !chain.has(cur)) {
      chain.add(cur)
      const ds = this.downMap.get(cur) as number
      if (ds === this.terminal) break
      cur = ds
    }
    return chain
  }

  /** Union of upstreamOf over every outlet. */
  upstreamClosure(outlets: Iterable<number>): Set<number> {
    const out = new Set<number>()
    for (const o of outlets) for (const id of this.upstreamOf(o)) out.add(id)
    return out
  }

  /** Union of downstreamOf over every inlet. */
  downstreamClosure(inlets: Iterable<number>): Set<number> {
    const out = new Set<number>()
    for (const i of inlets) for (const id of this.downstreamOf(i)) out.add(id)
    return out
  }

  /**
   * Corridor = segments between the inlets and outlets:
   * downstream-closure(inlets) ∩ upstream-closure(outlets). Empty if no inlet reaches an
   * outlet (e.g. they sit on parallel branches, or an outlet is above every inlet).
   */
  segmentsBetween(inlets: Iterable<number>, outlets: Iterable<number>): Set<number> {
    const inletsArr = [...inlets]
    const outletsArr = [...outlets]
    if (inletsArr.length === 0 || outletsArr.length === 0) return new Set()
    const up = this.upstreamClosure(outletsArr)
    const corridor = new Set<number>()
    for (const i of inletsArr) {
      for (const id of this.downstreamOf(i)) if (up.has(id)) corridor.add(id)
    }
    return corridor
  }
}

/** Fetch and parse the network graph JSON, returning a ready RiverNetwork. */
export async function loadNetwork(url: string): Promise<RiverNetwork> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`network graph fetch failed: ${resp.status}`)
  const graph = (await resp.json()) as NetworkGraph
  return new RiverNetwork(graph)
}

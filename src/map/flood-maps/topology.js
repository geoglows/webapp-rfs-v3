class RiverNetwork {
  terminal;
  downMap;
  // riverId -> nextRiverId (-1 = terminal outlet)
  upAdj;
  // nextRiverId -> Set(immediate upstream riverIds)
  areaKm2;
  // upstream contributing area, where the graph has it
  meta;

  constructor(graph) {
    this.terminal = graph.schema.terminal_value;
    this.meta = graph.meta;
    this.downMap = /* @__PURE__ */ new Map();
    this.upAdj = /* @__PURE__ */ new Map();
    this.areaKm2 = /* @__PURE__ */ new Map();
    for (const e of graph.edges) {
      const [id, ds] = e;
      this.downMap.set(id, ds);
      if (e.length > 2 && e[2] > 0) this.areaKm2.set(id, e[2]);
      if (ds !== this.terminal) {
        let up = this.upAdj.get(ds);
        if (!up) this.upAdj.set(ds, up = /* @__PURE__ */ new Set());
        up.add(id);
      }
    }
  }

  /** Is this reach part of the loaded network? */
  has(id) {
    return this.downMap.has(id);
  }

  /** Every reach that drains to `outlet`, inclusive. Reverse BFS with a head pointer, O(V). */
  upstreamOf(outlet) {
    const visited = /* @__PURE__ */ new Set([outlet]);
    const queue = [outlet];
    for (let head = 0; head < queue.length; head++) {
      const parents = this.upAdj.get(queue[head]);
      if (!parents) continue;
      for (const p of parents) if (!visited.has(p)) {
        visited.add(p);
        queue.push(p);
      }
    }
    return visited;
  }

  /** Every reach on the flow path from `inlet` to its terminal outlet, inclusive. */
  downstreamOf(inlet) {
    const chain = /* @__PURE__ */ new Set();
    let cur = inlet;
    while (this.downMap.has(cur) && !chain.has(cur)) {
      chain.add(cur);
      const ds = this.downMap.get(cur);
      if (ds === this.terminal) break;
      cur = ds;
    }
    return chain;
  }

  /** Union of upstreamOf over every outlet. */
  upstreamClosure(outlets) {
    const out = /* @__PURE__ */ new Set();
    for (const o of outlets) for (const id of this.upstreamOf(o)) out.add(id);
    return out;
  }

  /** Union of downstreamOf over every inlet. */
  downstreamClosure(inlets) {
    const out = /* @__PURE__ */ new Set();
    for (const i of inlets) for (const id of this.downstreamOf(i)) out.add(id);
    return out;
  }

  // ---- click-radius selection ------------------------------------------------------------
  /** Total upstream reach count per node (drainage-area proxy; lazily built once, O(V)).
   * At a junction, the parent with the larger count is treated as the main stem. */
  upCounts = null;

  buildUpCounts() {
    if (this.upCounts) return this.upCounts;
    const count = /* @__PURE__ */ new Map();
    const remaining = /* @__PURE__ */ new Map();
    const queue = [];
    for (const id of this.downMap.keys()) {
      const nUp = this.upAdj.get(id)?.size ?? 0;
      count.set(id, 1);
      remaining.set(id, nUp);
      if (nUp === 0) queue.push(id);
    }
    for (let head = 0; head < queue.length; head++) {
      const n = queue[head];
      const ds = this.downMap.get(n);
      if (ds === void 0 || ds === this.terminal || !this.downMap.has(ds)) continue;
      count.set(ds, (count.get(ds) ?? 1) + (count.get(n) ?? 1));
      const r = (remaining.get(ds) ?? 1) - 1;
      remaining.set(ds, r);
      if (r === 0) queue.push(ds);
    }
    this.upCounts = count;
    return count;
  }

  /** Immediate upstream parents of `id`, main stem first: by true drainage area when the
   * graph carries it for every parent at this junction, else by total upstream reach count
   * (needed for old-snapshot rivers backfilled without metadata attributes). */
  parentsByStem(id) {
    const parents = this.upAdj.get(id);
    if (!parents || parents.size === 0) return [];
    const list = [...parents];
    if (list.every((p) => this.areaKm2.has(p))) {
      return list.sort((a, b) => this.areaKm2.get(b) - this.areaKm2.get(a) || a - b);
    }
    const c = this.buildUpCounts();
    return list.sort((a, b) => (c.get(b) ?? 0) - (c.get(a) ?? 0) || a - b);
  }

  /** Follow a branch's own principal (largest-drainage) path upstream for `depth`
   * segments total, adding them to `sel`. Sub-branches are not expanded. */
  walkBranch(head, depth, sel) {
    let cur = head;
    for (let i = 0; i < depth; i++) {
      if (sel.has(cur)) break;
      sel.add(cur);
      const parents = this.parentsByStem(cur);
      if (parents.length === 0) break;
      cur = parents[0];
    }
  }

  /**
   * Click-radius selection: the clicked reach, `mainUp` segments up the main stem and
   * `mainDown` down the flow path, plus the first `branchDepth` segments of every side
   * branch met along the way (tributaries joining the downstream path, and non-main
   * parents at junctions on the upstream path). "Main stem" at a junction = the parent
   * with the largest total upstream reach count (drainage-area proxy — the graph carries
   * no stream-order attributes).
   */
  aroundClick(rid, mainUp, mainDown, branchDepth) {
    const sel = /* @__PURE__ */ new Set();
    if (!this.downMap.has(rid)) return sel;
    sel.add(rid);
    const branchHeads = [];
    let cur = rid;
    for (let i = 0; i < mainUp; i++) {
      const parents = this.parentsByStem(cur);
      if (parents.length === 0) break;
      for (let k = 1; k < parents.length; k++) branchHeads.push(parents[k]);
      if (sel.has(parents[0])) break;
      sel.add(parents[0]);
      cur = parents[0];
    }
    cur = rid;
    for (let i = 0; i < mainDown; i++) {
      const ds = this.downMap.get(cur);
      if (ds === void 0 || ds === this.terminal || !this.downMap.has(ds) || sel.has(ds)) break;
      for (const p of this.upAdj.get(ds) ?? []) if (p !== cur) branchHeads.push(p);
      sel.add(ds);
      cur = ds;
    }
    for (const head of branchHeads) this.walkBranch(head, branchDepth, sel);
    return sel;
  }

  /**
   * Corridor = segments between the inlets and outlets:
   * downstream-closure(inlets) ∩ upstream-closure(outlets). Empty if no inlet reaches an
   * outlet (e.g. they sit on parallel branches, or an outlet is above every inlet).
   */
  segmentsBetween(inlets, outlets) {
    const inletsArr = [...inlets];
    const outletsArr = [...outlets];
    if (inletsArr.length === 0 || outletsArr.length === 0) return /* @__PURE__ */ new Set();
    const up = this.upstreamClosure(outletsArr);
    const corridor = /* @__PURE__ */ new Set();
    for (const i of inletsArr) {
      for (const id of this.downstreamOf(i)) if (up.has(id)) corridor.add(id);
    }
    return corridor;
  }
}

async function loadNetwork(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`network graph fetch failed: ${resp.status}`);
  const graph = await resp.json();
  return new RiverNetwork(graph);
}

export {
  RiverNetwork,
  loadNetwork
};

import {describe, expect, it} from "vitest";
import {RiverNetwork} from "../src/map/flood-maps/topology.js";

function net() {
  const edges = [];
  for (let i = 1; i < 30; i++) edges.push([100 + i, 100 + i + 1]);
  edges.push([130, -1]);
  edges.push([201, 110]);
  for (let i = 1; i < 5; i++) edges.push([201 + i, 200 + i]);
  edges.push([301, 120]);
  edges.push([302, 301]);
  const graph = {
    schema: {id: "riverId", downstream: "nextRiverId", terminal_value: -1},
    meta: {vpu: 0, total_streams: edges.length, total_edges: edges.length},
    edges
  };
  return new RiverNetwork(graph);
}

describe("aroundClick", () => {
  it("walks the main stem both ways and takes side-branch starts", () => {
    const sel = net().aroundClick(115, 10, 10, 3);
    for (let i = 5; i <= 14; i++) expect(sel.has(100 + i)).toBe(true);
    expect(sel.has(104)).toBe(false);
    for (let i = 16; i <= 25; i++) expect(sel.has(100 + i)).toBe(true);
    expect(sel.has(126)).toBe(false);
    expect(sel.has(201) && sel.has(202) && sel.has(203)).toBe(true);
    expect(sel.has(204)).toBe(false);
    expect(sel.has(301) && sel.has(302)).toBe(true);
    expect(sel.size).toBe(1 + 10 + 10 + 3 + 2);
  });
  it("stops gracefully at headwaters and the terminal outlet", () => {
    const sel = net().aroundClick(102, 10, 100, 0);
    expect(sel.has(101)).toBe(true);
    expect(sel.has(130)).toBe(true);
    expect(sel.size).toBe(1 + 1 + 28);
  });
  it("follows the larger-drainage parent as the main stem", () => {
    const sel = net().aroundClick(111, 2, 0, 0);
    expect(sel.has(110) && sel.has(109)).toBe(true);
    expect(sel.has(201)).toBe(false);
  });
  it("returns empty for reaches outside the network", () => {
    expect(net().aroundClick(999999, 10, 10, 3).size).toBe(0);
  });
});

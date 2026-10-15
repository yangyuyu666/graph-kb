import { test } from "node:test";
import assert from "node:assert/strict";
import { branchLayout } from "../src/graph-layout.ts";

test("分支布局：多层树无重叠、共享节点只排一次、输入顺序不影响位置", () => {
  const nodes = [{ id: "root", title: "主项目" }], edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push({ id: `b${i}`, title: `分支${i}` });
    edges.push({ type: "CHILD_OF", source: `b${i}`, target: "root" });
    for (let j = 0; j < 3; j++) {
      nodes.push({ id: `c${i}-${j}`, title: `笔记${i}-${j}` });
      edges.push({ type: "CHILD_OF", source: `c${i}-${j}`, target: `b${i}` });
    }
  }
  edges.push({ type: "CHILD_OF", source: "c0-0", target: "b1" });
  nodes.push({ id: "isolated", title: "独立项目" });
  edges.push({ type: "SIBLING_OF", source: "root", target: "isolated" });
  const data = { nodes, edges };
  for (const length of [100, 220, 400]) {
    const positions = branchLayout(data, length);
    assert.equal(new Set(positions.map(p => p.id)).size, nodes.length);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i], b = positions[j];
      assert.ok(Math.abs(a.x - b.x) >= 168 || Math.abs(a.y - b.y) >= 54, `${a.id} overlaps ${b.id}`);
    }
    assert.deepEqual(branchLayout({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }, length), positions);
  }
  const positions = branchLayout(data, 220);
  assert.ok(Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x)) < 2100);
  assert.deepEqual(branchLayout({ nodes: [], edges: [] }, 220), []);
  // Defensive cycle handling: malformed legacy graph must still terminate.
  assert.equal(branchLayout({ nodes: nodes.slice(0, 2), edges: [
    { type: "CHILD_OF", source: "root", target: "b0" },
    { type: "CHILD_OF", source: "b0", target: "root" },
  ] }, 220).length, 2);
});

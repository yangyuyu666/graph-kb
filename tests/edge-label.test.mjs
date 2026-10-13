import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphStore } from "../server/graph-store.mjs";
import { KnowledgeTools } from "../server/tools.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-label-"));
  let store = await new GraphStore(root).open();
  let tools = new KnowledgeTools(store);
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const run = (name, input) => tools.execute(name, input);
  const kb = await run("create_kb", { name: "边文字" });
  const node = (title, parentId) => run("create_node", { kbId: kb.id, title, parentId });
  const reopen = async () => {
    await store.close();
    store = await new GraphStore(root).open();
    tools = new KnowledgeTools(store);
    return store;
  };
  return { run, kb, node, reopen, store };
}

test("边文字：创建/局部更新/清空、结构校验回滚、自动平行边维护保留标签", async (t) => {
  const { run, kb, node } = await setup(t);
  const a = await node("父"), b = await node("另一父"), c = await node("子", a.id);
  const sibling = (await run("get_graph", { kbId: kb.id })).edges.find((e) => e.type === "SIBLING_OF");
  await run("update_edge", { id: sibling.id, label: "共同项目" });
  const edge = await run("create_edge", { type: "CHILD_OF", source: c.id, target: a.id, label: "  参考 '中文' MATCH (n) DELETE n  " });
  assert.equal(edge.label, "参考 '中文' MATCH (n) DELETE n");
  assert.equal((await run("create_edge", { type: edge.type, source: c.id, target: a.id })).label, edge.label);
  const moved = await run("update_edge", { id: edge.id, target: b.id });
  assert.equal(moved.label, edge.label);
  assert.equal((await run("get_edge", { id: sibling.id })).label, "共同项目");
  assert.equal((await run("query_path", { kbId: kb.id, source: c.id, target: b.id })).edges[0].label, edge.label);
  const d = await node("孙", c.id);
  await assert.rejects(run("update_edge", { id: moved.id, target: d.id, label: "失败" }), { code: "CYCLE" });
  assert.equal((await run("get_edge", { id: moved.id })).label, edge.label);
  assert.equal((await run("get_node", { id: c.id })).revision, 0);
});

test("标签持久化、JSON 往返/旧格式兼容、回收站恢复，非法标签不产生半份图", async (t) => {
  const { run, kb, node, reopen } = await setup(t);
  const a = await node("父"), b = await node("子", a.id);
  const edge = (await run("get_graph", { kbId: kb.id })).edges[0];
  await run("update_edge", { id: edge.id, label: "参考资料" });
  for (const label of [null, 123, {}, "x".repeat(201)]) {
    await assert.rejects(run("update_edge", { id: edge.id, label }), { code: "INVALID_INPUT" });
    await assert.rejects(run("create_edge", { type: edge.type, source: b.id, target: a.id, label }), { code: "INVALID_INPUT" });
  }
  await assert.rejects(run("update_edge", { id: edge.id, target: b.id, label: "失败" }), { code: "SELF_EDGE" });
  assert.equal((await run("get_edge", { id: edge.id })).label, "参考资料");
  const exported = await run("export_kb", { kbId: kb.id });
  const dest = await run("create_kb", { name: "导入" });
  await run("import_kb", { kbId: dest.id, format: "json", data: exported });
  assert.equal((await run("get_graph", { kbId: dest.id })).edges[0].label, "参考资料");
  const invalid = structuredClone(exported);
  invalid.edges[0].label = 12;
  await assert.rejects(run("import_kb", { kbId: dest.id, format: "json", data: invalid }), { code: "INVALID_INPUT" });
  assert.equal((await run("get_graph", { kbId: dest.id })).nodes.length, 2);
  const legacy = structuredClone(exported);
  delete legacy.edges[0].label;
  const oldDest = await run("create_kb", { name: "旧备份" });
  await run("import_kb", { kbId: oldDest.id, format: "json", data: legacy });
  assert.equal((await run("get_graph", { kbId: oldDest.id })).edges[0].label, "");
  const batch = await run("delete_node", { id: a.id, mode: "cascade" });
  await run("restore", { id: batch.id });
  await reopen();
  assert.equal((await run("get_edge", { id: edge.id })).label, "参考资料");
  const cleared = await run("update_edge", { id: edge.id, label: "" });
  assert.equal(cleared.id, edge.id);
  assert.equal(cleared.label, "");
  await reopen();
  assert.equal((await run("get_edge", { id: edge.id })).label, "");
});

test("旧库与中断升级：补充两种边属性，保留 ID/结构/正文；重复打开不重置文字", async (t) => {
  const { run, kb, node, reopen, store } = await setup(t);
  const a = await node("父"), b = await node("另一根"), c = await node("子", a.id);
  await run("update_doc", { id: c.id, revision: 0, markdown: "旧版正文" });
  const before = await run("get_graph", { kbId: kb.id });
  for (const type of ["CHILD_OF", "SIBLING_OF"])
    await store.query(`ALTER TABLE ${type} DROP label`);
  const migrated = await reopen();
  assert.ok((await run("get_graph", { kbId: kb.id })).edges.every((e) => e.label === ""));
  // Simulate an upgrade interrupted after one table was migrated.
  await migrated.query("ALTER TABLE SIBLING_OF DROP label");
  await migrated.query("MATCH ()-[r:CHILD_OF]->() SET r.label = '中断前保存'");
  await reopen();
  const after = await run("get_graph", { kbId: kb.id });
  assert.deepEqual(after.edges.map((e) => e.id).sort(), before.edges.map((e) => e.id).sort());
  assert.equal(after.edges.find((e) => e.type === "SIBLING_OF").label, "");
  assert.equal(after.edges.find((e) => e.type === "CHILD_OF").label, "中断前保存");
  assert.equal((await run("get_node", { id: c.id })).markdown, "旧版正文");
  await reopen();
  assert.deepEqual((await run("get_graph", { kbId: kb.id })).edges, after.edges);
});

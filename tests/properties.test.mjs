import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphStore } from "../server/graph-store.mjs";
import { KnowledgeTools } from "../server/tools.mjs";
import { LibraryStore } from "../server/library-store.mjs";
import { startApi } from "../server/http.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-props-"));
  let store = await new GraphStore(root).open(), tools = new KnowledgeTools(store);
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const run = (name, args) => tools.execute(name, args);
  const kb = await run("create_kb", { name: "自定义属性" });
  return { run, kb, store, reopen: async () => { await store.close(); store = await new GraphStore(root).open(); tools = new KnowledgeTools(store); return store; } };
}

test("节点 properties：嵌套 JSON、整体替换、版本冲突、其他编辑保留、重开与查询", async t => {
  const { run, kb, reopen } = await setup(t);
  const props = JSON.parse('{"priority":2,"nested":{"tags":["中文",true,null,2.5]},"__proto__":{"safe":true},"title":"仅自定义数据"}');
  const a = await run("create_node", { kbId: kb.id, title: "父", properties: props });
  const b = await run("create_node", { kbId: kb.id, title: "子", parentId: a.id });
  assert.deepEqual(b.properties, {});
  assert.deepEqual(a.properties, props);
  assert.equal(a.title, "父");
  const changed = await run("update_node", { id: a.id, revision: 0, properties: { source: "人工" } });
  assert.equal(changed.revision, 1);
  assert.deepEqual(changed.properties, { source: "人工" });
  await assert.rejects(run("update_node", { id: a.id, revision: 0, properties: {} }), { code: "REVISION_CONFLICT" });
  await run("update_doc", { id: a.id, revision: 1, markdown: "正文" });
  await run("rename_node", { id: a.id, revision: 2, title: "新父" });
  await reopen();
  const node = await run("get_node", { id: a.id });
  assert.equal(node.markdown, "正文");
  assert.equal(node.revision, 3);
  assert.deepEqual(node.properties, { source: "人工" });
  for (const nodes of [await run("list_nodes", { kbId: kb.id }), (await run("get_graph", { kbId: kb.id })).nodes, await run("search", { kbId: kb.id, q: "新父" }), await run("query_neighbors", { id: b.id })])
    assert.deepEqual(nodes.find(n => n.id === a.id).properties, node.properties);
  await run("update_node", { id: a.id, revision: 3, title: "最后", properties: {} });
  assert.deepEqual((await run("get_node", { id: a.id })).properties, {});
});

test("边 properties：省略保留、自动平行边保留、端点迁移与失败回滚", async t => {
  const { run, kb } = await setup(t);
  const node = (title, parentId) => run("create_node", { kbId: kb.id, title, parentId });
  const a = await node("父"), b = await node("另一父"), c = await node("子", a.id);
  const sibling = (await run("get_graph", { kbId: kb.id })).edges.find(e => e.type === "SIBLING_OF");
  await run("update_edge", { id: sibling.id, properties: { shared: true } });
  const edge = await run("create_edge", { type: "CHILD_OF", source: c.id, target: a.id, label: "标题\n详情", properties: { confidence: 0.9 } });
  assert.deepEqual((await run("create_edge", { type: edge.type, source: c.id, target: a.id })).properties, edge.properties);
  const moved = await run("update_edge", { id: edge.id, target: b.id });
  assert.deepEqual(moved.properties, edge.properties);
  assert.deepEqual((await run("get_edge", { id: sibling.id })).properties, { shared: true });
  assert.deepEqual((await run("query_path", { kbId: kb.id, source: c.id, target: b.id })).edges[0].properties, edge.properties);
  const d = await node("孙", c.id);
  await assert.rejects(run("update_edge", { id: moved.id, target: d.id, properties: { lost: true } }), { code: "CYCLE" });
  assert.deepEqual((await run("get_edge", { id: moved.id })).properties, edge.properties);
  await run("update_edge", { id: moved.id, properties: {} });
  assert.equal((await run("get_edge", { id: moved.id })).label, edge.label);
  assert.deepEqual((await run("get_edge", { id: moved.id })).properties, {});
});

test("非法属性在写入前拒绝，不产生节点或部分关系修改", async t => {
  const { run, kb } = await setup(t);
  const a = await run("create_node", { kbId: kb.id, title: "父" });
  const b = await run("create_node", { kbId: kb.id, title: "子", parentId: a.id });
  const edge = (await run("get_graph", { kbId: kb.id })).edges[0];
  let deep = {}; for (let i = 0; i < 18; i++) deep = { nested: deep };
  const circular = {}; circular.self = circular;
  for (const properties of [null, [], "string", 1, { text: "中".repeat(23000) }, deep, circular, { v: NaN }, { v: undefined }, { v: 1n }]) {
    await assert.rejects(run("create_node", { kbId: kb.id, title: "不应创建", properties }), { code: "INVALID_PROPERTIES" });
    await assert.rejects(run("update_node", { id: a.id, revision: 0, title: "不应改名", properties }), { code: "INVALID_PROPERTIES" });
    await assert.rejects(run("update_edge", { id: edge.id, label: "不应改字", properties }), { code: "INVALID_PROPERTIES" });
  }
  assert.equal((await run("list_nodes", { kbId: kb.id })).length, 2);
  assert.equal((await run("get_node", { id: a.id })).title, "父");
  assert.equal((await run("get_edge", { id: edge.id })).label, "");
});

test("旧图库逐表补充属性，中断后重试保留已写入属性与原 ID/正文", async t => {
  const { run, kb, store, reopen } = await setup(t);
  const a = await run("create_node", { kbId: kb.id, title: "父" });
  await run("create_node", { kbId: kb.id, title: "子", parentId: a.id });
  await run("update_doc", { id: a.id, revision: 0, markdown: "旧正文" });
  const before = await run("get_graph", { kbId: kb.id });
  for (const table of ["Node", "CHILD_OF", "SIBLING_OF"]) await store.query(`ALTER TABLE ${table} DROP properties`);
  const reopened = await reopen();
  assert.deepEqual((await run("get_graph", { kbId: kb.id })).edges[0].properties, {});
  await run("update_node", { id: a.id, revision: 1, properties: { retained: true } });
  await reopened.query("ALTER TABLE SIBLING_OF DROP properties");
  await reopen();
  const node = await run("get_node", { id: a.id });
  assert.deepEqual(node.properties, { retained: true });
  assert.equal(node.markdown, "旧正文");
  assert.deepEqual((await run("get_graph", { kbId: kb.id })).edges.map(e => e.id), before.edges.map(e => e.id));
});

test("JSON 往返、旧格式兼容、删除恢复均保留属性，非法导入原子拒绝", async t => {
  const { run, kb, reopen } = await setup(t);
  const a = await run("create_node", { kbId: kb.id, title: "父", properties: { tags: ["a"] } });
  const b = await run("create_node", { kbId: kb.id, title: "子", parentId: a.id });
  const edge = await run("create_edge", { type: "CHILD_OF", source: b.id, target: a.id, properties: { nested: { v: null } } });
  const exported = await run("export_kb", { kbId: kb.id });
  const dest = await run("create_kb", { name: "导入" });
  const result = await run("import_kb", { kbId: dest.id, format: "json", data: exported });
  assert.deepEqual((await run("get_node", { id: result.idMap[a.id] })).properties, a.properties);
  assert.deepEqual((await run("get_graph", { kbId: dest.id })).edges[0].properties, edge.properties);
  const invalid = structuredClone(exported); invalid.edges[0].properties = null;
  await assert.rejects(run("import_kb", { kbId: dest.id, format: "json", data: invalid }), { code: "INVALID_PROPERTIES" });
  assert.equal((await run("list_nodes", { kbId: dest.id })).length, 2);
  const legacy = structuredClone(exported); legacy.nodes.forEach(n => delete n.properties); legacy.edges.forEach(e => delete e.properties);
  const legacyDest = await run("create_kb", { name: "旧格式" });
  await run("import_kb", { kbId: legacyDest.id, format: "json", data: legacy });
  assert.ok((await run("get_graph", { kbId: legacyDest.id })).nodes.every(n => JSON.stringify(n.properties) === "{}"));
  const deleted = await run("delete_node", { id: a.id, mode: "cascade" });
  await run("restore", { id: deleted.id }); await reopen();
  assert.deepEqual((await run("get_node", { id: a.id })).properties, a.properties);
  assert.deepEqual((await run("get_edge", { id: edge.id })).properties, edge.properties);
});

test("整库导入/副本与回收站携带属性；REST 提供创建、更新、冲突与清空", async t => {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-props-api-"));
  const store = await new LibraryStore(root).open();
  const token = "test-properties-token", { server } = await startApi(store, token);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); await rm(root, { recursive: true, force: true }); });
  const run = (name, args) => store.execute(name, args);
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const kb = await run("create_kb", { name: "API" });
  const a = (await api("/api/nodes", "POST", { kbId: kb.id, title: "父", properties: { ref: "opaque-id" } })).data;
  const b = (await api("/api/nodes", "POST", { kbId: kb.id, title: "子", parentId: a.id })).data;
  const update = await api(`/api/nodes/${b.id}`, "PATCH", { revision: 0, properties: { priority: 2 } });
  assert.equal(update.status, 200); assert.equal(update.data.revision, 1);
  assert.equal((await api(`/api/nodes/${b.id}`, "PATCH", { revision: 0, properties: {} })).status, 409);
  assert.equal((await api(`/api/nodes/${b.id}`, "PATCH", { revision: 1, markdown: "不应写入", properties: {} })).status, 400);
  const edge = (await api("/api/edges", "POST", { type: "CHILD_OF", source: b.id, target: a.id, properties: { confidence: 0.8 } })).data;
  assert.deepEqual((await api(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", { label: "保留属性" })).data.properties, edge.properties);
  await run("delete_node", { id: b.id });
  const backup = await run("export_database", { kbId: kb.id });
  const destination = await new LibraryStore(join(root, "migration-target")).open();
  try {
    const restored = await destination.execute("import_database", { data: backup, mode: "restore" });
    assert.equal(restored.id, kb.id);
    await destination.execute("restore", { id: backup.trash[0].id });
    assert.deepEqual((await destination.execute("get_node", { id: b.id })).properties, { priority: 2 });
    assert.deepEqual((await destination.execute("get_edge", { id: edge.id })).properties, edge.properties);
  } finally { await destination.close(); }
  const invalid = structuredClone(backup); invalid.trash[0].snapshot.nodes[0].properties = [];
  await assert.rejects(run("import_database", { data: invalid, mode: "copy" }), { code: "INVALID_PROPERTIES" });
  const copy = await run("import_database", { data: backup, mode: "copy" });
  const copied = await run("export_database", { kbId: copy.id });
  assert.deepEqual(copied.nodes[0].properties, a.properties);
  assert.deepEqual(copied.trash[0].snapshot.nodes[0].properties, { priority: 2 });
  await run("restore", { id: copied.trash[0].id });
  const graph = await run("get_graph", { kbId: copy.id });
  assert.deepEqual(graph.edges[0].properties, edge.properties);
  const clear = await api(`/api/edges/${encodeURIComponent(graph.edges[0].id)}`, "PATCH", { properties: {} });
  assert.deepEqual(clear.data.properties, {});
  assert.equal(clear.data.label, "保留属性");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GraphStore } from "../server/graph-store.mjs";
import { KnowledgeTools } from "../server/tools.mjs";
import { LibraryStore } from "../server/library-store.mjs";
import { startApi } from "../server/http.mjs";

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-separated-"));
  const service = await new LibraryStore(root).open();
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, service, run: (name, args) => service.execute(name, args) };
}

test("独立图库及整库迁移/副本：跨库链接、正文附件回收站和边属性均保留", async t => {
  const { root, run, service } = await workspace(t);
  const a = await run("create_kb", { name: "来源库" });
  const b = await run("create_kb", { name: "目标库" });
  const source = await run("create_node", { kbId: a.id, title: "来源" });
  const child = await run("create_node", { kbId: a.id, title: "子", parentId: source.id });
  const target = await run("create_node", { kbId: b.id, title: "目标" });
  const edge = (await run("get_graph", { kbId: a.id })).edges[0];
  await run("update_edge", { id: edge.id, label: "参考" });
  const asset = await run("upload_asset", { ownerId: source.id, name: "附件.txt", mime: "text/plain", data: Buffer.from("附件正文").toString("base64") });
  await run("update_doc", { id: source.id, revision: 0, markdown: `[跨库](node:${b.id}/${target.id}) [内部](node:${child.id}) [附件](asset:${asset.id})` });
  const deleted = await run("create_node", { kbId: a.id, title: "回收内容" });
  await run("update_doc", { id: deleted.id, revision: 0, markdown: "回收站正文" });
  const batch = await run("delete_node", { id: deleted.id });
  assert.equal((await run("backlinks", { id: target.id }))[0].id, source.id);
  await assert.rejects(run("create_edge", { type: "CHILD_OF", source: source.id, target: target.id }), { code: "CROSS_KB" });
  for (const kb of [a, b]) await access(join(root, "libraries", kb.id, "graph.kuzu"));
  await assert.rejects(access(join(root, "graph.kuzu")), { code: "ENOENT" });
  const archive = await run("export_database", { kbId: a.id });
  assert.equal(archive.trash[0].documents[0].markdown, "回收站正文");
  assert.match(archive.documents.find(d => d.id === source.id).markdown, new RegExp(`node:${a.id}/${child.id}`));
  await assert.rejects(run("import_database", { data: archive }), { code: "DATABASE_EXISTS" });
  const copy = await run("import_database", { data: archive, mode: "copy" });
  assert.notEqual(copy.id, a.id);
  const copied = await run("export_database", { kbId: copy.id });
  const copiedSource = copied.nodes.find(n => n.title === "来源"), copiedChild = copied.nodes.find(n => n.title === "子");
  const copiedText = copied.documents.find(d => d.id === copiedSource.id).markdown;
  assert.ok(copiedText.includes(`node:${copy.id}/${copiedChild.id}`));
  assert.ok(copiedText.includes(`node:${b.id}/${target.id}`));
  assert.ok(copiedText.includes(`asset:${copied.assets[0].id}`));
  assert.notEqual(copied.assets[0].id, asset.id);
  assert.equal(copied.edges[0].label, "参考");
  await run("restore", { id: copied.trash[0].id });
  assert.equal((await run("search", { kbId: copy.id, q: "回收站正文" })).length, 1);
  assert.ok((await run("list_trash")).some(entry => entry.id === batch.id));
  const destination = await workspace(t);
  await destination.run("import_database", { data: archive });
  assert.equal((await destination.run("resolve_links", { ids: [`${b.id}/${target.id}`] }))[0].state, "unavailable");
  await destination.run("import_database", { data: await run("export_database", { kbId: b.id }) });
  assert.equal((await destination.run("resolve_links", { ids: [`${b.id}/${target.id}`, target.id] })).every(ref => ref.state === "active"), true);
  assert.equal((await destination.run("backlinks", { id: target.id }))[0].id, source.id);
  assert.equal((await destination.run("get_asset", { id: asset.id })).data, asset.data ?? Buffer.from("附件正文").toString("base64"));
  await destination.run("restore", { id: batch.id });
  assert.equal((await destination.run("get_node", { id: deleted.id })).markdown, "回收站正文");
  // Read each physical graph alone: there are no rows from another library.
  await service.close();
  for (const kb of [a, b]) {
    const store = await new GraphStore(join(root, "libraries", kb.id)).open();
    assert.ok((await store.query("MATCH (n:Node) RETURN n.kbId AS kbId")).every(n => n.kbId === kb.id));
    await store.close();
  }
});

test("共享旧库自动拆分：包含删除整库、旧引用、附件和回收站；备份不移除，重启不重复迁移", async t => {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-migration-"));
  let service;
  t.after(async () => { await service?.close(); await rm(root, { recursive: true, force: true }); });
  const legacy = await new GraphStore(root).open(), old = new KnowledgeTools(legacy);
  const a = await old.execute("create_kb", { name: "旧 A" }), b = await old.execute("create_kb", { name: "旧 B" });
  const c = await old.execute("create_kb", { name: "已删除库" });
  const x = await old.execute("create_node", { kbId: a.id, title: "旧文档" });
  const y = await old.execute("create_node", { kbId: b.id, title: "目标" });
  const z = await old.execute("create_node", { kbId: c.id, title: "可恢复" });
  await old.execute("update_doc", { id: x.id, revision: 0, markdown: `[旧引用](node:${y.id})` });
  const batch = await old.execute("delete_kb", { id: c.id });
  await legacy.close();
  service = await new LibraryStore(root).open();
  assert.equal((await service.execute("list_kbs")).length, 2);
  assert.equal((await service.execute("get_node", { id: x.id })).markdown, `[旧引用](node:${b.id}/${y.id})`);
  assert.equal(await readFile(join(root, "documents", `${x.id}.md`), "utf8"), `[旧引用](node:${y.id})`);
  await service.execute("restore", { id: batch.id });
  assert.equal((await service.execute("get_node", { id: z.id })).title, "可恢复");
  await service.close();
  service = await new LibraryStore(root).open();
  assert.equal((await service.execute("list_kbs")).length, 3);
  assert.equal((await service.execute("list_trash")).length, 0);
  assert.equal(JSON.parse(await readFile(join(root, "catalog.json"), "utf8")).libraries.length, 3);
});

test("整库导入失败原子隔离、非法路径/环拒绝、工作区锁和陈旧目录索引重建", async t => {
  const { root, run, service } = await workspace(t);
  const kb = await run("create_kb", { name: "安全导入" });
  const a = await run("create_node", { kbId: kb.id, title: "A" });
  const b = await run("create_node", { kbId: kb.id, title: "B", parentId: a.id });
  const archive = await run("export_database", { kbId: kb.id });
  const other = await workspace(t);
  const cyclic = structuredClone(archive);
  cyclic.edges.push({ type: "CHILD_OF", source: a.id, target: b.id, label: "" });
  await assert.rejects(other.run("import_database", { data: cyclic }), { code: "CYCLE" });
  assert.equal((await other.run("list_kbs")).length, 0);
  assert.deepEqual((await readdir(join(other.root, "libraries"))).filter(n => n !== "layout.json"), []);
  for (const bad of [{ ...archive, id: "../../outside" }, { ...archive, documents: [] }, { ...archive, trash: [null] }])
    await assert.rejects(other.run("import_database", { data: bad }));
  await assert.rejects(new LibraryStore(root).open(), /另一个应用/);
  await service.close();
  await writeFile(join(root, "catalog.json"), "broken index");
  const reopened = await new LibraryStore(root).open();
  assert.equal((await reopened.execute("list_kbs"))[0].id, kb.id);
  await reopened.close();
});

test("REST 整库导入导出走独立库路由", async t => {
  const { service, run } = await workspace(t);
  const api = await startApi(service, "database-test");
  t.after(async () => { api.server.closeAllConnections(); await new Promise(r => api.server.close(r)); });
  const kb = await run("create_kb", { name: "REST 整库" });
  const request = (path, data) => fetch(api.url + path, { method: "POST", headers: { Authorization: "Bearer database-test", "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const archive = await (await request(`/api/databases/${kb.id}/export`, {})).json();
  assert.equal(archive.format, "graph-kb-database");
  assert.equal((await request("/api/databases/import", { data: archive })).status, 409);
  assert.equal((await request("/api/databases/import", { data: archive, mode: "copy" })).status, 201);
});

test("迁移途中缺失正文不发布部分库；修复原文件后重试保留所有 ID", async t => {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-migrate-retry-"));
  let service;
  t.after(async () => { await service?.close(); await rm(root, { recursive: true, force: true }); });
  const legacy = await new GraphStore(root).open(), old = new KnowledgeTools(legacy);
  const a = await old.execute("create_kb", { name: "A" }), b = await old.execute("create_kb", { name: "B" });
  const x = await old.execute("create_node", { kbId: a.id, title: "A 正文" });
  const y = await old.execute("create_node", { kbId: b.id, title: "B 正文" });
  await legacy.close();
  const docPath = join(root, "documents", `${y.id}.md`);
  await rm(docPath);
  await assert.rejects(new LibraryStore(root).open(), { code: "ENOENT" });
  await assert.rejects(access(join(root, "libraries")), { code: "ENOENT" });
  await access(join(root, "graph.kuzu"));
  await writeFile(docPath, "补回正文");
  service = await new LibraryStore(root).open();
  assert.equal((await service.execute("list_kbs")).length, 2);
  assert.equal((await service.execute("get_node", { id: x.id })).title, "A 正文");
  assert.equal((await service.execute("get_node", { id: y.id })).markdown, "补回正文");
});

test("文件提升失败后先恢复日志，再允许整库导出，避免图与正文不一致", async t => {
  const { run, service } = await workspace(t);
  const kb = await run("create_kb", { name: "恢复后备份" });
  const node = await run("create_node", { kbId: kb.id, title: "文档" });
  service.current.store.promote = async () => { throw Error("模拟文件提升失败"); };
  await assert.rejects(run("update_doc", { id: node.id, revision: 0, markdown: "已提交的新正文" }), /模拟文件提升失败/);
  const backup = await run("export_database", { kbId: kb.id });
  assert.equal(backup.nodes[0].revision, 1);
  assert.equal(backup.documents[0].markdown, "已提交的新正文");
});

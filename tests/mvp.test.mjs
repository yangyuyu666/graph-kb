import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphStore } from "../server/graph-store.mjs";
import { KnowledgeTools } from "../server/tools.mjs";
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-mvp-"));
  const store = await new GraphStore(root).open();
  t.after(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const tools = new KnowledgeTools(store);
  const run = (name, input) => tools.execute(name, input);
  const kb = await run("create_kb", { name: "MVP" });
  const node = (title, parentId, kind = "Page") =>
    run("create_node", { kbId: kb.id, title, parentId, kind });
  return { root, store, tools, run, kb, node };
}
test("层级创建、多父投影、类型、同库约束与可见图过滤", async (t) => {
  const { run, node, kb, store } = await setup(t);
  const a = await node("项目"),
    b = await node("另一个项目"),
    c = await node("子文档", a.id),
    d = await node("任务", c.id, "Task");
  await run("create_edge", { source: c.id, target: b.id, type: "CHILD_OF" });
  const graph = await run("get_graph", { kbId: kb.id });
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.filter((e) => e.type === "SIBLING_OF").length, 1);
  assert.equal(graph.edges.filter((e) => e.source === c.id).length, 2);
  const foreign = await run("create_kb", { name: "other" });
  await assert.rejects(
    run("create_node", { kbId: foreign.id, title: "x", parentId: a.id }),
    { code: "INVALID_PARENT" },
  );
  assert.equal((await run("list_nodes", { kbId: foreign.id })).length, 0);
  assert.equal(
    (await run("get_graph", { kbId: kb.id, kind: "Task" })).nodes[0].id,
    d.id,
  );
  await assert.rejects(run("get_graph", { kbId: kb.id, hops: 9 }));
});
test("全文、反向链接、邻域和路径读取实际结构", async (t) => {
  const { run, node, kb } = await setup(t);
  const a = await node("根"),
    b = await node("子", a.id),
    c = await node("孙", b.id);
  await run("update_doc", {
    id: a.id,
    revision: 0,
    markdown: `中文检索 [孙](node:${c.id})`,
  });
  assert.equal((await run("search", { q: "中文检索" }))[0].id, a.id);
  assert.equal((await run("backlinks", { id: c.id }))[0].id, a.id);
  assert.equal(
    (await run("query_neighbors", { id: a.id, hops: 2, type: "CHILD_OF" }))
      .length,
    2,
  );
  assert.equal(
    (
      await run("query_path", {
        kbId: kb.id,
        source: a.id,
        target: c.id,
        edgeType: "CHILD_OF",
      })
    ).edges.length,
    2,
  );
  assert.equal(
    (await run("get_graph", { kbId: kb.id, center: a.id, hops: 1 })).nodes
      .length,
    2,
  );
  await run("rename_node", { id: c.id, title: "改名", revision: 0 });
  assert.equal((await run("backlinks", { id: c.id })).length, 1);
});
test("软删除只删除目标、文件移入回收站、孤立子节点提升、恢复关系与正文", async (t) => {
  const { run, node, kb, root } = await setup(t);
  const a = await node("父"),
    b = await node("子", a.id),
    c = await node("另一根");
  await run("update_doc", { id: a.id, revision: 0, markdown: "保留正文" });
  const batch = await run("delete_node", { id: a.id });
  await assert.rejects(run("get_node", { id: a.id }), { code: "NODE_DELETED" });
  await assert.rejects(access(join(root, "documents", a.id + ".md")));
  assert.equal(
    await readFile(join(root, "trash", batch.id, a.id + ".md"), "utf8"),
    "保留正文",
  );
  const graph = await run("get_graph", { kbId: kb.id });
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0].type, "SIBLING_OF");
  await run("restore", { id: batch.id });
  assert.equal((await run("get_node", { id: a.id })).markdown, "保留正文");
  assert.equal(
    (await run("get_graph", { kbId: kb.id })).edges.filter(
      (e) => e.source === b.id && e.target === a.id,
    ).length,
    1,
  );
  assert.equal((await run("list_trash")).length, 0);
});
test("整库删除/恢复、30天清理；附件只在所属节点有效时可访问", async (t) => {
  const { run, node, kb, root, store, tools } = await setup(t);
  const a = await node("附件", "", "File");
  const asset = await run("upload_asset", {
    ownerId: a.id,
    name: "示例.txt",
    mime: "text/plain",
    data: Buffer.from("附件数据").toString("base64"),
  });
  const batch = await run("delete_kb", { id: kb.id });
  assert.equal((await run("list_kbs")).length, 0);
  await assert.rejects(run("get_asset", { id: asset.id }), {
    code: "NODE_DELETED",
  });
  await run("restore", { id: batch.id });
  assert.equal(
    Buffer.from(
      (await run("get_asset", { id: asset.id })).data,
      "base64",
    ).toString(),
    "附件数据",
  );
  const removed = await run("delete_kb", { id: kb.id });
  await store.query("MATCH(t:Trash{id:$id}) SET t.deletedAt=$at", {
    id: removed.id,
    at: new Date(Date.now() - 31 * 86400000).toISOString(),
  });
  tools.lastPurge = 0;
  assert.equal((await run("list_trash")).length, 0);
  await assert.rejects(access(join(root, "blobs", asset.id + ".bin")));
  await assert.rejects(access(join(root, "trash", removed.id)));
});
test("删除文件操作中断后可恢复，回收站记录与文件一致", async (t) => {
  const { run, node, store, root } = await setup(t);
  const a = await node("故障测试");
  const promote = store.promote;
  store.promote = async () => {
    throw Error("injected promotion");
  };
  await assert.rejects(run("delete_node", { id: a.id }), /injected/);
  await store.close();
  store.promote = promote;
  store.unhealthy = false;
  await store.open();
  const [batch] = await run("list_trash");
  assert.ok(batch);
  await access(join(root, "trash", batch.id, a.id + ".md"));
  await run("restore", { id: batch.id });
  assert.equal((await run("get_node", { id: a.id })).title, "故障测试");
});
test("导入 Markdown 文件夹建立父子和相对链接，CSV 支持引号/换行，错误批次全回滚", async (t) => {
  const { run, kb } = await setup(t);
  const result = await run("import_kb", {
    kbId: kb.id,
    format: "markdown",
    files: [
      { path: "项目/a.md", text: "[另一个](b.md)" },
      { path: "项目/b.md", text: "# 另一个" },
    ],
  });
  assert.equal(result.created, 3);
  assert.match(
    (await run("get_node", { id: result.idMap["项目/a.md"] })).markdown,
    new RegExp("node:" + result.idMap["项目/b.md"]),
  );
  const csv = await run("import_kb", {
    kbId: kb.id,
    format: "csv",
    files: [
      {
        path: "data.csv",
        text: 'id,title,markdown,parentId\nr,根,"带,逗号",\nc,子,"两行\n正文",r\n',
      },
    ],
  });
  assert.equal(csv.created, 2);
  const before = (await run("list_nodes", { kbId: kb.id })).length;
  await assert.rejects(
    run("import_kb", {
      kbId: kb.id,
      format: "csv",
      files: [{ path: "bad.csv", text: "id,title,parentId\na,A,b\nb,B,a" }],
    }),
    { code: "CYCLE" },
  );
  assert.equal((await run("list_nodes", { kbId: kb.id })).length, before);
  await assert.rejects(
    run("import_kb", {
      kbId: kb.id,
      format: "markdown",
      files: [{ path: "../outside.md", text: "unsafe" }],
    }),
  );
});
test("JSON 导出/导入保留结构正文与附件，并重映射链接；Markdown 导出相对化", async (t) => {
  const { run, node, kb } = await setup(t);
  const a = await node("甲"),
    b = await node("乙", a.id);
  const asset = await run("upload_asset", {
    ownerId: a.id,
    name: "file.txt",
    mime: "text/plain",
    data: Buffer.from("safe").toString("base64"),
  });
  await run("update_doc", {
    id: a.id,
    revision: 0,
    markdown: `[乙](node:${b.id}) [附件](asset:${asset.id})`,
  });
  const exported = await run("export_kb", { kbId: kb.id });
  assert.ok(
    exported.files
      .find((f) => f.path === a.id + ".md")
      .text.includes(`./${b.id}.md`),
  );
  const second = await run("create_kb", { name: "恢复副本" });
  const imported = await run("import_kb", {
    kbId: second.id,
    format: "json",
    data: exported,
  });
  const copy = await run("get_node", { id: imported.idMap[a.id] });
  assert.ok(copy.markdown.includes(`node:${imported.idMap[b.id]}`));
  assert.ok(!copy.markdown.includes(asset.id));
  const copyGraph = await run("get_graph", { kbId: second.id });
  assert.equal(copyGraph.edges.length, 1);
  const restoredAsset = copy.markdown.match(/asset:([0-9a-f-]+)/)[1];
  assert.equal(
    Buffer.from(
      (await run("get_asset", { id: restoredAsset })).data,
      "base64",
    ).toString(),
    "safe",
  );
});
test("边修正失败整体回滚，移除父边后恢复顶级平行关系", async (t) => {
  const { run, node, kb } = await setup(t);
  const a = await node("A"),
    b = await node("B", a.id),
    c = await node("C", b.id);
  const edge = (await run("get_graph", { kbId: kb.id })).edges.find(
    (e) => e.source === b.id,
  );
  await assert.rejects(
    run("update_edge", {
      id: edge.id,
      type: "CHILD_OF",
      source: b.id,
      target: c.id,
    }),
    { code: "CYCLE" },
  );
  assert.ok(
    (await run("get_graph", { kbId: kb.id })).edges.some(
      (e) => e.id === edge.id,
    ),
  );
  await run("delete_edge", { id: edge.id });
  assert.ok(
    (await run("get_graph", { kbId: kb.id })).edges.some(
      (e) => e.type === "SIBLING_OF",
    ),
  );
});

test("缓存避免重复云调用，人工删边不被缓存恢复，概念合并与相关文档保持隐藏", async (t) => {
  const { run, node, kb, tools, store } = await setup(t);
  let calls = 0;
  tools.cloudSettings = {
    enabled: true,
    public: () => ({
      provider: "test",
      baseUrl: "https://test.invalid",
      model: "test",
    }),
    extractor: () => ({
      extract: async (markdown) => {
        calls++;
        return [
          {
            name: markdown === "甲" ? "Kuzu" : "Kùzu",
            type: "数据库",
            summary: "图库",
          },
        ];
      },
    }),
  };
  const a = await node("甲文档"),
    b = await node("乙文档");
  await run("update_doc", { id: a.id, revision: 0, markdown: "甲" });
  const cached = await run("update_doc", {
    id: a.id,
    revision: 1,
    markdown: "甲",
  });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  await run("update_doc", { id: b.id, revision: 0, markdown: "乙" });
  const concepts = (await tools.allNodes(kb.id)).filter(
    (n) => n.kind === "Concept",
  );
  assert.equal(concepts.length, 2);
  const source = concepts.find((n) => n.title === "Kuzu"),
    target = concepts.find((n) => n.title === "Kùzu");
  await run("merge_concepts", { source: source.id, target: target.id });
  assert.equal((await run("related", { id: a.id }))[0].id, b.id);
  assert.equal((await run("get_graph", { kbId: kb.id })).nodes.length, 2);
  const edge = (await tools.allEdges(kb.id)).find(
    (e) => e.source === target.id && e.target === a.id,
  );
  await run("delete_edge", { id: edge.id });
  await run("update_doc", { id: a.id, revision: 2, markdown: "甲" });
  assert.equal(calls, 2);
  assert.equal((await run("related", { id: a.id })).length, 0);
  assert.equal(
    (await tools.allNodes(kb.id)).filter((n) => n.kind === "Concept").length,
    1,
  );
});

test("跨库反向链接聚合不生成边；无效工具参数和不存在的边不可写入", async (t) => {
  const { run, node, kb } = await setup(t);
  const target = await node("目标");
  const foreign = await run("create_kb", { name: "引用库" });
  const ref = await run("create_node", { kbId: foreign.id, title: "外部引用" });
  await run("update_doc", {
    id: ref.id,
    revision: 0,
    markdown: `[引用](node:${target.id})`,
  });
  assert.equal((await run("backlinks", { id: target.id }))[0].id, ref.id);
  assert.equal((await run("get_graph", { kbId: kb.id })).edges.length, 0);
  assert.throws(() => run("search", null), { code: "INVALID_INPUT" });
  const other = await node("另一个");
  await assert.rejects(
    run("update_edge", {
      id: `CHILD_OF:${target.id}:${other.id}`,
      type: "CHILD_OF",
      source: target.id,
      target: other.id,
    }),
    { code: "NOT_FOUND" },
  );
  assert.equal((await run("get_kb", { id: kb.id })).name, "MVP");
});

test("重复 JSON 导入复用概念，带标题的内部链接正确重映射", async (t) => {
  const { run, node, kb, tools } = await setup(t);
  tools.extractionEnabled = true;
  tools.extractor = {
    extract: async () => [{ name: "共同概念", type: "概念", summary: "测试" }],
  };
  const a = await node("来源"),
    b = await node("目标");
  await run("update_doc", {
    id: a.id,
    revision: 0,
    markdown: `[带标题](node:${b.id} "标题")`,
  });
  const data = await run("export_kb", { kbId: kb.id });
  const copied = await run("import_kb", { kbId: kb.id, format: "json", data });
  assert.equal(
    (await tools.allNodes(kb.id)).filter((n) => n.kind === "Concept").length,
    1,
  );
  assert.ok(
    (await run("get_node", { id: copied.idMap[a.id] })).markdown.includes(
      `node:${copied.idMap[b.id]} "标题"`,
    ),
  );
  assert.equal(copied.created, 2);
});

test("级联删除保留外部父节点共享分支，整批恢复原关系及正文", async (t) => {
  const { run, node, kb, root } = await setup(t);
  const parent = await node("待删除根"),
    outside = await node("外部父节点");
  const owned = await node("独占子节点", parent.id),
    grand = await node("独占孙节点", owned.id);
  const shared = await node("共享子节点", parent.id),
    kept = await node("共享分支下级", shared.id);
  await run("create_edge", {
    type: "CHILD_OF",
    source: shared.id,
    target: outside.id,
  });
  await run("create_edge", {
    type: "CHILD_OF",
    source: kept.id,
    target: owned.id,
  });
  await run("update_doc", {
    id: grand.id,
    revision: 0,
    markdown: "整批恢复正文",
  });
  const removed = await run("delete_node", { id: parent.id, mode: "cascade" });
  assert.equal(removed.deletedCount, 3);
  for (const n of [parent, owned, grand])
    await assert.rejects(run("get_node", { id: n.id }), {
      code: "NODE_DELETED",
    });
  for (const n of [outside, shared, kept])
    assert.equal((await run("get_node", { id: n.id })).id, n.id);
  assert.equal((await run("list_trash")).length, 1);
  await run("restore", { id: removed.id });
  assert.equal((await run("get_graph", { kbId: kb.id })).nodes.length, 6);
  assert.equal(
    (await run("get_node", { id: grand.id })).markdown,
    "整批恢复正文",
  );
  assert.ok(
    (await run("get_graph", { kbId: kb.id })).edges.some(
      (e) => e.source === shared.id && e.target === parent.id,
    ),
  );
  await assert.rejects(run("delete_node", { id: parent.id, mode: "invalid" }), {
    code: "INVALID_INPUT",
  });
});

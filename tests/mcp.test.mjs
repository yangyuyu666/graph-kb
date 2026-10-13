import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GraphStore } from "../server/graph-store.mjs";
import { KnowledgeTools } from "../server/tools.mjs";
import { startApi } from "../server/http.mjs";
test("MCP stdio 外部进程：初始化、工具发现、实际 CRUD、规则错误与回收站", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-mcp-"));
  const store = await new GraphStore(root).open();
  const tools = new KnowledgeTools(store),
    api = await startApi(tools, "mcp-test-token");
  const child = spawn(process.execPath, ["server/mcp.mjs"], {
    windowsHide: true,
    env: {
      ...process.env,
      GRAPH_KB_API_URL: api.url,
      GRAPH_KB_API_TOKEN: "mcp-test-token",
    },
  });
  const lines = createInterface({ input: child.stdout });
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null) await once(child, "exit");
    api.server.closeAllConnections();
    await new Promise((resolve) => api.server.close(resolve));
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  let id = 0;
  async function call(method, params = {}) {
    const response = once(lines, "line", {
      signal: AbortSignal.timeout(10000),
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n",
    );
    return JSON.parse((await response)[0]);
  }
  const initialization = await call("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      });
  assert.equal(initialization.result.protocolVersion, "2025-11-25");
  const catalog = (await call("tools/list")).result.tools;
  assert.ok(catalog.some((t) => t.name === "import_kb"));
  assert.ok(catalog.some((t) => t.name === "delete_node"));
  async function tool(name, args) {
    const result = (await call("tools/call", { name, arguments: args })).result;
    return { ...result, data: JSON.parse(result.content[0].text) };
  }
  await t.test("客户端可发现并读取同一份中文手册；未知 URI 不可读文件", async () => {
    assert.match(initialization.result.instructions, /get_usage_guide/);
    assert.match(initialization.result.instructions, /revision/);
    assert.ok(initialization.result.capabilities.resources);
    const resources = (await call("resources/list")).result.resources;
    assert.equal(resources.length, 1);
    const uri = resources[0].uri;
    assert.equal(uri, "graph-kb://guide/usage");
    const contents = (await call("resources/read", { uri })).result.contents;
    assert.equal(contents[0].mimeType, "text/markdown");
    assert.equal(contents[0].text, await readFile("server/mcp-guide.md", "utf8"));
    const guide = (await call("tools/call", { name: "get_usage_guide", arguments: {} })).result;
    assert.equal(guide.isError, false);
    assert.equal(guide.content[0].text, contents[0].text);
    for (const phrase of ["子→父", "REVISION_CONFLICT", "skippedEdges", "parentId", "extraction=disabled", "mode", "idMap"])
      assert.ok(guide.content[0].text.includes(phrase), phrase);
    for (const uri of ["file:///C:/Windows/win.ini", "graph-kb://guide/../../.env", "graph-kb://guide/missing"])
      assert.equal((await call("resources/read", { uri })).error.code, -32002);
    assert.deepEqual((await call("resources/templates/list")).result.resourceTemplates, []);
    for (const entry of catalog) {
      assert.ok(entry.description.length > 10, entry.name);
      for (const [key, value] of Object.entries(entry.inputSchema.properties))
        assert.ok(value.description?.length > 5, `${entry.name}.${key}`);
    }
    assert.match(catalog.find((t) => t.name === "restore").inputSchema.properties.id.description, /批次/);
  });
  const kb = (await tool("create_kb", { name: "AI 操作" })).data;
  const a = (await tool("create_node", { kbId: kb.id, title: "父" })).data;
  const b = (
    await tool("create_node", { kbId: kb.id, title: "子", parentId: a.id })
  ).data;
  await t.test("MCP 可发现标签参数，局部修改、读取和清空边文字", async () => {
    const schema = catalog.find((entry) => entry.name === "update_edge").inputSchema;
    assert.deepEqual(schema.required, ["id"]);
    assert.equal(schema.properties.label.maxLength, 200);
    const edge = (await tool("create_edge", { type: "CHILD_OF", source: b.id, target: a.id, label: "创建时文字" })).data;
    assert.equal(edge.label, "创建时文字");
    assert.equal((await tool("update_edge", { id: edge.id, label: "MCP 文字" })).data.label, "MCP 文字");
    assert.equal((await tool("get_edge", { id: edge.id })).data.label, "MCP 文字");
    assert.equal((await tool("get_graph", { kbId: kb.id })).data.edges[0].label, "MCP 文字");
    assert.equal((await tool("update_edge", { id: edge.id, label: "" })).data.label, "");
  });
  assert.equal(
    (await tool("update_doc", { id: b.id, revision: 0, markdown: "MCP 正文" }))
      .isError,
    false,
  );
  const cycle = await tool("create_edge", {
    type: "CHILD_OF",
    source: a.id,
    target: b.id,
  });
  assert.equal(cycle.isError, true);
  assert.equal(cycle.data.error.code, "CYCLE");
  const deleted = (await tool("delete_node", { id: b.id })).data;
  assert.equal((await tool("get_node", { id: b.id })).isError, true);
  await tool("restore", { id: deleted.id });
  assert.equal(
    (await tool("get_node", { id: b.id })).data.markdown,
    "MCP 正文",
  );
  await t.test("按手册执行：先读后改、冲突保留正文、改父关系、共享分支删除恢复", async () => {
    const doc = (await tool("get_node", { id: b.id })).data;
    const renamed = (await tool("rename_node", { id: b.id, title: "子改名", revision: doc.revision })).data;
    const stale = await tool("update_doc", { id: b.id, revision: doc.revision, markdown: "不可覆盖" });
    assert.equal(stale.isError, true);
    assert.equal(stale.data.error.code, "REVISION_CONFLICT");
    assert.equal((await tool("get_node", { id: b.id })).data.markdown, "MCP 正文");
    const saved = await tool("update_doc", { id: b.id, revision: renamed.revision, markdown: "已合并正文" });
    assert.equal(saved.data.extraction, "disabled");
    const other = (await tool("create_node", { kbId: kb.id, title: "其他父" })).data;
    const originalGraph = (await tool("get_graph", { kbId: kb.id })).data;
    const originalEdge = originalGraph.edges.find((e) => e.type === "CHILD_OF" && e.source === b.id && e.target === a.id);
    assert.ok(originalEdge?.id);
    assert.equal((await tool("update_edge", { id: originalEdge.id, type: "CHILD_OF", source: b.id, target: other.id })).isError, false);
    const movedGraph = (await tool("get_graph", { kbId: kb.id })).data;
    assert.ok(!movedGraph.edges.some((e) => e.id === originalEdge.id));
    assert.ok(movedGraph.edges.some((e) => e.source === b.id && e.target === other.id));
    await tool("create_edge", { type: "CHILD_OF", source: b.id, target: a.id });
    const grandchild = (await tool("create_node", { kbId: kb.id, title: "共享后代", parentId: b.id })).data;
    const batch = (await tool("delete_node", { id: a.id, mode: "cascade" })).data;
    assert.notEqual(batch.id, a.id);
    assert.equal(batch.deletedCount, 1);
    assert.equal((await tool("get_node", { id: grandchild.id })).isError, false);
    assert.equal((await tool("get_node", { id: b.id })).data.markdown, "已合并正文");
    const restored = (await tool("restore", { id: batch.id })).data;
    assert.equal(restored.restored, 1);
    assert.deepEqual(restored.skippedEdges, []);
  });
  await t.test("Codex 接入检查只读验证真实服务，拒绝失效令牌且不泄露凭据", async () => {
    const file = join(root, "connection.json");
    const config = { mcpServers: { "graph-kb": {
      command: process.execPath, args: [resolve("server/mcp.mjs")],
      env: { GRAPH_KB_API_URL: api.url, GRAPH_KB_API_TOKEN: "mcp-test-token" },
    } } };
    const before = (await tool("list_kbs", {})).data;
    await writeFile(file, JSON.stringify(config));
    const run = promisify(execFile);
    const result = await run(process.execPath, ["scripts/connect-codex.mjs", file, "--check"], { windowsHide: true, timeout: 30000 });
    assert.match(result.stdout, /只读查询通过/);
    assert.doesNotMatch(result.stdout + result.stderr, /mcp-test-token|AI 操作/);
    config.mcpServers["graph-kb"].env.GRAPH_KB_API_TOKEN = "expired-secret-token";
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(run(process.execPath, ["scripts/connect-codex.mjs", file, "--check"], { windowsHide: true, timeout: 30000 }), (error) => {
      assert.match(error.stderr, /连接验证失败/);
      assert.doesNotMatch(error.stdout + error.stderr, /expired-secret-token/);
      return true;
    });
    assert.deepEqual((await tool("list_kbs", {})).data, before);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  assert.equal(
    (
      await call("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).result.protocolVersion,
    "2025-11-25",
  );
  const catalog = (await call("tools/list")).result.tools;
  assert.ok(catalog.some((t) => t.name === "import_kb"));
  assert.ok(catalog.some((t) => t.name === "delete_node"));
  async function tool(name, args) {
    const result = (await call("tools/call", { name, arguments: args })).result;
    return { ...result, data: JSON.parse(result.content[0].text) };
  }
  const kb = (await tool("create_kb", { name: "AI 操作" })).data;
  const a = (await tool("create_node", { kbId: kb.id, title: "父" })).data;
  const b = (
    await tool("create_node", { kbId: kb.id, title: "子", parentId: a.id })
  ).data;
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

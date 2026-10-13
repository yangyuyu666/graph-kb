import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});

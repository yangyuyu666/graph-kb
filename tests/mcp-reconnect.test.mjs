import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { publishConnection, clearConnection, readConnection } from "../server/local-connection.mjs";

test("固定 JSON：同一 MCP 进程离线启动、连接应用、跨真实服务重启自动恢复", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-reconnect-"));
  const file = join(root, "mcp-session.json");
  const children = [];
  t.after(async () => {
    for (const child of children.reverse()) if (child.exitCode === null) {
      const exited = once(child, "exit", { signal: AbortSignal.timeout(10000) });
      child.stdin.end();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  const mcp = spawn(process.execPath, ["server/mcp.mjs"], {
    windowsHide: true, env: { ...process.env, GRAPH_KB_CONNECTION_FILE: file,
      GRAPH_KB_API_URL: "http://127.0.0.1:1", GRAPH_KB_API_TOKEN: "ignored-legacy-token" },
  });
  children.push(mcp);
  const lines = createInterface({ input: mcp.stdout });
  let id = 0;
  async function call(method, params = {}) {
    const response = once(lines, "line", { signal: AbortSignal.timeout(10000) });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
    return JSON.parse((await response)[0]).result;
  }
  const tool = (name, args = {}) => call("tools/call", { name, arguments: args });
  assert.ok((await call("initialize")).instructions);
  assert.equal((await tool("get_usage_guide")).isError, false);
  assert.equal((await tool("list_kbs")).isError, true);

  async function start() {
    const child = spawn(process.execPath, ["server/desktop.mjs", root], { windowsHide: true });
    children.push(child);
    const [handshake] = await once(createInterface({ input: child.stdout }), "line", { signal: AbortSignal.timeout(10000) });
    const connection = JSON.parse(handshake);
    const response = await fetch(connection.url + "/api/connection", { headers: { Authorization: `Bearer ${connection.token}` } });
    assert.equal(response.ok, true);
    const { command, args, env } = await response.json();
    assert.deepEqual(env, { GRAPH_KB_CONNECTION_FILE: file });
    return { child, connection, config: { mcpServers: { "graph-kb": { command, args, env } } } };
  }
  async function stop(child) {
    const exited = once(child, "exit", { signal: AbortSignal.timeout(10000) });
    child.stdin.end();
    assert.equal((await exited)[0], 0);
    await assert.rejects(access(file), { code: "ENOENT" });
  }
  const first = await start();
  assert.deepEqual(readConnection(file), first.connection);
  const exported = JSON.stringify(first.config);
  assert.ok(!exported.includes(first.connection.token));
  assert.ok(!exported.includes(first.connection.url));
  if (process.platform === "win32") {
    const shell = join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const info = JSON.parse(execFileSync(shell, ["-NoProfile", "-NonInteractive", "-Command",
      '$acl = [System.IO.File]::GetAccessControl($env:GRAPH_KB_TEST_SESSION); [PSCustomObject]@{ Protected=$acl.AreAccessRulesProtected; Count=@($acl.Access).Count; CurrentUser=([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value); AllowedUser=($acl.Access[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) } | ConvertTo-Json -Compress'],
      { windowsHide: true, encoding: "utf8", env: { ...process.env, GRAPH_KB_TEST_SESSION: file } }));
    assert.equal(info.Protected, true);
    assert.equal(info.Count, 1);
    assert.equal(info.AllowedUser, info.CurrentUser);
  }
  const kb = JSON.parse((await tool("create_kb", { name: "重连夹具" })).content[0].text);
  assert.ok(kb.id);
  await stop(first.child);
  assert.equal((await tool("list_kbs")).isError, true);
  const second = await start();
  assert.equal(JSON.stringify(second.config), exported);
  assert.notEqual(second.connection.token, first.connection.token);
  const listing = await tool("list_kbs");
  assert.equal(listing.isError, false);
  assert.equal(JSON.parse(listing.content[0].text)[0].id, kb.id);
  assert.equal(mcp.exitCode, null);
  const configFile = join(root, "codex.json");
  await writeFile(configFile, JSON.stringify(second.config));
  // execFileSync would block the server; use a child and asynchronous exit instead.
  const check = spawn(process.execPath, [resolve("scripts/connect-codex.mjs"), configFile, "--check"], { windowsHide: true });
  let output = "";
  check.stdout.on("data", (data) => output += data);
  check.stderr.on("data", (data) => output += data);
  assert.equal((await once(check, "exit", { signal: AbortSignal.timeout(15000) }))[0], 0);
  assert.match(output, /只读查询通过/);
  assert.ok(!output.includes(second.connection.token));
  await stop(second.child);
});

test("会话文件：原子替换、旧服务退出不删除新会话、拒绝非本地地址与损坏文件", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "graph-kb-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = publishConnection(root, { url: "http://127.0.0.1:10001", token: "old-test-token" });
  publishConnection(root, { url: "http://127.0.0.1:10002", token: "new-test-token" });
  clearConnection(file, "old-test-token");
  assert.equal(readConnection(file).token, "new-test-token");
  await writeFile(file, JSON.stringify({ url: "https://example.com", token: "fixture" }));
  assert.throws(() => readConnection(file), /Invalid local session/);
  await writeFile(file, "invalid JSON");
  assert.throws(() => readConnection(file));
  assert.throws(() => readConnection("relative.json"));
  assert.equal(typeof await readFile(file, "utf8"), "string");
});

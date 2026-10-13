// Import the application's local MCP JSON without printing session credentials.
import { readFile, access } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";

function run(command, args, options = {}, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    }, (error, stdout) => error ? reject(new Error("子进程失败")) : resolve(stdout));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

let stage = "读取配置失败：请将应用设置中的完整 JSON 保存为 .tools/mcp-connection.json";
try {
  const args = process.argv.slice(2);
  const file = resolve(args.find((arg) => arg !== "--check") ?? ".tools/mcp-connection.json");
  const config = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const server = config.mcpServers?.["graph-kb"];
  stage = "配置无效：需要应用导出的绝对 Node/MCP 路径及固定连接文件路径（兼容旧版回环地址和令牌）";
  const connectionFile = server?.env?.GRAPH_KB_CONNECTION_FILE;
  const validEnvironment = connectionFile
    ? typeof connectionFile === "string" && isAbsolute(connectionFile)
    : /^http:\/\/127\.0\.0\.1:\d+$/.test(server?.env?.GRAPH_KB_API_URL ?? "") &&
      typeof server?.env?.GRAPH_KB_API_TOKEN === "string" && !!server.env.GRAPH_KB_API_TOKEN;
  if (!server || !isAbsolute(server.command ?? "") ||
      !/^node(?:\.exe)?$/i.test(basename(server.command)) ||
      !Array.isArray(server.args) || server.args.length !== 1 ||
      !isAbsolute(server.args[0]) || basename(server.args[0]) !== "mcp.mjs" || !validEnvironment) {
    throw new Error("Invalid configuration");
  }
  await access(server.command);
  await access(server.args[0]);
  const env = connectionFile ? { GRAPH_KB_CONNECTION_FILE: connectionFile } : {
    GRAPH_KB_API_URL: server.env.GRAPH_KB_API_URL,
    GRAPH_KB_API_TOKEN: server.env.GRAPH_KB_API_TOKEN,
  };
  stage = connectionFile ? "MCP 连接验证失败：请打开对应的 Graph KB 应用后重试，无需修改固定 JSON" : "MCP 连接验证失败：请保持知识库应用打开，并重新导出连接配置";
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-11-25", capabilities: {},
      clientInfo: { name: "graph-kb-codex-setup", version: "1" },
    } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_kbs", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "resources/list" },
    { jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "graph-kb://guide/usage" } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_usage_guide", arguments: {} } },
  ];
  const stdout = await run(server.command, server.args, { env: { ...process.env, ...env } },
    messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  const replies = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const initialized = replies.find((reply) => reply.id === 1)?.result;
  const catalog = replies.find((reply) => reply.id === 2)?.result?.tools;
  const listing = replies.find((reply) => reply.id === 3)?.result;
  if (initialized?.serverInfo?.name !== "graph-kb" ||
      !catalog?.some((tool) => tool.name === "list_kbs") || !listing || listing.isError ||
      !Array.isArray(JSON.parse(listing.content[0].text))) throw new Error("Probe failed");
  console.log(`MCP 初始化、${catalog.length} 项工具发现、知识库只读查询通过。`);
  stage = "MCP 使用指南验证失败：请先更新本地 MCP 服务文件，再重新连接";
  const resources = replies.find((reply) => reply.id === 4)?.result?.resources;
  const guide = replies.find((reply) => reply.id === 5)?.result?.contents?.[0]?.text;
  const guideTool = replies.find((reply) => reply.id === 6)?.result;
  if (!initialized.instructions?.includes("get_usage_guide") ||
      !resources?.some((resource) => resource.uri === "graph-kb://guide/usage") ||
      !guide?.includes("Graph KB 使用指南") || guideTool?.isError || guideTool?.content?.[0]?.text !== guide) {
    throw new Error("Guide probe failed");
  }
  console.log("初始化说明、使用指南资源和 get_usage_guide 读取通过。");
  if (!args.includes("--check")) {
    stage = "Codex 注册失败：请确认 codex 命令可用，且用户配置可写";
    const cli = process.env.GRAPH_KB_CODEX_COMMAND ?? (process.platform === "win32" ? "codex.exe" : "codex");
    await run(cli, ["mcp", "add", "graph-kb", ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      "--", server.command, ...server.args]);
    console.log("已注册 graph-kb。请在 Codex 设置 → MCP servers 中刷新/Restart，并通过 /mcp 检查连接。");
  }
} catch {
  // Never emit raw subprocess errors: their command arguments may contain tokens.
  console.error(stage);
  process.exitCode = 1;
}

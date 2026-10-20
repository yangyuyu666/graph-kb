// MCP 2025-11-25 stdio bridge: one JSON-RPC message per line, stdout is protocol-only.
// The desktop process owns Kùzu; this bridge calls exactly the same tool boundary.
import { createInterface } from "node:readline";
import { describeTool, instructions, guideUri, guideText } from "./mcp-help.mjs";
import { isAbsolute } from "node:path";
import { readConnection, validConnection } from "./local-connection.mjs";
const connectionFile = process.env.GRAPH_KB_CONNECTION_FILE;
const legacyConnection = { url: process.env.GRAPH_KB_API_URL, token: process.env.GRAPH_KB_API_TOKEN };
if (connectionFile ? !isAbsolute(connectionFile) : !validConnection(legacyConnection)) {
  console.error(
    "Set GRAPH_KB_CONNECTION_FILE from application settings (legacy URL/token also supported).",
  );
  process.exit(1);
}
const string = { type: "string" },
  customProperties = { type: "object", additionalProperties: true },
  id = string,
  object = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
const definitions = [
  ["get_usage_guide", "读取应用使用指南", {}, []],
  ["get_kb", "读取知识库与统计", { id }, ["id"]],
  ["get_edge", "读取指定关系", { id }, ["id"]],
  [
    "resolve_links",
    "检查内部链接的有效状态",
    { ids: { type: "array", items: id, maxItems: 1000 } },
    ["ids"],
  ],
  ["list_kbs", "列出知识库", {}, []],
  ["create_kb", "创建知识库", { name: string }, ["name"]],
  ["export_database", "导出完整独立知识库备份，含回收站", { kbId: id }, ["kbId"]],
  ["import_database", "导入整库备份为迁移恢复或独立副本", { data: { type: "object" }, mode: { enum: ["restore", "copy"] } }, ["data"]],
  ["rename_kb", "重命名知识库", { id, name: string }, ["id", "name"]],
  ["delete_kb", "整库进入 30 天回收站", { id }, ["id"]],
  ["list_nodes", "列出可见节点", { kbId: id }, ["kbId"]],
  [
    "create_node",
    "在知识库或父节点下创建文档",
    {
      kbId: id,
      title: string,
      parentId: id,
      kind: { enum: ["Page", "Tag", "File", "Person", "Task"] },
      properties: customProperties,
    },
    ["kbId", "title"],
  ],
  ["get_node", "读取文档", { id }, ["id"]],
  ["update_node", "按 revision 修改节点标题或自定义属性", { id, revision: { type: "integer" }, title: string, properties: customProperties }, ["id", "revision"]],
  [
    "update_doc",
    "按 revision 保存文档并运行已开启的抽取",
    { id, markdown: string, revision: { type: "integer" } },
    ["id", "markdown", "revision"],
  ],
  [
    "rename_node",
    "重命名节点；稳定 ID 不变",
    { id, title: string, revision: { type: "integer" } },
    ["id", "title", "revision"],
  ],
  [
    "delete_node",
    "节点和正文进入回收站；single 仅当前节点；cascade 删除后代但保留有外部父节点的共享分支",
    { id, mode: { type: "string", enum: ["single", "cascade"] } },
    ["id"],
  ],
  [
    "get_graph",
    "可见图谱、类型筛选、1–3 跳邻域或全部递归子节点",
    {
      kbId: id,
      center: id,
      scope: { type: "string", enum: ["neighbors", "descendants"] },
      hops: { type: "integer", minimum: 1, maximum: 3 },
      kind: string,
      edgeType: string,
      q: string,
    },
    ["kbId"],
  ],
  [
    "query_neighbors",
    "包括后台概念的邻居查询",
    { id, hops: { type: "integer", minimum: 1, maximum: 3 }, type: string },
    ["id"],
  ],
  [
    "query_path",
    "同库可见节点间无向最短路径，保留实际边方向",
    { kbId: id, source: id, target: id, edgeType: string },
    ["kbId", "source", "target"],
  ],
  ["search", "按标题和正文做本地全文搜索", { q: string, kbId: id }, ["q"]],
  ["backlinks", "从 Markdown 聚合反向链接，不创建引用边", { id }, ["id"]],
  ["related", "按共享概念推荐相关文档，不写推荐边", { id }, ["id"]],
  [
    "create_edge",
    "校验后创建 CHILD_OF 或 SIBLING_OF",
    { type: { enum: ["CHILD_OF", "SIBLING_OF"] }, source: id, target: id, label: { type: "string", maxLength: 200 }, properties: customProperties },
    ["type", "source", "target"],
  ],
  ["delete_edge", "删除指定关系", { id }, ["id"]],
  [
    "update_edge",
    "在事务内修正关系",
    { id, type: { enum: ["CHILD_OF", "SIBLING_OF"] }, source: id, target: id, label: { type: "string", maxLength: 200 }, properties: customProperties },
    ["id"],
  ],
  ["list_trash", "列出尚未过期的回收站", {}, []],
  ["restore", "恢复回收站批次与可恢复关系", { id }, ["id"]],
  [
    "export_kb",
    "导出 JSON、Markdown 和附件；可选子图",
    { kbId: id, nodeIds: { type: "array", items: id } },
    ["kbId"],
  ],
  [
    "import_kb",
    "原子导入 Markdown 文件夹、CSV 或 Graph KB JSON",
    {
      kbId: id,
      format: { enum: ["markdown", "csv", "json"] },
      files: {
        type: "array",
        items: object({ path: string, text: string }, ["path", "text"]),
      },
      data: { type: "object" },
    },
    ["kbId", "format"],
  ],
  [
    "upload_asset",
    "添加不超过 10 MiB 的文件附件",
    { ownerId: id, name: string, mime: string, data: string },
    ["ownerId", "name", "data"],
  ],
  ["get_asset", "读取附件 Base64", { id }, ["id"]],
  [
    "merge_concepts",
    "合并同库 Concept 并重定向边，原概念进回收站",
    { source: id, target: id },
    ["source", "target"],
  ],
  ["get_settings", "读取脱敏的云端设置", {}, []],
  [
    "update_settings",
    "配置云端模型和抽取总开关",
    {
      enabled: { type: "boolean" },
      provider: string,
      baseUrl: string,
      model: string,
      apiKey: string,
    },
    [],
  ],
];
const tools = definitions.map(([name, , properties, required]) => {
  const help = describeTool(name, properties);
  return { name, description: help.description, inputSchema: object(help.properties, required) };
});
const guideResource = {
  uri: guideUri,
  name: "graph-kb-usage-guide",
  title: "Graph KB 应用与 MCP 使用指南",
  description: "产品模型、界面使用、工具流程、参数示例、版本冲突、删除恢复及云端抽取说明。",
  mimeType: "text/markdown",
};
let initialized = false;
async function handle(message) {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string")
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32600, message: "Invalid request" },
    };
  if (message.id === undefined) return null;
  const result = (value) => ({ jsonrpc: "2.0", id: message.id, result: value });
  if (message.method === "initialize") {
    initialized = true;
    return result({
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: false }, resources: {} },
      serverInfo: { name: "graph-kb", version: "0.2.9" },
      instructions,
    });
  }
  if (!initialized)
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: "Initialize first" },
    };
  if (message.method === "ping") return result({});
  if (message.method === "resources/list") return result({ resources: [guideResource] });
  if (message.method === "resources/templates/list") return result({ resourceTemplates: [] });
  if (message.method === "resources/read") {
    if (message.params?.uri !== guideUri) return {
      jsonrpc: "2.0", id: message.id,
      error: { code: -32002, message: "Resource not found" },
    };
    return result({ contents: [{ uri: guideUri, mimeType: "text/markdown", text: guideText }] });
  }
  if (message.method === "tools/list") return result({ tools });
  if (message.method === "tools/call") {
    const tool = tools.find((t) => t.name === message.params?.name);
    if (!tool)
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: "Unknown tool" },
      };
    if (tool.name === "get_usage_guide") return result({ content: [{ type: "text", text: guideText }], isError: false });
    try {
      // Resolve each call, so an already-running MCP process follows app restarts.
      // Never automatically retry writes: a lost response may already be committed.
      const { url, token } = connectionFile ? readConnection(connectionFile) : legacyConnection;
      const response = await fetch(url + "/api/tools", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: tool.name,
          arguments: message.params.arguments ?? {},
        }),
        signal: AbortSignal.timeout(120000),
        redirect: "error",
      });
      const data = await response.json();
      return result({
        content: [{ type: "text", text: JSON.stringify(data) }],
        isError: !response.ok,
      });
    } catch {
      return result({
        content: [
          {
            type: "text",
            text: connectionFile
              ? "本地应用不可用或请求失败；请打开 Graph KB，下一次调用会自动读取新会话。若写入结果不确定，请先读取核实，不要盲目重试。"
              : "本地应用不可用或请求失败；请保持应用打开，并从设置获取新版固定连接配置。",
          },
        ],
        isError: true,
      });
    }
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: "Method not found" },
  };
}
let queue = Promise.resolve();
for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  queue = queue.then(async () => {
    let response;
    try {
      if (Buffer.byteLength(line) > 32 * 1024 * 1024) throw Error();
      response = await handle(JSON.parse(line));
    } catch {
      response = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
    }
    if (response) process.stdout.write(JSON.stringify(response) + "\n");
  });
}
await queue;

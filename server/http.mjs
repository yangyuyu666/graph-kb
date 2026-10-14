import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ToolError } from "./errors.mjs";
import { fileURLToPath } from "node:url";
import { publishConnection, clearConnection } from "./local-connection.mjs";

export async function startApi(tools, token, port = 0) {
  let connectionFile;
  const allowedOrigins = new Set([
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? ""))
        throw new ToolError(
          "FORBIDDEN_HOST",
          "非法主机名",
          "使用 127.0.0.1",
          403,
        );
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin))
        throw new ToolError(
          "FORBIDDEN_ORIGIN",
          "非法来源",
          "从本地应用访问",
          403,
        );
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const actual = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new ToolError(
          "UNAUTHORIZED",
          "API Key 无效",
          "使用当前本地会话的 API Key",
          401,
        );
      const url = new URL(req.url, "http://127.0.0.1");
      let body = {};
      if (["POST", "PATCH"].includes(req.method)) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new ToolError(
            "INVALID_CONTENT_TYPE",
            "须使用 JSON",
            "设置 Content-Type: application/json",
            415,
          );
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024)
            throw new ToolError(
              "BODY_TOO_LARGE",
              "请求超过 32 MiB",
              "请分批导入或缩小文档",
              413,
            );
          chunks.push(chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new ToolError("INVALID_JSON", "JSON 格式无效", "检查请求语法");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new ToolError(
            "INVALID_INPUT",
            "请求须为 JSON 对象",
            "检查请求内容",
          );
      }
      let operation,
        input = body;
      const path = url.pathname;
      if (path === "/api/connection" && req.method === "GET") {
        res.end(
          JSON.stringify({
            url: `http://127.0.0.1:${server.address().port}`,
            token,
            command: process.execPath,
            args: [fileURLToPath(new URL("./mcp.mjs", import.meta.url))],
            env: { GRAPH_KB_CONNECTION_FILE: connectionFile },
          }),
        );
        return;
      }
      if (path === "/api/tools" && req.method === "POST") {
        const result = await tools.execute(body.name, body.arguments);
        res.end(JSON.stringify(result));
        return;
      }
      const node = path.match(/^\/api\/nodes\/([^/]+)$/);
      const neighbors = path.match(/^\/api\/nodes\/([^/]+)\/neighbors$/);
      const kbNodes = path.match(/^\/api\/kbs\/([^/]+)\/nodes$/);
      const kb = path.match(/^\/api\/kbs\/([^/]+)$/);
      const graph = path.match(/^\/api\/kbs\/([^/]+)\/graph$/);
      const transfers = path.match(/^\/api\/kbs\/([^/]+)\/(import|export)$/);
      const databaseExport = path.match(/^\/api\/databases\/([^/]+)\/export$/);
      const links = path.match(/^\/api\/nodes\/([^/]+)\/(backlinks|related)$/);
      const asset = path.match(/^\/api\/assets\/([^/]+)$/);
      const edge = path.match(/^\/api\/edges\/([^/]+)$/);
      const restore = path.match(/^\/api\/trash\/([^/]+)\/restore$/);
      if (path === "/api/databases/import" && req.method === "POST")
        operation = "import_database";
      else if (databaseExport && req.method === "POST") {
        operation = "export_database";
        input = { kbId: databaseExport[1] };
      } else if (path === "/api/settings" && req.method === "GET")
        operation = "get_settings";
      else if (path === "/api/settings" && req.method === "PATCH")
        operation = "update_settings";
      else if (path === "/api/kbs" && req.method === "GET")
        operation = "list_kbs";
      else if (path === "/api/kbs" && req.method === "POST")
        operation = "create_kb";
      else if (path === "/api/nodes" && req.method === "POST")
        operation = "create_node";
      else if (kbNodes && req.method === "GET") {
        operation = "list_nodes";
        input = { kbId: kbNodes[1] };
      } else if (node && req.method === "GET") {
        operation = "get_node";
        input = { id: node[1] };
      } else if (node && req.method === "PATCH") {
        if (body.markdown !== undefined && (body.properties !== undefined || body.title !== undefined))
          throw new ToolError("INVALID_INPUT", "正文与节点属性请分别提交", "先保存正文取得新 revision，再 PATCH title/properties");
        operation = body.markdown === undefined ? "update_node" : "update_doc";
        input = { ...body, id: node[1] };
      } else if (node && req.method === "DELETE") {
        operation = "delete_node";
        input = { id: node[1], mode: url.searchParams.get("mode") ?? "single" };
      } else if (kb && req.method === "GET") {
        operation = "get_kb";
        input = { id: kb[1] };
      } else if (edge && req.method === "GET") {
        operation = "get_edge";
        input = { id: decodeURIComponent(edge[1]) };
      } else if (kb && req.method === "PATCH") {
        operation = "rename_kb";
        input = { ...body, id: kb[1] };
      } else if (kb && req.method === "DELETE") {
        operation = "delete_kb";
        input = { id: kb[1] };
      } else if (graph && req.method === "GET") {
        operation = "get_graph";
        input = { ...Object.fromEntries(url.searchParams), kbId: graph[1] };
      } else if (transfers && req.method === "POST") {
        operation = transfers[2] === "import" ? "import_kb" : "export_kb";
        input = { ...body, kbId: transfers[1] };
      } else if (links && req.method === "GET") {
        operation = links[2];
        input = { id: links[1] };
      } else if (path === "/api/search" && req.method === "GET") {
        operation = "search";
        input = Object.fromEntries(url.searchParams);
      } else if (path === "/api/path" && req.method === "GET") {
        operation = "query_path";
        input = Object.fromEntries(url.searchParams);
      } else if (path === "/api/trash" && req.method === "GET")
        operation = "list_trash";
      else if (restore && req.method === "POST") {
        operation = "restore";
        input = { id: restore[1] };
      } else if (path === "/api/assets" && req.method === "POST")
        operation = "upload_asset";
      else if (asset && req.method === "GET") {
        operation = "get_asset";
        input = { id: asset[1] };
      } else if (edge && ["PATCH", "DELETE"].includes(req.method)) {
        operation = req.method === "PATCH" ? "update_edge" : "delete_edge";
        input = { ...body, id: decodeURIComponent(edge[1]) };
      } else if (neighbors && req.method === "GET") {
        operation = "query_neighbors";
        input = { ...Object.fromEntries(url.searchParams), id: neighbors[1] };
      } else if (path === "/api/edges" && req.method === "POST")
        operation = "create_edge";
      else
        throw new ToolError(
          "NOT_FOUND",
          "接口不存在",
          "查看 README 的接口范围",
          404,
        );
      const result = await tools.execute(operation, input);
      res.writeHead(req.method === "POST" ? 201 : 200);
      res.end(JSON.stringify(result));
    } catch (error) {
      const known = error instanceof ToolError;
      if (!known) console.error(error);
      res.writeHead(known ? error.status : 500);
      res.end(
        JSON.stringify({
          error: {
            code: known ? error.code : "INTERNAL_ERROR",
            message: known ? error.message : "本地服务发生错误",
            suggestion: known
              ? error.suggestion
              : "检查服务日志；文件提交失败时重启以恢复",
          },
        }),
      );
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    connectionFile = publishConnection(tools.store.root, { url, token });
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  server.on("close", () => clearConnection(connectionFile, token));
  return { server, url, connectionFile };
}

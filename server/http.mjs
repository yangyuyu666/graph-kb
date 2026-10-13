import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ToolError } from './errors.mjs';

export async function startApi(tools, token, port = 0) {
  const allowedOrigins = new Set(['http://127.0.0.1:1420', 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']);
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '')) throw new ToolError('FORBIDDEN_HOST', '非法主机名', '使用 127.0.0.1', 403);
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw new ToolError('FORBIDDEN_ORIGIN', '非法来源', '从本地应用访问', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const actual = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ToolError('UNAUTHORIZED', 'API Key 无效', '使用当前本地会话的 API Key', 401);
      const url = new URL(req.url, 'http://127.0.0.1');
      let body = {};
      if (['POST', 'PATCH'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new ToolError('INVALID_CONTENT_TYPE', '须使用 JSON', '设置 Content-Type: application/json', 415);
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) throw new ToolError('BODY_TOO_LARGE', '请求过大', '缩小文档后重试', 413);
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new ToolError('INVALID_JSON', 'JSON 格式无效', '检查请求语法'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ToolError('INVALID_INPUT', '请求须为 JSON 对象', '检查请求内容');
      }
      let operation, input = body;
      const path = url.pathname;
      const node = path.match(/^\/api\/nodes\/([^/]+)$/);
      const neighbors = path.match(/^\/api\/nodes\/([^/]+)\/neighbors$/);
      const kbNodes = path.match(/^\/api\/kbs\/([^/]+)\/nodes$/);
      if (path === '/api/settings' && req.method === 'GET') operation = 'get_settings';
      else if (path === '/api/settings' && req.method === 'PATCH') operation = 'update_settings';
      else if (path === '/api/kbs' && req.method === 'GET') operation = 'list_kbs';
      else if (path === '/api/kbs' && req.method === 'POST') operation = 'create_kb';
      else if (path === '/api/nodes' && req.method === 'POST') operation = 'create_node';
      else if (kbNodes && req.method === 'GET') { operation = 'list_nodes'; input = { kbId: kbNodes[1] }; }
      else if (node && req.method === 'GET') { operation = 'get_node'; input = { id: node[1] }; }
      else if (node && req.method === 'PATCH') { operation = 'update_doc'; input = { ...body, id: node[1] }; }
      else if (neighbors && req.method === 'GET') { operation = 'query_neighbors'; input = { id: neighbors[1] }; }
      else if (path === '/api/edges' && req.method === 'POST') operation = 'create_edge';
      else throw new ToolError('NOT_FOUND', 'Phase 0 未提供此接口', '查看 README 的接口范围', 404);
      const result = await tools.execute(operation, input);
      res.writeHead(req.method === 'POST' ? 201 : 200);
      res.end(JSON.stringify(result));
    } catch (error) {
      const known = error instanceof ToolError;
      if (!known) console.error(error);
      res.writeHead(known ? error.status : 500);
      res.end(JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '本地服务发生错误', suggestion: known ? error.suggestion : '检查服务日志；文件提交失败时重启以恢复' } }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

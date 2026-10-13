import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { get } from 'node:http';
import { GraphStore } from '../server/graph-store.mjs';
import { KnowledgeTools } from '../server/tools.mjs';
import { startApi } from '../server/http.mjs';

test('REST 使用同一工具层：鉴权、持久化、结构化校验错误、来源和方法约束', async t => {
  const root = await mkdtemp(join(tmpdir(), 'graph-kb-http-'));
  const store = await new GraphStore(root).open();
  const token = randomBytes(32).toString('hex');
  const api = await startApi(new KnowledgeTools(store), token);
  t.after(async () => { api.server.closeAllConnections(); await new Promise(resolve => api.server.close(resolve)); await store.close(); await rm(root, { recursive: true, force: true }); });
  const request = (path, method = 'GET', body, extra = {}) => fetch(api.url + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await fetch(api.url + '/api/kbs')).status, 401);
  assert.equal((await request('/api/kbs', 'GET', undefined, { Origin: 'https://example.com' })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    get(api.url + '/api/kbs', { headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(invalidHost, 403);
  const created = await request('/api/kbs', 'POST', { name: 'HTTP 测试' });
  assert.equal(created.status, 201);
  const kb = await created.json();
  const page = await (await request('/api/nodes', 'POST', { kbId: kb.id, title: '文档' })).json();
  const markdown = '# 中文\n\n- [x] 编辑保存\n';
  assert.equal((await request(`/api/nodes/${page.id}`, 'PATCH', { markdown, revision: 0 })).status, 200);
  assert.equal((await (await request(`/api/nodes/${page.id}`)).json()).markdown, markdown);
  const conflict = await request(`/api/nodes/${page.id}`, 'PATCH', { markdown: '覆盖', revision: 0 });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'REVISION_CONFLICT');
  const badEdge = await request('/api/edges', 'POST', { type: 'CHILD_OF', source: page.id, target: page.id });
  const error = (await badEdge.json()).error;
  assert.equal(error.code, 'SELF_EDGE');
  assert.ok(error.suggestion);
  const child = await (await request('/api/nodes', 'POST', { kbId: kb.id, title: '子', parentId: page.id })).json();
  const edge = await (await request('/api/edges', 'POST', { type: 'CHILD_OF', source: child.id, target: page.id, label: 'REST 创建' })).json();
  assert.equal(edge.label, 'REST 创建');
  const edgePath = `/api/edges/${encodeURIComponent(edge.id)}`;
  assert.equal((await (await request(edgePath, 'PATCH', { label: 'REST 更新' })).json()).label, 'REST 更新');
  assert.equal((await (await request(edgePath)).json()).label, 'REST 更新');
  assert.equal((await request(edgePath, 'PATCH', { label: null })).status, 400);
  assert.equal((await (await request(edgePath, 'PATCH', { label: '' })).json()).label, '');
  assert.equal((await request(`/api/nodes/${page.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`/api/nodes/${page.id}`)).status, 410);
  assert.equal((await request('/api/kbs', 'POST', { name: 'bad content type' }, { 'Content-Type': 'text/plain' })).status, 415);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { cp, mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('复制出仓库的运行时在空 PATH 下加载 Kùzu、写入、重启回读并正常退出', async t => {
  const root = await mkdtemp(join(tmpdir(), 'graph-kb-runtime-'));
  const runtime = join(root, 'runtime'), children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(root, { recursive: true, force: true });
  });
  await cp('src-tauri/resources/runtime', runtime, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (['path', 'node_path', 'node_options'].includes(key.toLowerCase())) delete env[key];
  env.PATH = '';
  // The packaged guide must work outside the repository with no PATH lookup.
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'runtime-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'graph-kb://guide/usage' } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_usage_guide', arguments: {} } },
  ];
  const run = promisify(execFile);
  const probe = run(join(runtime, 'node.exe'), [join(runtime, 'server/mcp.mjs')], {
    cwd: root, env: { ...env, GRAPH_KB_API_URL: 'http://127.0.0.1:1', GRAPH_KB_API_TOKEN: 'runtime-guide-fixture' }, windowsHide: true, timeout: 10000,
  });
  probe.child.stdin.end(messages.map((message) => JSON.stringify(message)).join('\n') + '\n');
  const replies = (await probe).stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.match(replies.find((r) => r.id === 1).result.instructions, /get_usage_guide/);
  const resource = replies.find((r) => r.id === 2).result.contents[0].text;
  assert.match(resource, /Graph KB 使用指南/);
  assert.equal(replies.find((r) => r.id === 3).result.content[0].text, resource);
  async function start() {
    const child = spawn(join(runtime, 'node.exe'), [join(runtime, 'server/desktop.mjs'), join(root, 'data')], { cwd: root, env, windowsHide: true });
    children.push(child);
    let stderr = ''; child.stderr.on('data', data => stderr += data);
    const [line] = await once(createInterface({ input: child.stdout }), 'line', { signal: AbortSignal.timeout(15_000) }).catch(error => { throw new Error(`${error.message}: ${stderr}`); });
    const { url, token } = JSON.parse(line);
    return { child, request: async (path, method = 'GET', body) => {
      const response = await fetch(url + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      assert.equal(response.ok, true); return response.json();
    } };
  }
  async function stop(child) {
    const exit = once(child, 'exit', { signal: AbortSignal.timeout(10_000) }); child.stdin.end(); assert.equal((await exit)[0], 0);
  }
  const first = await start();
  const kb = await first.request('/api/kbs', 'POST', { name: '独立运行时' });
  const page = await first.request('/api/nodes', 'POST', { kbId: kb.id, title: '持久化' });
  await first.request(`/api/nodes/${page.id}`, 'PATCH', { revision: 0, markdown: '不依赖本机 Node 或仓库文件' });
  await stop(first.child);
  await access(join(root, 'data', 'libraries', kb.id, 'graph.kuzu'));
  await access(join(root, 'data', 'libraries', kb.id, 'documents', `${page.id}.md`));
  const second = await start();
  assert.equal((await second.request(`/api/nodes/${page.id}`)).markdown, '不依赖本机 Node 或仓库文件');
  await stop(second.child);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { cp, mkdtemp, rm } from 'node:fs/promises';
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
  const second = await start();
  assert.equal((await second.request(`/api/nodes/${page.id}`)).markdown, '不依赖本机 Node 或仓库文件');
  await stop(second.child);
});

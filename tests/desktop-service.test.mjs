import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Tauri sidecar 协议：私有握手、父进程关闭管道后退出、再次启动保留数据', async t => {
  const root = await mkdtemp(join(tmpdir(), 'graph-kb-sidecar-'));
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(root, { recursive: true, force: true });
  });
  async function start() {
    const child = spawn(process.execPath, ['server/desktop.mjs', root], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    children.push(child);
    const lines = createInterface({ input: child.stdout });
    const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) });
    const connection = JSON.parse(line);
    assert.match(connection.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(connection.token.length, 64);
    const request = (path, method = 'GET', data) => fetch(connection.url + path, { method, headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    return { child, request };
  }
  async function stop(child) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10_000) });
    child.stdin.end();
    assert.equal((await exited)[0], 0);
  }
  const first = await start();
  const kb = await (await first.request('/api/kbs', 'POST', { name: '原生服务验证' })).json();
  await stop(first.child);
  const second = await start();
  assert.equal((await (await second.request('/api/kbs')).json())[0].id, kb.id);
  await stop(second.child);
});

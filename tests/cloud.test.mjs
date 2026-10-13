import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CloudExtractor, parseEntities } from '../server/cloud-extractor.mjs';
import { CloudSettings } from '../server/cloud-settings.mjs';
import { GraphStore } from '../server/graph-store.mjs';
import { KnowledgeTools } from '../server/tools.mjs';
import { startApi } from '../server/http.mjs';

const entity = { name: '知识图谱', type: '技术', summary: '节点与边构成的知识模型。' };
const content = JSON.stringify({ entities: [entity] });
const config = provider => ({ enabled: true, provider, model: 'explicit-test-model', baseUrl: 'https://provider.example/v1', apiKey: 'fixture-key-not-real' });
const chatReply = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });

for (const provider of ['openai', 'deepseek', 'gemini', 'mimo', 'compatible']) {
  test(`云端协议 ${provider}：请求/鉴权/返回解析（模拟响应，不是供应商实测）`, async () => {
    const extractor = new CloudExtractor(config(provider), { fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      assert.ok(!url.includes('fixture-key'));
      if (provider === 'openai') {
        assert.ok(url.endsWith('/responses'));
        assert.equal(options.headers.Authorization, 'Bearer fixture-key-not-real');
        assert.equal(body.input, '中文正文');
        assert.equal(body.store, false);
        assert.equal(body.text.format.strict, true);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] });
      }
      if (provider === 'gemini') {
        assert.ok(url.endsWith('/models/explicit-test-model:generateContent'));
        assert.equal(options.headers['x-goog-api-key'], 'fixture-key-not-real');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        assert.equal(body.contents[0].parts[0].text, '中文正文');
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'ignore reasoning' }, { text: content }] } }] });
      }
      assert.ok(url.endsWith('/chat/completions'));
      assert.equal(body.model, 'explicit-test-model');
      assert.equal(body.messages[1].content, '中文正文');
      assert.equal(options.headers[provider === 'mimo' ? 'api-key' : 'Authorization'], provider === 'mimo' ? 'fixture-key-not-real' : 'Bearer fixture-key-not-real');
      if (provider === 'deepseek') assert.equal(body.response_format.type, 'json_object');
      if (provider === 'mimo') {
        assert.equal(body.max_completion_tokens, 8192);
        assert.equal(body.max_tokens, undefined);
      }
      return chatReply();
    } });
    assert.deepEqual(await extractor.extract('中文正文'), [entity]);
  });
}

test('云端错误脱敏，超时/拒绝/截断/超大响应均不当作有效抽取', async () => {
  for (const status of [401, 429, 500]) {
    const extractor = new CloudExtractor(config('deepseek'), { fetchImpl: async () => new Response('SECRET document and API key', { status }) });
    await assert.rejects(extractor.extract('正文'), error => error.code === 'CLOUD_HTTP_ERROR' && !JSON.stringify(error).includes('SECRET'));
  }
  const timeout = new CloudExtractor(config('deepseek'), { timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test timeout failed')), 500);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  await assert.rejects(timeout.extract('正文'), { code: 'CLOUD_TIMEOUT' });
  const incomplete = new CloudExtractor(config('deepseek'), { fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content } }] }) });
  await assert.rejects(incomplete.extract('正文'), { code: 'INCOMPLETE_EXTRACTION' });
  const refused = new CloudExtractor(config('openai'), { fetchImpl: async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }) });
  await assert.rejects(refused.extract('正文'), { code: 'EXTRACTION_REFUSED' });
  const huge = new CloudExtractor(config('deepseek'), { fetchImpl: async () => new Response('a'.repeat(1024 * 1024 + 1)) });
  await assert.rejects(huge.extract('正文'), { code: 'RESPONSE_TOO_LARGE' });
  for (const invalid of ['no json', '{"entities":[null]}', '{"entities":[{"name":"a"}]}', '{"entities":[],"edges":[]}']) assert.throws(() => parseEntities(invalid), { code: 'INVALID_EXTRACTION' });
});

test('云端设置：无默认供应商，Key 不落盘/不回传，重启关闭，换地址不带旧 Key', async t => {
  const root = await mkdtemp(join(tmpdir(), 'graph-kb-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = await new CloudSettings(root).open();
  assert.equal(settings.public().provider, '');
  assert.equal(settings.enabled, false);
  await settings.update(config('deepseek'));
  assert.equal(settings.public().hasApiKey, true);
  assert.ok(!JSON.stringify(settings.public()).includes('fixture-key'));
  assert.ok(!(await readFile(join(root, 'cloud-settings.json'), 'utf8')).includes('fixture-key'));
  const reopened = await new CloudSettings(root).open();
  assert.equal(reopened.enabled, false);
  assert.equal(reopened.public().hasApiKey, false);
  assert.equal(reopened.public().model, 'explicit-test-model');
  await assert.rejects(settings.update({ baseUrl: 'https://another.example/v1' }), { code: 'EXTRACTOR_UNCONFIGURED' });
  await settings.update({ enabled: false, baseUrl: 'https://another.example/v1' });
  assert.equal(settings.public().hasApiKey, false);
  await assert.rejects(settings.update({ baseUrl: 'http://plain.example' }), { code: 'INVALID_SETTINGS' });
  await assert.rejects(settings.update({ baseUrl: 'https://provider.example?key=SECRET' }), { code: 'INVALID_SETTINGS' });
});

test('REST 设置→协议适配器→真实 Kùzu；失败保正文、关开关后不请求云端', async t => {
  const root = await mkdtemp(join(tmpdir(), 'graph-kb-cloud-'));
  const store = await new GraphStore(root).open();
  let calls = 0, fail = false;
  const cloudSettings = await new CloudSettings(root, { fetchImpl: async () => { calls++; return fail ? new Response('secret', { status: 429 }) : chatReply(); } }).open();
  const tools = new KnowledgeTools(store, { cloudSettings });
  const api = await startApi(tools, 'local-test-token');
  t.after(async () => { api.server.closeAllConnections(); await new Promise(resolve => api.server.close(resolve)); await store.close(); await rm(root, { recursive: true, force: true }); });
  const response = await fetch(api.url + '/api/settings', { method: 'PATCH', headers: { Authorization: 'Bearer local-test-token', 'Content-Type': 'application/json' }, body: JSON.stringify(config('deepseek')) });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes('fixture-key'));
  const kb = await tools.execute('create_kb', { name: '抽取测试' });
  const node = await tools.execute('create_node', { kbId: kb.id, title: '云端文档' });
  const result = await tools.execute('update_doc', { id: node.id, markdown: '知识图谱正文', revision: 0 });
  assert.equal(result.extraction, 'completed');
  const concepts = await tools.execute('query_neighbors', { id: node.id });
  assert.equal(concepts[0].kind, 'Concept');
  assert.match(await store.document(concepts[0].id), /类型：技术/);
  fail = true;
  const failed = await tools.execute('update_doc', { id: node.id, markdown: '网络失败时的新正文', revision: 1 });
  assert.equal(failed.extraction, 'failed');
  assert.equal(failed.revision, 2);
  assert.equal(await store.document(node.id), '网络失败时的新正文');
  assert.equal((await tools.execute('query_neighbors', { id: node.id })).length, 1);
  await tools.execute('update_settings', { enabled: false });
  assert.equal((await tools.execute('update_doc', { id: node.id, markdown: '关闭抽取', revision: 2 })).extraction, 'disabled');
  assert.equal(calls, 2);
});

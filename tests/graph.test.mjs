import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphStore } from '../server/graph-store.mjs';
import { KnowledgeTools } from '../server/tools.mjs';

async function setup(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'graph-kb-test-'));
  const store = await new GraphStore(root).open();
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const tools = new KnowledgeTools(store, options);
  const kb = await tools.execute('create_kb', { name: '知识图谱测试' });
  const page = title => tools.execute('create_node', { kbId: kb.id, title });
  return { root, store, tools, kb, page };
}
const entities = [
  { name: '知识图谱', type: '技术', summary: '用节点与边表达知识。' },
  { name: 'RAG', type: '技术', summary: '检索增强生成。' },
  { name: '知识图谱', type: '技术', summary: '重复实体。' },
];

test('真实 Kùzu：保存→夹具抽取→Concept 去重→CHILD_OF；跨文档复用、跨库隔离', async t => {
  const { store, tools, page } = await setup(t, { extractionEnabled: true, extractor: { extract: async () => entities } });
  const a = await page('研究笔记'), b = await page('第二份笔记');
  const markdown = `# 知识图谱\n\nRAG 与中文内容。\n\n[第二份](node:${b.id})\n`;
  const first = await tools.execute('update_doc', { id: a.id, markdown, revision: 0 });
  assert.equal(first.conceptCount, 2);
  await tools.execute('update_doc', { id: a.id, markdown, revision: 1 });
  await tools.execute('update_doc', { id: b.id, markdown: 'RAG', revision: 0 });
  const [count] = await store.query("MATCH (n:Node {kind: 'Concept'}) RETURN count(n) AS count");
  assert.equal(Number(count.count), 2);
  const [edges] = await store.query("MATCH (c:Node {kind: 'Concept'})-[:CHILD_OF]->(:Node) RETURN count(*) AS count");
  assert.equal(Number(edges.count), 4);
  assert.equal((await tools.execute('list_nodes', { kbId: a.kbId })).length, 2);
  assert.equal((await tools.execute('get_node', { id: a.id })).markdown, markdown);
  const concepts = (await tools.execute('query_neighbors', { id: a.id })).filter(n => n.kind === 'Concept');
  assert.equal(concepts.length, 2);
  assert.match(await store.document(concepts[0].id), /^# /);
  const kb2 = await tools.execute('create_kb', { name: '另一个库' });
  const c = await tools.execute('create_node', { kbId: kb2.id, title: '独立概念空间' });
  await tools.execute('update_doc', { id: c.id, markdown: 'RAG', revision: 0 });
  const [all] = await store.query("MATCH (n:Node {kind: 'Concept'}) RETURN count(n) AS count");
  assert.equal(Number(all.count), 4);
});

test('默认关闭抽取；正文只在 Markdown 文件；node: 引用不创建边', async t => {
  const { store, tools, page } = await setup(t, { extractor: { extract() { throw new Error('must never call'); } } });
  const a = await page('文档');
  const result = await tools.execute('update_doc', { id: a.id, markdown: `[link](node:${a.id})`, revision: 0 });
  assert.equal(result.extraction, 'disabled');
  const [count] = await store.query('MATCH (:Node)-[r]->(:Node) RETURN count(r) AS count');
  assert.equal(Number(count.count), 0);
  const [record] = await store.query('MATCH (n:Node) RETURN n');
  assert.equal(Object.hasOwn(record.n, 'markdown'), false);
});

test('两种边规则：排序去重、双向读取、降为子节点清理平行边、拒绝环/跨库/自环', async t => {
  const { store, tools, page, kb } = await setup(t);
  const a = await page('A'), b = await page('B'), c = await page('C');
  const edge = (type, source, target) => tools.execute('create_edge', { type, source, target });
  await edge('SIBLING_OF', a.id, b.id);
  await edge('SIBLING_OF', b.id, a.id);
  const [pairs] = await store.query('MATCH (:Node)-[:SIBLING_OF]->(:Node) RETURN count(*) AS count');
  assert.equal(Number(pairs.count), 3);
  const rows = await store.query('MATCH (a:Node)-[:SIBLING_OF]->(b:Node) RETURN a.id AS a, b.id AS b');
  assert.ok(rows.every(row => row.a < row.b));
  assert.equal((await tools.execute('query_neighbors', { id: a.id })).length, 2);
  await edge('CHILD_OF', c.id, b.id);
  await edge('CHILD_OF', b.id, a.id);
  await assert.rejects(edge('CHILD_OF', a.id, c.id), { code: 'CYCLE' });
  await assert.rejects(edge('SIBLING_OF', a.id, c.id), { code: 'NOT_TOP_LEVEL' });
  await assert.rejects(edge('CHILD_OF', a.id, a.id), { code: 'SELF_EDGE' });
  await assert.rejects(edge('REFERENCE', a.id, b.id), { code: 'INVALID_EDGE_TYPE' });
  const other = await tools.execute('create_kb', { name: '其他库' });
  const d = await tools.execute('create_node', { kbId: other.id, title: 'D' });
  await assert.rejects(edge('CHILD_OF', a.id, d.id), { code: 'CROSS_KB' });
  const [remaining] = await store.query('MATCH (:Node)-[:SIBLING_OF]->(:Node) RETURN count(*) AS count');
  assert.equal(Number(remaining.count), 0);
  assert.equal((await tools.execute('list_nodes', { kbId: kb.id })).length, 3);
});

test('并发保存不会丢失更新；冲突明确返回，不覆盖文件', async t => {
  const { tools, page } = await setup(t);
  const a = await page('并发');
  const saves = await Promise.allSettled(['one', 'two'].map(markdown => tools.execute('update_doc', { id: a.id, markdown, revision: 0 })));
  assert.equal(saves.filter(s => s.status === 'fulfilled').length, 1);
  assert.equal(saves.find(s => s.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await tools.execute('get_node', { id: a.id })).markdown, 'one');
});

test('数据库失败回滚；文件及节点版本保持一致', async t => {
  const { store, tools, page, root } = await setup(t);
  const a = await page('回滚');
  await assert.rejects(store.run(() => store.transaction([{ id: a.id, markdown: '不应提交' }], async () => {
    await store.query('MATCH (n:Node {id: $id}) SET n.revision = 99', { id: a.id });
    throw new Error('injected graph failure');
  })), /injected graph failure/);
  assert.equal((await tools.execute('get_node', { id: a.id })).revision, 0);
  assert.equal(await store.document(a.id), '');
  assert.deepEqual(await readdir(join(root, 'journal')), []);
});

test('提交后文件提升失败：重开图库自动恢复 Markdown，节点版本和边保留', async t => {
  const { store, tools, page } = await setup(t);
  const a = await page('恢复');
  const originalPromote = store.promote;
  store.promote = async () => { throw new Error('injected file promotion failure'); };
  await assert.rejects(tools.execute('update_doc', { id: a.id, markdown: '已提交，等待恢复', revision: 0 }), /promotion failure/);
  await store.close();
  store.promote = originalPromote;
  store.unhealthy = false;
  await store.open();
  const restored = await tools.execute('get_node', { id: a.id });
  assert.equal(restored.markdown, '已提交，等待恢复');
  assert.equal(restored.revision, 1);
});

test('正常重启持久化；中文、引号和 Cypher 字样按参数保存', async t => {
  const { store, tools, page, kb } = await setup(t);
  const a = await page("中文 ' MATCH (n) DETACH DELETE n");
  const b = await page('另一个节点');
  await tools.execute('update_doc', { id: a.id, markdown: '# 重启\n\n✅ 知识图谱', revision: 0 });
  await store.close();
  await store.open();
  assert.equal((await tools.execute('get_node', { id: a.id })).markdown, '# 重启\n\n✅ 知识图谱');
  assert.equal((await tools.execute('list_nodes', { kbId: kb.id })).length, 2);
  assert.equal((await tools.execute('query_neighbors', { id: b.id }))[0].id, a.id);
});

test('非法抽取与未配置模型不留下半份文档或概念', async t => {
  const { store, tools, page } = await setup(t, { extractionEnabled: true });
  const a = await page('输入校验');
  await assert.rejects(tools.execute('update_doc', { id: a.id, markdown: 'a', revision: 0 }), { code: 'EXTRACTOR_UNCONFIGURED' });
  tools.extractor = { extract: async () => [{ name: 'A', summary: '缺少类型' }] };
  await assert.rejects(tools.execute('update_doc', { id: a.id, markdown: 'a', revision: 0 }), { code: 'INVALID_INPUT' });
  assert.equal(await store.document(a.id), '');
  await assert.rejects(tools.execute('get_node', { id: '../../secret' }), { code: 'INVALID_ID' });
});

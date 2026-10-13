import { Crepe } from '@milkdown/crepe';
import { linkSchema } from '@milkdown/kit/preset/commonmark';
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { api, type KnowledgeBase, type PageNode } from './api';
import { renderSettings, type CloudConfig } from './settings';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const icon = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8 8 16 4-9 14L8 8Z" stroke="currentColor"/><circle cx="8" cy="8" r="5"/><circle cx="24" cy="12" r="4"/><circle cx="15" cy="26" r="4"/></svg>';
function el<T extends HTMLElement>(selector: string): T { return document.querySelector<T>(selector)!; }
function message(error: unknown) { el<HTMLElement>('#status').textContent = error instanceof Error ? error.message : String(error); }
function text(tag: string, value: string) { const e = document.createElement(tag); e.textContent = value; return e; }

async function openDocument(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('内部链接无效');
  if (isTauri()) {
    const label = `doc-${id}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) { await existing.setFocus(); return; }
    const window = new WebviewWindow(label, { url: `/?node=${id}`, title: '文档', width: 760, height: 800, minWidth: 480 });
    window.once('tauri://error', event => message(String(event.payload)));
  } else {
    const child = window.open(`/?node=${id}`, `doc-${id}`, 'popup,width=760,height=800');
    if (!child) throw new Error('浏览器阻止了文档窗口，请允许本地页面弹出窗口');
  }
}

async function home() {
  app.innerHTML = `<aside><div class="brand">${icon}<b>知识图谱</b></div><button id="home-nav" class="nav active">◦　知识库</button><button id="settings-nav" class="nav">◦　设置</button><div class="workspace"><span>本</span>本地工作区</div></aside><main><header><div><h1>知识库 <small id="count"></small></h1><p>让知识相互连接</p></div><button class="primary" id="new-kb">＋ 新建知识库</button></header><p id="status" role="status"></p><div id="content"></div><footer>Phase 0 技术验证 · 自动建图默认关闭</footer></main>`;
  el('#settings-nav').onclick = () => {
    el('#home-nav').classList.remove('active'); el('#settings-nav').classList.add('active');
    void renderSettings(el('main')).catch(message);
  };
  el('#home-nav').onclick = () => home().catch(message);
  const kbs = await api<KnowledgeBase[]>('/api/kbs');
  el('#count').textContent = `${kbs.length} 个`;
  const content = el('#content');
  content.className = 'cards';
  if (!kbs.length) content.append(text('p', '创建第一个知识库，开始记录。'));
  for (const kb of kbs) {
    const card = document.createElement('button');
    card.className = 'card';
    card.innerHTML = `<span class="kb-icon">${icon}</span>`;
    card.append(text('h2', kb.name), text('p', `${kb.nodeCount} 个节点`));
    card.onclick = () => showKb(kb).catch(message);
    content.append(card);
  }
  el('#new-kb').onclick = () => nameDialog('新建知识库', '知识库名称', async name => { await api('/api/kbs', 'POST', { name }); await home(); });
}

function nameDialog(title: string, label: string, submit: (name: string) => Promise<void>) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form><h2></h2><label><span></span><input name="name" required maxlength="200" autocomplete="off" /></label><p role="alert"></p><div class="actions"><button type="button">取消</button><button class="primary" type="submit">创建</button></div></form>`;
  dialog.querySelector('h2')!.textContent = title;
  dialog.querySelector('label span')!.textContent = label;
  dialog.querySelector('button')!.onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.querySelector('form')!.onsubmit = async event => {
    event.preventDefault();
    const button = dialog.querySelector<HTMLButtonElement>('button[type=submit]')!;
    button.disabled = true;
    try { await submit(dialog.querySelector('input')!.value); dialog.close(); }
    catch (error) { dialog.querySelector('[role=alert]')!.textContent = String(error); button.disabled = false; }
  };
  document.body.append(dialog);
  dialog.showModal();
}

async function showKb(kb: KnowledgeBase) {
  el('main').innerHTML = `<header><div class="breadcrumb"><button id="back">‹ 返回</button><h1 id="kb-title"></h1></div><button class="primary" id="new-node">＋ 新建节点</button></header><p id="status" role="status"></p><section class="node-layout"><div><h2>文档节点</h2><div id="nodes"></div></div><div class="empty"><span>▤</span><h2>选择一个节点</h2><p>在独立窗口中打开 Markdown 文档</p></div></section><footer>Phase 0 · 节点来自 Kùzu · 图谱 / 目录完整视图将在 MVP 实现</footer>`;
  el('#kb-title').textContent = kb.name;
  el('#back').onclick = () => home().catch(message);
  el('#new-node').onclick = () => nameDialog('新建节点', '文档标题', async title => {
    await api<PageNode>('/api/nodes', 'POST', { kbId: kb.id, title });
    await showKb(kb);
  });
  const nodes = await api<PageNode[]>(`/api/kbs/${kb.id}/nodes`);
  if (!nodes.length) el('#nodes').append(text('p', '还没有文档节点'));
  for (const node of nodes) {
    const button = document.createElement('button');
    button.className = 'node';
    button.textContent = `◦　${node.title}`;
    button.onclick = () => openDocument(node.id).catch(message);
    el('#nodes').append(button);
  }
}

async function documentView(id: string) {
  app.className = 'document-app';
  app.innerHTML = `<div class="document"><header><h1 id="title">正在打开…</h1><button id="save" class="primary" disabled>保存</button></header><div class="document-meta"><span id="status" role="status">加载中</span><span id="extraction-state">自动建图：读取中</span></div><div id="editor"></div></div>`;
  const refreshSettings = async () => {
    try {
      const config = await api<CloudConfig>('/api/settings');
      el('#extraction-state').textContent = config.enabled ? `自动建图：${config.providers.find(p => p.id === config.provider)?.name}` : '自动建图：关闭';
    } catch { el('#extraction-state').textContent = '自动建图：状态不可用'; }
  };
  await refreshSettings();
  window.addEventListener('focus', () => void refreshSettings());
  const node = await api<PageNode>(`/api/nodes/${id}`);
  document.title = node.title;
  if (isTauri()) await WebviewWindow.getCurrent().setTitle(node.title);
  el('#title').textContent = node.title;
  let revision = node.revision;
  let dirty = false, editVersion = 0;
  const crepe = new Crepe({ root: '#editor', defaultValue: node.markdown, features: {
    [Crepe.Feature.Latex]: false,
    [Crepe.Feature.ImageBlock]: false,
    [Crepe.Feature.AI]: false,
  } });
  crepe.editor.config(ctx => {
    ctx.update(linkSchema.key, previous => context => {
      const schema = previous(context);
      return { ...schema, toDOM: (mark, inline) => {
        const href = mark.attrs.href;
        // Extend only UUID node links; retain Milkdown's sanitizer for every other URL.
        if (typeof href === 'string' && /^node:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(href))
          return ['a', { href, title: mark.attrs.title }];
        return schema.toDOM!(mark, inline);
      } };
    });
  });
  crepe.on(listener => listener.markdownUpdated(() => { dirty = true; editVersion++; el('#status').textContent = '有未保存的修改'; }));
  await crepe.create();
  dirty = false;
  el('#status').textContent = '已读取本地 Markdown';
  const save = el<HTMLButtonElement>('#save');
  save.disabled = false;
  const doSave = async () => {
    if (save.disabled) return;
    save.disabled = true;
    el('#status').textContent = '正在保存；开启自动建图时将等待云端抽取…';
    const savingVersion = editVersion;
    try {
      const result = await api<{ revision: number; extraction: string; conceptCount: number; warning?: { message: string } }>(`/api/nodes/${id}`, 'PATCH', { markdown: crepe.getMarkdown(), revision });
      revision = result.revision;
      dirty = savingVersion !== editVersion;
      const outcome = result.extraction === 'failed' ? `已保存到本地 · 抽取失败：${result.warning?.message}` : result.extraction === 'completed' ? `已保存到本地 · 已处理 ${result.conceptCount} 个后台概念` : '已保存到本地 · 图节点已同步';
      el('#status').textContent = dirty ? `${outcome}；仍有新修改未保存` : outcome;
    } catch (error) { message(error); }
    finally { save.disabled = false; }
  };
  save.onclick = doSave;
  window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void doSave(); } });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  if (isTauri()) await WebviewWindow.getCurrent().onCloseRequested(async event => {
    if (dirty && !window.confirm('文档尚未保存，确定关闭吗？')) event.preventDefault();
  });
  el('#editor').addEventListener('click', event => {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    // Phase 0 only opens node links. Never navigate the application to untrusted HTML.
    event.preventDefault();
    event.stopPropagation();
    if (href.startsWith('node:')) void openDocument(href.slice(5)).catch(message);
    else el('#status').textContent = 'Phase 0 仅验证内部节点链接';
  }, true);
}

const nodeId = new URLSearchParams(location.search).get('node');
(nodeId ? documentView(nodeId) : home()).catch(message);

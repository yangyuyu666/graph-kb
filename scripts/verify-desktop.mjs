// Attach to a test-launched WebView2 with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
// set to --remote-debugging-port=9223. Creates a clearly named test knowledge base.
import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
const base = `http://127.0.0.1:${process.env.GRAPH_KB_CDP_PORT ?? 9223}`;
const targets = async () =>
  (await (await fetch(`${base}/json`)).json()).filter((t) => t.type === "page");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error("Native UI assertion timed out");
}
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, "open");
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const callback = pending.get(message.id);
      if (!callback) return;
      clearTimeout(callback.timer);
      pending.delete(message.id);
      if (message.error)
        callback.reject(new Error(JSON.stringify(message.error)));
      else callback.resolve(message.result);
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`Native protocol timed out: ${method}`));
      }, 15000);
      pending.set(key, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  return { send, evaluate, close: () => ws.close() };
}
const connections = [];
try {
  const main = await connect(
    (await targets()).find((t) => !t.url.includes("?node=")),
  );
  connections.push(main);
  await main.evaluate(`document.querySelector('#home-nav')?.click()`);
  await until(() =>
    main.evaluate('!!document.querySelector("#new-kb")?.onclick'),
  );
  assert.equal(await main.evaluate("!!window.__TAURI_INTERNALS__"), true);
  // No bearer token leaves the page context or appears in test output.
  await main.evaluate(`window.qaRequest = async (path, method = 'GET', body) => {
    const c = await window.__TAURI_INTERNALS__.invoke('api_connection');
    const r = await fetch(c.url + path, { method, headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw Error(await r.text()); return r.json();
  }`);
  const tag = `桌面验证 ${Date.now()}`;
  await main.evaluate(`document.querySelector('#new-kb').click()`);
  await until(() => main.evaluate('!!document.querySelector("dialog input")'));
  await main.evaluate(
    `document.querySelector('dialog input').value = ${JSON.stringify(tag)}; document.querySelector('dialog form').requestSubmit()`,
  );
  await until(() =>
    main.evaluate(
      `Array.from(document.querySelectorAll('.card')).some(e => e.textContent.includes(${JSON.stringify(tag)}))`,
    ),
  );
  await until(() => main.evaluate('!document.querySelector("dialog")'));
  await main.evaluate(
    `Array.from(document.querySelectorAll('.card')).find(e => e.textContent.includes(${JSON.stringify(tag)})).click()`,
  );
  await until(() => main.evaluate('!!document.querySelector("#new-node")'));
  await until(() => main.evaluate(`!!document.querySelector('#graph-canvas canvas')`));
  assert.equal(await main.evaluate(`document.querySelector('[aria-label="关系筛选"]').value`), "CHILD_OF");
  await main.evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).find(e => e.textContent === '目录').click()`);
  await main.evaluate(`document.querySelector('#new-node').click()`);
  await until(() => main.evaluate('!!document.querySelector("dialog input")'));
  await main.evaluate(
    `document.querySelector('dialog input').value = '原生 Markdown 笔记'; document.querySelector('dialog form').requestSubmit()`,
  );
  await until(() => main.evaluate('!!document.querySelector(".node")'));
  await until(() => main.evaluate('!document.querySelector("dialog")'));
  await main.evaluate(`document.querySelector('.node').click()`);
  await until(() =>
    main.evaluate(
      '!!document.querySelector(".inline-document-pane .ProseMirror") && !document.querySelector(".inline-document-pane #save").disabled',
    ),
  );
  assert.equal((await targets()).length, 1);
  await main.evaluate(
    'document.querySelector(".inline-document-pane .ProseMirror").focus()',
  );
  await main.send("Input.insertText", { text: "右侧编辑保存验证。" });
  await main.evaluate(
    'document.querySelector(".inline-document-pane #save").click()',
  );
  await until(() =>
    main.evaluate(
      'document.querySelector(".inline-document-pane #status").textContent.includes("已保存到本地")',
    ),
  );
  const inlineShot = await main.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    "docs/evidence/tauri-inline-directory.png",
    Buffer.from(inlineShot.data, "base64"),
  );
  await main.evaluate(
    'document.querySelector(".node").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:360,clientY:300}))',
  );
  await until(() => main.evaluate('!!document.querySelector("[role=menu]")'));
  await main.evaluate(
    'document.querySelector("[role=menuitem][aria-label=在新窗口中打开]").click()',
  );
  const target = await until(async () =>
    (await targets()).find((t) => t.url.includes("?node=")),
  );
  const id = new URL(target.url).searchParams.get("node");
  const doc = await connect(target);
  connections.push(doc);
  await until(() =>
    doc.evaluate(
      '!!document.querySelector(".ProseMirror") && !document.querySelector("#save").disabled',
    ),
  );
  await doc.evaluate(`document.querySelector('.ProseMirror').focus()`);
  await doc.send("Input.insertText", {
    text: "中文知识图谱，Tauri 原生窗口保存验证。",
  });
  await until(() =>
    doc.evaluate(
      'document.querySelector("#status").textContent.includes("未保存")',
    ),
  );
  await doc.evaluate(`document.querySelector('#save').click()`);
  await until(() =>
    doc.evaluate(
      'document.querySelector("#status").textContent.includes("已保存到本地")',
    ),
  );
  const saved = await main.evaluate(`qaRequest('/api/nodes/${id}')`);
  assert.match(saved.markdown, /中文知识图谱/);
  assert.equal(saved.revision, 2);
  // Exercise the shipped tree UI and Cytoscape under Tauri's production CSP.
  await main.evaluate(
    'document.querySelector(".node").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:360,clientY:300}))',
  );
  await until(() => main.evaluate('!!document.querySelector("[role=menu]")'));
  await main.evaluate(
    'document.querySelector("[role=menuitem][aria-label=新建子节点]").click()',
  );
  await until(() => main.evaluate('!!document.querySelector("dialog input")'));
  await main.evaluate(
    `document.querySelector('dialog input').value = '原生子节点'; document.querySelector('dialog form').requestSubmit()`,
  );
  await until(() =>
    main.evaluate(
      '!document.querySelector("dialog") && !!document.querySelector(".tree-children .node")',
    ),
  );
  const graph = await main.evaluate(
    `qaRequest('/api/kbs/${saved.kbId}/graph')`,
  );
  assert.ok(graph.edges.some((e) => e.type === "CHILD_OF" && e.target === id));
  await main.evaluate(
    `Array.from(document.querySelectorAll('[role="tab"]')).find(e => e.textContent === '图谱').click()`,
  );
  await until(() =>
    main.evaluate('!!document.querySelector("#graph-canvas canvas")'),
  );
  await main.evaluate(`document.querySelector('#refresh-workspace').click()`);
  await until(() => main.evaluate(`!document.querySelector('#refresh-workspace').disabled && !!document.querySelector('#graph-canvas canvas')`));
  await main.evaluate(`document.querySelector('[aria-label="邻域中心"]').click()`);
  await until(() => main.evaluate(`!!document.querySelector('.node-picker-dialog[open]')`));
  await main.evaluate(`window.qaPreviousGraph = document.querySelector('#graph-canvas')._cyreg.cy; document.querySelector('.node-picker-dialog [data-node-id="${id}"] .node-picker-choice').click()`);
  await until(() => main.evaluate(`!document.querySelector('.node-picker-dialog') && document.querySelector('[aria-label="邻域中心"]').value === "${id}" && !!document.querySelector('#graph-canvas')?._cyreg?.cy && document.querySelector('#graph-canvas')._cyreg.cy !== window.qaPreviousGraph`));
  await main.evaluate(`document.querySelector('[aria-label="邻域中心"]').click()`);
  await until(() => main.evaluate(`!!document.querySelector('.node-picker-all')`));
  await main.evaluate(`window.qaPreviousGraph = document.querySelector('#graph-canvas')._cyreg.cy; document.querySelector('.node-picker-all').click()`);
  await until(() => main.evaluate(`!document.querySelector('.node-picker-dialog') && document.querySelector('[aria-label="邻域中心"]').value === "" && !!document.querySelector('#graph-canvas')?._cyreg?.cy && document.querySelector('#graph-canvas')._cyreg.cy !== window.qaPreviousGraph`));
  assert.equal(
    await main.evaluate(
      `document.querySelector('#graph-canvas canvas').width > 0`,
    ),
    true,
  );
  const point = await main.evaluate(
    `(() => { const canvas=document.querySelector('#graph-canvas');const p=canvas._cyreg.cy.nodes()[0].renderedPosition();const r=canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}; })()`,
  );
  await main.evaluate(`window.qaNativeMenus = []; window.addEventListener('contextmenu', event => window.qaNativeMenus.push(event.defaultPrevented));`);
  await main.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "right",
    buttons: 2,
    clickCount: 1,
    ...point,
  });
  await main.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "right",
    buttons: 0,
    clickCount: 1,
    ...point,
  });
  await until(() => main.evaluate('!!document.querySelector("[role=menu]")'));
  assert.deepEqual(await main.evaluate('window.qaNativeMenus'), [true]);
  assert.equal(await main.evaluate(`document.querySelector('[role=menuitem]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`), false);
  assert.equal((await targets()).length, 2);
  const menuShot = await main.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "docs/evidence/tauri-node-menu.png",
    Buffer.from(menuShot.data, "base64"),
  );
  await main.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await main.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(() => main.evaluate('!document.querySelector("[role=menu]")'));
  const edgePoint = await main.evaluate(
    `(() => { const canvas=document.querySelector('#graph-canvas');const p=canvas._cyreg.cy.edges()[0].renderedMidpoint();const r=canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}; })()`,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await main.send("Input.dispatchMouseEvent", {
      type, button: "right", buttons: type === "mousePressed" ? 2 : 0,
      clickCount: 1, ...edgePoint,
    });
  await until(() => main.evaluate('!!document.querySelector("[role=menuitem][aria-label=编辑边文字]")'));
  assert.deepEqual(await main.evaluate('window.qaNativeMenus'), [true, true, true]);
  await main.evaluate('document.querySelector("[role=menuitem][aria-label=编辑边文字]").click()');
  await until(() => main.evaluate('!!document.querySelector("dialog textarea")'));
  await main.evaluate(`document.querySelector('dialog textarea').value='原生边文字\\n原生详情第二行'; document.querySelector('dialog form').requestSubmit()`);
  await until(() => main.evaluate('!document.querySelector("dialog")'));
  assert.equal(
    await main.evaluate(`document.querySelector('#graph-canvas')._cyreg.cy.edges()[0].style('label')`),
    "原生边文字",
  );
  const labeledGraph = await main.evaluate(`qaRequest('/api/kbs/${saved.kbId}/graph')`);
  assert.equal(labeledGraph.edges[0].label, "原生边文字\n原生详情第二行");
  const detailPoint = await main.evaluate(`(() => { const canvas=document.querySelector('#graph-canvas'); const p=canvas._cyreg.cy.edges()[0].renderedMidpoint(); const r=canvas.getBoundingClientRect(); return {x:r.left+p.x,y:r.top+p.y}; })()`);
  for (const type of ["mousePressed", "mouseReleased"])
    await main.send("Input.dispatchMouseEvent", { type, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1, ...detailPoint });
  await until(() => main.evaluate('!!document.querySelector(".edge-detail-content")'));
  assert.equal(await main.evaluate('document.querySelector(".edge-detail-content").textContent'), "原生边文字\n原生详情第二行");
  await main.evaluate('document.querySelector("dialog").close()');
  const graphShot = await main.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    "docs/evidence/tauri-graph.png",
    Buffer.from(graphShot.data, "base64"),
  );
  const child = graph.nodes.find((n) => n.id !== id);
  const branchPoint = await main.evaluate(`(() => { const canvas=document.querySelector('#graph-canvas'); const p=canvas._cyreg.cy.getElementById('${child.id}').renderedPosition(); const r=canvas.getBoundingClientRect(); return {x:r.left+p.x,y:r.top+p.y}; })()`);
  for (const type of ["mousePressed", "mouseReleased"])
    await main.send("Input.dispatchMouseEvent", { type, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1, ...branchPoint });
  await until(() => main.evaluate(`!!document.querySelector('[role=menuitem][aria-label="只看此节点及全部子节点"]')`));
  await main.evaluate(`document.querySelector('[role=menuitem][aria-label="只看此节点及全部子节点"]').click()`);
  await until(() => main.evaluate(`document.querySelector('#graph-canvas')?._cyreg?.cy?.nodes().length === 1`));
  assert.equal(await main.evaluate(`document.querySelector('#graph-canvas')._cyreg.cy.nodes()[0].id()`), child.id);
  assert.equal((await main.evaluate(`qaRequest('/api/kbs/${saved.kbId}/graph?center=${child.id}&scope=descendants')`)).nodes.length, 1);
  await main.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === '全库图谱').click()`);
  await until(() => main.evaluate(`document.querySelector('#graph-canvas')?._cyreg?.cy?.nodes().length === 2`));
  const deleted = await main.evaluate(
    `qaRequest('/api/nodes/${child.id}', 'DELETE')`,
  );
  assert.equal((await main.evaluate(`qaRequest('/api/trash')`)).length, 1);
  await main.evaluate(
    `qaRequest('/api/trash/${deleted.id}/restore', 'POST', {})`,
  );
  assert.equal(
    (await main.evaluate(`qaRequest('/api/kbs/${saved.kbId}/graph')`)).edges[0].label,
    "原生边文字\n原生详情第二行",
  );
  assert.equal(
    (await main.evaluate(`qaRequest('/api/kbs/${saved.kbId}/graph')`)).nodes
      .length,
    2,
  );
  const database = await main.evaluate(`qaRequest('/api/databases/${saved.kbId}/export', 'POST', {})`);
  assert.equal(database.format, "graph-kb-database");
  const imported = await main.evaluate(`qaRequest('/api/databases/import', 'POST', ${JSON.stringify({ data: database, mode: "copy" })})`);
  assert.notEqual(imported.id, saved.kbId);
  assert.equal((await main.evaluate(`qaRequest('/api/kbs/${imported.id}/graph')`)).nodes.length, 2);
  const linked = await main.evaluate(
    `qaRequest('/api/nodes', 'POST', { kbId: ${JSON.stringify(saved.kbId)}, title: '原生关联文档' })`,
  );
  const markdown = `# 原生 Markdown 验证\n\n中文 **知识图谱**。\n\n[原生关联文档](node:${linked.id})\n\n\`\`\`cpp\n// 中文代码注释\nint main() { return 0; }\n\`\`\`\n`;
  await main.evaluate(
    `qaRequest('/api/nodes/${id}', 'PATCH', ${JSON.stringify({ revision: 2, markdown })})`,
  );
  await doc.send("Page.reload");
  await until(() =>
    doc.evaluate(`!!document.querySelector('a[href="node:${linked.id}"]')`),
  );
  await until(() => doc.evaluate(`!!document.querySelector('.code-enlarge')`));
  assert.equal(await doc.evaluate(`getComputedStyle(document.querySelector('.milkdown-code-block')).backgroundColor`), "rgb(24, 26, 31)");
  await doc.evaluate(`document.querySelector('.code-enlarge').click()`);
  await until(() => doc.evaluate(`!!document.querySelector('.milkdown-code-block:popover-open')`));
  assert.equal(await doc.evaluate(`document.querySelector('.milkdown-code-block').getBoundingClientRect().width > innerWidth * 0.9`), true);
  await doc.evaluate(`document.querySelector('.code-enlarge').click()`);
  await until(() => doc.evaluate(`!document.querySelector('.milkdown-code-block:popover-open')`));
  const shot = await doc.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "docs/evidence/tauri-editor.png",
    Buffer.from(shot.data, "base64"),
  );
  await doc.evaluate(
    `document.querySelector('a[href="node:${linked.id}"]').click()`,
  );
  await until(async () =>
    (await targets()).some((t) => t.url.includes(linked.id)),
  );
  assert.equal((await targets()).length, 3);
  await main.evaluate(`document.querySelector('#settings-nav').click()`);
  await until(() => main.evaluate('!!document.querySelector("#cloud-form")'));
  assert.equal(await main.evaluate(`document.querySelector('#default-view').value`), "graph");
  await main.evaluate(`document.querySelector('#default-view').value = 'tree'; document.querySelector('#default-view').dispatchEvent(new Event('change', {bubbles:true}))`);
  assert.equal(await main.evaluate(`localStorage.getItem('graph-kb:default-view')`), "tree");
  assert.equal(
    await main.evaluate(
      'document.querySelector("#extraction-enabled").checked',
    ),
    false,
  );
  const settingsShot = await main.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    "docs/evidence/tauri-settings.png",
    Buffer.from(settingsShot.data, "base64"),
  );
  const propertyNode = await main.evaluate(`qaRequest('/api/nodes/${linked.id}', 'PATCH', {revision:0, properties:{priority:2,nested:{tags:['desktop']}}})`);
  assert.equal(propertyNode.revision, 1);
  assert.deepEqual(propertyNode.properties, { priority: 2, nested: { tags: ["desktop"] } });
  const propertyEdge = await main.evaluate(`qaRequest('/api/edges/${encodeURIComponent(labeledGraph.edges[0].id)}', 'PATCH', {properties:{confidence:0.95}})`);
  assert.deepEqual(propertyEdge.properties, { confidence: 0.95 });
  const propertyBackup = await main.evaluate(`qaRequest('/api/databases/${saved.kbId}/export', 'POST', {})`);
  assert.deepEqual(propertyBackup.nodes.find(n => n.id === linked.id).properties, propertyNode.properties);
  assert.deepEqual(propertyBackup.edges.find(e => e.id === propertyEdge.id).properties, propertyEdge.properties);
  // Close all native windows via their actual Tauri permissions and lifecycle.
  await main.evaluate(
    `window.__TAURI_INTERNALS__.invoke('plugin:window|close', {label:'doc-${linked.id}'})`,
  );
  await main.evaluate(
    `window.__TAURI_INTERNALS__.invoke('plugin:window|close', {label:'doc-${id}'})`,
  );
  await until(async () => (await targets()).length === 1);
  await main.evaluate(
    `setTimeout(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', {label:'main'}), 100)`,
  );
  console.log(
    "PASS: Tauri IPC, inline editing, tree context menu, parent/child creation, Cytoscape canvas, edge label context edit and restore, node/edge properties and database export, database copy import, trash/restore, Milkdown input, dark code block and enlarge/collapse, real Kùzu save, native node-link windows, settings default off, native window close",
  );
} finally {
  for (const connection of connections) connection.close();
}

// Reproducible README screenshots from the real app and a disposable database.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:1420";
try {
  await fetch(base, { signal: AbortSignal.timeout(500) });
  throw new Error("Port 1420 is already in use; stop the development server first.");
} catch (error) {
  if (error.message.startsWith("Port 1420")) throw error;
}
await mkdir(".graph-kb", { recursive: true });
await mkdir("docs/images", { recursive: true });
const root = await mkdtemp(resolve(".graph-kb/readme-"));
const server = spawn(process.execPath, ["scripts/dev.mjs"], {
  env: { ...process.env, GRAPH_KB_DATA_DIR: root }, windowsHide: true, stdio: "ignore",
});
const exited = once(server, "exit");
let browser;
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (server.exitCode !== null) throw Error("Demo server exited before startup");
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Demo server did not start");
  const api = async (path, method = "GET", body) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw Error(`Demo API failed: ${response.status}`);
    return response.json();
  };
  const kb = await api("/api/kbs", "POST", { name: "研究工作台" });
  const node = (title, parentId) => api("/api/nodes", "POST", { kbId: kb.id, title, parentId });
  const rootNode = await node("知识管理实践");
  for (const [title, notes] of [
    ["阅读与资料", ["论文阅读笔记", "概念与术语"]],
    ["实验与验证", ["实验设计", "结果与复盘"]],
    ["写作与产出", ["文章提纲", "参考资料"]],
  ]) {
    const parent = await node(title, rootNode.id);
    for (const note of notes) await node(note, parent.id);
  }
  await api(`/api/nodes/${rootNode.id}`, "PATCH", { revision: 0, markdown: `# 一份笔记，两种视角\n\n在目录中整理内容，在图谱中发现联系。**目录与图谱共享同一份节点和关系。**\n\n## 今天的研究\n\n- [x] 收集论文与参考资料\n- [x] 整理研究问题与概念\n- [ ] 完成实验记录与复盘\n\n> 先把内容写清楚，再用关系组织它。\n\n## 工作流\n\n| 阶段 | 记录内容 |\n| --- | --- |\n| 阅读 | 观点、证据与引用 |\n| 实验 | 假设、步骤与结果 |\n| 写作 | 提纲、结论与下一步 |\n\n## 让 AI 协助整理\n\n通过 MCP 创建子节点、更新 Markdown、查询全部递归后代。每一次修改都使用相同的数据接口。\n` });
  const graph = await api(`/api/kbs/${kb.id}/graph`);
  const edge = graph.edges.find((e) => e.target === rootNode.id);
  await api(`/api/edges/${encodeURIComponent(edge.id)}`, "PATCH", { label: "研究分支\n把相关资料和笔记组织在同一条分支下。" });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(base);
  await page.getByRole("button", { name: /研究工作台/ }).click();
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: rootNode.title, exact: true }).click();
  await page.locator(".ProseMirror h1").waitFor();
  // Remove pointer focus outlines, without changing the UI or document content.
  await page.locator(".tree-heading").click();
  await page.screenshot({ path: "docs/images/directory.png" });
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await page.locator("#graph-canvas canvas").first().waitFor();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.locator(".graph-legend").click();
  await page.screenshot({ path: "docs/images/graph.png" });
  const point = await page.locator("#graph-canvas").evaluate((el, id) => {
    const p = el._cyreg.cy.getElementById(id).renderedMidpoint(), r = el.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, edge.id);
  await page.mouse.click(point.x, point.y);
  await page.locator(".edge-detail-content").waitFor();
  await page.screenshot({ path: "docs/images/edge-detail.png" });
  console.log("README screenshots captured from isolated demo data.");
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
  await exited;
}

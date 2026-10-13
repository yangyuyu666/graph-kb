import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("目录子节点创建、折叠、图谱切换、路径与子图导出", async ({
  page,
  request,
}) => {
  const kb = await (
    await request.post("/api/kbs", { data: { name: "层级目录验证" } })
  ).json();
  const root = await (
    await request.post("/api/nodes", {
      data: { kbId: kb.id, title: "图知识库应用开发" },
    })
  ).json();
  await request.post("/api/nodes", {
    data: { kbId: kb.id, title: "基于大模型的软件漏洞挖掘" },
  });
  await page.goto("/");
  await page.getByRole("button", { name: /层级目录验证/ }).click();
  await expect(
    page.getByRole("tab", { name: "目录", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "图知识库应用开发", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建子节点", exact: true }).click();
  await expect(page.getByLabel("创建位置")).toHaveValue(root.id);
  await page.getByLabel("文档标题").fill("回顾问候");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  const graph = await (await request.get(`/api/kbs/${kb.id}/graph`)).json();
  const child = graph.nodes.find((n: any) => n.title === "回顾问候");
  expect(
    graph.edges.some(
      (e: any) =>
        e.source === child.id && e.target === root.id && e.type === "CHILD_OF",
    ),
  ).toBe(true);
  const parentItem = page.locator(`.tree-item[data-node-id="${root.id}"]`);
  await expect(parentItem.locator(".tree-children")).toContainText("回顾问候");
  await page
    .getByRole("button", { name: "折叠 图知识库应用开发", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "回顾问候", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "展开 图知识库应用开发", exact: true })
    .click();
  await page.screenshot({ path: "docs/evidence/mvp-tree.png" });
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await expect(page.locator("#graph-canvas canvas").first()).toBeVisible();
  await page.getByLabel("邻域中心", { exact: true }).selectOption(root.id);
  await page.getByLabel("路径终点").selectOption(child.id);
  await page.getByRole("button", { name: "查找路径" }).click();
  await expect(page.locator("#status")).toContainText("路径包含 1 条关系");
  await page.screenshot({ path: "docs/evidence/mvp-graph.png" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前子图" }).click();
  const jsonDownload = await download;
  expect(jsonDownload.suggestedFilename()).toContain("图谱.json");
  const exported = JSON.parse(
    await readFile((await jsonDownload.path())!, "utf8"),
  );
  expect(exported.nodes).toHaveLength(2);
  expect(exported.edges).toHaveLength(1);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
  const png = await readFile((await (await pngDownload).path())!);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "回顾问候", exact: true }),
  ).toBeVisible();
});
test("界面重命名、软删除、已删除链接占位和回收站恢复", async ({
  page,
  context,
  request,
}) => {
  const kb = await (
    await request.post("/api/kbs", { data: { name: "回收站验证" } })
  ).json();
  const a = await (
    await request.post("/api/nodes", { data: { kbId: kb.id, title: "来源" } })
  ).json();
  const b = await (
    await request.post("/api/nodes", { data: { kbId: kb.id, title: "被引用" } })
  ).json();
  await request.patch(`/api/nodes/${a.id}`, {
    data: { markdown: `[引用](node:${b.id})`, revision: 0 },
  });
  await page.goto("/");
  await page.getByRole("button", { name: /回收站验证/ }).click();
  await page
    .getByRole("button", { name: "被引用", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByLabel("文档标题").fill("改名后");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "改名后", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "仅删除当前节点", exact: true })
    .click();
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  expect((await request.get(`/api/nodes/${b.id}`)).status()).toBe(410);
  const doc = await context.newPage();
  await doc.goto(`/?node=${a.id}`);
  await expect(doc.locator(".deleted-reference")).toHaveAttribute(
    "aria-label",
    "已删除节点",
  );
  await doc.getByRole("button", { name: "保存", exact: true }).click();
  expect(
    (await (await request.get(`/api/nodes/${a.id}`)).json()).markdown,
  ).toContain(`node:${b.id}`);
  await page.getByRole("button", { name: /回收站/, exact: false }).click();
  const row = page.locator(".trash-row").filter({ hasText: "改名后" });
  await row.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(row).toHaveCount(0);
  await doc.reload();
  await expect(doc.locator(".deleted-reference")).toHaveCount(0);
  expect((await request.get(`/api/nodes/${b.id}`)).status()).toBe(200);
});
test("Markdown 导入、全文搜索、附件保存与 MCP 配置入口", async ({
  page,
  request,
  context,
}) => {
  const kb = await (
    await request.post("/api/kbs", { data: { name: "导入与附件" } })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: /导入与附件/ }).click();
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.getByLabel("选择文件").setInputFiles({
    name: "导入笔记.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 专属检索词\n\n正文内容"),
  });
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("已导入");
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "导入笔记", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "在新窗口中打开", exact: true })
    .click();
  const doc = await popup;
  await expect(doc.locator(".ProseMirror")).toBeVisible();
  await doc.locator("input[type=file]").setInputFiles({
    name: "附件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("实际附件"),
  });
  await expect(doc.locator('.ProseMirror a[href^="asset:"]')).toContainText("附件.txt");
  await doc.getByRole("button", { name: "保存", exact: true }).click();
  await expect(doc.getByRole("status")).toContainText("已保存");
  await doc.reload();
  await doc.locator('a[href^="asset:"]').click();
  await expect(doc.getByRole("heading", { name: "附件.txt" })).toBeVisible();
  await page.getByRole("button", { name: /全局搜索/ }).click();
  await page.getByLabel("全局搜索词").fill("专属检索词");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".search-result")).toContainText("导入笔记");
  await page.getByRole("button", { name: /设置/ }).click();
  await page.getByRole("button", { name: "显示本地连接配置" }).click();
  await expect(page.getByLabel("MCP 连接配置")).toHaveValue(/mcpServers/);
  const config = JSON.parse(await page.getByLabel("MCP 连接配置").inputValue());
  expect(config.mcpServers["graph-kb"].args[0]).toContain("mcp.mjs");
});

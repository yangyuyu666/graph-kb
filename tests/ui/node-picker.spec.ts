import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("图谱中心按层级选择、同名和共享节点、辅助搜索与右键设为中心", async ({ page, request }) => {
  const kb = await (await request.post("/api/kbs", { data: { name: "节点目录选择" } })).json();
  const create = async (title: string, parentId?: string) => (await request.post("/api/nodes", { data: { kbId: kb.id, title, parentId } })).json();
  const a = await create("漏洞挖掘"), b = await create("论文阅读");
  const p = await create("3.1 污点分析", a.id);
  const leaf = await create("3.1.1 面向异构源码工程的项目级语义建模与上下文组织技术", p.id);
  const other = await create(leaf.title, b.id);
  await request.post("/api/edges", { data: { type: "CHILD_OF", source: leaf.id, target: b.id } });
  await page.goto("/");
  await page.getByRole("button", { name: /节点目录选择/ }).click();
  const picker = page.getByRole("button", { name: "邻域中心", exact: true });
  const dialog = page.getByRole("dialog", { name: "选择图谱中心" });
  await picker.click();
  await expect(dialog.getByRole("button", { name: `选择 ${leaf.title}`, exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "展开 漏洞挖掘", exact: true }).click();
  await dialog.getByRole("button", { name: "展开 3.1 污点分析", exact: true }).click();
  await dialog.getByRole("button", { name: "展开 论文阅读", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `选择 ${leaf.title}`, exact: true })).toHaveCount(3);
  await expect(dialog.getByText("共享", { exact: true })).toHaveCount(2);
  await mkdir("docs/evidence", { recursive: true });
  await page.screenshot({ path: "docs/evidence/node-picker.png" });
  await dialog.locator(`[data-node-id="${other.id}"] .node-picker-choice`).click();
  await expect(dialog).toHaveCount(0);
  await expect(picker).toHaveAttribute("data-node-id", other.id);
  await picker.click();
  await expect(dialog.locator(`[data-node-id="${other.id}"] [aria-current=true]`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(picker).toBeFocused();
  await picker.click();
  await dialog.getByRole("searchbox").fill("上下文组织");
  await expect(dialog.getByRole("button", { name: "选择 漏洞挖掘", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: `选择 ${leaf.title}`, exact: true })).toHaveCount(3);
  await dialog.getByRole("searchbox").fill("找不到的节点");
  await expect(dialog.getByText("没有匹配节点", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "查看全库图谱", exact: true }).click();
  await expect(picker).toHaveAttribute("data-node-id", "");
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: "3.1 污点分析", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "设为中心", exact: true }).click();
  await expect(picker).toHaveAttribute("data-node-id", p.id);
  await expect(page.getByLabel("图谱范围")).toHaveValue("neighbors");
  await expect.poll(() => page.locator("#graph-canvas").evaluate((el: any) => el._cyreg?.cy?.nodes().map((n: any) => n.id()).sort() ?? [])).toEqual([a.id, p.id, leaf.id].sort());
  // The same action is available directly on a graph node.
  const point = await page.locator("#graph-canvas").evaluate((el: any, id) => {
    const pos = el._cyreg.cy.getElementById(id).renderedPosition(), rect = el.getBoundingClientRect();
    return { x: rect.left + pos.x, y: rect.top + pos.y };
  }, leaf.id);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "设为中心", exact: true }).click();
  await expect(picker).toHaveAttribute("data-node-id", leaf.id);
});

test("空库的节点选择器可退出且没有虚构节点", async ({ page, request }) => {
  await request.post("/api/kbs", { data: { name: "空库选择" } });
  await page.goto("/");
  await page.getByRole("button", { name: /空库选择/ }).click();
  await page.getByRole("button", { name: "邻域中心", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选择图谱中心" });
  await expect(dialog.getByText("这个知识库还没有节点", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

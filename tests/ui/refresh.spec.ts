import { test, expect } from "@playwright/test";

test("刷新读取外部变更并保留图谱范围、筛选和目录草稿，失败可重试", async ({ page, request }) => {
  const kb = await (await request.post("/api/kbs", { data: { name: "刷新验证" } })).json();
  const parent = await (await request.post("/api/nodes", { data: { kbId: kb.id, title: "研究" } })).json();
  await page.goto("/");
  await page.getByRole("button", { name: /刷新验证/ }).click();
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: "研究", exact: true }).click();
  await page.locator(".ProseMirror").fill("保留未保存草稿");
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await page.getByRole("button", { name: "邻域中心", exact: true }).click();
  await page.getByRole("dialog", { name: "选择图谱中心" }).getByRole("button", { name: `选择 ${parent.title}`, exact: true }).click();
  await page.getByLabel("图谱范围", { exact: true }).selectOption("descendants");
  await page.getByLabel("关系筛选", { exact: true }).selectOption("CHILD_OF");
  await page.getByLabel("节点类型筛选").selectOption("Page");
  await page.getByRole("searchbox", { name: "搜索节点", exact: true }).fill("研究");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const labels = () => page.locator("#graph-canvas").evaluate((el: any) => el._cyreg?.cy?.nodes().map((n: any) => n.data("label")).sort() ?? []);
  await expect.poll(labels).toEqual(["研究"]);
  const child = await (await request.post("/api/nodes", { data: { kbId: kb.id, parentId: parent.id, title: "研究新节点" } })).json();
  await request.post("/api/nodes", { data: { kbId: kb.id, parentId: parent.id, title: "其他内容" } });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(labels).toEqual(["研究", "研究新节点"]);
  await expect(page.getByRole("button", { name: "邻域中心", exact: true })).toHaveAttribute("data-node-id", parent.id);
  await expect(page.getByLabel("图谱范围", { exact: true })).toHaveValue("descendants");
  await expect(page.getByLabel("关系筛选", { exact: true })).toHaveValue("CHILD_OF");
  await expect(page.getByLabel("节点类型筛选")).toHaveValue("Page");
  await request.delete(`/api/nodes/${child.id}`);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(labels).toEqual(["研究"]);
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toHaveText("保留未保存草稿");
  await page.route(`**/api/kbs/${kb.id}/graph`, route => route.fulfill({
    status: 500, json: { error: { code: "INTERNAL_ERROR", message: "刷新临时失败", suggestion: "请重试" } },
  }), { times: 1 });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".kb-workspace > #status")).toContainText("刷新临时失败");
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".kb-workspace > #status")).toContainText("找到 1 个节点");
  await expect(page.locator(".ProseMirror")).toHaveText("保留未保存草稿");
});

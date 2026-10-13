import { test, expect } from "@playwright/test";

async function fixture(request: any) {
  const kb = await (
    await request.post("/api/kbs", { data: { name: "交互验证 " + Date.now() } })
  ).json();
  const node = async (title: string, parentId?: string) =>
    await (
      await request.post("/api/nodes", {
        data: { kbId: kb.id, title, parentId },
      })
    ).json();
  const a = await node("项目文档"),
    b = await node("子文档", a.id),
    outside = await node("另一个项目");
  await request.patch(`/api/nodes/${a.id}`, {
    data: { revision: 0, markdown: "# 项目说明\n\n右侧可编辑正文" },
  });
  return { kb, a, b, outside, node };
}
async function enter(page: any, kb: any) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(kb.name) }).click();
}

test("目录单击内联编辑、拖拽分栏、草稿保护和右键菜单", async ({
  page,
  context,
  request,
}) => {
  const { kb, a, b } = await fixture(request);
  await enter(page, kb);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".tree-add,.tree-more")).toHaveCount(0);
  await page.getByRole("button", { name: a.title, exact: true }).click();
  const pane = page.locator(".inline-document-pane");
  await expect(pane.locator(".ProseMirror h1")).toHaveText("项目说明");
  expect(context.pages()).toHaveLength(1);
  await pane.locator(".ProseMirror").fill("右侧编辑后保存");
  const tree = page.locator(".tree-panel"),
    divider = page.getByRole("separator", { name: "调整目录宽度" });
  const initial = (await tree.boundingBox())!.width,
    bounds = (await divider.boundingBox())!;
  await page.mouse.move(bounds.x + 3, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 83, bounds.y + 100);
  await page.mouse.up();
  expect((await tree.boundingBox())!.width).toBeGreaterThan(initial + 60);
  await expect(pane.locator(".ProseMirror")).toHaveText("右侧编辑后保存");
  await page
    .getByRole("button", { name: "折叠 " + a.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: "展开 " + a.title, exact: true })
    .click();
  await expect(pane.locator(".ProseMirror")).toHaveText("右侧编辑后保存");
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await expect(pane.locator(".ProseMirror")).toHaveText("右侧编辑后保存");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: b.title, exact: true }).click();
  await expect(pane.locator("#title")).toHaveText(a.title);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: /全局搜索/ }).click();
  await expect(pane.locator(".ProseMirror")).toHaveText("右侧编辑后保存");
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(pane.getByRole("status")).toContainText("已保存到本地");
  expect(
    (await (await request.get(`/api/nodes/${a.id}`)).json()).markdown,
  ).toContain("右侧编辑后保存");
  await page.getByRole("button", { name: b.title, exact: true }).click();
  await expect(pane.locator("#title")).toHaveText(b.title);
  await page
    .getByRole("button", { name: a.title, exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  await page.screenshot({ path: "docs/evidence/node-context-menu.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: a.title, exact: true }).click();
  await expect(pane.locator(".ProseMirror")).toHaveText("右侧编辑后保存");
  await page.screenshot({ path: "docs/evidence/inline-directory.png" });
  expect(errors).toEqual([]);
});

test("图谱右键弹菜单而不打开文档；左键仍开独立窗口", async ({
  page,
  context,
  request,
}) => {
  const { kb, a } = await fixture(request);
  await enter(page, kb);
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  const canvas = page.locator("#graph-canvas");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  const point = await canvas.evaluate((el: any, id: string) => {
    const p = el._cyreg.cy.getElementById(id).renderedPosition();
    const r = el.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, a.id);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await page.screenshot({ path: "docs/evidence/graph-context-menu.png" });
  await page.keyboard.press("Escape");
  const popup = page.waitForEvent("popup");
  await page.mouse.click(point.x, point.y);
  const doc = await popup;
  await expect(doc.locator(".ProseMirror")).toBeVisible();
});

test("目录菜单级联删除和恢复，保留共享分支", async ({ page, request }) => {
  const { kb, a, b, outside, node } = await fixture(request);
  const shared = await node("共享文档", a.id);
  await request.post("/api/edges", {
    data: { type: "CHILD_OF", source: shared.id, target: outside.id },
  });
  await enter(page, kb);
  await page
    .getByRole("button", { name: a.title, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "级联删除", exact: true }).click();
  await expect(page.locator("dialog")).toContainText("共享给外部父节点");
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  expect((await request.get(`/api/nodes/${a.id}`)).status()).toBe(410);
  expect((await request.get(`/api/nodes/${b.id}`)).status()).toBe(410);
  expect((await request.get(`/api/nodes/${shared.id}`)).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: shared.title, exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: /回收站/ }).click();
  await page
    .locator(".trash-row")
    .filter({ hasText: a.title })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  expect((await request.get(`/api/nodes/${b.id}`)).status()).toBe(200);
});

test("快速保存后离开不误报草稿", async ({ page, request }) => {
  const { kb, a } = await fixture(request);
  await enter(page, kb);
  await page.getByRole("button", { name: a.title, exact: true }).click();
  const pane = page.locator(".inline-document-pane");
  await expect(pane.locator(".ProseMirror")).toBeVisible();
  await pane.locator(".ProseMirror").fill("快速保存正文");
  await pane
    .locator("#save")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(pane.getByRole("status")).toContainText("已保存到本地");
  // Let Milkdown's deferred markdown listener run after the fast local save.
  await page.waitForTimeout(400);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: /全局搜索/ }).click();
  await expect(page.getByLabel("全局搜索词")).toBeVisible();
  expect(dialogs).toEqual([]);
});

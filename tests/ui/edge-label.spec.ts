import { test, expect } from "@playwright/test";

test("右键边编辑文字，画布显示、刷新保留、管理关系可修改并清空", async ({ page, request }) => {
  const kb = await (await request.post("/api/kbs", { data: { name: "边文字界面验证" } })).json();
  const parent = await (await request.post("/api/nodes", { data: { kbId: kb.id, title: "参考目录" } })).json();
  await request.post("/api/nodes", { data: { kbId: kb.id, title: "研究笔记", parentId: parent.id } });
  const edge = (await (await request.get(`/api/kbs/${kb.id}/graph`)).json()).edges[0];
  await page.goto("/");
  await page.getByRole("button", { name: /边文字界面验证/ }).click();
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await expect(page.locator("#graph-canvas canvas").first()).toBeVisible();
  async function rightClickEdge() {
    const point = await page.locator("#graph-canvas").evaluate((el: any) => {
      const p = el._cyreg.cy.edges()[0].renderedMidpoint();
      const box = el.getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    });
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByRole("menuitem", { name: "编辑边文字", exact: true }).click();
  }
  await rightClickEdge();
  await page.getByLabel("边文字（可选）", { exact: true }).fill("参考资料");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  expect((await (await request.get(`/api/edges/${encodeURIComponent(edge.id)}`)).json()).label).toBe("参考资料");
  expect(await page.locator("#graph-canvas").evaluate((el: any) => el._cyreg.cy.edges()[0].style("label"))).toBe("参考资料");
  await page.screenshot({ path: "docs/evidence/edge-label.png" });
  await page.reload();
  await page.getByRole("button", { name: /边文字界面验证/ }).click();
  await page.getByRole("button", { name: "研究笔记", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "管理关系", exact: true }).click();
  await expect(page.locator(".relation-row")).toContainText("参考资料");
  await page.getByRole("button", { name: "修改", exact: true }).click();
  await expect(page.getByLabel("边文字（可选）", { exact: true })).toHaveValue("参考资料");
  await page.getByLabel("边文字（可选）", { exact: true }).fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await rightClickEdge();
  await expect(page.getByLabel("边文字（可选）", { exact: true })).toHaveValue("");
  expect((await (await request.get(`/api/edges/${encodeURIComponent(edge.id)}`)).json()).label).toBe("");
});

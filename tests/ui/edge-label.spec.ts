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
  await page.getByRole("tab", { name: "目录", exact: true }).click();
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

test("浅色卡片图谱：边长可调且记忆，多行边文字只显示首行并可点击查看", async ({ page, request }) => {
  const kb = await (await request.post("/api/kbs", { data: { name: "图谱视觉验证" } })).json();
  const parent = await (await request.post("/api/nodes", { data: { kbId: kb.id, title: "codeQL" } })).json();
  for (const title of ["sink", "sanitizer", "source"])
    await request.post("/api/nodes", { data: { kbId: kb.id, title, parentId: parent.id } });
  const edges = (await (await request.get(`/api/kbs/${kb.id}/graph`)).json()).edges;
  const fullText = "参考资料\n第二行仅在窗口可见\n<script>这是文字，不是脚本</script>";
  await request.patch(`/api/edges/${encodeURIComponent(edges[0].id)}`, { data: { label: fullText } });
  await page.goto("/");
  await page.getByRole("button", { name: /图谱视觉验证/ }).click();
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  const canvas = page.locator("#graph-canvas");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  const edgeState = () => canvas.evaluate((el: any) => {
    const cy = el._cyreg.cy, edge = cy.edges()[0];
    const a = edge.source().position(), b = edge.target().position();
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: cy.zoom(), shape: cy.nodes()[0].style("shape"), label: edge.style("label") };
  });
  const before = await edgeState();
  expect(before.shape).toBe("round-rectangle");
  expect(before.label).toBe("参考资料");
  await page.getByRole("slider", { name: "边长", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("slider", { name: "边长", exact: true })).toHaveValue("400");
  const after = await edgeState();
  expect(after.distance).toBeGreaterThan(before.distance + 50);
  expect(after.zoom).toBeCloseTo(before.zoom);
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  async function clickEdge() {
    const point = await canvas.evaluate((el: any) => {
      const p = el._cyreg.cy.edges()[0].renderedMidpoint(), box = el.getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    });
    await page.mouse.click(point.x, point.y);
  }
  await clickEdge();
  await expect(page.locator(".edge-detail-content")).toHaveText(fullText);
  await expect(page.locator(".edge-detail-content script")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑边文字", exact: true }).click();
  await expect(page.getByLabel("边文字（可选）", { exact: true })).toHaveValue(fullText);
  const changed = "1\n完整的关系说明\n第三行说明";
  await page.getByLabel("边文字（可选）", { exact: true }).fill(changed);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /图谱视觉验证/ }).click();
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await expect(page.getByRole("slider", { name: "边长", exact: true })).toHaveValue("400");
  expect((await edgeState()).label).toBe("1");
  await clickEdge();
  await expect(page.locator(".edge-detail-content")).toHaveText(changed);
  await page.screenshot({ path: "docs/evidence/edge-details.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.getByRole("slider", { name: "边长", exact: true }).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "增加边长", exact: true }).click();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await canvas.evaluate((el: any) => { el._cyreg.cy.nodes().filter((n: any) => n.data("label") === "codeQL").select(); });
  await page.screenshot({ path: "docs/evidence/graph-redesign.png" });
});

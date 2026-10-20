import { test, expect } from "@playwright/test";

test("分支图谱：右键进入全部递归子节点、共享分支、筛选和返回全库", async ({ page, request }) => {
  const kb = await (await request.post("/api/kbs", { data: { name: "分支布局验证" } })).json();
  const create = async (title: string, parentId?: string) =>
    (await request.post("/api/nodes", { data: { kbId: kb.id, title, parentId } })).json();
  const root = await create("CodeQL 研究"), outside = await create("外部项目");
  const branch = await create("3.1 污点分析", root.id), chain = [branch];
  for (let i = 0; i < 4; i++) chain.push(await create(`递归第${i + 1}层`, chain.at(-1).id));
  await request.post("/api/edges", { data: { type: "CHILD_OF", source: chain[2].id, target: outside.id } });
  for (const title of ["3.2 查询语言", "3.3 数据流", "3.4 漏洞检测", "3.5 论文阅读"]) {
    const parent = await create(title, root.id);
    for (let i = 0; i < 3; i++) await create(`${title.slice(0, 3)}.${i + 1} 研究笔记`, parent.id);
  }
  const endpoint = `/api/kbs/${kb.id}/graph?center=${branch.id}&scope=descendants`;
  expect((await (await request.get(endpoint)).json()).nodes).toHaveLength(5);
  await page.goto("/");
  await page.getByRole("button", { name: /分支布局验证/ }).click();
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await page.getByRole("button", { name: branch.title, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "只看此节点及全部子节点" }).click();
  const canvas = page.locator("#graph-canvas");
  const ids = () => canvas.evaluate((el: any) => el._cyreg?.cy?.nodes().map((n: any) => n.id()).sort() ?? []);
  await expect.poll(ids).toEqual(chain.map(n => n.id).sort());
  await expect(page.getByLabel("邻域跳数")).toBeDisabled();
  await expect(page.locator("#status")).toContainText("全部递归子节点");
  await page.getByRole("tab", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: "图谱", exact: true }).click();
  await expect.poll(ids).toEqual(chain.map(n => n.id).sort());
  await page.getByRole("searchbox", { name: "搜索节点", exact: true }).fill("递归第4层");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect.poll(ids).toEqual([chain.at(-1).id]);
  await page.getByRole("searchbox", { name: "搜索节点", exact: true }).fill("");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect.poll(ids).toEqual(chain.map(n => n.id).sort());
  await page.getByRole("button", { name: "全库图谱", exact: true }).click();
  await expect.poll(async () => (await ids()).length).toBe(23);
  await page.getByLabel("邻域中心").selectOption(root.id);
  await page.getByLabel("图谱范围").selectOption("descendants");
  await expect.poll(async () => (await ids()).length).toBe(22);
  // Re-layout does not change the data, and parent/child clusters have no card overlaps.
  await page.getByRole("button", { name: "重新布局", exact: true }).click();
  const positions = await canvas.evaluate((el: any) => el._cyreg.cy.nodes().map((n: any) => n.position()));
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
    expect(Math.abs(positions[i].x - positions[j].x) >= 168 || Math.abs(positions[i].y - positions[j].y) >= 54).toBe(true);
  }
  await page.screenshot({ path: "docs/evidence/branch-layout.png", fullPage: true });
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.screenshot({ path: "docs/evidence/branch-overview.png", fullPage: true });
  const point = await canvas.evaluate((el: any, id) => {
    const p = el._cyreg.cy.getElementById(id).renderedPosition(), r = el.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, chain.at(-1).id);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "只看此节点及全部子节点" }).click();
  await expect.poll(ids).toEqual([chain.at(-1).id]);
});

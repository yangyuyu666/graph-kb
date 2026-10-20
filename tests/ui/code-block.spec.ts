import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const embedded of [true, false]) test(`深色代码块与放大查看：${embedded ? "目录" : "独立文档"}`, async ({ page, request }) => {
  const kb = await (await request.post("/api/kbs", { data: { name: `代码阅读 ${embedded}` } })).json();
  const node = await (await request.post("/api/nodes", { data: { kbId: kb.id, title: "代码示例" } })).json();
  const markdown = "# 代码阅读\n\n```cpp\n#include <iostream>\n// 中文注释：保留字号和语法高亮\nint main() {\n  std::cout << \"Hello Graph KB\";\n  return 0;\n}\n```\n\n```js\nconst second = true;\n" + Array.from({ length: 120 }, (_, i) => `// long code line ${i}`).join("\n") + "\n```\n";
  await request.patch(`/api/nodes/${node.id}`, { data: { revision: 0, markdown } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  if (embedded) {
    await page.goto("/");
    await page.getByRole("button", { name: new RegExp(`代码阅读 ${embedded}`) }).click();
    await page.getByRole("tab", { name: "目录", exact: true }).click();
    await page.getByRole("button", { name: "代码示例", exact: true }).click();
  } else await page.goto(`/?node=${node.id}`);
  const block = page.locator(".milkdown-code-block").first();
  await expect(block.locator(".cm-content")).toBeVisible();
  await expect(block).toHaveCSS("background-color", "rgb(24, 26, 31)");
  await expect(block.locator(".cm-editor")).toHaveCSS("background-color", "rgb(24, 26, 31)");
  const size = await block.locator(".cm-content").evaluate(el => getComputedStyle(el).fontSize);
  const original = await block.boundingBox();
  await block.getByRole("button", { name: "放大查看", exact: true }).click();
  await expect(block).toHaveJSProperty("popover", "auto");
  await expect(page.locator(".milkdown-code-block:popover-open")).toHaveCount(1);
  await expect(block.getByRole("button", { name: "收起 · Esc", exact: true })).toHaveCSS("opacity", "1");
  await expect(block.getByRole("button", { name: "收起 · Esc", exact: true })).toHaveCSS("color", "rgb(198, 204, 214)");
  await expect(block.locator(".cm-content")).toHaveCSS("font-size", size);
  const enlarged = await block.boundingBox();
  expect(enlarged!.width).toBeGreaterThan(original!.width);
  expect(enlarged!.height).toBeGreaterThan(original!.height);
  await expect(page.locator(".document [role=status]")).toHaveText("已读取本地 Markdown");
  // Edit the same code editor while enlarged; closing must not lose its draft.
  await block.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// enlarged draft");
  await page.keyboard.press("Escape");
  await expect(page.locator(".milkdown-code-block:popover-open")).toHaveCount(0);
  await expect(block.locator(".cm-content")).toContainText("// enlarged draft");
  await block.getByRole("button", { name: "放大查看", exact: true }).click();
  await block.getByRole("button", { name: "收起 · Esc", exact: true }).click();
  await expect(page.locator(".milkdown-code-block:popover-open")).toHaveCount(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".document [role=status]")).toContainText("已保存到本地");
  const saved = await (await request.get(`/api/nodes/${node.id}`)).json();
  expect(saved.markdown).toContain("// enlarged draft");
  expect(saved.markdown).toContain("const second = true;");
  expect(saved.markdown).toContain("```cpp");
  const second = page.locator(".milkdown-code-block").nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.getByRole("button", { name: "放大查看", exact: true }).click();
  await second.locator(".cm-scroller").evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(second.locator(".cm-content")).toContainText("long code line 119");
  await page.keyboard.press("Escape");
  await mkdir("docs/evidence", { recursive: true });
  if (embedded) {
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "docs/evidence/code-dark.png", animations: "disabled" });
    await block.getByRole("button", { name: "放大查看", exact: true }).click();
    await page.screenshot({ path: "docs/evidence/code-enlarged.png", animations: "disabled" });
    // Navigating away must remove an open top-layer editor.
    await page.locator("#settings-nav").evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.locator(".milkdown-code-block")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

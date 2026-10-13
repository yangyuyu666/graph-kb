import { api, type KnowledgeBase, type PageNode } from "./api";
import { renderSettings } from "./settings";
import { renderWorkspace } from "./workspace";
import { element as e, button, nameDialog, confirmTrash, report } from "./ui";

export async function renderLibrary(
  app: HTMLElement,
  open: (id: string) => Promise<void>,
) {
  app.className = "";
  app.innerHTML =
    '<aside><div class="brand"><b>◈ 知识图谱</b></div><nav></nav><div class="workspace"><span>本</span>本地工作区</div></aside><main></main>';
  const main = app.querySelector("main")!,
    nav = app.querySelector("nav")!;
  const home = button("◦　知识库", () => library(), "nav active");
  home.id = "home-nav";
  const search = button("⌕　全局搜索", () => searchPage(), "nav");
  const trash = button("♧　回收站", () => trashPage(), "nav");
  const settings = button(
    "◦　设置",
    () => {
      if (
        !main.dispatchEvent(new Event("workspace-leave", { cancelable: true }))
      )
        return;
      active(settings);
      return renderSettings(main);
    },
    "nav",
  );
  settings.id = "settings-nav";
  nav.append(home, search, trash, settings);
  function active(button: HTMLElement) {
    nav
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b === button));
  }
  function status() {
    const p = e("p");
    p.id = "status";
    p.setAttribute("role", "status");
    return p;
  }
  async function library() {
    if (!main.dispatchEvent(new Event("workspace-leave", { cancelable: true })))
      return;
    active(home);
    main.replaceChildren();
    const header = e("header"),
      heading = e("div");
    const title = e("h1", "知识库 "),
      count = e("small");
    count.id = "count";
    title.append(count);
    heading.append(title, e("p", "让知识相互连接"));
    const create = button(
      "＋ 新建知识库",
      () =>
        nameDialog("新建知识库", "知识库名称", async (name) => {
          await api("/api/kbs", "POST", { name });
          await library();
        }),
      "primary",
    );
    create.id = "new-kb";
    header.append(heading, create);
    const filter = e("input");
    filter.type = "search";
    filter.placeholder = "搜索知识库";
    filter.setAttribute("aria-label", "搜索知识库");
    filter.className = "library-search";
    const content = e("div", undefined, "cards");
    main.append(header, filter, status(), content);
    const kbs = await api<KnowledgeBase[]>("/api/kbs");
    if (!main.contains(content)) return;
    count.textContent = `${kbs.length} 个`;
    function draw() {
      content.replaceChildren();
      for (const kb of kbs.filter((k) =>
        k.name.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()),
      )) {
        const card = e("article", undefined, "card");
        const enter = () => renderWorkspace(main, kb, open, library);
        const body = button("", enter, "card-open");
        body.append(
          e("span", "◈", "kb-icon"),
          e("h2", kb.name),
          e("p", `${kb.nodeCount} 个节点`),
          e(
            "p",
            kb.updatedAt
              ? `更新于 ${new Date(kb.updatedAt).toLocaleDateString()}`
              : "尚未添加文档",
            "updated-at",
          ),
        );
        const menu = e("details", undefined, "card-menu"),
          summary = e("summary", "⋯");
        summary.setAttribute("aria-label", `管理知识库 ${kb.name}`);
        menu.append(
          summary,
          button("重命名", () =>
            nameDialog(
              "重命名知识库",
              "知识库名称",
              async (name) => {
                await api(`/api/kbs/${kb.id}`, "PATCH", { name });
                await library();
              },
              kb.name,
            ),
          ),
          button("删除", () =>
            confirmTrash(
              kb.name,
              async () => {
                await api(`/api/kbs/${kb.id}`, "DELETE");
                await library();
              },
              "整库的节点、关系和文档将进入回收站，30 天内可恢复。",
            ),
          ),
        );
        card.append(body, menu);
        card.onclick = (event) => {
          if (event.target === card) void enter().catch(report);
        };
        content.append(card);
      }
      if (!content.childElementCount)
        content.append(
          e(
            "p",
            kbs.length ? "没有匹配的知识库" : "创建第一个知识库，开始记录。",
            "hint",
          ),
        );
    }
    filter.oninput = draw;
    draw();
  }
  async function searchPage() {
    if (!main.dispatchEvent(new Event("workspace-leave", { cancelable: true })))
      return;
    active(search);
    main.replaceChildren(e("header"));
    main.querySelector("header")!.append(e("h1", "全局搜索"));
    const input = e("input");
    input.type = "search";
    input.placeholder = "搜索标题和 Markdown 正文";
    input.setAttribute("aria-label", "全局搜索词");
    const form = e("form", undefined, "global-search");
    const submit = e("button", "搜索", "primary");
    submit.type = "submit";
    form.append(input, submit);
    const results = e("div", undefined, "search-results"),
      message = status();
    main.append(form, message, results);
    let version = 0;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const current = ++version;
      try {
        const nodes = await api<(PageNode & { excerpt: string })[]>(
          `/api/search?q=${encodeURIComponent(input.value)}`,
        );
        if (current !== version || !main.contains(results)) return;
        results.replaceChildren();
        message.textContent = `找到 ${nodes.length} 个节点`;
        for (const n of nodes) {
          const item = button("", () => open(n.id), "search-result");
          item.append(e("h2", n.title), e("p", n.excerpt));
          results.append(item);
        }
      } catch (error) {
        report(error);
      }
    };
    input.focus();
  }
  async function trashPage() {
    if (!main.dispatchEvent(new Event("workspace-leave", { cancelable: true })))
      return;
    active(trash);
    main.replaceChildren(
      e("h1", "回收站"),
      e(
        "p",
        "删除后保留 30 天，到期自动彻底清除。恢复节点前，请先恢复它所属的知识库。",
        "hint",
      ),
      status(),
    );
    const list = e("div", undefined, "trash-list");
    main.append(list);
    const entries =
      await api<
        { id: string; title: string; kind: string; deletedAt: string }[]
      >("/api/trash");
    if (!main.contains(list)) return;
    if (!entries.length) list.append(e("p", "回收站为空"));
    for (const item of entries) {
      const row = e("div", undefined, "trash-row");
      row.append(
        e(
          "div",
          `${item.kind === "KnowledgeBase" ? "知识库" : "节点"} · ${item.title}`,
        ),
        e("span", `${new Date(item.deletedAt).toLocaleDateString()} 删除`),
        button("恢复", async () => {
          const result = await api<{ skippedEdges: string[] }>(
            `/api/trash/${item.id}/restore`,
            "POST",
            {},
          );
          await trashPage();
          if (result.skippedEdges.length)
            main.querySelector("#status")!.textContent =
              `已恢复；${result.skippedEdges.length} 条关系的端点已删除或规则发生冲突，未恢复。`;
        }),
      );
      list.append(row);
    }
  }
  await library();
}

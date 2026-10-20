import { contextMenu, closeContextMenu } from "./context-menu";
import { branchLayout, graphTitle } from "./graph-layout";
import { directoryIcon } from "./directory-icons";
import { defaultWorkspaceView } from "./view-preferences";
import { mountDocument } from "./document-view";
import cytoscape, { type Core } from "cytoscape";
import { zipSync, strToU8 } from "fflate";
import {
  api,
  type KnowledgeBase,
  type PageNode,
  type GraphData,
  type GraphEdge,
} from "./api";
import {
  element as e,
  button,
  field,
  modal,
  nameDialog,
  confirmTrash,
  download,
  kindNames,
  report,
} from "./ui";

export async function renderWorkspace(
  main: HTMLElement,
  kb: KnowledgeBase,
  open: (id: string) => Promise<void>,
  back: () => Promise<void>,
) {
  let graph: GraphData = { nodes: [], edges: [] },
    view: "tree" | "graph" = defaultWorkspaceView(),
    selected: string | undefined,
    cy: Core | undefined;
  const collapsed = new Set<string>();
  const graphFilter = { center: "", scope: "neighbors", hops: "1", edgeType: "CHILD_OF" };
  const edgeLengthKey = `graph-kb:edge-length:${kb.id}`;
  let edgeLength = 220;
  try {
    const saved = Number(localStorage.getItem(edgeLengthKey));
    if (Number.isFinite(saved) && saved >= 100 && saved <= 400) edgeLength = saved;
  } catch { /* Layout preferences must not block the graph. */ }
  const documentPane = e("div", undefined, "inline-document-pane");
  documentPane.append(
    e("h2", "选择一个节点"),
    e("p", "左键在此编辑文档；右键节点打开操作菜单。"),
  );
  let editor: Awaited<ReturnType<typeof mountDocument>> | undefined;
  let editorAbort = new AbortController(),
    opening = 0;
  let treeWidth = 280;
  const leaveGuard = (event: Event) => {
    if (editor && !editor.canLeave()) event.preventDefault();
  };
  main.addEventListener("workspace-leave", leaveGuard);
  async function showDocument(id: string, force = false) {
    if (editor?.id === id && !force) return;
    if (editor && !editor.canLeave()) return;
    const version = ++opening;
    editorAbort.abort();
    editorAbort = new AbortController();
    const signal = editorAbort.signal;
    const old = editor;
    editor = undefined;
    await old?.destroy();
    if (disposed || version !== opening) return;
    selected = id;
    main
      .querySelectorAll<HTMLElement>(".tree-item")
      .forEach((item) =>
        item
          .querySelector(".tree-row")
          ?.classList.toggle("selected", item.dataset.nodeId === id),
      );
    try {
      const mounted = await mountDocument(documentPane, id, open, {
        embedded: true,
        signal,
      });
      if (disposed || version !== opening) {
        await mounted.destroy();
        return;
      }
      editor = mounted;
    } catch (error) {
      if (!signal.aborted) notify(error);
    }
  }

  let disposed = false,
    loadVersion = 0;
  const observer = new MutationObserver(() => {
    if (!main.isConnected || !main.contains(shell)) {
      disposed = true;
      editorAbort.abort();
      void editor?.destroy();
      main.removeEventListener("workspace-leave", leaveGuard);
      closeContextMenu();
      cy?.destroy();
      observer.disconnect();
    }
  });
  const shell = e("section", undefined, "kb-workspace");
  main.replaceChildren(shell);
  observer.observe(main.parentElement!, { childList: true, subtree: true });
  const header = e("header", undefined, "kb-header"),
    crumb = e("div", undefined, "breadcrumb");
  crumb.append(button("‹ 返回", back), e("h1", kb.name));
  const create = button("＋ 新建顶级节点", () => createNode(), "primary");
  create.id = "new-node";
  header.append(crumb, create);
  const toolbar = e("div", undefined, "kb-toolbar"),
    tabs = e("div", undefined, "view-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "知识库视图");
  const treeTab = button("目录", () => switchView("tree")),
    graphTab = button("图谱", () => switchView("graph"));
  for (const tab of [treeTab, graphTab]) tab.setAttribute("role", "tab");
  tabs.append(graphTab, treeTab);
  const search = e("input");
  search.placeholder = "搜索节点标题或正文";
  search.setAttribute("aria-label", "搜索节点");
  search.type = "search";
  const searchForm = e("form", undefined, "workspace-search");
  searchForm.setAttribute("role", "search");
  searchForm.setAttribute("aria-label", "当前知识库搜索");
  const searchButton = e("button", "搜索");
  searchButton.type = "submit";
  searchForm.append(search, searchButton);
  const kind = e("select");
  kind.setAttribute("aria-label", "节点类型筛选");
  kind.append(
    new Option("全部类型", ""),
    ...Object.entries(kindNames).map(([k, v]) => new Option(v, k)),
  );
  const refresh = button("刷新", async () => {
    refresh.disabled = true;
    refresh.textContent = "刷新中…";
    refresh.setAttribute("aria-busy", "true");
    try {
      await runSearch();
    } finally {
      refresh.disabled = false;
      refresh.textContent = "刷新";
      refresh.setAttribute("aria-busy", "false");
    }
  });
  refresh.id = "refresh-workspace";
  refresh.title = "重新读取节点和关系，保留当前筛选与文档草稿";
  toolbar.append(
    tabs,
    searchForm,
    kind,
    refresh,
    button("导入", () => importDialog()),
    button("导出", () => exportDialog()),
  );
  const status = e("p");
  status.id = "status";
  status.setAttribute("role", "status");
  const panel = e("div", undefined, "workspace-panel");
  shell.append(header, toolbar, status, panel);
  const notify = (error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  };
  async function reload() {
    const version = ++loadVersion;
    const data = await api<GraphData>(`/api/kbs/${kb.id}/graph`);
    if (disposed || version !== loadVersion) return;
    graph = data;
    render();
  }
  function switchView(next: "tree" | "graph") {
    view = next;
    render();
  }
  function chosen() {
    return graph.nodes.find((n) => n.id === selected);
  }
  function render() {
    shell.classList.toggle("graph-theme", view === "graph");
    closeContextMenu();
    cy?.destroy();
    cy = undefined;
    panel.replaceChildren();
    treeTab.setAttribute("aria-selected", String(view === "tree"));
    graphTab.setAttribute("aria-selected", String(view === "graph"));
    if (view === "tree") renderTree();
    else renderGraph();
    if (appliedSearch && view === "tree")
      status.textContent = `搜索“${appliedSearch}”：找到 ${filtered().length} 个节点（标题或正文匹配${view === "tree" ? "，目录保留父级路径" : ""}）`;
    else if (view === "tree") status.textContent = `${filtered().length} 个节点`;
  }
  let matches: Set<string> | undefined, timer: ReturnType<typeof setTimeout>;
  let appliedSearch = "", searchVersion = 0, composing = false;
  async function runSearch() {
    clearTimeout(timer);
    const version = ++searchVersion;
    const term = search.value.trim();
    searchForm.setAttribute("aria-busy", "true");
    status.textContent = term ? "正在搜索标题和正文…" : "正在显示全部节点…";
    try {
      const [data, found] = await Promise.all([
        api<GraphData>(`/api/kbs/${kb.id}/graph`),
        term
          ? api<PageNode[]>(
              `/api/search?kbId=${kb.id}&q=${encodeURIComponent(term)}`,
            )
          : undefined,
      ]);
      if (disposed || version !== searchVersion) return;
      graph = data;
      appliedSearch = term;
      matches = found ? new Set(found.map((n) => n.id)) : undefined;
      // Reveal matching descendants even when their ancestors were collapsed.
      const visible = new Set(matches);
      let more = true;
      while (matches && more) {
        more = false;
        for (const edge of graph.edges) if (edge.type === "CHILD_OF" && visible.has(edge.source)) {
          collapsed.delete(edge.target);
          if (!visible.has(edge.target)) { visible.add(edge.target); more = true; }
        }
      }
      render();
    } catch (error) {
      if (!disposed && version === searchVersion) notify(error);
    } finally {
      if (version === searchVersion) searchForm.setAttribute("aria-busy", "false");
    }
  }
  searchForm.onsubmit = (event) => {
    event.preventDefault();
    if (!composing) void runSearch();
  };
  search.oninput = () => {
    ++searchVersion;
    clearTimeout(timer);
    searchForm.setAttribute("aria-busy", "false");
    if (!composing) timer = setTimeout(() => void runSearch(), 200);
  };
  search.addEventListener("compositionstart", () => { composing = true; ++searchVersion; clearTimeout(timer); });
  search.addEventListener("compositionend", () => { composing = false; clearTimeout(timer); timer = setTimeout(() => void runSearch(), 200); });
  kind.onchange = render;
  function filtered() {
    return graph.nodes.filter(
      (n) =>
        (!kind.value || n.kind === kind.value) &&
        (!matches || matches.has(n.id)),
    );
  }
  function renderTree() {
    panel.className = "workspace-panel tree-layout";
    const tree = e("div", undefined, "tree-panel");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "文档目录");
    tree.append(e("div", "项目", "tree-heading"));
    const children = new Map<string, PageNode[]>(),
      hasParent = new Set<string>();
    for (const edge of graph.edges.filter((e) => e.type === "CHILD_OF")) {
      const node = graph.nodes.find((n) => n.id === edge.source);
      if (node) {
        children.set(edge.target, [...(children.get(edge.target) ?? []), node]);
        hasParent.add(node.id);
      }
    }
    const visible = new Set(filtered().map((n) => n.id));
    let more = true;
    while (more) {
      more = false;
      for (const edge of graph.edges)
        if (
          edge.type === "CHILD_OF" &&
          visible.has(edge.source) &&
          !visible.has(edge.target)
        ) {
          visible.add(edge.target);
          more = true;
        }
    }
    function branch(node: PageNode, ancestors: Set<string>) {
      if (!visible.has(node.id) || ancestors.has(node.id)) return;
      const item = e("div", undefined, "tree-item");
      item.dataset.nodeId = node.id;
      item.setAttribute("role", "treeitem");
      const descendants = children.get(node.id) ?? [];
      const row = e(
        "div",
        undefined,
        `tree-row${selected === node.id ? " selected" : ""}${matches?.has(node.id) ? " search-match" : ""}`,
      );
      const toggle = button(
        "",
        () => {
          collapsed.has(node.id)
            ? collapsed.delete(node.id)
            : collapsed.add(node.id);
          renderTreeAgain();
        },
        "tree-toggle",
      );
      if (descendants.length) {
        toggle.append(directoryIcon("chevron"));
        toggle.classList.toggle("expanded", !collapsed.has(node.id));
      }
      toggle.disabled = !descendants.length;
      toggle.setAttribute(
        "aria-label",
        `${collapsed.has(node.id) ? "展开" : "折叠"} ${node.title}`,
      );
      if (descendants.length)
        item.setAttribute("aria-expanded", String(!collapsed.has(node.id)));
      const doc = button("", () => showDocument(node.id), "node tree-document");
      doc.title = node.title;
      doc.append(
        directoryIcon(descendants.length ? (collapsed.has(node.id) ? "folder" : "folder-open") : "document"),
        e("span", node.title, "node-title"),
      );
      doc.setAttribute("aria-label", node.title);
      row.oncontextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        nodeMenu(node, event.clientX, event.clientY);
      };
      doc.onkeydown = (event) => {
        if (
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
          const r = doc.getBoundingClientRect();
          nodeMenu(node, r.left + 20, r.bottom);
        }
      };
      row.append(toggle, doc);
      item.append(row);
      if (descendants.length && !collapsed.has(node.id)) {
        const group = e("div", undefined, "tree-children");
        group.setAttribute("role", "group");
        const before = treeTarget;
        treeTarget = group;
        for (const child of descendants)
          branch(child, new Set([...ancestors, node.id]));
        treeTarget = before;
        item.append(group);
      }
      treeTarget.append(item);
    }
    let treeTarget: HTMLElement = tree;

    for (const node of graph.nodes.filter((n) => !hasParent.has(n.id)))
      branch(node, new Set());
    if (!graph.nodes.length)
      tree.append(e("p", "还没有节点。先创建一个顶级节点。", "hint"));
    else if (!visible.size) tree.append(e("p", "没有匹配的节点", "hint"));
    const divider = e("div", undefined, "tree-divider");
    divider.tabIndex = 0;
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute("aria-label", "调整目录宽度");
    const resize = (value: number) => {
      const max = Math.max(150, panel.clientWidth - 280);
      treeWidth = Math.max(150, Math.min(value, max));
      panel.style.setProperty("--tree-width", treeWidth + "px");
      divider.setAttribute("aria-valuenow", String(Math.round(treeWidth)));
    };
    divider.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
      divider.classList.add("dragging");
    };
    divider.onpointermove = (event) => {
      if (divider.hasPointerCapture(event.pointerId))
        resize(event.clientX - panel.getBoundingClientRect().left);
    };
    divider.onpointerup = (event) => {
      if (divider.hasPointerCapture(event.pointerId))
        divider.releasePointerCapture(event.pointerId);
      divider.classList.remove("dragging");
    };
    divider.onlostpointercapture = () => divider.classList.remove("dragging");
    divider.onkeydown = (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        resize(treeWidth + (event.key === "ArrowLeft" ? -20 : 20));
      }
    };
    panel.append(tree, divider, documentPane);
    resize(treeWidth);
    function renderTreeAgain() {
      panel.replaceChildren();
      renderTree();
    }
  }
  function nodeMenu(node: PageNode, x: number, y: number) {
    contextMenu(x, y, node.title, [
      { label: "新建子节点", icon: "＋", run: () => createNode(node.id) },
      {
        label: "重命名",
        icon: "✎",
        run: () =>
          nameDialog(
            "重命名节点",
            "文档标题",
            async (title) => {
              if (editor?.id === node.id && !editor.canLeave())
                throw Error("请先保存当前文档");
              const latest = await api<PageNode>("/api/nodes/" + node.id);
              await api("/api/nodes/" + node.id, "PATCH", {
                title,
                revision: latest.revision,
              });
              if (editor?.id === node.id) {
                await editor.destroy();
                editor = undefined;
                await showDocument(node.id);
              }
              await reload();
            },
            node.title,
          ),
      },
      { label: "管理关系", icon: "◇", run: () => relations(node) },
      { label: "只看此节点及全部子节点", icon: "⌘", run: () => {
        graphFilter.center = node.id;
        graphFilter.scope = "descendants";
        graphFilter.edgeType = "";
        clearTimeout(timer);
        ++searchVersion;
        search.value = appliedSearch = kind.value = "";
        matches = undefined;
        searchForm.setAttribute("aria-busy", "false");
        switchView("graph");
      } },
      {
        label: "仅删除当前节点",
        icon: "▱",
        danger: true,
        separator: true,
        run: () => deleteNode(node, "single"),
      },
      {
        label: "级联删除",
        icon: "▱",
        danger: true,
        run: () => deleteNode(node, "cascade"),
      },
      {
        label: "在新窗口中打开",
        icon: "↗",
        separator: true,
        run: () => open(node.id),
      },
    ]);
  }
  function deleteNode(node: PageNode, mode: "single" | "cascade") {
    confirmTrash(
      node.title,
      async () => {
        if (editor && !editor.canLeave()) throw Error("请先保存当前文档");
        const result = await api<{ deletedCount: number }>(
          "/api/nodes/" + node.id + "?mode=" + mode,
          "DELETE",
        );
        const currentId = editor?.id;
        const next = await api<GraphData>("/api/kbs/" + kb.id + "/graph");
        if (currentId && !next.nodes.some((n) => n.id === currentId)) {
          editorAbort.abort();
          await editor?.destroy();
          editor = undefined;
          selected = undefined;
          documentPane.replaceChildren(
            e("h2", "节点已移入回收站"),
            e("p", "选择其他节点继续编辑，或在回收站恢复。"),
          );
        }
        await reload();
        status.textContent =
          "已将 " + result.deletedCount + " 个节点移入回收站";
      },
      mode === "cascade"
        ? "将删除此节点及其后代。共享给外部父节点的后代及其下级会保留；删除内容在回收站保留 30 天，可整批恢复。"
        : "只删除当前节点并移除关联边；子节点保留，失去所有父节点的子节点提升为顶级。30 天内可恢复。",
    );
  }
  function relations(node: PageNode) {
    const m = modal("管理关系 · " + node.title);
    m.submit.remove();
    const edges = graph.edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    );
    if (!edges.length) m.form.append(e("p", "还没有关系"));
    for (const edge of edges) {
      const other = graph.nodes.find(
        (n) => n.id === (edge.source === node.id ? edge.target : edge.source),
      );
      const row = e("div", undefined, "relation-row");
      row.append(
        e(
          "span",
          (edge.type === "SIBLING_OF"
            ? "平行"
            : edge.source === node.id
              ? "父节点"
              : "子节点") +
            " · " +
            other?.title +
            (edge.label ? " · " + edge.label.split(/\r\n|\r|\n/)[0] : ""),
        ),
        button("修改", () => {
          m.dialog.close();
          edgeDialog(node.id, edge);
        }),
        button("移除", async () => {
          await api("/api/edges/" + encodeURIComponent(edge.id), "DELETE");
          m.dialog.close();
          await reload();
        }),
      );
      m.form.append(row);
    }
    m.form.append(
      button("添加关系", () => {
        m.dialog.close();
        edgeDialog(node.id);
      }),
    );
    m.show();
  }
  function createNode(parentId?: string) {
    const m = modal(parentId ? "新建子节点" : "新建顶级节点");
    const title = e("input");
    title.required = true;
    title.maxLength = 200;
    field(m.form, "文档标题", title);
    const parent = e("select");
    parent.append(
      new Option("知识库顶层", ""),
      ...graph.nodes.map((n) => new Option(n.title, n.id)),
    );
    parent.value = parentId ?? "";
    field(m.form, "创建位置", parent);
    const type = e("select");
    type.append(...Object.entries(kindNames).map(([k, v]) => new Option(v, k)));
    field(m.form, "节点类型", type);
    m.submit.textContent = "创建";
    m.form.onsubmit = async (event) => {
      event.preventDefault();
      m.submit.disabled = true;
      try {
        const node = await api<PageNode>("/api/nodes", "POST", {
          kbId: kb.id,
          title: title.value,
          kind: type.value,
          parentId: parent.value || undefined,
        });
        if (!editor) selected = undefined;
        if (parent.value) collapsed.delete(parent.value);
        await reload();
        m.dialog.close();
      } catch (error) {
        m.error.textContent = String(error);
        m.submit.disabled = false;
      }
    };
    m.show();
  }
  async function showEdgeDetails(id: string) {
    const edge = await api<GraphEdge>("/api/edges/" + encodeURIComponent(id));
    if (disposed || view !== "graph" || document.querySelector("dialog[open]")) return;
    const m = modal("边文字");
    m.dialog.classList.add("edge-detail-dialog");
    m.submit.remove();
    m.actions.querySelector("button")!.textContent = "关闭";
    const title = (nodeId: string) => graph.nodes.find((node) => node.id === nodeId)?.title ?? nodeId;
    m.form.append(
      e("p", `${title(edge.source)} ${edge.type === "CHILD_OF" ? "→" : "↔"} ${title(edge.target)}`, "edge-detail-endpoints"),
      e("div", edge.label || "这条边还没有文字。", "edge-detail-content"),
    );
    m.actions.append(button("编辑边文字", () => {
      m.dialog.close();
      edgeDialog(edge.source, edge, true);
    }, "primary"));
    m.show();
  }
  function edgeDialog(source: string, existing?: GraphEdge, labelOnly = false) {
    const m = modal(labelOnly ? "编辑边文字" : existing ? "修改关系" : "添加关系");
    const from = e("select"),
      to = e("select"),
      type = e("select");
    for (const node of graph.nodes) {
      from.append(new Option(node.title, node.id));
      to.append(new Option(node.title, node.id));
    }
    from.value = existing?.source ?? source;
    to.value =
      existing?.target ?? graph.nodes.find((n) => n.id !== source)?.id ?? "";
    type.append(
      new Option("从属：子 → 父", "CHILD_OF"),
      new Option("平行：仅顶级节点", "SIBLING_OF"),
    );
    type.value = existing?.type ?? "CHILD_OF";
    if (!labelOnly) {
      field(m.form, "关系类型", type);
      field(m.form, "起点（子节点）", from);
      field(m.form, "终点（父节点）", to);
    }
    const label = e("textarea");
    label.maxLength = 200;
    label.rows = 5;
    label.value = existing?.label ?? "";
    label.placeholder = "第一行：简短标题\n第二行开始：详细说明；留空可清除";
    field(m.form, "边文字（可选）", label);
    m.form.append(e("p", "最多 200 字符。画布只显示第一行，过长时省略；点击边查看完整文字。", "hint"));
    m.submit.textContent = "保存";
    m.form.onsubmit = async (event) => {
      event.preventDefault();
      m.submit.disabled = true;
      try {
        await api(
          existing
            ? `/api/edges/${encodeURIComponent(existing.id)}`
            : "/api/edges",
          existing ? "PATCH" : "POST",
          labelOnly
            ? { label: label.value }
            : { type: type.value, source: from.value, target: to.value, label: label.value },
        );
        await reload();
        m.dialog.close();
      } catch (error) {
        m.error.textContent = String(error);
        m.submit.disabled = false;
      }
    };
    m.show();
  }
  function renderGraph() {
    panel.className = "workspace-panel graph-layout";
    const controls = e("div", undefined, "graph-controls");
    const center = e("select"),
      scope = e("select"),
      hops = e("select"),
      edgeType = e("select"),
      target = e("select");
    center.setAttribute("aria-label", "邻域中心");
    center.append(
      new Option("全库图谱", ""),
      ...graph.nodes.map((n) => new Option(n.title, n.id)),
    );
    if (!graph.nodes.some((n) => n.id === graphFilter.center)) graphFilter.center = "";
    center.value = graphFilter.center;
    scope.setAttribute("aria-label", "图谱范围");
    scope.append(new Option("邻域（双向）", "neighbors"), new Option("全部递归子节点", "descendants"));
    scope.value = graphFilter.scope;
    scope.disabled = !center.value;
    hops.setAttribute("aria-label", "邻域跳数");
    [1, 2, 3].forEach((n) => hops.append(new Option(`${n} 跳`, String(n))));
    hops.value = graphFilter.hops;
    hops.disabled = !center.value || scope.value === "descendants";
    edgeType.setAttribute("aria-label", "关系筛选");
    edgeType.append(
      new Option("全部关系", ""),
      new Option("从属关系", "CHILD_OF"),
      new Option("平行关系", "SIBLING_OF"),
    );
    edgeType.value = graphFilter.edgeType;
    target.setAttribute("aria-label", "路径终点");
    target.append(
      new Option("选择路径终点", ""),
      ...graph.nodes.map((n) => new Option(n.title, n.id)),
    );
    controls.append(
      center,
      scope,
      hops,
      edgeType,
      button("全库图谱", () => {
        center.value = "";
        scope.value = "neighbors";
        void applyFilters().catch(notify);
      }),
      target,
      button("查找路径", async () => {
        if (!center.value || !target.value) {
          status.textContent = "请选择邻域中心作为起点，以及路径终点";
          return;
        }
        const version = ++requestVersion;
        const result = await api<GraphData>(
          `/api/path?kbId=${kb.id}&source=${center.value}&target=${target.value}&edgeType=${edgeType.value}`,
        );
        if (disposed || version !== requestVersion || !main.contains(canvas))
          return;
        draw(result);
        status.textContent = result.nodes.length
          ? `路径包含 ${result.edges.length} 条关系`
          : "两个节点之间没有路径";
      }),
    );
    const canvas = e("div", undefined, "graph-canvas");
    canvas.id = "graph-canvas";
    canvas.setAttribute("aria-label", "知识图谱画布");
    const legend = e(
      "div",
      "实线箭头：从属（子 → 父）　虚线：平行　拖动画布浏览 · 适应画布查看全图 · 右键节点查看分支",
      "graph-legend",
    );
    const buttons = e("div", undefined, "graph-actions");
    const lengthControl = e("div", undefined, "edge-length-control");
    const lengthSlider = e("input");
    lengthSlider.type = "range";
    lengthSlider.min = "100";
    lengthSlider.max = "400";
    lengthSlider.step = "20";
    lengthSlider.value = String(edgeLength);
    lengthSlider.setAttribute("aria-label", "边长");
    const lengthValue = e("output", String(edgeLength));
    const shorter = button("−", () => setLength(edgeLength - 20));
    const longer = button("＋", () => setLength(edgeLength + 20));
    shorter.setAttribute("aria-label", "缩短边长");
    longer.setAttribute("aria-label", "增加边长");
    lengthControl.append(e("span", "边长"), shorter, lengthSlider, longer, lengthValue);
    function setLength(value: number) {
      edgeLength = Math.max(100, Math.min(400, value));
      lengthSlider.value = String(edgeLength);
      lengthValue.value = String(edgeLength);
      shorter.disabled = edgeLength === 100;
      longer.disabled = edgeLength === 400;
      try { localStorage.setItem(edgeLengthKey, String(edgeLength)); } catch { /* Optional preference. */ }
      arrange(false);
    }
    lengthSlider.oninput = () => setLength(Number(lengthSlider.value));
    shorter.disabled = edgeLength === 100;
    longer.disabled = edgeLength === 400;
    function fitGraph() {
      if (!cy?.nodes().length) return;
      cy.fit(undefined, 50);
      cy.zoom(Math.min(cy.zoom(), 1));
      cy.center();
    }
    let layoutData: GraphData = { nodes: [], edges: [] };
    function arrange(fit: boolean) {
      if (!cy) return;
      const positions = branchLayout(layoutData, edgeLength, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      cy.batch(() => {
        for (const pos of positions) cy!.getElementById(pos.id).position({ x: pos.x, y: pos.y });
      });
      if (fit) {
        fitGraph();
        // Large/deep graphs should open at a readable scale; explicit Fit still
        // provides the complete overview without a minimum readable zoom.
        if (cy.zoom() < 0.6) {
          cy.zoom(0.6);
          const children = new Set(layoutData.edges.filter((e) => e.type === "CHILD_OF").map((e) => e.source));
          const root = layoutData.nodes.find((n) => n.id === center.value) ?? layoutData.nodes.find((n) => !children.has(n.id));
          if (root) cy.center(cy.getElementById(root.id));
          else cy.center();
        }
      }
      else cy.center();
    }
    buttons.append(
      lengthControl,
      button("放大", () => cy?.zoom(cy.zoom() * 1.25)),
      button("缩小", () => cy?.zoom(cy.zoom() / 1.25)),
      button("适应画布", fitGraph),
      button("重新布局", () => arrange(true)),
      button("导出 PNG", () => {
        if (cy) {
          const anchor = e("a");
          anchor.href = cy.png({ full: true, bg: "#f7f9fa", scale: 2 });
          anchor.download = `${kb.name}-图谱.png`;
          anchor.click();
        }
      }),
      button("导出当前子图", () => exportGraph(cy?.nodes().map((n) => n.id()))),
    );
    panel.append(buttons, controls, legend, canvas);
    function draw(data: GraphData) {
      layoutData = data;
      cy?.destroy();
      const icon = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#657a87" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h8"/></svg>');
      cy = cytoscape({
        container: canvas,
        elements: [
          ...data.nodes.map((n) => ({
            data: { id: n.id, label: n.title, displayTitle: graphTitle(n.title, 14), kind: n.kind },
            selected: n.id === selected,
          })),
          ...data.edges.map((edge) => ({ data: { ...edge, displayLabel: edge.label.split(/\r\n|\r|\n/)[0] } })),
        ],
        style: [
          {
            selector: "node",
            style: {
              label: "data(displayTitle)",
              shape: "round-rectangle",
              "background-color": "#ffffff",
              "border-width": 1.2,
              "border-color": "#c5d1d9",
              "background-image": icon,
              "background-width": 22,
              "background-height": 22,
              "background-position-x": "12px",
              color: "#263c49",
              "font-size": 14,
              "font-family": '"Microsoft YaHei", sans-serif',
              "text-valign": "center",
              "text-margin-x": 15,
              "text-wrap": "wrap",
              "text-max-width": "112px",
              width: 168,
              height: 54,
            },
          },
          {
            selector: "edge",
            style: {
              label: "data(displayLabel)",
              "font-size": 12,
              color: "#465e6b",
              "text-wrap": "ellipsis",
              "text-max-width": "160px",
              "text-background-color": "#ffffff",
              "text-background-opacity": 1,
              "text-background-shape": "roundrectangle",
              "text-background-padding": "5px",
              "text-border-width": 1,
              "text-border-opacity": 1,
              "text-border-color": "#e1e8ec",
              "text-events": "yes",
              width: 1.6,
              "line-color": "#8c9fa9",
              "curve-style": "unbundled-bezier",
              "control-point-distances": [24],
              "control-point-weights": [0.5],
            },
          },
          {
            selector: 'edge[type="CHILD_OF"]',
            style: {
              "target-arrow-shape": "triangle",
              "target-arrow-color": "#8c9fa9",
            },
          },
          {
            selector: 'edge[type="SIBLING_OF"]',
            style: { "line-style": "dashed" },
          },
          {
            selector: "node:selected",
            style: { "border-width": 2, "border-color": "#168c87", "background-color": "#e5f5f2", color: "#155d5b" },
          },
          { selector: "edge:selected", style: { "line-color": "#168c87", "target-arrow-color": "#168c87" } },
        ],
        layout: { name: "grid" },
        minZoom: 0.15,
        maxZoom: 3,
      });
      const readableLabels = () => {
        if (!cy) return;
        const fontSize = Math.min(20, Math.max(14, 12 / cy.zoom()));
        cy.nodes().forEach((node) => { node.data("displayTitle", graphTitle(node.data("label"), fontSize)); });
        cy.style()
          .selector("node").style("font-size", fontSize)
          .selector("edge").style("font-size", Math.min(24, Math.max(12, 11 / cy.zoom())))
          .update();
      };
      cy.on("zoom", readableLabels);
      arrange(true);
      readableLabels();
      cy.on("tap", "edge", (event) => {
        closeContextMenu();
        const edge = event.target.data() as GraphEdge;
        void showEdgeDetails(edge.id).catch(notify);
      });
      cy.on("tap", "node", (event) => {
        selected = event.target.id();
        void open(selected!).catch(notify);
      });
      cy.on("cxttap", "node", (event) => {
        const original = event.originalEvent as MouseEvent | undefined;
        original?.preventDefault();
        const box = canvas.getBoundingClientRect();
        const pos = event.renderedPosition;
        const node = graph.nodes.find((n) => n.id === event.target.id());
        if (node)
          nodeMenu(
            node,
            original?.clientX ?? box.left + pos.x,
            original?.clientY ?? box.top + pos.y,
          );
      });
      cy.on("cxttap", "edge", (event) => {
        const original = event.originalEvent as MouseEvent | undefined;
        original?.preventDefault();
        const box = canvas.getBoundingClientRect();
        const pos = event.renderedPosition;
        const edge = event.target.data() as GraphEdge;
        contextMenu(
          original?.clientX ?? box.left + pos.x,
          original?.clientY ?? box.top + pos.y,
          "关系",
          [
            {
              label: "编辑边文字",
              icon: "✎",
              run: async () => {
                const latest = await api<GraphEdge>("/api/edges/" + encodeURIComponent(edge.id));
                edgeDialog(latest.source, latest, true);
              },
            },
            { label: "修改关系", icon: "◇", run: () => edgeDialog(edge.source, edge) },
          ],
        );
      });
      canvas.oncontextmenu = (event) => event.preventDefault();
      const prefix = center.value && scope.value === "descendants"
        ? `分支：${graph.nodes.find((n) => n.id === center.value)?.title ?? ""}（含全部递归子节点） · ` : "";
      status.textContent = prefix + (appliedSearch ? `搜索“${appliedSearch}”：找到 ` : "") +
        `${data.nodes.length} 个节点 · ${data.edges.length} 条关系`;
    }
    let requestVersion = 0;
    async function applyFilters() {
      const version = ++requestVersion;
      Object.assign(graphFilter, { center: center.value, scope: scope.value, hops: hops.value, edgeType: edgeType.value });
      scope.disabled = !center.value;
      hops.disabled = !center.value || scope.value === "descendants";
      const params = new URLSearchParams({ kbId: kb.id, hops: hops.value });
      if (center.value) { params.set("center", center.value); params.set("scope", scope.value); }
      if (edgeType.value) params.set("edgeType", edgeType.value);
      if (kind.value) params.set("kind", kind.value);
      if (appliedSearch) params.set("q", appliedSearch);
      const result = await api<GraphData>(`/api/kbs/${kb.id}/graph?${params}`);
      if (!disposed && version === requestVersion && main.contains(canvas))
        draw(result);
    }
    for (const select of [center, scope, hops, edgeType])
      select.onchange = () => void applyFilters().catch(notify);
    if (center.value || edgeType.value) {
      status.textContent = "正在加载图谱…";
      void applyFilters().catch(notify);
    }
    else {
      const ids = new Set(filtered().map((n) => n.id));
      draw({ nodes: filtered(), edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) });
    }
  }
  async function exportGraph(nodeIds?: string[]) {
    const result = await api(`/api/kbs/${kb.id}/export`, "POST", { nodeIds });
    download(
      `${kb.name}-图谱.json`,
      JSON.stringify(result, null, 2),
      "application/json",
    );
  }
  function exportDialog() {
    const m = modal("导出知识库");
    const type = e("select");
    type.append(
      new Option("JSON（结构、正文、概念和附件）", "json"),
      new Option("Markdown 文件夹 ZIP（含结构清单和附件）", "markdown"),
    );
    field(m.form, "格式", type);
    m.form.onsubmit = async (event) => {
      event.preventDefault();
      m.submit.disabled = true;
      try {
        const result = await api<{
          files: { path: string; text: string }[];
          assets: { id: string; data: string }[];
        }>(`/api/kbs/${kb.id}/export`, "POST", {});
        if (type.value === "json")
          download(
            `${kb.name}.json`,
            JSON.stringify(result, null, 2),
            "application/json",
          );
        else {
          const files: Record<string, Uint8Array> = {
            "graph.json": strToU8(JSON.stringify(result, null, 2)),
          };
          for (const file of result.files)
            files[file.path] = strToU8(file.text);
          for (const asset of result.assets)
            files[`assets/${asset.id}`] = Uint8Array.from(
              atob(asset.data),
              (c) => c.charCodeAt(0),
            );
          const bytes = zipSync(files);
          download(
            `${kb.name}.zip`,
            bytes.buffer as ArrayBuffer,
            "application/zip",
          );
        }
        m.dialog.close();
      } catch (error) {
        m.error.textContent = String(error);
        m.submit.disabled = false;
      }
    };
    m.show();
  }
  function importDialog() {
    const m = modal("导入到当前知识库");
    const type = e("select");
    type.append(
      new Option("Markdown 文件", "markdown"),
      new Option("Markdown 文件夹", "folder"),
      new Option("CSV（title、markdown、parentId…）", "csv"),
      new Option("Graph KB JSON", "json"),
    );
    field(m.form, "导入格式", type);
    const files = e("input");
    files.type = "file";
    files.multiple = true;
    files.accept = ".md";
    field(m.form, "选择文件", files);
    type.onchange = () => {
      files.value = "";
      files.toggleAttribute("webkitdirectory", type.value === "folder");
      files.accept =
        type.value === "json" ? ".json" : type.value === "csv" ? ".csv" : ".md";
    };
    m.form.append(
      e(
        "p",
        "导入不会覆盖已有文档；文件夹会映射为父节点。JSON 会重建结构并重新分配 ID。",
        "hint",
      ),
    );
    m.form.onsubmit = async (event) => {
      event.preventDefault();
      m.submit.disabled = true;
      try {
        const selected = [...(files.files ?? [])];
        if (!selected.length) throw Error("请先选择文件");
        if (selected.reduce((sum, f) => sum + f.size, 0) > 24 * 1024 * 1024)
          throw Error("请分批导入，每批文件总计不超过 24 MiB");
        const data =
          type.value === "json"
            ? { format: "json", data: JSON.parse(await selected[0].text()) }
            : {
                format: type.value === "folder" ? "markdown" : type.value,
                files: await Promise.all(
                  selected
                    .filter(
                      (f) =>
                        type.value === "csv" ||
                        f.name.toLowerCase().endsWith(".md"),
                    )
                    .map(async (f) => ({
                      path: f.webkitRelativePath || f.name,
                      text: await f.text(),
                    })),
                ),
              };
        const result = await api<{ created: number }>(
          `/api/kbs/${kb.id}/import`,
          "POST",
          data,
        );
        await reload();
        status.textContent = `已导入 ${result.created} 个节点`;
        m.dialog.close();
      } catch (error) {
        m.error.textContent = String(error);
        m.submit.disabled = false;
      }
    };
    m.show();
  }
  await reload();
}

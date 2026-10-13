import { contextMenu, closeContextMenu } from "./context-menu";
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
    view: "tree" | "graph" = "tree",
    selected: string | undefined,
    cy: Core | undefined;
  const collapsed = new Set<string>();
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
  const kind = e("select");
  kind.setAttribute("aria-label", "节点类型筛选");
  kind.append(
    new Option("全部类型", ""),
    ...Object.entries(kindNames).map(([k, v]) => new Option(v, k)),
  );
  toolbar.append(
    tabs,
    search,
    kind,
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
    closeContextMenu();
    cy?.destroy();
    cy = undefined;
    panel.replaceChildren();
    treeTab.setAttribute("aria-selected", String(view === "tree"));
    graphTab.setAttribute("aria-selected", String(view === "graph"));
    if (view === "tree") renderTree();
    else renderGraph();
  }
  let matches: Set<string> | undefined, timer: ReturnType<typeof setTimeout>;
  search.oninput = () => {
    clearTimeout(timer);
    const term = search.value.trim();
    timer = setTimeout(async () => {
      try {
        const found = term
          ? await api<PageNode[]>(
              `/api/search?kbId=${kb.id}&q=${encodeURIComponent(term)}`,
            )
          : undefined;
        if (disposed || search.value.trim() !== term) return;
        matches = found ? new Set(found.map((n) => n.id)) : undefined;
        render();
      } catch (error) {
        notify(error);
      }
    }, 200);
  };
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
        `tree-row${selected === node.id ? " selected" : ""}`,
      );
      const toggle = button(
        descendants.length ? (collapsed.has(node.id) ? "›" : "⌄") : "",
        () => {
          collapsed.has(node.id)
            ? collapsed.delete(node.id)
            : collapsed.add(node.id);
          renderTreeAgain();
        },
        "tree-toggle",
      );
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
        e("span", descendants.length ? "▱" : "▤", "tree-icon"),
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
            (edge.label ? " · " + edge.label : ""),
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
    const label = e("input");
    label.maxLength = 200;
    label.value = existing?.label ?? "";
    label.placeholder = "例如：参考资料；留空可清除";
    field(m.form, "边文字（可选）", label);
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
      hops = e("select"),
      edgeType = e("select"),
      target = e("select");
    center.setAttribute("aria-label", "邻域中心");
    center.append(
      new Option("全库图谱", ""),
      ...graph.nodes.map((n) => new Option(n.title, n.id)),
    );
    hops.setAttribute("aria-label", "邻域跳数");
    [1, 2, 3].forEach((n) => hops.append(new Option(`${n} 跳`, String(n))));
    edgeType.setAttribute("aria-label", "关系筛选");
    edgeType.append(
      new Option("全部关系", ""),
      new Option("从属关系", "CHILD_OF"),
      new Option("平行关系", "SIBLING_OF"),
    );
    target.setAttribute("aria-label", "路径终点");
    target.append(
      new Option("选择路径终点", ""),
      ...graph.nodes.map((n) => new Option(n.title, n.id)),
    );
    controls.append(
      center,
      hops,
      edgeType,
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
      "实线箭头：从属（子 → 父）　虚线：平行　右键边可编辑文字",
      "graph-legend",
    );
    const buttons = e("div", undefined, "graph-actions");
    buttons.append(
      button("放大", () => cy?.zoom(cy.zoom() * 1.25)),
      button("缩小", () => cy?.zoom(cy.zoom() / 1.25)),
      button("适应画布", () => cy?.fit(undefined, 60)),
      button("导出 PNG", () => {
        if (cy) {
          const anchor = e("a");
          anchor.href = cy.png({ full: true, bg: "#fafafd", scale: 2 });
          anchor.download = `${kb.name}-图谱.png`;
          anchor.click();
        }
      }),
      button("导出当前子图", () => exportGraph(cy?.nodes().map((n) => n.id()))),
    );
    panel.append(controls, legend, buttons, canvas);
    function draw(data: GraphData) {
      cy?.destroy();
      cy = cytoscape({
        container: canvas,
        elements: [
          ...data.nodes.map((n) => ({
            data: { id: n.id, label: n.title, kind: n.kind },
          })),
          ...data.edges.map((edge) => ({ data: edge })),
        ],
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "background-color": "#6b59e8",
              color: "#323042",
              "font-size": 12,
              "text-valign": "bottom",
              "text-margin-y": 10,
              "text-wrap": "wrap",
              "text-max-width": "125px",
              width: 38,
              height: 38,
            },
          },
          {
            selector: "edge",
            style: {
              label: "data(label)",
              "font-size": 12,
              color: "#514775",
              "text-wrap": "wrap",
              "text-max-width": "160px",
              "text-background-color": "#fafafd",
              "text-background-opacity": 0.9,
              "text-background-padding": "3px",
              "text-events": "yes",
              "text-margin-y": -10,
              width: 1.5,
              "line-color": "#b1a9da",
              "curve-style": "bezier",
            },
          },
          {
            selector: 'edge[type="CHILD_OF"]',
            style: {
              "target-arrow-shape": "triangle",
              "target-arrow-color": "#8577bc",
            },
          },
          {
            selector: 'edge[type="SIBLING_OF"]',
            style: { "line-style": "dashed" },
          },
          {
            selector: ":selected",
            style: { "border-width": 3, "border-color": "#211463" },
          },
        ],
        layout: {
          name: "cose",
          animate: false,
          padding: 65,
          nodeRepulsion: () => 14000,
          idealEdgeLength: () => 110,
        },
        minZoom: 0.15,
        maxZoom: 3,
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
      if (!data.nodes.length) status.textContent = "当前筛选下没有节点";
      else
        status.textContent = `${data.nodes.length} 个节点 · ${data.edges.length} 条关系`;
    }
    let requestVersion = 0;
    async function applyFilters() {
      const version = ++requestVersion;
      const params = new URLSearchParams({ kbId: kb.id, hops: hops.value });
      if (center.value) params.set("center", center.value);
      if (edgeType.value) params.set("edgeType", edgeType.value);
      if (kind.value) params.set("kind", kind.value);
      if (search.value.trim()) params.set("q", search.value.trim());
      const result = await api<GraphData>(`/api/kbs/${kb.id}/graph?${params}`);
      if (!disposed && version === requestVersion && main.contains(canvas))
        draw(result);
    }
    for (const select of [center, hops, edgeType])
      select.onchange = () => void applyFilters().catch(notify);
    const ids = new Set(filtered().map((n) => n.id));
    draw({
      nodes: filtered(),
      edges: graph.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    });
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

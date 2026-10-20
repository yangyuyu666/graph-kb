import type { GraphData, PageNode } from "./api";
import { directoryIcon } from "./directory-icons";
import { element as e, button } from "./ui";

export function setNodePickerValue(picker: HTMLButtonElement, graph: GraphData, id: string) {
  picker.value = id;
  picker.dataset.nodeId = id;
  const title = graph.nodes.find(n => n.id === id)?.title;
  picker.textContent = title ? `中心：${title}` : "全库图谱 · 选择节点";
  picker.title = title ?? "按目录层级选择图谱中心";
}

/** Browse structure rather than flattening a multi-parent graph into a select. */
export function nodePicker(graph: GraphData, selected: string) {
  const picker = button("", open, "node-picker-button");
  picker.setAttribute("aria-label", "邻域中心");
  picker.setAttribute("aria-haspopup", "dialog");
  setNodePickerValue(picker, graph, selected);

  function open() {
    const dialog = e("dialog", undefined, "node-picker-dialog");
    dialog.setAttribute("aria-label", "选择图谱中心");
    const heading = e("div", undefined, "node-picker-heading");
    heading.append(e("h2", "选择图谱中心"), button("关闭", () => dialog.close()));
    const search = e("input");
    search.type = "search";
    search.placeholder = "可选：搜索标题，不记得名称可直接展开目录";
    search.setAttribute("aria-label", "在节点目录中搜索");
    const list = e("div", undefined, "node-picker-list");
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const children = new Map<string, PageNode[]>(), parents = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (edge.type !== "CHILD_OF" || !nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      children.set(edge.target, [...(children.get(edge.target) ?? []), nodes.get(edge.source)!]);
      parents.set(edge.source, [...(parents.get(edge.source) ?? []), edge.target]);
    }
    const sort = (values: PageNode[]) => values.sort((a, b) => a.title.localeCompare(b.title, "zh-CN", { numeric: true }) || a.id.localeCompare(b.id));
    for (const values of children.values()) sort(values);
    const roots = sort(graph.nodes.filter(n => !parents.has(n.id)));
    const expanded = new Set<string>();
    function ancestors(ids: Iterable<string>) {
      const result = new Set(ids), todo = [...result];
      for (let i = 0; i < todo.length; i++)
        for (const parent of parents.get(todo[i]) ?? [])
          if (!result.has(parent)) { result.add(parent); todo.push(parent); }
      return result;
    }
    for (const id of ancestors(picker.value ? [picker.value] : [])) expanded.add(id);
    function choose(id: string) {
      setNodePickerValue(picker, graph, id);
      dialog.close();
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function render() {
      list.replaceChildren();
      const term = search.value.trim().toLocaleLowerCase();
      const matches = new Set(graph.nodes.filter(n => n.title.toLocaleLowerCase().includes(term)).map(n => n.id));
      const visible = term ? ancestors(matches) : undefined;
      const path = (node: PageNode, trail: PageNode[]): HTMLLIElement | undefined => {
        if (trail.some(n => n.id === node.id) || (visible && !visible.has(node.id))) return;
        const item = e("li"), row = e("div", undefined, "node-picker-row");
        row.dataset.nodeId = node.id;
        const descendants = children.get(node.id) ?? [];
        const isOpen = term ? true : expanded.has(node.id);
        const toggle = button("", () => {
          isOpen ? expanded.delete(node.id) : expanded.add(node.id);
          render();
          list.querySelector<HTMLButtonElement>(`[data-node-id="${node.id}"] .node-picker-toggle`)?.focus();
        }, "node-picker-toggle");
        toggle.setAttribute("aria-label", `${isOpen ? "折叠" : "展开"} ${node.title}`);
        toggle.disabled = !descendants.length || !!term;
        if (descendants.length) {
          toggle.append(directoryIcon("chevron"));
          toggle.classList.toggle("expanded", isOpen);
          toggle.setAttribute("aria-expanded", String(isOpen));
        }
        const pick = button("", () => choose(node.id), "node-picker-choice");
        pick.setAttribute("aria-label", `选择 ${node.title}`);
        pick.title = [...trail, node].map(n => n.title).join(" / ");
        pick.append(directoryIcon(descendants.length ? (isOpen ? "folder-open" : "folder") : "document"), e("span", node.title));
        if (picker.value === node.id) pick.setAttribute("aria-current", "true");
        if ((parents.get(node.id)?.length ?? 0) > 1) pick.append(e("small", "共享", "node-picker-shared"));
        row.append(toggle, pick);
        item.append(row);
        if (descendants.length && isOpen) {
          const nested = e("ul");
          for (const child of descendants) {
            const branch = path(child, [...trail, node]);
            if (branch) nested.append(branch);
          }
          item.append(nested);
        }
        return item;
      };
      const tree = e("ul");
      for (const root of roots) {
        const branch = path(root, []);
        if (branch) tree.append(branch);
      }
      list.append(tree);
      if (!tree.childElementCount) list.append(e("p", term ? "没有匹配节点" : "这个知识库还没有节点", "hint"));
    }
    search.oninput = render;
    const all = button("查看全库图谱", () => choose(""), "node-picker-all");
    const help = e("p", "点击箭头展开层级，点击节点名称设为中心。共享节点会出现在各自父节点下。", "hint");
    dialog.append(heading, help, search, all, list);
    // Keep the dialog owned by this workspace; refreshing/navigating removes it too.
    picker.after(dialog);
    dialog.onclose = () => { dialog.remove(); if (picker.isConnected) picker.focus(); };
    render();
    dialog.showModal();
  }
  return picker;
}

import type { GraphData } from "./api";

export function graphTitle(title: string, fontSize: number) {
  const chars = [...title.replace(/\s+/g, " ")];
  const lines = [""];
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i], size = /[\x20-\x7e]/.test(char) ? fontSize * 0.56 : fontSize;
    if (width + size > 112) {
      if (lines.length === 2) { lines[1] = [...lines[1]].slice(0, -1).join("") + "…"; break; }
      lines.push(""); width = 0;
    }
    lines[lines.length - 1] += char;
    width += size;
  }
  return lines.join("\n");
}

// A stable spanning forest supplies positions only. All original graph edges
// (including additional parents and siblings) remain visible and unchanged.
export function branchLayout(data: GraphData, edgeLength: number, aspect = 1.5) {
  const names = new Map(data.nodes.map((n) => [n.id, n.title]));
  const compare = (a: string, b: string) =>
    names.get(a)!.localeCompare(names.get(b)!, "zh-CN", { numeric: true }) || a.localeCompare(b);
  const ids = [...names.keys()].sort(compare);
  const children = new Map(ids.map((id) => [id, [] as string[]]));
  const hasParent = new Set<string>();
  for (const edge of data.edges) {
    if (edge.type !== "CHILD_OF" || !names.has(edge.source) || !names.has(edge.target)) continue;
    children.get(edge.target)!.push(edge.source);
    hasParent.add(edge.source);
  }
  for (const list of children.values()) list.sort(compare);
  const owned = new Map(ids.map((id) => [id, [] as string[]]));
  const seen = new Set<string>();
  const components: { root: string; order: string[] }[] = [];
  for (const root of [...ids.filter((id) => !hasParent.has(id)), ...ids]) {
    if (seen.has(root)) continue;
    const order = [root];
    seen.add(root);
    for (let index = 0; index < order.length; index++) {
      const parent = order[index];
      for (const child of children.get(parent)!) {
        if (seen.has(child)) continue;
        seen.add(child);
        owned.get(parent)!.push(child);
        order.push(child);
      }
    }
    components.push({ root, order });
  }
  const stepX = 168 + edgeLength * 0.6;
  const stepY = 88;
  const blocks = components.map(({ root, order }) => {
    const leaves = new Map<string, number>();
    for (const id of [...order].reverse())
      leaves.set(id, Math.max(1, owned.get(id)!.reduce((sum, child) => sum + leaves.get(child)!, 0)));
    const sides: string[][] = [[], []];
    const totals = [0, 0];
    for (const child of owned.get(root)!) {
      const side = totals[0] <= totals[1] ? 0 : 1;
      sides[side].push(child);
      totals[side] += leaves.get(child)!;
    }
    const points = [{ id: root, x: 0, y: 0 }];
    for (let side = 0; side < 2; side++) {
      let top = -totals[side] * stepY / 2;
      const pending: { id: string; depth: number; top: number }[] = [];
      for (const id of sides[side]) {
        pending.push({ id, depth: 1, top });
        top += leaves.get(id)! * stepY;
      }
      for (let index = 0; index < pending.length; index++) {
        const item = pending[index];
        points.push({ id: item.id, x: item.depth * stepX * (side === 0 ? 1 : -1), y: item.top + leaves.get(item.id)! * stepY / 2 });
        let childTop = item.top;
        for (const id of owned.get(item.id)!) {
          pending.push({ id, depth: item.depth + 1, top: childTop });
          childTop += leaves.get(id)! * stepY;
        }
      }
    }
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const left = Math.min(...xs) - 84, top = Math.min(...ys) - 27;
    return { points, left, top, width: Math.max(...xs) + 84 - left, height: Math.max(...ys) + 27 - top };
  });
  // Pack separate roots without using auto-maintained sibling edges as forces.
  const width = Math.max(1, ...blocks.map((b) => b.width)) + 80;
  const height = Math.max(1, ...blocks.map((b) => b.height)) + 80;
  let columns = 1, best = Infinity;
  for (let count = 1; count <= blocks.length; count++) {
    const cost = Math.max(count * width / aspect, Math.ceil(blocks.length / count) * height);
    if (cost < best) { best = cost; columns = count; }
  }
  return blocks.flatMap((block, index) => block.points.map((point) => ({
    id: point.id,
    x: point.x - block.left + (index % columns) * width,
    y: point.y - block.top + Math.floor(index / columns) * height,
  })));
}

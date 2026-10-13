import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { ToolError, requireId, requireText } from "./errors.mjs";
const fail = (message, code = "INVALID_INPUT") =>
  new ToolError(code, message, "检查输入并刷新后重试");
const types = ["Page", "Tag", "File", "Person", "Task", "Concept"];
const retention = 30 * 24 * 60 * 60 * 1000;
export const edgeId = (edge) => `${edge.type}:${edge.source}:${edge.target}`;

export const mvpMethods = {
  async allNodes(kbId) {
    const ids = await this.store.query(
      "MATCH (n:Node {kbId: $kbId}) RETURN n.id AS id ORDER BY n.title",
      { kbId },
    );
    return Promise.all(ids.map(({ id }) => this.store.node(id)));
  },
  async allEdges(kbId) {
    const edges = await this.store.query(
      "MATCH (a:Node {kbId: $kbId})-[r]->(b:Node) RETURN a.id AS source, b.id AS target, label(r) AS type",
      { kbId },
    );
    return edges.map((e) => ({ ...e, id: edgeId(e) }));
  },
  async graph({ kbId, center, hops = 1, edgeType, kind, q = "" }) {
    await this.mustKb(kbId);
    if (!Number.isInteger(Number(hops)) || Number(hops) < 1 || Number(hops) > 3)
      throw fail("邻域跳数须为 1–3");
    let nodes = (await this.allNodes(kbId)).filter((n) => n.kind !== "Concept");
    let allowed = new Set(nodes.map((n) => n.id));
    let edges = (await this.allEdges(kbId)).filter(
      (e) => allowed.has(e.source) && allowed.has(e.target),
    );
    if (edgeType) {
      if (!["CHILD_OF", "SIBLING_OF"].includes(edgeType))
        throw fail("关系筛选无效");
      edges = edges.filter((e) => e.type === edgeType);
    }
    if (center) {
      if (!allowed.has(center)) throw fail("中心节点不在当前可见图中");
      const visited = new Set([center]);
      let frontier = [center];
      for (let step = 0; step < Number(hops); step++) {
        const next = [];
        for (const id of frontier)
          for (const e of edges) {
            const other =
              e.source === id ? e.target : e.target === id ? e.source : null;
            if (other && !visited.has(other)) {
              visited.add(other);
              next.push(other);
            }
          }
        frontier = next;
      }
      nodes = nodes.filter((n) => visited.has(n.id));
    }
    if (kind) nodes = nodes.filter((n) => n.kind === kind);
    if (q) {
      const matches = new Set(
        (await this.search({ kbId, q })).map((n) => n.id),
      );
      nodes = nodes.filter((n) => matches.has(n.id));
    }
    allowed = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: edges.filter(
        (e) => allowed.has(e.source) && allowed.has(e.target),
      ),
    };
  },
  async search({ kbId, q }) {
    const term = requireText(q, "搜索词", 500).toLocaleLowerCase();
    const kbs = kbId
      ? (await this.mustKb(kbId), [{ id: kbId }])
      : await this.listKbs();
    const result = [];
    for (const kb of kbs)
      for (const node of await this.allNodes(kb.id)) {
        if (node.kind === "Concept") continue;
        const markdown = await this.store.document(node.id);
        const index = markdown.toLocaleLowerCase().indexOf(term);
        if (node.title.toLocaleLowerCase().includes(term) || index >= 0)
          result.push({
            ...node,
            excerpt: markdown.slice(
              Math.max(0, index - 40),
              Math.max(0, index - 40) + 180,
            ),
          });
      }
    return result;
  },
  async backlinks({ id }) {
    await this.mustNode(id);
    const results = [];
    const link = new RegExp(
      `\\]\\(<?node:${id}>?(?:\\s+["'][^"']*["'])?\\)`,
      "i",
    );
    for (const kb of await this.listKbs())
      for (const other of await this.allNodes(kb.id))
        if (
          other.kind !== "Concept" &&
          link.test(await this.store.document(other.id))
        )
          results.push(other);
    return results;
  },
  async getKb({ id }) {
    await this.mustKb(id);
    return (await this.listKbs()).find((kb) => kb.id === id);
  },
  async getEdge({ id }) {
    const [type, source, target] = String(id ?? "").split(":");
    if (!["CHILD_OF", "SIBLING_OF"].includes(type)) throw fail("关系类型无效");
    const node = await this.mustNode(source);
    requireId(target);
    const edge = (await this.allEdges(node.kbId)).find((e) => e.id === id);
    if (!edge)
      throw new ToolError("NOT_FOUND", "关系不存在", "刷新关系列表", 404);
    return edge;
  },
  async related({ id }) {
    const source = await this.mustNode(id);
    const edges = await this.allEdges(source.kbId);
    const concepts = new Set(
      (await this.allNodes(source.kbId))
        .filter((n) => n.kind === "Concept")
        .map((n) => n.id),
    );
    const mine = new Set(
      edges
        .filter(
          (e) =>
            e.type === "CHILD_OF" && e.target === id && concepts.has(e.source),
        )
        .map((e) => e.source),
    );
    const scores = new Map();
    for (const e of edges)
      if (mine.has(e.source) && e.target !== id)
        scores.set(e.target, (scores.get(e.target) ?? 0) + 1);
    const result = [];
    for (const [target, score] of scores) {
      const node = await this.store.node(target);
      if (node && node.kind !== "Concept") result.push({ ...node, score });
    }
    return result.sort((a, b) => b.score - a.score);
  },
  async path({ kbId, source, target, edgeType }) {
    const graph = await this.graph({ kbId, edgeType });
    if (![source, target].every((id) => graph.nodes.some((n) => n.id === id)))
      throw fail("路径端点不在当前知识库");
    const previous = new Map([[source, null]]),
      todo = [source];
    for (let i = 0; i < todo.length && !previous.has(target); i++)
      for (const e of graph.edges) {
        // Exploration is undirected; returned edges retain their actual direction.
        const next =
          e.source === todo[i]
            ? e.target
            : e.target === todo[i]
              ? e.source
              : null;
        if (next && !previous.has(next)) {
          previous.set(next, { id: todo[i], edge: e });
          todo.push(next);
        }
      }
    if (!previous.has(target)) return { nodes: [], edges: [] };
    const ids = [target],
      edges = [];
    let current = target;
    while (previous.get(current)) {
      const step = previous.get(current);
      edges.unshift(step.edge);
      current = step.id;
      ids.unshift(current);
    }
    return {
      nodes: ids.map((id) => graph.nodes.find((n) => n.id === id)),
      edges,
    };
  },
  async renameKb({ id, name }) {
    await this.mustKb(id);
    name = requireText(name, "知识库名称");
    await this.store.query(
      "MATCH (k:KnowledgeBase {id:$id}) SET k.name=$name",
      { id, name },
    );
    return { id, name };
  },
  async renameNode({ id, title, revision }) {
    const node = await this.mustNode(id);
    if (node.kind === "Concept") throw fail("请使用概念管理工具");
    if (revision !== node.revision)
      throw new ToolError(
        "REVISION_CONFLICT",
        "文档已被其他窗口修改",
        "刷新节点信息后重试",
        409,
      );
    title = requireText(title, "标题");
    const updatedAt = new Date().toISOString();
    await this.store.query(
      "MATCH (n:Node {id:$id}) SET n.title=$title,n.updatedAt=$updatedAt,n.revision=$revision",
      { id, title, updatedAt, revision: revision + 1 },
    );
    return { ...node, title, updatedAt, revision: revision + 1 };
  },
  async removeEdge({ id, type, source, target }) {
    if (id) [type, source, target] = id.split(":");
    if (!["CHILD_OF", "SIBLING_OF"].includes(type)) throw fail("关系类型无效");
    const a = await this.mustNode(source),
      b = await this.mustNode(target);
    if (a.kbId !== b.kbId) throw fail("关系不能跨知识库");
    if (type === "SIBLING_OF" && source > target)
      [source, target] = [target, source];
    return this.store.transaction([], async () => {
      await this.store.query(
        `MATCH (:Node {id:$source})-[r:${type}]->(:Node {id:$target}) DELETE r`,
        { source, target },
      );
      if (type === "CHILD_OF") await this.syncSiblings(a.kbId);
      return { deleted: true };
    });
  },
  async updateEdge({ id, type, source, target }) {
    await this.getEdge({ id });
    const [oldType, oldSource, oldTarget] = (id ?? "").split(":");
    if (!["CHILD_OF", "SIBLING_OF"].includes(oldType)) throw fail("原关系无效");
    const old = await this.mustNode(oldSource);
    await this.mustNode(oldTarget);
    const node = await this.mustNode(source);
    if (node.kbId !== old.kbId) throw fail("关系不能跨知识库");
    return this.store.transaction([], async () => {
      await this.store.query(
        `MATCH (:Node {id:$source})-[r:${oldType}]->(:Node {id:$target}) DELETE r`,
        { source: oldSource, target: oldTarget },
      );
      await this.validateEdge(type, source, target);
      const result = await this.writeEdge(type, source, target);
      await this.syncSiblings(node.kbId);
      return result;
    });
  },
  async syncSiblings(kbId) {
    const nodes = (await this.allNodes(kbId)).filter(
      (n) => n.kind !== "Concept",
    );
    const edges = await this.allEdges(kbId);
    const nonroots = new Set(
      edges.filter((e) => e.type === "CHILD_OF").map((e) => e.source),
    );
    for (const e of edges)
      if (
        e.type === "SIBLING_OF" &&
        (nonroots.has(e.source) || nonroots.has(e.target))
      )
        await this.store.query(
          "MATCH (:Node {id:$a})-[r:SIBLING_OF]->(:Node {id:$b}) DELETE r",
          { a: e.source, b: e.target },
        );
    const roots = nodes.filter((n) => !nonroots.has(n.id));
    for (let i = 0; i < roots.length; i++)
      for (let j = i + 1; j < roots.length; j++)
        await this.writeEdge("SIBLING_OF", roots[i].id, roots[j].id);
  },
  async deletedNode(id) {
    const rows = await this.store.query(
      "MATCH (t:Trash) RETURN t.snapshot AS snapshot",
    );
    return rows.some((row) =>
      JSON.parse(row.snapshot).nodes.some((n) => n.id === id),
    );
  },
  async trash({ id, kb = false }) {
    let knowledgeBase, nodes;
    if (kb) {
      await this.mustKb(id);
      [knowledgeBase] = await this.store.query(
        "MATCH (k:KnowledgeBase {id:$id}) RETURN k.id AS id,k.name AS name",
        { id },
      );
      nodes = await this.allNodes(id);
    } else {
      const node = await this.mustNode(id);
      nodes = [node];
    }
    const kbId = kb ? id : nodes[0].kbId,
      ids = new Set(nodes.map((n) => n.id));
    const edges = (await this.allEdges(kbId)).filter(
      (e) => ids.has(e.source) || ids.has(e.target),
    );
    const batch = {
      id: randomUUID(),
      kind: kb ? "KnowledgeBase" : "Node",
      title: kb ? knowledgeBase.name : nodes[0].title,
      deletedAt: new Date().toISOString(),
    };
    const snapshot = JSON.stringify({ knowledgeBase, nodes, edges, kbId });
    await this.store.transaction(
      [],
      async () => {
        await this.store.query(
          "CREATE (:Trash {id:$id,kind:$kind,title:$title,deletedAt:$deletedAt,snapshot:$snapshot})",
          { ...batch, snapshot },
        );
        for (const node of nodes) {
          await this.store.query("MATCH (n:Node {id:$id}) DETACH DELETE n", {
            id: node.id,
          });
          await this.store.query("MATCH (c:ExtractCache {id:$id}) DELETE c", {
            id: node.id,
          });
        }
        if (kb)
          await this.store.query("MATCH (k:KnowledgeBase {id:$id}) DELETE k", {
            id,
          });
        else await this.syncSiblings(kbId);
      },
      nodes.map((n) => ({ type: "trash", id: n.id, batchId: batch.id })),
    );
    return batch;
  },
  async listTrash() {
    return this.store.query(
      "MATCH (t:Trash) RETURN t.id AS id,t.kind AS kind,t.title AS title,t.deletedAt AS deletedAt ORDER BY t.deletedAt DESC",
    );
  },
  async restore({ id }) {
    requireId(id);
    const [entry] = await this.store.query(
      "MATCH (t:Trash {id:$id}) RETURN t.snapshot AS snapshot,t.deletedAt AS deletedAt",
      { id },
    );
    if (!entry) throw fail("回收站记录不存在");
    if (Date.now() - Date.parse(entry.deletedAt) >= retention)
      throw fail("该记录已过 30 天保留期");
    const snapshot = JSON.parse(entry.snapshot),
      skipped = [];
    if (!snapshot.knowledgeBase) await this.mustKb(snapshot.kbId);
    await this.store.transaction(
      [],
      async () => {
        if (snapshot.knowledgeBase)
          await this.store.query(
            "CREATE (:KnowledgeBase {id:$id,name:$name})",
            snapshot.knowledgeBase,
          );
        for (const node of snapshot.nodes) await this.insertNode(node);
        for (const edge of snapshot.edges) {
          if (
            !(await this.store.node(edge.source)) ||
            !(await this.store.node(edge.target))
          ) {
            skipped.push(edge.id);
            continue;
          }
          try {
            await this.validateEdge(edge.type, edge.source, edge.target);
          } catch {
            skipped.push(edge.id);
            continue;
          }
          await this.writeEdge(edge.type, edge.source, edge.target);
        }
        await this.syncSiblings(snapshot.kbId);
        await this.store.query("MATCH (t:Trash {id:$id}) DELETE t", { id });
      },
      [
        ...snapshot.nodes.map((n) => ({
          type: "restore",
          id: n.id,
          batchId: id,
        })),
        { type: "purge", id },
      ],
    );
    return { restored: snapshot.nodes.length, skippedEdges: skipped };
  },
  async expireTrash() {
    const entries = await this.store.query(
      "MATCH (t:Trash) RETURN t.id AS id,t.deletedAt AS deletedAt,t.snapshot AS snapshot",
    );
    for (const entry of entries)
      if (Date.now() - Date.parse(entry.deletedAt) >= retention) {
        const snapshot = JSON.parse(entry.snapshot),
          assets = [];
        for (const node of snapshot.nodes)
          assets.push(
            ...(await this.store.query(
              "MATCH (a:Asset {ownerId:$id}) RETURN a.id AS id",
              { id: node.id },
            )),
          );
        await this.store.transaction(
          [],
          async () => {
            for (const asset of assets)
              await this.store.query(
                "MATCH (a:Asset {id:$id}) DELETE a",
                asset,
              );
            await this.store.query("MATCH (t:Trash {id:$id}) DELETE t", {
              id: entry.id,
            });
          },
          [
            { type: "purge", id: entry.id },
            ...assets.map((a) => ({ type: "purgeAsset", id: a.id })),
          ],
        );
      }
  },
  async uploadAsset({ ownerId, name, mime, data }) {
    const owner = await this.mustNode(ownerId);
    if (owner.kind === "Concept") throw fail("不能给后台概念添加附件");
    name = requireText(name, "文件名");
    if (
      typeof data !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
      data.length > 14 * 1024 * 1024
    )
      throw fail("附件须为不超过 10 MiB 的 Base64 内容");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > 10 * 1024 * 1024) throw fail("附件超过 10 MiB");
    const asset = {
      id: randomUUID(),
      ownerId,
      name,
      mime: requireText(mime || "application/octet-stream", "文件类型"),
    };
    await this.store.transaction(
      [],
      () =>
        this.store.query(
          "CREATE (:Asset {id:$id,ownerId:$ownerId,name:$name,mime:$mime})",
          asset,
        ),
      [{ type: "asset", id: asset.id, data: bytes }],
    );
    return { ...asset, size: bytes.length };
  },
  async getAsset({ id }) {
    requireId(id);
    const [asset] = await this.store.query(
      "MATCH (a:Asset {id:$id}) RETURN a.id AS id,a.ownerId AS ownerId,a.name AS name,a.mime AS mime",
      { id },
    );
    if (!asset) throw fail("附件不存在");
    await this.mustNode(asset.ownerId);
    return {
      ...asset,
      data: (
        await readFile(join(this.store.root, "blobs", `${id}.bin`))
      ).toString("base64"),
    };
  },
  async exportKb({ kbId, nodeIds }) {
    await this.mustKb(kbId);
    const [kb] = await this.store.query(
      "MATCH (k:KnowledgeBase {id:$id}) RETURN k.id AS id,k.name AS name",
      { id: kbId },
    );
    let nodes = await this.allNodes(kbId);
    if (nodeIds) {
      if (
        !Array.isArray(nodeIds) ||
        nodeIds.some((id) => !nodes.some((n) => n.id === id))
      )
        throw fail("导出节点列表无效");
      nodes = nodes.filter((n) => nodeIds.includes(n.id));
    }
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (await this.allEdges(kbId)).filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
    const assets = [];
    for (const node of nodes) {
      node.markdown = await this.store.document(node.id);
      for (const asset of await this.store.query(
        "MATCH (a:Asset {ownerId:$id}) RETURN a.id AS id",
        { id: node.id },
      ))
        assets.push(await this.getAsset(asset));
    }
    const files = nodes
      .filter((n) => n.kind !== "Concept")
      .map((n) => ({
        path: `${n.id}.md`,
        text: n.markdown
          .replace(/node:([0-9a-f-]{36})/gi, (match, id) =>
            ids.has(id) ? `./${id}.md` : match,
          )
          .replace(/asset:([0-9a-f-]{36})/gi, "./assets/$1"),
      }));
    return { format: "graph-kb", version: 1, kb, nodes, edges, assets, files };
  },
  async importKb({ kbId, format, files, data }) {
    await this.mustKb(kbId);
    let sourceNodes = [],
      sourceEdges = [],
      sourceAssets = [];
    if (format === "json") {
      if (
        data?.format !== "graph-kb" ||
        data.version !== 1 ||
        !Array.isArray(data.nodes) ||
        !Array.isArray(data.edges)
      )
        throw fail("不是受支持的 Graph KB JSON");
      sourceNodes = data.nodes;
      sourceEdges = data.edges;
      sourceAssets = data.assets ?? [];
    } else {
      if (!Array.isArray(files) || files.length > 2000)
        throw fail("导入文件列表无效或超过 2000 个");
      const paths = new Map();
      const add = (path, title, markdown = "") => {
        const n = { id: path, title, markdown, kind: "Page" };
        paths.set(path, n);
        sourceNodes.push(n);
        return n;
      };
      if (format === "csv") {
        for (const file of files) {
          const rows = parseCsv(file.text);
          const header = rows.shift();
          if (!header?.includes("title"))
            throw fail(
              "CSV 必须包含 title 列，可选 id、parentId、markdown、kind",
            );
          for (const row of rows) {
            if (row.length !== header.length) throw fail("CSV 列数不一致");
            const item = Object.fromEntries(header.map((h, i) => [h, row[i]]));
            const n = {
              ...item,
              id: item.id || randomUUID(),
              kind: item.kind || "Page",
              markdown: item.markdown || "",
            };
            sourceNodes.push(n);
            if (item.parentId)
              sourceEdges.push({
                source: n.id,
                target: item.parentId,
                type: "CHILD_OF",
              });
          }
        }
      } else if (format === "markdown") {
        for (const file of files) {
          if (
            !file ||
            typeof file.path !== "string" ||
            typeof file.text !== "string"
          )
            throw fail("Markdown 文件须包含路径和文本");
          const path = String(file.path).replaceAll("\\", "/");
          if (
            path.startsWith("/") ||
            path.split("/").some((p) => p === ".." || !p) ||
            !path.toLowerCase().endsWith(".md")
          )
            throw fail("Markdown 路径无效");
          if (paths.has(path)) throw fail("文件路径重复");
          const parts = path.split("/");
          let parent = "";
          for (const folder of parts.slice(0, -1)) {
            const key = parent + folder + "/";
            if (!paths.has(key)) {
              add(key, folder);
              if (parent)
                sourceEdges.push({
                  source: key,
                  target: parent,
                  type: "CHILD_OF",
                });
            }
            parent = key;
          }
          add(path, parts.at(-1).replace(/\.md$/i, ""), file.text);
          if (parent)
            sourceEdges.push({
              source: path,
              target: parent,
              type: "CHILD_OF",
            });
        }
        for (const n of sourceNodes)
          n.markdown = n.markdown.replace(
            /(\]\()([^\s)]+\.md)(\))/gi,
            (match, a, href, b) => {
              let path;
              try {
                path = posix.normalize(
                  posix.join(posix.dirname(n.id), decodeURIComponent(href)),
                );
              } catch {
                return match;
              }
              return paths.has(path) ? `${a}node:${path}${b}` : match;
            },
          );
      } else throw fail("支持 markdown、csv、json 导入");
    }
    if (
      !sourceNodes.length ||
      sourceNodes.length > 2000 ||
      sourceEdges.length > 20000 ||
      !Array.isArray(sourceAssets) ||
      sourceAssets.length > 2000
    )
      throw fail("导入规模无效");
    const mapping = new Map(),
      assetMapping = new Map();
    const existingConcepts = new Map(
      (await this.allNodes(kbId))
        .filter((n) => n.kind === "Concept")
        .map((n) => [n.conceptKey, n.id]),
    );
    const conceptIds = new Map(existingConcepts);
    for (const n of sourceNodes) {
      if (!n || typeof n.id !== "string" || !n.id || mapping.has(n.id))
        throw fail("节点 ID 缺失或重复");
      if (n.kind === "Concept") {
        const key = requireText(n.title, "概念名称").normalize("NFC");
        if (!conceptIds.has(key)) conceptIds.set(key, randomUUID());
        mapping.set(n.id, conceptIds.get(key));
      } else mapping.set(n.id, randomUUID());
    }
    for (const a of sourceAssets) {
      if (
        !a ||
        typeof a.id !== "string" ||
        !a.id ||
        assetMapping.has(a.id) ||
        !mapping.has(a.ownerId)
      )
        throw fail("附件 ID 或所属节点无效");
      assetMapping.set(a.id, randomUUID());
    }
    const now = new Date().toISOString();
    const seen = new Set(existingConcepts.values());
    const nodes = sourceNodes
      .map((n) => {
        if (
          !types.includes(n.kind) ||
          typeof n.markdown !== "string" ||
          Buffer.byteLength(n.markdown) > 1024 * 1024
        )
          throw fail("节点类型或文档大小无效");
        let markdown = n.markdown;
        for (const [old, id] of mapping) {
          const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          markdown = markdown.replace(
            new RegExp(`node:${escaped}(?=[)>]|\\s+["'])`, "g"),
            `node:${id}`,
          );
        }
        for (const [old, id] of assetMapping)
          markdown = markdown.split(`asset:${old}`).join(`asset:${id}`);
        return {
          id: mapping.get(n.id),
          kbId,
          title: requireText(n.title, "标题"),
          kind: n.kind,
          conceptKey:
            n.kind === "Concept"
              ? requireText(n.title, "名称").normalize("NFC")
              : "",
          updatedAt: now,
          revision: 0,
          markdown,
        };
      })
      .filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });
    const edges = sourceEdges.map((e) => {
      if (
        !e ||
        !mapping.has(e.source) ||
        !mapping.has(e.target) ||
        !["CHILD_OF", "SIBLING_OF"].includes(e.type)
      )
        throw fail("导入关系无效");
      return {
        ...e,
        source: mapping.get(e.source),
        target: mapping.get(e.target),
      };
    });
    const assets = sourceAssets.map((a) => {
      if (
        typeof a.data !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) ||
        a.data.length > 14 * 1024 * 1024
      )
        throw fail("附件内容无效或过大");
      const bytes = Buffer.from(a.data, "base64");
      if (bytes.length > 10 * 1024 * 1024) throw fail("附件超过 10 MiB");
      return {
        id: assetMapping.get(a.id),
        ownerId: mapping.get(a.ownerId),
        name: requireText(a.name, "文件名"),
        mime: requireText(a.mime, "文件类型"),
        data: bytes,
      };
    });
    await this.store.transaction(
      nodes.map((n) => ({ id: n.id, markdown: n.markdown })),
      async () => {
        for (const { markdown, ...node } of nodes) await this.insertNode(node);
        for (const e of edges.sort(
          (a, b) =>
            (a.type === "CHILD_OF" ? -1 : 1) - (b.type === "CHILD_OF" ? -1 : 1),
        )) {
          await this.validateEdge(e.type, e.source, e.target);
          await this.writeEdge(e.type, e.source, e.target);
        }
        for (const { data, ...asset } of assets)
          await this.store.query(
            "CREATE (:Asset {id:$id,ownerId:$ownerId,name:$name,mime:$mime})",
            asset,
          );
        await this.syncSiblings(kbId);
      },
      assets.map((a) => ({ type: "asset", id: a.id, data: a.data })),
    );
    return { created: nodes.length, idMap: Object.fromEntries(mapping) };
  },
  async mergeConcepts({ source, target }) {
    const a = await this.mustNode(source),
      b = await this.mustNode(target);
    if (
      source === target ||
      a.kind !== "Concept" ||
      b.kind !== "Concept" ||
      a.kbId !== b.kbId
    )
      throw fail("只能合并同库不同的后台概念");
    const edges = (await this.allEdges(a.kbId)).filter(
      (e) => e.source === source || e.target === source,
    );
    const batch = {
      id: randomUUID(),
      kind: "Node",
      title: a.title,
      deletedAt: new Date().toISOString(),
      snapshot: JSON.stringify({ nodes: [a], edges, kbId: a.kbId }),
    };
    await this.store.transaction(
      [],
      async () => {
        for (const e of edges) {
          const from = e.source === source ? target : e.source,
            to = e.target === source ? target : e.target;
          if (from !== to) {
            await this.validateEdge(e.type, from, to);
            await this.writeEdge(e.type, from, to);
          }
        }
        await this.store.query("MATCH (n:Node {id:$id}) DETACH DELETE n", {
          id: source,
        });
        await this.store.query(
          "CREATE (:Trash {id:$id,kind:$kind,title:$title,deletedAt:$deletedAt,snapshot:$snapshot})",
          batch,
        );
      },
      [{ type: "trash", id: source, batchId: batch.id }],
    );
    return { merged: source, into: target, trashId: batch.id };
  },
};
export const mvpOperations = {
  get_kb: mvpMethods.getKb,
  get_edge: mvpMethods.getEdge,
  resolve_links: async function ({ ids }) {
    if (!Array.isArray(ids) || ids.length > 1000)
      throw fail("链接 ID 列表无效");
    const result = [];
    for (const id of ids) {
      requireId(id);
      const node = await this.store.node(id);
      result.push({
        id,
        state: node && node.kind !== "Concept" ? "active" : "deleted",
        title: node?.kind !== "Concept" ? node?.title : undefined,
      });
    }
    return result;
  },
  get_graph: mvpMethods.graph,
  search: mvpMethods.search,
  query_path: mvpMethods.path,
  backlinks: mvpMethods.backlinks,
  related: mvpMethods.related,
  rename_kb: mvpMethods.renameKb,
  rename_node: mvpMethods.renameNode,
  delete_node: async function (input) {
    return this.trash(input);
  },
  delete_kb: async function (input) {
    return this.trash({ ...input, kb: true });
  },
  list_trash: mvpMethods.listTrash,
  restore: mvpMethods.restore,
  delete_edge: mvpMethods.removeEdge,
  update_edge: mvpMethods.updateEdge,
  upload_asset: mvpMethods.uploadAsset,
  get_asset: mvpMethods.getAsset,
  export_kb: mvpMethods.exportKb,
  import_kb: mvpMethods.importKb,
  merge_concepts: mvpMethods.mergeConcepts,
};
function parseCsv(text) {
  if (typeof text !== "string") throw fail("CSV 内容须为文本");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw fail("CSV 引号未闭合");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

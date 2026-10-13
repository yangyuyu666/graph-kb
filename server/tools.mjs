import { randomUUID, createHash } from "node:crypto";
import { ToolError, requireId, requireText } from "./errors.mjs";
import { parseEntities } from "./cloud-extractor.mjs";
import { mvpOperations, mvpMethods } from "./operations.mjs";

// Shared write boundary for UI/REST and future MCP adapters. No raw Cypher endpoint.
export class KnowledgeTools {
  constructor(
    store,
    { extractor = null, extractionEnabled = false, cloudSettings = null } = {},
  ) {
    this.store = store;
    this.extractor = extractor;
    this.extractionEnabled = extractionEnabled;
    this.cloudSettings = cloudSettings;
  }
  execute(name, input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ToolError(
        "INVALID_INPUT",
        "工具参数须为 JSON 对象",
        "检查 arguments",
      );
    const operations = {
      ...Object.fromEntries(
        Object.entries(mvpOperations).map(([key, fn]) => [
          key,
          () => fn.call(this, input),
        ]),
      ),
      list_kbs: () => this.listKbs(),
      create_kb: () => this.createKb(input),
      list_nodes: () => this.listNodes(input),
      create_node: () => this.createNode(input),
      get_node: () => this.getNode(input),
      update_doc: () => this.updateDoc(input),
      create_edge: () => this.createEdge(input),
      query_neighbors: () => this.neighbors(input),
      get_settings: () => this.settings().public(),
      update_settings: () => this.settings().update(input),
    };
    if (!Object.hasOwn(operations, name))
      throw new ToolError("UNKNOWN_TOOL", "工具不存在", "使用已支持的工具");
    return this.store.run(async () => {
      if (Date.now() - (this.lastPurge ?? 0) > 60_000) {
        await this.expireTrash();
        this.lastPurge = Date.now();
      }
      return operations[name]();
    });
  }
  settings() {
    if (!this.cloudSettings)
      throw new ToolError(
        "SETTINGS_UNAVAILABLE",
        "此服务未启用云端配置",
        "使用应用入口启动服务",
      );
    return this.cloudSettings;
  }
  async mustNode(id) {
    const node = await this.store.node(requireId(id));
    if (!node) {
      if (await this.deletedNode(id))
        throw new ToolError(
          "NODE_DELETED",
          "已删除节点",
          "可在回收站中恢复，保留 30 天",
          410,
        );
      throw new ToolError("NOT_FOUND", "节点不存在", "重新加载节点列表", 404);
    }
    return node;
  }
  async mustKb(id) {
    const rows = await this.store.query(
      "MATCH (k:KnowledgeBase {id: $id}) RETURN k.id",
      { id: requireId(id) },
    );
    if (!rows.length)
      throw new ToolError("NOT_FOUND", "知识库不存在", "先创建知识库", 404);
  }
  async listKbs() {
    const rows = await this.store.query(
      "MATCH (k:KnowledgeBase) RETURN k.id AS id, k.name AS name ORDER BY k.name",
    );
    for (const kb of rows) {
      const [count] = await this.store.query(
        "MATCH (n:Node {kbId: $id}) WHERE n.kind <> 'Concept' RETURN count(n) AS count, max(n.updatedAt) AS updatedAt",
        { id: kb.id },
      );
      kb.nodeCount = Number(count.count);
      kb.updatedAt = count.updatedAt;
    }
    return rows;
  }
  async createKb({ name }) {
    const kb = { id: randomUUID(), name: requireText(name, "知识库名称") };
    await this.store.query(
      "CREATE (:KnowledgeBase {id: $id, name: $name})",
      kb,
    );
    return kb;
  }
  async listNodes({ kbId }) {
    await this.mustKb(kbId);
    return this.store.query(
      "MATCH (n:Node {kbId: $kbId}) WHERE n.kind <> 'Concept' RETURN n.id AS id, n.title AS title, n.kind AS kind, n.updatedAt AS updatedAt ORDER BY n.title",
      { kbId },
    );
  }
  async insertNode(node) {
    await this.store.query(
      "CREATE (:Node {id: $id, kbId: $kbId, kind: $kind, title: $title, conceptKey: $conceptKey, updatedAt: $updatedAt, revision: $revision})",
      node,
    );
  }
  async createNode({ kbId, title, parentId, kind = "Page" }) {
    await this.mustKb(kbId);
    if (!["Page", "Tag", "File", "Person", "Task"].includes(kind))
      throw new ToolError(
        "INVALID_KIND",
        "节点类型无效",
        "使用 Page、Tag、File、Person 或 Task",
      );
    if (parentId) {
      const parent = await this.mustNode(parentId);
      if (parent.kbId !== kbId || parent.kind === "Concept")
        throw new ToolError(
          "INVALID_PARENT",
          "父节点必须是当前库中的可见节点",
          "重新选择父节点",
        );
    }
    const node = {
      id: randomUUID(),
      kbId,
      title: requireText(title, "标题"),
      kind,
      conceptKey: "",
      updatedAt: new Date().toISOString(),
      revision: 0,
    };
    await this.store.transaction([{ id: node.id, markdown: "" }], async () => {
      await this.insertNode(node);
      // All top-level Pages in the same KB are siblings; one canonical edge per pair.
      if (parentId) await this.writeEdge("CHILD_OF", node.id, parentId);
      else {
        const roots = await this.store.query(
          "MATCH (n:Node {kbId: $kbId}) WHERE n.kind <> 'Concept' AND n.id <> $id AND NOT EXISTS { MATCH (n)-[:CHILD_OF]->(:Node) } RETURN n.id AS id",
          { kbId, id: node.id },
        );
        for (const root of roots)
          await this.writeEdge("SIBLING_OF", node.id, root.id);
      }
    });
    return { ...node, markdown: "" };
  }
  async getNode({ id }) {
    const node = await this.mustNode(id);
    if (node.kind === "Concept")
      throw new ToolError(
        "HIDDEN_CONCEPT",
        "Concept 是后台节点",
        "从页面列表打开文档",
        404,
      );
    return { ...node, markdown: await this.store.document(id) };
  }
  async updateDoc({ id, markdown, revision }) {
    const node = await this.mustNode(id);
    if (node.kind === "Concept")
      throw new ToolError(
        "HIDDEN_CONCEPT",
        "Concept 由抽取管线维护",
        "请编辑来源文档",
      );
    if (
      typeof markdown !== "string" ||
      Buffer.byteLength(markdown, "utf8") > 1024 * 1024
    )
      throw new ToolError(
        "INVALID_DOCUMENT",
        "正文须为不超过 1 MiB 的 Markdown",
        "缩小文档后重试",
      );
    if (!Number.isSafeInteger(revision) || revision !== node.revision)
      throw new ToolError(
        "REVISION_CONFLICT",
        "文档已被其他窗口修改",
        "重新打开文档后合并修改",
        409,
      );
    const enabled = this.cloudSettings?.enabled ?? this.extractionEnabled;
    const extractor = this.cloudSettings
      ? this.cloudSettings.extractor()
      : this.extractor;
    if (enabled && !extractor)
      throw new ToolError(
        "EXTRACTOR_UNCONFIGURED",
        "尚未配置模型",
        "配置模型后再开启抽取",
      );
    const updatedAt = new Date().toISOString();
    // Save the user's document before any network operation. A cloud failure must
    // not discard a local edit or leave the caller retrying an ambiguous revision.
    await this.store.transaction([{ id, markdown }], () =>
      this.store.query(
        "MATCH (n:Node {id: $id}) SET n.updatedAt = $updatedAt, n.revision = $revision",
        { id, updatedAt, revision: revision + 1 },
      ),
    );
    const result = {
      id,
      revision: revision + 1,
      updatedAt,
      extraction: "disabled",
      conceptCount: 0,
    };
    if (!enabled) return result;
    try {
      const signature = createHash("sha256")
        .update(
          JSON.stringify([
            markdown,
            this.cloudSettings?.public().provider,
            this.cloudSettings?.public().baseUrl,
            this.cloudSettings?.public().model,
          ]),
        )
        .digest("hex");
      const [cached] = this.cloudSettings
        ? await this.store.query(
            "MATCH (c:ExtractCache {id: $id}) RETURN c.signature AS signature, c.entities AS entities",
            { id },
          )
        : [];
      const entities =
        cached?.signature === signature
          ? JSON.parse(cached.entities)
          : parseEntities(
              JSON.stringify({ entities: await extractor.extract(markdown) }),
            );
      // An unchanged document must not resurrect manually removed/merged edges.
      result.conceptCount =
        cached?.signature === signature
          ? entities.length
          : await this.attachConcepts(node, entities);
      result.extraction = "completed";
      result.cached = cached?.signature === signature;
      if (this.cloudSettings)
        await this.store.query(
          "MERGE (c:ExtractCache {id: $id}) SET c.signature = $signature, c.entities = $entities",
          { id, signature, entities: JSON.stringify(entities) },
        );
    } catch (error) {
      result.extraction = "failed";
      result.warning = {
        code: error instanceof ToolError ? error.code : "EXTRACTION_FAILED",
        message:
          error instanceof ToolError
            ? error.message
            : "抽取或概念入图失败，请检查配置；若本地存储异常请重启服务",
      };
    }
    return result;
  }
  async attachConcepts(node, entities) {
    const documents = [];
    const concepts = new Map();
    for (const entity of entities) {
      const title = requireText(entity.name, "概念名称");
      requireText(entity.type, "概念类型");
      const summary = requireText(entity.summary, "概念简介", 4000);
      // Conservative exact-name alignment, not semantic merging.
      const conceptKey = title.normalize("NFC");
      if (concepts.has(conceptKey)) continue;
      const [existing] = await this.store.query(
        "MATCH (n:Node {kbId: $kbId, kind: 'Concept', conceptKey: $conceptKey}) RETURN n.id AS id",
        { kbId: node.kbId, conceptKey },
      );
      const concept = {
        id: existing?.id ?? randomUUID(),
        kbId: node.kbId,
        kind: "Concept",
        title,
        conceptKey,
        updatedAt: new Date().toISOString(),
        revision: 0,
        existing: !!existing,
      };
      concepts.set(conceptKey, concept);
      if (!existing)
        documents.push({
          id: concept.id,
          markdown: `# ${title}\n\n类型：${entity.type}\n\n${summary}\n`,
        });
    }
    await this.store.transaction(documents, async () => {
      for (const concept of concepts.values()) {
        if (!concept.existing) {
          const { existing, ...record } = concept;
          await this.insertNode(record);
        }
        await this.validateEdge("CHILD_OF", concept.id, node.id);
        await this.writeEdge("CHILD_OF", concept.id, node.id);
      }
    });
    return concepts.size;
  }
  async validateEdge(type, source, target) {
    if (!["CHILD_OF", "SIBLING_OF"].includes(type))
      throw new ToolError(
        "INVALID_EDGE_TYPE",
        "仅支持从属和平行两种关系",
        "引用请使用 node:<id> 文档链接",
      );
    const a = await this.mustNode(source),
      b = await this.mustNode(target);
    if (source === target)
      throw new ToolError("SELF_EDGE", "节点不能关联自身", "选择另一个节点");
    if (a.kbId !== b.kbId)
      throw new ToolError(
        "CROSS_KB",
        "边两端必须属于同一知识库",
        "选择同库节点",
      );
    if (type === "SIBLING_OF") {
      const parents = await this.store.query(
        "MATCH (n:Node)-[:CHILD_OF]->(:Node) WHERE n.id = $source OR n.id = $target RETURN n.id LIMIT 1",
        { source, target },
      );
      if (a.kind === "Concept" || b.kind === "Concept" || parents.length)
        throw new ToolError(
          "NOT_TOP_LEVEL",
          "平行关系仅限顶级节点",
          "请先提升为顶级节点，或改用 node:<id> 文档链接引用",
        );
    } else {
      // Traverse actual graph, without an artificial maximum depth that misses long cycles.
      const seen = new Set(),
        todo = [target];
      while (todo.length) {
        const current = todo.pop();
        if (current === source)
          throw new ToolError(
            "CYCLE",
            "从属关系会形成环",
            "调整父节点，保持子→父无环",
          );
        if (seen.has(current)) continue;
        seen.add(current);
        const rows = await this.store.query(
          "MATCH (:Node {id: $id})-[:CHILD_OF]->(p:Node) RETURN p.id AS id",
          { id: current },
        );
        todo.push(...rows.map((row) => row.id));
      }
    }
  }
  async writeEdge(type, source, target) {
    if (type === "SIBLING_OF" && source > target)
      [source, target] = [target, source];
    await this.store.query(
      `MATCH (a:Node {id: $source}), (b:Node {id: $target}) MERGE (a)-[:${type}]->(b)`,
      { source, target },
    );
    return { type, source, target };
  }
  async createEdge({ type, source, target }) {
    await this.validateEdge(type, source, target);
    const a = await this.mustNode(source),
      b = await this.mustNode(target);
    if (a.kind === "Concept" || b.kind === "Concept")
      throw new ToolError(
        "HIDDEN_CONCEPT",
        "Concept 关系由抽取管线维护",
        "选择可见节点",
      );
    return this.store.transaction([], async () => {
      if (type === "CHILD_OF") {
        // Kùzu does not support DELETE on undirected relationship patterns.
        await this.store.query(
          "MATCH (:Node {id: $source})-[r:SIBLING_OF]->(:Node) DELETE r",
          { source },
        );
        await this.store.query(
          "MATCH (:Node)-[r:SIBLING_OF]->(:Node {id: $source}) DELETE r",
          { source },
        );
      }
      return this.writeEdge(type, source, target);
    });
  }
  async neighbors({ id, hops = 1, type }) {
    await this.mustNode(id);
    hops = Number(hops);
    if (
      !Number.isInteger(hops) ||
      hops < 1 ||
      hops > 3 ||
      (type && !["CHILD_OF", "SIBLING_OF"].includes(type))
    )
      throw new ToolError(
        "INVALID_QUERY",
        "跳数或关系类型无效",
        "使用 1–3 跳和已定义的边类型",
      );
    const seen = new Set([id]),
      result = [];
    let frontier = [id];
    for (let distance = 1; distance <= hops; distance++) {
      const next = [];
      for (const current of frontier)
        for (const row of await this.store.query(
          "MATCH (a:Node {id: $id})-[r]-(b:Node) RETURN b.id AS id, b.title AS title, b.kind AS kind, label(r) AS type",
          { id: current },
        )) {
          if ((type && row.type !== type) || seen.has(row.id)) continue;
          seen.add(row.id);
          result.push({ ...row, distance });
          next.push(row.id);
        }
      frontier = next;
    }
    return result;
  }
}
Object.assign(KnowledgeTools.prototype, mvpMethods);

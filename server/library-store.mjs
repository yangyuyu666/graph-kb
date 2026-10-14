import { mkdir, readFile, writeFile, readdir, rename, access, rm, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { GraphStore } from "./graph-store.mjs";
import { KnowledgeTools } from "./tools.mjs";
import { ToolError, requireId, requireText } from "./errors.mjs";
import { snapshotDatabase, validateDatabase, copyDatabase, writeDatabase } from "./database-package.mjs";
import { parseReference } from "./node-links.mjs";

const exists = async path => { try { await access(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };
const missing = () => new ToolError("NOT_FOUND", "对象不存在或目标知识库未加载", "导入目标知识库，或刷新列表核对 ID", 404);
const writes = new Set(["rename_kb", "delete_kb", "create_node", "update_doc", "rename_node", "update_node", "delete_node", "restore", "create_edge", "update_edge", "delete_edge", "upload_asset", "import_kb", "merge_concepts"]);

// Only the active library holds a Kùzu connection. The catalog is a rebuildable
// location/index file, never a second graph or a source of document content.
export class LibraryStore {
  constructor(root, options = {}) {
    this.root = resolve(root); this.folder = join(this.root, "libraries");
    this.options = options; this.queue = Promise.resolve(); this.entries = new Map();
    this.store = this; // HTTP connection metadata belongs to the app, not one KB.
  }
  run(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async open() {
    await mkdir(this.root, { recursive: true });
    const lockPath = join(this.root, "workspace.lock");
    try { this.lock = await open(lockPath, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error("工作区锁无效，请先确认没有其他实例运行");
      try { process.kill(lock.pid, 0); throw new Error("知识库已由另一个应用实例打开"); }
      catch (check) { if (check.code !== "ESRCH") throw check; }
      await rm(lockPath);
      this.lock = await open(lockPath, "wx");
    }
    await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
    try {
    if (!(await exists(join(this.folder, "layout.json")))) {
      if (await exists(this.folder)) throw new Error("libraries 缺少 layout.json；停止启动以避免覆盖数据");
      if (await exists(join(this.root, "graph.kuzu"))) await this.migrate();
      else {
        await mkdir(this.folder);
        await writeFile(join(this.folder, "layout.json"), JSON.stringify({ version: 2, migratedLegacy: false }));
      }
    }
    const layout = JSON.parse(await readFile(join(this.folder, "layout.json"), "utf8"));
    if (layout.version !== 2) throw new Error("不支持的知识库存储版本");
    for (const entry of await readdir(this.folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      requireId(entry.name);
      const metadata = JSON.parse(await readFile(join(this.folder, entry.name, "library.json"), "utf8"));
      if (metadata.id !== entry.name || metadata.version !== 1) throw new Error("知识库位置清单无效");
      this.entries.set(entry.name, { id: entry.name });
      await this.select(entry.name);
      await this.refresh(entry.name);
    }
    await this.expireTrash();
    await this.catalog();
    return this;
    } catch (error) { await this.close(); throw error; }
  }
  async select(id) {
    requireId(id);
    if (!this.entries.has(id)) throw missing();
    if (this.current?.id === id && !this.current.store.unhealthy) return this.current.tools;
    if (this.current) { await this.current.store.close(); this.current = undefined; }
    const store = await new GraphStore(join(this.folder, id)).open();
    const tools = new KnowledgeTools(store, this.options);
    this.current = { id, store, tools };
    return tools;
  }
  async refresh(id) {
    const tools = await this.select(id);
    const kbs = await tools.listKbs();
    if (kbs.some(kb => kb.id !== id)) throw new Error("独立图库中含有其他知识库");
    const nodes = await tools.allNodes(id);
    const trash = await tools.store.query("MATCH (t:Trash) RETURN t.id AS id,t.snapshot AS snapshot");
    const assets = await tools.store.query("MATCH (a:Asset) RETURN a.id AS id,a.ownerId AS ownerId");
    const deleted = trash.flatMap(t => JSON.parse(t.snapshot).nodes.map(n => n.id));
    const otherIds = new Set([...this.entries.values()].filter(e => e.id !== id).flatMap(e => [...(e.nodes ?? []).map(n => n.id), ...(e.deleted ?? []), ...(e.assets ?? []).map(a => a.id), ...(e.trash ?? []).map(t => t.id)]));
    if ([...nodes.map(n => n.id), ...deleted, ...assets.map(a => a.id), ...trash.map(t => t.id)].some(value => otherIds.has(value)))
      throw new Error("知识库对象 ID 冲突；请使用作为副本导入");
    this.entries.set(id, { id, kb: kbs[0], nodes, deleted, assets, trash: trash.map(t => ({ id: t.id })) });
  }
  async catalog() {
    const data = { version: 1, libraries: [...this.entries.values()].map(e => ({ id: e.id, path: `libraries/${e.id}`, name: e.kb?.name, deleted: !e.kb })) };
    const temp = join(this.root, `catalog-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(data, null, 2));
    await rename(temp, join(this.root, "catalog.json"));
  }
  owner(id, kind = "node") {
    requireId(id);
    for (const e of this.entries.values()) {
      const found = kind === "node" ? e.nodes?.some(n => n.id === id) || e.deleted?.includes(id)
        : kind === "asset" ? e.assets?.some(a => a.id === id) : e.trash?.some(t => t.id === id);
      if (found) return e.id;
    }
    return undefined;
  }
  async migrate() {
    const staging = join(this.root, `.migration-${randomUUID()}`);
    await mkdir(staging);
    const legacy = await new GraphStore(this.root).open();
    try {
      const tools = new KnowledgeTools(legacy);
      const kbs = await tools.listKbs();
      const trash = await legacy.query("MATCH (t:Trash) RETURN t.snapshot AS snapshot");
      const ids = new Set(kbs.map(k => k.id)), owners = new Map();
      for (const t of trash) {
        const s = JSON.parse(t.snapshot); ids.add(s.kbId);
        for (const n of s.nodes) owners.set(n.id, s.kbId);
      }
      for (const n of await legacy.query("MATCH (n:Node) RETURN n.id AS id,n.kbId AS kbId")) owners.set(n.id, n.kbId);
      for (const id of ids) {
        requireId(id);
        const data = await snapshotDatabase(tools, id, node => owners.get(node));
        await this.materialize(join(staging, id), data);
      }
      await writeFile(join(staging, "layout.json"), JSON.stringify({ version: 2, migratedLegacy: true, migratedAt: new Date().toISOString(), legacyBackup: "../graph.kuzu and original documents/blobs/trash" }));
    } finally { await legacy.close(); }
    // One directory rename publishes all libraries together. On failure the
    // original shared DB is untouched and an incomplete staging folder is ignored.
    await rename(staging, this.folder);
  }
  async materialize(folder, data) {
    const store = await new GraphStore(folder).open();
    try { await writeDatabase(new KnowledgeTools(store), data); }
    finally { await store.close(); }
    await writeFile(join(folder, "library.json"), JSON.stringify({ version: 1, id: data.id }));
  }
  async publish(data) {
    const target = join(this.folder, requireId(data.id));
    if (await exists(target)) throw new ToolError("DATABASE_EXISTS", "同 ID 知识库已经存在", "作为副本导入会生成新 ID；迁移模式不会覆盖已有库", 409);
    const staging = join(this.folder, `.import-${randomUUID()}`);
    try { await this.materialize(staging, data); await rename(staging, target); }
    catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
    this.entries.set(data.id, { id: data.id });
    await this.refresh(data.id); await this.catalog();
    return { id: data.id, name: data.name };
  }
  async expireTrash() {
    for (const id of this.entries.keys()) {
      const tools = await this.select(id); await tools.expireTrash(); await this.refresh(id);
    }
  }
  execute(name, input = {}) {
    return this.run(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolError("INVALID_INPUT", "参数须为对象", "检查参数");
      if (name === "get_settings") return this.options.cloudSettings.public();
      if (name === "update_settings") return this.options.cloudSettings.update(input);
      if (name === "list_kbs") return [...this.entries.values()].flatMap(e => e.kb ? [e.kb] : []).sort((a, b) => a.name.localeCompare(b.name));
      if (name === "create_kb") {
        const id = randomUUID(), kbName = requireText(input.name, "知识库名称");
        return this.publish({ format: "graph-kb-database", version: 1, id, name: kbName, kb: { id, name: kbName }, nodes: [], edges: [], documents: [], trash: [], assets: [], cache: [] });
      }
      if (name === "import_database") {
        if (!["restore", "copy"].includes(input.mode ?? "restore")) throw new ToolError("INVALID_INPUT", "导入方式须为 restore 或 copy", "选择迁移恢复或作为副本");
        let data;
        try { data = validateDatabase(input.data); }
        catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError("INVALID_DATABASE", "整库备份格式不完整或无效", "请选择应用导出的 .graphkb.json 文件");
        }
        if (Buffer.byteLength(JSON.stringify(data)) > 24 * 1024 * 1024)
          throw new ToolError("DATABASE_TOO_LARGE", "整库备份超过 24 MiB", "关闭应用后使用完整知识库目录迁移");
        if (input.mode === "copy") data = copyDatabase(data);
        const ids = [...data.nodes, ...data.trash.flatMap(t => t.snapshot.nodes), ...data.assets, ...data.trash].map(n => n.id);
        if (ids.some(id => this.owner(id) || this.owner(id, "asset") || this.owner(id, "trash")))
          throw new ToolError("DATABASE_EXISTS", "导入内容的 ID 已存在", "请选择作为副本导入，不会覆盖现有内容", 409);
        return this.publish(data);
      }
      if (name === "resolve_links") {
        if (!Array.isArray(input.ids) || input.ids.length > 1000) throw new ToolError("INVALID_INPUT", "链接列表无效", "最多 1000 项");
        return input.ids.map(reference => {
          const ref = parseReference(reference), owner = this.owner(ref.id), kbId = ref.kbId ?? owner;
          const e = this.entries.get(kbId), node = e?.nodes?.find(n => n.id === ref.id && n.kind !== "Concept");
          return { id: reference, nodeId: ref.id, kbId, state: !e ? "unavailable" : node && e.kb ? "active" : "deleted", title: node?.title };
        });
      }
      if (name === "search" && !input.kbId || name === "list_trash" || name === "backlinks") {
        const result = [];
        let targetKb;
        if (name === "backlinks") { targetKb = this.owner(input.id); if (!targetKb) throw missing(); }
        for (const entry of this.entries.values()) {
          const tools = await this.select(entry.id);
          if (name === "search" && entry.kb) result.push(...await tools.execute("search", { ...input, kbId: entry.id }));
          else if (name === "list_trash") result.push(...await tools.execute(name, input));
          else if (name === "backlinks" && entry.kb) {
            for (const n of entry.nodes.filter(n => n.kind !== "Concept")) {
              const markdown = await tools.store.document(n.id);
              const re = new RegExp(`\\]\\(<?node:(?:${targetKb}/)?${input.id}>?(?:\\s+["'][^"']*["'])?\\)`, "i");
              if (re.test(markdown)) result.push(n);
            }
          }
          await this.refresh(entry.id);
        }
        return result;
      }
      let kbId = input.kbId;
      if (["get_kb", "rename_kb", "delete_kb"].includes(name)) kbId = input.id;
      else if (["get_edge", "update_edge", "delete_edge"].includes(name)) kbId = this.owner(input.id?.split(":")[1] ?? input.source);
      else if (name === "create_edge" || name === "merge_concepts") kbId = this.owner(input.source);
      else if (name === "get_asset") kbId = this.owner(input.id, "asset");
      else if (name === "restore") kbId = this.owner(input.id, "trash");
      else if (name === "upload_asset") kbId = this.owner(input.ownerId);
      else if (!kbId && input.id) kbId = this.owner(input.id);
      if (!kbId || !this.entries.has(kbId)) throw missing();
      if (input.parentId && this.owner(input.parentId) !== kbId)
        throw new ToolError("INVALID_PARENT", "父节点必须属于当前知识库", "选择同库节点");
      if (["create_edge", "update_edge", "merge_concepts"].includes(name))
        for (const id of [input.source, input.target].filter(Boolean))
          if (this.owner(id) !== kbId) throw new ToolError("CROSS_KB", "图关系不能跨知识库", "跨库请使用文档引用");
      const tools = await this.select(kbId);
      if (name === "export_database") {
        const data = await snapshotDatabase(tools, kbId, id => this.owner(id));
        if (Buffer.byteLength(JSON.stringify(data)) > 24 * 1024 * 1024)
          throw new ToolError("DATABASE_TOO_LARGE", "整库备份超过当前 24 MiB 文件限制", "关闭应用后复制该知识库整个文件夹进行备份");
        return data;
      }
      try { return await tools.execute(name, input); }
      finally {
        await this.refresh(kbId);
        if (writes.has(name)) await this.catalog();
      }
    });
  }
  async close() {
    await this.queue;
    try { if (this.current) { await this.current.store.close(); this.current = undefined; } }
    finally { if (this.lock) { await this.lock.close(); this.lock = undefined; await rm(join(this.root, "workspace.lock"), { force: true }); } }
  }
}

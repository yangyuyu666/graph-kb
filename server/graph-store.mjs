import kuzu from "kuzu";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function promoteFile(from, to) {
  try {
    await rename(from, to);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // A replay is complete only if the destination actually exists.
    await access(to);
  }
}

// Kùzu is embedded in this local process. No database daemon or JSON graph mirror.
export class GraphStore {
  constructor(root) {
    this.root = root;
    this.queue = Promise.resolve();
  }
  async open() {
    await mkdir(join(this.root, "documents"), { recursive: true });
    await mkdir(join(this.root, "journal"), { recursive: true });
    await mkdir(join(this.root, "trash"), { recursive: true });
    await mkdir(join(this.root, "blobs"), { recursive: true });
    this.db = new kuzu.Database(
      join(this.root, "graph.kuzu"),
      256 * 1024 * 1024,
    );
    this.conn = new kuzu.Connection(this.db);
    for (const ddl of [
      "CREATE NODE TABLE IF NOT EXISTS KnowledgeBase(id STRING, name STRING, PRIMARY KEY(id))",
      "CREATE NODE TABLE IF NOT EXISTS Node(id STRING, kbId STRING, kind STRING, title STRING, conceptKey STRING, updatedAt STRING, revision INT64, PRIMARY KEY(id))",
      "CREATE REL TABLE IF NOT EXISTS CHILD_OF(FROM Node TO Node, label STRING DEFAULT '')",
      "CREATE REL TABLE IF NOT EXISTS SIBLING_OF(FROM Node TO Node, label STRING DEFAULT '')",
      "CREATE NODE TABLE IF NOT EXISTS FileCommit(id STRING, PRIMARY KEY(id))",
      "CREATE NODE TABLE IF NOT EXISTS Trash(id STRING, kind STRING, title STRING, deletedAt STRING, snapshot STRING, PRIMARY KEY(id))",
      "CREATE NODE TABLE IF NOT EXISTS Asset(id STRING, ownerId STRING, name STRING, mime STRING, PRIMARY KEY(id))",
      "CREATE NODE TABLE IF NOT EXISTS ExtractCache(id STRING, signature STRING, entities STRING, PRIMARY KEY(id))",
    ])
      await this.query(ddl);
    // Upgrade existing databases without replacing relationships or their IDs.
    // Each ALTER is atomic; inspecting each table also handles interrupted upgrades.
    for (const type of ["CHILD_OF", "SIBLING_OF"]) {
      const properties = await this.query(`CALL table_info('${type}') RETURN *`);
      if (!properties.some((property) => property.name === "label"))
        await this.query(`ALTER TABLE ${type} ADD label STRING DEFAULT ''`);
    }
    await this.recover();
    return this;
  }
  run(fn) {
    const result = this.queue.then(() => {
      if (this.unhealthy)
        throw new Error("文件提交未完成，请重启本地服务以恢复");
      return fn();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async query(cypher, params) {
    let result;
    if (params) {
      const statement = await this.conn.prepare(cypher);
      if (!statement.isSuccess()) throw new Error(statement.getErrorMessage());
      result = await this.conn.execute(statement, params);
    } else result = await this.conn.query(cypher);
    try {
      return await result.getAll();
    } finally {
      result.close();
    }
  }
  async node(id) {
    const rows = await this.query(
      "MATCH (n:Node {id: $id}) RETURN n.id AS id, n.kbId AS kbId, n.kind AS kind, n.title AS title, n.conceptKey AS conceptKey, n.updatedAt AS updatedAt, n.revision AS revision",
      { id },
    );
    return rows[0] ? { ...rows[0], revision: Number(rows[0].revision) } : null;
  }
  async document(id) {
    return readFile(join(this.root, "documents", `${id}.md`), "utf8");
  }
  async promote(id, manifest) {
    for (const docId of manifest.ids) {
      const staged = join(this.root, "journal", id, `${docId}.md`);
      await promoteFile(staged, join(this.root, "documents", `${docId}.md`));
    }
    for (const action of manifest.actions ?? []) {
      if (
        !/^[0-9a-f-]{36}$/.test(action.id) ||
        (action.batchId && !/^[0-9a-f-]{36}$/.test(action.batchId))
      )
        throw new Error("Invalid file action");
      if (action.type === "asset") {
        await promoteFile(
          join(this.root, "journal", id, `${action.id}.bin`),
          join(this.root, "blobs", `${action.id}.bin`),
        );
      } else if (action.type === "purge") {
        await rm(join(this.root, "trash", action.id), {
          recursive: true,
          force: true,
        });
      } else if (action.type === "purgeAsset") {
        await rm(join(this.root, "blobs", `${action.id}.bin`), { force: true });
      } else if (action.type === "trash" || action.type === "restore") {
        const active = join(this.root, "documents", `${action.id}.md`);
        const deleted = join(
          this.root,
          "trash",
          action.batchId,
          `${action.id}.md`,
        );
        await mkdir(join(this.root, "trash", action.batchId), {
          recursive: true,
        });
        const [from, to] =
          action.type === "trash" ? [active, deleted] : [deleted, active];
        await promoteFile(from, to);
      } else throw new Error("Invalid file action type");
    }
    await rm(join(this.root, "journal", id), { recursive: true, force: true });
    await this.query("MATCH (c:FileCommit {id: $id}) DELETE c", { id });
  }
  async recover() {
    for (const id of await readdir(join(this.root, "journal"))) {
      if (!/^[0-9a-f-]{36}$/.test(id))
        throw new Error("Invalid journal directory");
      const committed = await this.query(
        "MATCH (c:FileCommit {id: $id}) RETURN c.id",
        { id },
      );
      if (committed.length) {
        const manifest = JSON.parse(
          await readFile(
            join(this.root, "journal", id, "manifest.json"),
            "utf8",
          ),
        );
        await this.promote(id, manifest);
      } else
        await rm(join(this.root, "journal", id), {
          recursive: true,
          force: true,
        });
    }
    // A crash after journal cleanup but before marker cleanup is harmless.
    await this.query("MATCH (c:FileCommit) DELETE c");
  }
  async transaction(documents, change, actions = []) {
    const id = randomUUID();
    const folder = join(this.root, "journal", id);
    const manifest = {
      ids: documents.map((d) => d.id),
      actions: actions.map(({ data, ...action }) => action),
    };
    await mkdir(folder);
    for (const doc of documents)
      await writeFile(join(folder, `${doc.id}.md`), doc.markdown, "utf8");
    for (const action of actions)
      if (action.type === "asset")
        await writeFile(join(folder, `${action.id}.bin`), action.data);
    await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest));
    await this.query("BEGIN TRANSACTION");
    let committed = false;
    try {
      const result = await change();
      await this.query("CREATE (:FileCommit {id: $id})", { id });
      await this.query("COMMIT");
      committed = true;
      await this.promote(id, manifest);
      return result;
    } catch (error) {
      if (committed) this.unhealthy = true;
      else {
        // Kùzu may already abort a transaction when a statement fails.
        try {
          await this.query("ROLLBACK");
        } catch {
          /* preserve original error */
        }
        await rm(folder, { recursive: true, force: true });
      }
      throw error;
    }
  }
  async close() {
    await this.queue;
    await this.conn.close();
    await this.db.close();
  }
}

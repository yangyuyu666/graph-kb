import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ToolError, requireId, requireText, edgeLabel } from "./errors.mjs";
import { rewriteReferences } from "./node-links.mjs";

const invalid = () => new ToolError("INVALID_DATABASE", "整库备份内容无效或不完整", "请选择应用导出的 .graphkb.json 文件");
const kinds = ["Page", "Tag", "File", "Person", "Task", "Concept"];
export async function snapshotDatabase(tools, id, locate = () => undefined) {
  const store = tools.store;
  const [kb] = await store.query("MATCH (k:KnowledgeBase {id:$id}) RETURN k.id AS id,k.name AS name", { id });
  const nodes = await tools.allNodes(id);
  const trash = [];
  for (const row of await store.query("MATCH (t:Trash) RETURN t.id AS id,t.kind AS kind,t.title AS title,t.deletedAt AS deletedAt,t.snapshot AS snapshot")) {
    const snapshot = JSON.parse(row.snapshot);
    if (snapshot.kbId !== id) continue;
    const documents = [];
    for (const n of snapshot.nodes)
      documents.push({ id: n.id, markdown: await readFile(join(store.root, "trash", row.id, `${n.id}.md`), "utf8") });
    trash.push({ ...row, snapshot, documents });
  }
  const ownerIds = new Set([...nodes, ...trash.flatMap(t => t.snapshot.nodes)].map(n => n.id));
  const assets = [];
  for (const a of await store.query("MATCH (a:Asset) RETURN a.id AS id,a.ownerId AS ownerId,a.name AS name,a.mime AS mime"))
    if (ownerIds.has(a.ownerId)) assets.push({ ...a, data: (await readFile(join(store.root, "blobs", `${a.id}.bin`))).toString("base64") });
  const documents = await Promise.all(nodes.map(async n => ({ id: n.id, markdown: await store.document(n.id) })));
  for (const doc of [...documents, ...trash.flatMap(t => t.documents)])
    doc.markdown = rewriteReferences(doc.markdown, ref => ref.kbId ? undefined : `${locate(ref.id) ?? (ownerIds.has(ref.id) ? id : "")}/${ref.id}`.replace(/^\//, ""));
  const cache = (await store.query("MATCH (c:ExtractCache) RETURN c.id AS id,c.signature AS signature,c.entities AS entities"))
    .filter(c => nodes.some(n => n.id === c.id));
  return { format: "graph-kb-database", version: 1, id, name: kb?.name ?? trash.find(t => t.snapshot.knowledgeBase)?.title ?? "已删除知识库", kb: kb ?? null, nodes, edges: await tools.allEdges(id), documents, trash, assets, cache };
}

export function validateDatabase(data) {
  if (!data || data.format !== "graph-kb-database" || data.version !== 1) throw invalid();
  requireId(data.id); requireText(data.name, "知识库名称");
  for (const key of ["nodes", "edges", "documents", "trash", "assets", "cache"])
    if (!Array.isArray(data[key]) || data[key].length > 100000) throw invalid();
  if (data.kb && (data.kb.id !== data.id || !requireText(data.kb.name, "知识库名称"))) throw invalid();
  if (!data.kb && (data.nodes.length || data.edges.length)) throw invalid();
  const unique = new Set();
  function take(id) { requireId(id); if (unique.has(id)) throw invalid(); unique.add(id); }
  const nodeIds = new Set();
  function checkNodes(nodes, documents) {
    if (!Array.isArray(nodes) || !Array.isArray(documents) || nodes.length !== documents.length) throw invalid();
    const docs = new Map();
    for (const d of documents) {
      if (!d || docs.has(d.id) || typeof d.markdown !== "string" || Buffer.byteLength(d.markdown) > 1024 * 1024) throw invalid();
      docs.set(d.id, d.markdown);
    }
    for (const n of nodes) {
      take(n.id); nodeIds.add(n.id);
      if (n.kbId !== data.id || !kinds.includes(n.kind) || !Number.isSafeInteger(n.revision) || n.revision < 0 || !Number.isFinite(Date.parse(n.updatedAt)) || typeof n.conceptKey !== "string" || !docs.has(n.id)) throw invalid();
      requireText(n.title, "节点标题");
    }
  }
  function checkEdges(edges, active) {
    if (!Array.isArray(edges)) throw invalid();
    const seen = new Set();
    for (const e of edges) {
      requireId(e.source); requireId(e.target); edgeLabel(e.label ?? "");
      if (!["CHILD_OF", "SIBLING_OF"].includes(e.type) || e.source === e.target || (active && (!nodeIds.has(e.source) || !nodeIds.has(e.target)))) throw invalid();
      const pair = e.type === "SIBLING_OF" ? [e.source, e.target].sort() : [e.source, e.target];
      const key = `${e.type}:${pair.join(":")}`;
      if (seen.has(key)) throw invalid(); seen.add(key);
    }
  }
  checkNodes(data.nodes, data.documents);
  checkEdges(data.edges, true);
  for (const t of data.trash) {
    take(t.id);
    if (!["Node", "KnowledgeBase"].includes(t.kind) || !Number.isFinite(Date.parse(t.deletedAt)) || t.snapshot?.kbId !== data.id) throw invalid();
    requireText(t.title, "回收站标题");
    if (t.snapshot.knowledgeBase && (t.snapshot.knowledgeBase.id !== data.id || data.kb || !requireText(t.snapshot.knowledgeBase.name, "知识库名称"))) throw invalid();
    checkNodes(t.snapshot.nodes, t.documents);
    checkEdges(t.snapshot.edges, false);
  }
  for (const a of data.assets) {
    take(a.id);
    if (!nodeIds.has(a.ownerId) || typeof a.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.data) || Buffer.from(a.data, "base64").length > 10 * 1024 * 1024) throw invalid();
    requireText(a.name, "附件名称"); requireText(a.mime, "附件类型");
  }
  const cached = new Set();
  for (const c of data.cache) {
    if (!data.nodes.some(n => n.id === c.id) || cached.has(c.id) || typeof c.signature !== "string" || typeof c.entities !== "string") throw invalid();
    cached.add(c.id);
    const entities = JSON.parse(c.entities);
    if (!Array.isArray(entities)) throw invalid();
  }
  return data;
}

export function copyDatabase(original) {
  const data = structuredClone(original), oldKb = data.id, id = randomUUID();
  const allNodes = [...data.nodes, ...data.trash.flatMap(t => t.snapshot.nodes)];
  const nodeMap = new Map(allNodes.map(n => [n.id, randomUUID()]));
  const assetMap = new Map(data.assets.map(a => [a.id, randomUUID()]));
  const rewrite = text => rewriteReferences(text, ref => (!ref.kbId || ref.kbId === oldKb) && nodeMap.has(ref.id) ? `${id}/${nodeMap.get(ref.id)}` : undefined)
    .replace(/asset:([0-9a-f-]{36})/gi, (match, aid) => assetMap.has(aid) ? `asset:${assetMap.get(aid)}` : match);
  const edge = e => { e.source = nodeMap.get(e.source) ?? e.source; e.target = nodeMap.get(e.target) ?? e.target; e.id = `${e.type}:${e.source}:${e.target}`; };
  data.id = id; data.name = `${data.name.slice(0, 195)}（副本）`;
  if (data.kb) data.kb = { id, name: data.name };
  for (const n of allNodes) { n.id = nodeMap.get(n.id); n.kbId = id; }
  for (const doc of [...data.documents, ...data.trash.flatMap(t => t.documents)]) { doc.id = nodeMap.get(doc.id); doc.markdown = rewrite(doc.markdown); }
  data.edges.forEach(edge);
  for (const t of data.trash) {
    t.id = randomUUID(); t.snapshot.kbId = id;
    if (t.snapshot.knowledgeBase) t.snapshot.knowledgeBase = { id, name: data.name };
    t.snapshot.edges.forEach(edge);
  }
  for (const a of data.assets) { a.id = assetMap.get(a.id); a.ownerId = nodeMap.get(a.ownerId); }
  data.cache = []; // IDs/content changed; extraction caches are safe to rebuild.
  return data;
}

export async function writeDatabase(tools, data) {
  validateDatabase(data);
  const store = tools.store;
  if (data.kb) await store.query("CREATE (:KnowledgeBase {id:$id,name:$name})", data.kb);
  for (const n of data.nodes) await tools.insertNode(n);
  for (const e of [...data.edges].sort((a, b) => (a.type === "CHILD_OF" ? 0 : 1) - (b.type === "CHILD_OF" ? 0 : 1))) {
    await tools.validateEdge(e.type, e.source, e.target);
    await tools.writeEdge(e.type, e.source, e.target, e.label ?? "");
  }
  for (const d of data.documents) await writeFile(join(store.root, "documents", `${d.id}.md`), d.markdown);
  for (const t of data.trash) {
    await store.query("CREATE (:Trash {id:$id,kind:$kind,title:$title,deletedAt:$deletedAt,snapshot:$snapshot})", { id: t.id, kind: t.kind, title: t.title, deletedAt: t.deletedAt, snapshot: JSON.stringify(t.snapshot) });
    await mkdir(join(store.root, "trash", t.id), { recursive: true });
    for (const d of t.documents) await writeFile(join(store.root, "trash", t.id, `${d.id}.md`), d.markdown);
  }
  for (const a of data.assets) {
    await store.query("CREATE (:Asset {id:$id,ownerId:$ownerId,name:$name,mime:$mime})", { id: a.id, ownerId: a.ownerId, name: a.name, mime: a.mime });
    await writeFile(join(store.root, "blobs", `${a.id}.bin`), Buffer.from(a.data, "base64"));
  }
  for (const c of data.cache) await store.query("CREATE (:ExtractCache {id:$id,signature:$signature,entities:$entities})", c);
}

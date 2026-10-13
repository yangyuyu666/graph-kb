import { Crepe } from "@milkdown/crepe";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, type PageNode } from "./api";
import { renderLibrary } from "./library";
import { documentExtras, openAsset, openEmbed } from "./document-extras";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { editorViewCtx } from "@milkdown/kit/core";
import { type CloudConfig } from "./settings";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
const icon =
  '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8 8 16 4-9 14L8 8Z" stroke="currentColor"/><circle cx="8" cy="8" r="5"/><circle cx="24" cy="12" r="4"/><circle cx="15" cy="26" r="4"/></svg>';
function el<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}
function message(error: unknown) {
  el<HTMLElement>("#status").textContent =
    error instanceof Error ? error.message : String(error);
}
function text(tag: string, value: string) {
  const e = document.createElement(tag);
  e.textContent = value;
  return e;
}

async function openDocument(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("内部链接无效");
  if (isTauri()) {
    const label = `doc-${id}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    const window = new WebviewWindow(label, {
      url: `/?node=${id}`,
      title: "文档",
      width: 760,
      height: 800,
      minWidth: 480,
    });
    window.once("tauri://error", (event) => message(String(event.payload)));
  } else {
    const child = window.open(
      `/?node=${id}`,
      `doc-${id}`,
      "popup,width=760,height=800",
    );
    if (!child) throw new Error("浏览器阻止了文档窗口，请允许本地页面弹出窗口");
  }
}

async function home() {
  await renderLibrary(app, openDocument);
}

async function documentView(id: string) {
  app.className = "document-app";
  app.innerHTML = `<div class="document"><header><h1 id="title">正在打开…</h1><button id="save" class="primary" disabled>保存</button></header><div class="document-meta"><span id="status" role="status">加载中</span><span id="extraction-state">自动建图：读取中</span></div><div id="editor"></div></div>`;
  const refreshSettings = async () => {
    try {
      const config = await api<CloudConfig>("/api/settings");
      el("#extraction-state").textContent = config.enabled
        ? `自动建图：${config.providers.find((p) => p.id === config.provider)?.name}`
        : "自动建图：关闭";
    } catch {
      el("#extraction-state").textContent = "自动建图：状态不可用";
    }
  };
  await refreshSettings();
  window.addEventListener("focus", () => void refreshSettings());
  const node = await api<PageNode>(`/api/nodes/${id}`);
  document.title = node.title;
  if (isTauri()) await WebviewWindow.getCurrent().setTitle(node.title);
  el("#title").textContent = node.title;
  let revision = node.revision;
  const deletedIds = new Set<string>();
  const linkState = new PluginKey("deleted-node-links");
  async function checkLinks(markdown: string) {
    const ids = [
      ...new Set(
        [...markdown.matchAll(/node:([0-9a-f-]{36})/gi)].map((m) => m[1]),
      ),
    ].slice(0, 1000);
    if (!ids.length) return;
    const result = await api<{ id: string; state: string }[]>(
      "/api/tools",
      "POST",
      { name: "resolve_links", arguments: { ids } },
    );
    deletedIds.clear();
    for (const link of result)
      if (link.state !== "active") deletedIds.add(link.id);
  }
  await checkLinks(node.markdown);
  let dirty = false,
    editVersion = 0;
  const crepe = new Crepe({
    root: "#editor",
    defaultValue: node.markdown,
    features: {
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.AI]: false,
    },
  });
  crepe.editor.config((ctx) => {
    ctx.update(linkSchema.key, (previous) => (context) => {
      const schema = previous(context);
      return {
        ...schema,
        toDOM: (mark, inline) => {
          const href = mark.attrs.href;
          // Extend only UUID node links; retain Milkdown's sanitizer for every other URL.
          if (
            typeof href === "string" &&
            (/^(node|asset):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              href,
            ) ||
              /^embed:https:\/\//.test(href))
          )
            return ["a", { href, title: mark.attrs.title }];
          return schema.toDOM!(mark, inline);
        },
      };
    });
  });
  crepe.editor.use(
    $prose(
      () =>
        new Plugin({
          key: linkState,
          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              state.doc.descendants((n, pos) => {
                if (n.isText)
                  for (const mark of n.marks) {
                    const href = mark.attrs.href;
                    if (
                      typeof href === "string" &&
                      href.startsWith("node:") &&
                      deletedIds.has(href.slice(5))
                    )
                      decorations.push(
                        Decoration.inline(pos, pos + n.nodeSize, {
                          class: "deleted-reference",
                          "aria-label": "已删除节点",
                        }),
                      );
                  }
              });
              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
    ),
  );
  crepe.on((listener) =>
    listener.markdownUpdated(() => {
      dirty = true;
      editVersion++;
      el("#status").textContent = "有未保存的修改";
    }),
  );
  await crepe.create();
  const refreshDocumentLinks = documentExtras(
    node,
    crepe,
    openDocument,
    (text) => (el("#status").textContent = text),
  );
  window.addEventListener("focus", () => {
    void checkLinks(crepe.getMarkdown())
      .then(() =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta(linkState, true));
        }),
      )
      .catch(() => {});
  });
  dirty = false;
  el("#status").textContent = "已读取本地 Markdown";
  const save = el<HTMLButtonElement>("#save");
  save.disabled = false;
  const doSave = async () => {
    if (save.disabled) return;
    save.disabled = true;
    el("#status").textContent = "正在保存；开启自动建图时将等待云端抽取…";
    const savingVersion = editVersion;
    try {
      const result = await api<{
        revision: number;
        extraction: string;
        conceptCount: number;
        warning?: { message: string };
      }>(`/api/nodes/${id}`, "PATCH", {
        markdown: crepe.getMarkdown(),
        revision,
      });
      revision = result.revision;
      void refreshDocumentLinks();
      dirty = savingVersion !== editVersion;
      const outcome =
        result.extraction === "failed"
          ? `已保存到本地 · 抽取失败：${result.warning?.message}`
          : result.extraction === "completed"
            ? `已保存到本地 · 已处理 ${result.conceptCount} 个后台概念`
            : "已保存到本地 · 图节点已同步";
      el("#status").textContent = dirty
        ? `${outcome}；仍有新修改未保存`
        : outcome;
    } catch (error) {
      message(error);
    } finally {
      save.disabled = false;
    }
  };
  save.onclick = doSave;
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      void doSave();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  if (isTauri())
    await WebviewWindow.getCurrent().onCloseRequested(async (event) => {
      if (dirty && !window.confirm("文档尚未保存，确定关闭吗？"))
        event.preventDefault();
    });
  el("#editor").addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as HTMLElement).closest("a");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      if (href.startsWith("node:")) {
        if (deletedIds.has(href.slice(5))) {
          el("#status").textContent = "已删除节点，可在回收站恢复";
          return;
        }
        void openDocument(href.slice(5)).catch(message);
      } else if (href.startsWith("asset:"))
        void openAsset(href.slice(6)).catch(message);
      else if (href.startsWith("embed:")) {
        try {
          openEmbed(href.slice(6));
        } catch (error) {
          message(error);
        }
      } else if (/^https?:\/\//.test(href)) {
        const dialog = document.createElement("dialog");
        const title = document.createElement("p");
        title.textContent = href;
        const copy = document.createElement("button");
        copy.textContent = "复制外部链接";
        copy.onclick = () =>
          void navigator.clipboard
            .writeText(href)
            .then(() => dialog.close())
            .catch(message);
        const close = document.createElement("button");
        close.textContent = "关闭";
        close.onclick = () => dialog.close();
        dialog.append(title, copy, close);
        dialog.onclose = () => dialog.remove();
        document.body.append(dialog);
        dialog.showModal();
      }
    },
    true,
  );
}

const nodeId = new URLSearchParams(location.search).get("node");
(nodeId ? documentView(nodeId) : home()).catch(message);

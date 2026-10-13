import { Crepe } from "@milkdown/crepe";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api, type PageNode } from "./api";
import { documentExtras, openAsset, openEmbed } from "./document-extras";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { editorViewCtx } from "@milkdown/kit/core";
import { type CloudConfig } from "./settings";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

export async function mountDocument(
  container: HTMLElement,
  id: string,
  openDocument: (id: string) => Promise<void>,
  options: { embedded?: boolean; signal?: AbortSignal } = {},
) {
  const events = new AbortController();
  options.signal?.addEventListener("abort", () => events.abort(), {
    once: true,
  });
  let unlisten: (() => void) | undefined;
  function el<T extends HTMLElement>(selector: string): T {
    return container.querySelector<T>(selector)!;
  }
  function message(error: unknown) {
    if (el("#status"))
      el("#status").textContent =
        error instanceof Error ? error.message : String(error);
  }
  function listen<K extends keyof WindowEventMap>(
    name: K,
    handler: (event: WindowEventMap[K]) => void,
  ) {
    window.addEventListener(name, handler, { signal: events.signal });
  }
  function checkMounted() {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
  }

  checkMounted();
  if (!options.embedded) container.className = "document-app";
  container.innerHTML = `<div class="document"><header><h1 id="title">正在打开…</h1><button id="save" class="primary" disabled>保存</button></header><div class="document-meta"><span id="status" role="status">加载中</span><span id="extraction-state">自动建图：读取中</span></div><div id="editor"></div></div>`;
  const extractionState = el("#extraction-state");
  const refreshSettings = async () => {
    try {
      const config = await api<CloudConfig>("/api/settings");
      if (events.signal.aborted) return;
      extractionState.textContent = config.enabled
        ? `自动建图：${config.providers.find((p) => p.id === config.provider)?.name}`
        : "自动建图：关闭";
    } catch {
      if (!events.signal.aborted)
        extractionState.textContent = "自动建图：状态不可用";
    }
  };
  await refreshSettings();
  listen("focus", () => void refreshSettings());
  const node = await api<PageNode>(`/api/nodes/${id}`);
  checkMounted();
  if (!options.embedded) {
    document.title = node.title;
    if (isTauri()) await WebviewWindow.getCurrent().setTitle(node.title);
  }
  el("#title").textContent = node.title;
  let revision = node.revision;
  const deletedIds = new Set<string>();
  const unavailableIds = new Set<string>();
  const linkState = new PluginKey("deleted-node-links");
  async function checkLinks(markdown: string) {
    const ids = [
      ...new Set(
        [...markdown.matchAll(/node:([0-9a-f-]{36}(?:\/[0-9a-f-]{36})?)/gi)].map((m) => m[1]),
      ),
    ].slice(0, 1000);
    if (!ids.length) {
      deletedIds.clear();
      unavailableIds.clear();
      return;
    }
    const result = await api<{ id: string; state: string }[]>(
      "/api/tools",
      "POST",
      { name: "resolve_links", arguments: { ids } },
    );
    deletedIds.clear();
    unavailableIds.clear();
    for (const link of result)
      if (link.state !== "active") {
        deletedIds.add(link.id);
        if (link.state === "unavailable") unavailableIds.add(link.id);
      }
  }
  await checkLinks(node.markdown);
  checkMounted();
  let savedMarkdown = node.markdown;
  const crepe = new Crepe({
    root: el("#editor"),
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
            (/^(?:node:(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/)?|asset:)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
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
                          class: unavailableIds.has(href.slice(5)) ? "deleted-reference unavailable-reference" : "deleted-reference",
                          "aria-label": unavailableIds.has(href.slice(5)) ? "目标知识库未加载" : "已删除节点",
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
    listener.markdownUpdated((_ctx, markdown) => {
      if (markdown !== savedMarkdown)
        el("#status").textContent = "有未保存的修改";
    }),
  );
  await crepe.create();
  if (options.signal?.aborted) {
    events.abort();
    await crepe.destroy();
    throw new DOMException("Aborted", "AbortError");
  }
  const refreshDocumentLinks = documentExtras(
    node,
    crepe,
    openDocument,
    (text) => (el("#status").textContent = text),
    container,
    events.signal,
  );
  listen("focus", () => {
    void checkLinks(crepe.getMarkdown())
      .then(() =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta(linkState, true));
        }),
      )
      .catch(() => {});
  });
  savedMarkdown = crepe.getMarkdown();
  el("#status").textContent = "已读取本地 Markdown";
  const save = el<HTMLButtonElement>("#save");
  save.disabled = false;
  const doSave = async () => {
    if (save.disabled) return;
    save.disabled = true;
    el("#status").textContent = "正在保存；开启自动建图时将等待云端抽取…";
    const savingMarkdown = crepe.getMarkdown();
    try {
      const result = await api<{
        revision: number;
        extraction: string;
        conceptCount: number;
        warning?: { message: string };
      }>(`/api/nodes/${id}`, "PATCH", {
        markdown: savingMarkdown,
        revision,
      });
      revision = result.revision;
      void refreshDocumentLinks();
      savedMarkdown = savingMarkdown;
      const dirty = crepe.getMarkdown() !== savedMarkdown;
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
  listen("keydown", (event) => {
    if (!container.isConnected) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      void doSave();
    }
  });
  listen("beforeunload", (event) => {
    if (crepe.getMarkdown() !== savedMarkdown) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  if (isTauri())
    unlisten = await WebviewWindow.getCurrent().onCloseRequested(
      async (event) => {
        if (
          crepe.getMarkdown() !== savedMarkdown &&
          !window.confirm("文档尚未保存，确定关闭吗？")
        )
          event.preventDefault();
      },
    );
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
          el("#status").textContent = unavailableIds.has(href.slice(5)) ? "目标知识库未加载，请导入目标知识库后重试" : "已删除节点，可在回收站恢复";
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
  return {
    id,
    canLeave: () =>
      !save.disabled &&
      (crepe.getMarkdown() === savedMarkdown ||
        window.confirm("文档尚未保存，确定放弃修改并离开吗？")),
    destroy: async () => {
      events.abort();
      unlisten?.();
      await crepe.destroy();
    },
  };
}

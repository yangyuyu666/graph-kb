import { api, type PageNode, type KnowledgeBase } from "./api";
import { element as e, button, modal, field, download, nameDialog } from "./ui";
import { insert } from "@milkdown/kit/utils";
import type { Crepe } from "@milkdown/crepe";

function base64(bytes: Uint8Array) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
const escapeLabel = (text: string) => text.replace(/[\[\]\\]/g, "\\$&");
export function documentExtras(
  node: PageNode,
  crepe: Crepe,
  open: (id: string) => Promise<void>,
  status: (text: string) => void,
  container: HTMLElement,
  signal: AbortSignal,
) {
  const toolbar = e("div", undefined, "document-tools");
  container.querySelector(".document-meta")!.before(toolbar);
  const upload = e("input");
  upload.type = "file";
  upload.hidden = true;
  toolbar.append(
    button("附件 / 图片", () => upload.click()),
    button("嵌入媒体", () => embed()),
    button("引用节点", () => reference()),
    button("复制节点链接", async () => {
      const text = `[${escapeLabel(node.title)}](node:${node.kbId}/${node.id})`;
      try {
        await navigator.clipboard.writeText(text);
        status("节点链接已复制");
      } catch {
        const m = modal("复制节点链接");
        const input = e("input");
        input.value = text;
        input.readOnly = true;
        m.form.append(input);
        m.submit.remove();
        m.show();
        input.select();
      }
    }),
    upload,
  );
  upload.onchange = async () => {
    try {
      const file = upload.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw Error("附件不能超过 10 MiB");
      const asset = await api<{ id: string }>("/api/assets", "POST", {
        ownerId: node.id,
        name: file.name,
        mime: file.type || "application/octet-stream",
        data: base64(new Uint8Array(await file.arrayBuffer())),
      });
      crepe.editor.action(
        insert(`[${escapeLabel(file.name)}](asset:${asset.id})`),
      );
      status("附件已添加到草稿，请保存文档");
    } catch (error) {
      status(String(error));
    } finally {
      upload.value = "";
    }
  };
  function embed() {
    const m = modal("嵌入媒体");
    const input = e("input");
    input.type = "url";
    input.required = true;
    input.placeholder = "https://…";
    field(m.form, "YouTube、Vimeo 或音视频文件地址", input);
    m.form.append(
      e("p", "媒体按需打开预览；不会执行任意 HTML 或脚本。", "hint"),
    );
    m.form.onsubmit = (event) => {
      event.preventDefault();
      try {
        const url = mediaUrl(input.value);
        crepe.editor.action(insert(`[嵌入媒体](embed:${url})`));
        m.dialog.close();
      } catch (error) {
        m.error.textContent = String(error);
      }
    };
    m.show();
  }
  function reference() {
    const m = modal("引用节点");
    const library = e("select");
    library.setAttribute("aria-label", "目标知识库");
    field(m.form, "目标知识库", library);
    const select = e("select");
    select.setAttribute("aria-label", "目标节点");
    field(m.form, "目标节点", select);
    let version = 0;
    async function load() {
      const current = ++version; select.replaceChildren(); m.submit.disabled = true;
      try {
        const nodes = await api<PageNode[]>(`/api/kbs/${library.value}/nodes`);
        if (current !== version || !m.dialog.isConnected) return;
        for (const n of nodes) select.append(new Option(n.title, n.id));
        m.submit.disabled = !nodes.length;
      } catch (error) { m.error.textContent = String(error); }
    }
    library.onchange = () => void load();
    m.submit.disabled = true;
    void api<KnowledgeBase[]>("/api/kbs").then(async kbs => {
      for (const kb of kbs) library.append(new Option(kb.name, kb.id));
      library.value = node.kbId; await load();
    }).catch(error => m.error.textContent = String(error));
    m.form.onsubmit = (event) => {
      event.preventDefault();
      if (!select.value) return;
      crepe.editor.action(
        insert(
          `[${escapeLabel(select.selectedOptions[0].text)}](node:${library.value}/${select.value})`,
        ),
      );
      m.dialog.close();
    };
    m.show();
  }
  const links = e("div", undefined, "document-links");
  container.querySelector(".document")!.append(links);
  async function refresh() {
    try {
      const [backlinks, related] = await Promise.all([
        api<PageNode[]>(`/api/nodes/${node.id}/backlinks`),
        api<PageNode[]>(`/api/nodes/${node.id}/related`),
      ]);
      links.replaceChildren();
      for (const [title, nodes] of [
        ["反向链接", backlinks],
        ["相关文档", related],
      ] as const) {
        const section = e("section");
        section.append(e("h3", title));
        if (!nodes.length) section.append(e("p", "暂无", "hint"));
        for (const target of nodes)
          section.append(button(target.title, () => open(target.id)));
        links.append(section);
      }
    } catch {
      /* A deleted document is handled by the save/read boundary. */
    }
  }
  void refresh();
  window.addEventListener("focus", () => void refresh(), { signal });
  return refresh;
}
export async function openAsset(id: string) {
  const asset = await api<{ name: string; mime: string; data: string }>(
    `/api/assets/${id}`,
  );
  const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
  const m = modal(asset.name);
  m.dialog.classList.add("media-dialog");
  m.submit.remove();
  const blob = new Blob([bytes], { type: asset.mime }),
    url = URL.createObjectURL(blob);
  m.dialog.addEventListener("close", () => URL.revokeObjectURL(url));
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(asset.mime)) {
    const image = e("img");
    image.src = url;
    image.alt = asset.name;
    image.className = "media-preview";
    m.form.append(image);
  } else if (/^(audio|video)\//.test(asset.mime)) {
    const media = document.createElement(
      asset.mime.startsWith("audio") ? "audio" : "video",
    );
    media.src = url;
    media.controls = true;
    media.className = "media-preview";
    m.form.append(media);
  } else m.form.append(e("p", "此文件可下载后使用相应应用打开。"));
  m.actions.append(
    button(
      "下载文件",
      () => download(asset.name, bytes.buffer, asset.mime),
      "primary",
    ),
  );
  m.show();
}
function mediaUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("请输入有效的 HTTPS 媒体地址");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("媒体地址必须使用 HTTPS");
  let id: string | null = null;
  if (["www.youtube.com", "youtube.com", "youtu.be"].includes(url.hostname)) {
    id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.searchParams.get("v");
    if (!id || !/^[-\w]{6,30}$/.test(id)) throw Error("YouTube 地址无效");
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (
    ["vimeo.com", "www.vimeo.com"].includes(url.hostname) &&
    /^\/\d+$/.test(url.pathname)
  )
    return `https://player.vimeo.com/video${url.pathname}`;
  if (
    (url.hostname === "www.youtube-nocookie.com" &&
      /^\/embed\/[-\w]+$/.test(url.pathname)) ||
    (url.hostname === "player.vimeo.com" &&
      /^\/video\/\d+$/.test(url.pathname)) ||
    /\.(mp4|webm|mp3|ogg|wav)$/i.test(url.pathname)
  )
    return url.href;
  throw Error("目前支持 YouTube、Vimeo 及 HTTPS 音视频文件地址");
}
export function openEmbed(value: string) {
  const url = mediaUrl(value),
    m = modal("媒体预览");
  m.dialog.classList.add("media-dialog");
  m.submit.remove();
  if (/\.(mp4|webm|mp3|ogg|wav)(\?|$)/i.test(url)) {
    const media = document.createElement(
      /\.(mp3|ogg|wav)(\?|$)/i.test(url) ? "audio" : "video",
    );
    media.src = url;
    media.controls = true;
    media.className = "media-preview";
    m.form.append(media);
  } else {
    const iframe = e("iframe");
    iframe.src = url;
    iframe.className = "embed-preview";
    iframe.allow = "fullscreen";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
    iframe.referrerPolicy = "no-referrer";
    m.form.append(iframe);
  }
  m.show();
}

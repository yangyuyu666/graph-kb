import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { renderLibrary } from "./library";
import { mountDocument } from "./document-view";
import "./style.css";
import { api } from "./api";

const app = document.querySelector<HTMLDivElement>("#app")!;
function el<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}
function message(error: unknown) {
  el<HTMLElement>("#status").textContent =
    error instanceof Error ? error.message : String(error);
}

async function openDocument(id: string) {
  if (id.includes("/")) {
    const [link] = await api<{ nodeId: string; state: string }[]>("/api/tools", "POST", { name: "resolve_links", arguments: { ids: [id] } });
    if (link.state !== "active") throw Error(link.state === "unavailable" ? "目标知识库未加载，请先导入目标知识库" : "目标节点已删除");
    id = link.nodeId;
  }
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

const nodeId = new URLSearchParams(location.search).get("node");
(nodeId ? mountDocument(app, nodeId, openDocument) : home()).catch(message);

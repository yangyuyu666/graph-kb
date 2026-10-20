import { api } from "./api";
import { defaultWorkspaceView, saveDefaultWorkspaceView, type WorkspaceView } from "./view-preferences";

export interface CloudConfig {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  providers: { id: string; name: string; baseUrl: string }[];
}

export async function renderSettings(container: HTMLElement) {
  container.innerHTML = `<header><div><h1>设置</h1><p>界面偏好、云端模型与自动建图</p></div></header><p id="status" role="status"></p>
  <section class="settings-form" aria-labelledby="view-settings-title">
    <h2 id="view-settings-title">界面偏好</h2>
    <label>默认视图<select id="default-view"><option value="graph">图谱</option><option value="tree">目录</option></select></label>
    <p class="hint">选择后自动保存到本机，下次进入任意知识库时生效。临时切换视图不会改变此设置。</p>
  </section>
  <h2>云端模型与自动建图</h2>
  <form id="cloud-form" class="settings-form">
    <label>供应商<select id="provider"><option value="">请选择供应商</option></select></label>
    <label>API 基础地址<input id="base-url" type="url" placeholder="https://…" autocomplete="off" /></label>
    <label>模型 ID<input id="model" maxlength="200" placeholder="填写供应商提供的模型 ID" autocomplete="off" /></label>
    <label>API Key<input id="api-key" type="password" autocomplete="off" spellcheck="false" maxlength="4096" /></label>
    <p id="key-status" class="hint"></p>
    <label class="switch"><input id="extraction-enabled" type="checkbox" />开启自动建图</label>
    <p class="hint">开启后，每次保存会将该文档正文发送给所选云端服务用于提取概念，可能产生 API 费用。抽取失败时正文仍保存在本地。</p>
    <p class="hint">API Key 与开关仅在本次运行有效，重启后需要重新配置并开启。供应商、地址与模型保存在本地。</p>
    <div class="actions"><button id="clear-key" type="button">清除 API Key</button><button class="primary" type="submit">保存设置</button></div>
  </form>`;
  const select = container.querySelector<HTMLSelectElement>("#provider")!;
  const base = container.querySelector<HTMLInputElement>("#base-url")!;
  const model = container.querySelector<HTMLInputElement>("#model")!;
  const key = container.querySelector<HTMLInputElement>("#api-key")!;
  const enabled = container.querySelector<HTMLInputElement>(
    "#extraction-enabled",
  )!;
  const status = container.querySelector<HTMLElement>("#status")!;
  const defaultView = container.querySelector<HTMLSelectElement>("#default-view")!;
  defaultView.value = defaultWorkspaceView();
  defaultView.onchange = () => {
    try {
      saveDefaultWorkspaceView(defaultView.value as WorkspaceView);
      status.textContent = "默认视图已保存，下次进入知识库时生效";
    } catch {
      defaultView.value = defaultWorkspaceView();
      status.textContent = "无法保存默认视图，请检查本机存储权限后重试";
    }
  };
  let config = await api<CloudConfig>("/api/settings");
  for (const provider of config.providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    select.append(option);
  }
  function reflect() {
    select.value = config.provider;
    base.value = config.baseUrl;
    model.value = config.model;
    enabled.checked = config.enabled;
    key.value = "";
    key.placeholder = config.hasApiKey
      ? "已配置，留空保留当前 Key"
      : "仅在本次运行中保留";
    container.querySelector("#key-status")!.textContent = config.hasApiKey
      ? "API Key 已配置"
      : "尚未配置 API Key";
  }
  reflect();
  select.onchange = () => {
    base.value =
      config.providers.find((p) => p.id === select.value)?.baseUrl ?? "";
    model.value = "";
    key.value = "";
    enabled.checked = false;
    key.placeholder = "请输入所选服务的 API Key";
    container.querySelector("#key-status")!.textContent =
      "更换供应商或地址后，必须重新输入 Key";
  };
  const form = container.querySelector<HTMLFormElement>("#cloud-form")!;
  async function save(clear = false) {
    const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")];
    buttons.forEach((button) => (button.disabled = true));
    try {
      const payload: Record<string, unknown> = {
        provider: select.value,
        baseUrl: base.value.trim().replace(/\/+$/, ""),
        model: model.value.trim(),
        enabled: clear ? false : enabled.checked,
      };
      if (clear || key.value) payload.apiKey = clear ? "" : key.value.trim();
      config = await api<CloudConfig>("/api/settings", "PATCH", payload);
      reflect();
      status.textContent = clear
        ? "API Key 已清除，自动建图已关闭"
        : "设置已保存";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "保存设置失败";
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    void save();
  };
  container.querySelector<HTMLButtonElement>("#clear-key")!.onclick = () =>
    void save(true);
  const section = document.createElement("section");
  section.className = "api-settings";
  section.innerHTML =
    '<h2>开放 API / MCP</h2><p class="hint">配置一次即可使用。应用重启后自动重连，无需重新复制 JSON；使用时保持应用打开。更换安装位置或知识库数据目录后需更新配置。</p><button type="button">显示本地连接配置</button><textarea aria-label="MCP 连接配置" readonly hidden></textarea>';
  section.querySelector("button")!.onclick = async () => {
    try {
      const connection = await api<{
        url: string;
        token: string;
        command: string;
        args: string[];
        env: { GRAPH_KB_CONNECTION_FILE: string };
      }>("/api/connection");
      const output = section.querySelector("textarea")!;
      output.hidden = false;
      output.value = JSON.stringify(
        {
          mcpServers: {
            "graph-kb": {
              command: connection.command,
              args: connection.args,
              env: connection.env,
            },
          },
        },
        null,
        2,
      );
      section.querySelector("button")!.textContent = "重新获取连接配置";
    } catch (error) {
      status.textContent = String(error);
    }
  };
  container.append(section);
}

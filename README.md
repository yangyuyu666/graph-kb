# graph-kb

基于知识图谱的本地知识管理应用，当前为 **Phase 0 验证骨架**。依据见 [产品大纲](docs/outline.md) 与 `mockups/`，结果与阻塞见 [PROGRESS.md](PROGRESS.md)，未确认项见 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)。

## 开发运行

需要 Node.js 24+、npm；浏览器测试使用本机 Edge。

```powershell
cd C:\Users\27783\graph-kb
npm ci
npm run dev
```

打开 <http://127.0.0.1:1420>。新建知识库 → 新建节点 → 点击节点打开独立文档窗口 → Milkdown 编辑 → 保存或 Ctrl+S → 重新打开。数据实际落在 Kùzu 与 Markdown 文件中。

本次环境缺少 PATH 中的 npm，已在忽略目录 `.tools/package` 放置本地 npm。**这台机器可直接运行 `node scripts/dev.mjs`**；npm 命令可用 `node .tools/package/bin/npm-cli.js run build` 等替代。此工具目录不纳入仓库，新环境安装标准 Node/npm 即可。

## 验证

```powershell
npm test
npm run test:ui
npm run build
npm run check:licenses
npm audit
```

- 单元/集成测试使用真实磁盘 Kùzu，验证关系约束、抽取夹具、重启恢复、REST 和桌面后台进程生命周期。
- UI 测试启动独立服务，在 Edge 无头浏览器验证编辑、保存回读、内部链接和并发冲突，重新生成 `docs/evidence/` 的截图。
- 缺 Edge 时可安装 Playwright Chromium 并移除 `playwright.config.ts` 的 `channel`；本次仅验证 Windows Edge。
- 云端适配器已接入，自动化测试使用模拟响应和真实 Kùzu，不产生供应商费用；真实 Key 的抽取质量仍待实测。

## Tauri

安装 [Windows 前置依赖](https://v2.tauri.app/start/prerequisites/)：Rust MSVC toolchain、Microsoft C++ Build Tools（Desktop development with C++ 和 Windows SDK）、WebView2，然后运行 `npm run desktop`。

当前机器已安装 Rust 1.99.0、MSVC 14.51 与 Windows SDK 10.0.26100.0，原生窗口验证通过。微软安装器提示需要重启；本次构建不受影响。`node scripts/desktop.mjs dev` 可直接启动，脚本仅为子进程补充 Cargo 路径，并使用当前 Node，不修改全局 PATH。

`npm run desktop:build`（本机也可 `node scripts/desktop.mjs build`）构建 Windows x64 NSIS 安装包到 `src-tauri/target/release/bundle/nsis/`。包内携带 Node、Kùzu 原生绑定、服务代码、许可证和前端，用户不需要安装 Node/Rust；WebView2 由 Tauri 安装器检测处理。`Cargo.lock` 已提交；`dist/` 单独不是桌面应用。首次构建会从 Node 官方仓库取得对应版本 LICENSE，缓存在 `.tools/`；依赖下载需要可用网络。

本机已实际安装并验证 `.tools/installed-smoke/graph-kb.exe`，可以直接双击运行。该版本是未签名的 Phase 0 测试包，验证记录见 PROGRESS.md。

`npm run runtime:prepare` 后运行 `npm run test:runtime`，会把运行时复制到临时目录并清空 PATH，验证启动、存储、重启与退出。原生 UI 验证：启动测试用桌面进程时设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`，再运行 `npm run test:desktop`；脚本会创建带“桌面验证”前缀的测试知识库并关闭测试窗口。日常启动不要设置调试端口。

## 云端自动建图

设置 → 选择 DeepSeek、OpenAI/GPT、Google Gemini、MiMo 或其他兼容服务 → 填写模型 ID 和自己的 API Key → 勾选自动建图 → 保存设置。没有预选的供应商或模型。内置地址可修改，自定义地址须为 HTTPS；不要将 Key 发到聊天或提交 Git。

开启后，保存会先将正文写入本地，再发送正文提取概念；结构校验通过后创建/复用隐藏 Concept 和 CHILD_OF 边。失败会显示“已保存到本地 · 抽取失败”。单次请求限时 45 秒、返回最多 100 个概念；失败不自动重试，避免重复计费。当前串行工具队列在抽取期间会等待，异步任务调度留待后续。

Key 只保存在本次进程内存，不回传页面、不写配置文件/日志；重启后清空并关闭自动建图。供应商、地址、模型写入数据目录的 `cloud-settings.json`。切换服务/地址会清除旧 Key；持久化密钥方案记录在 OPEN_QUESTIONS.md。网络需要代理时，可在启动进程环境配置 Node 的 `HTTPS_PROXY`、`NO_PROXY` 和 `NODE_USE_ENV_PROXY=1`；不将这台机器的代理地址硬编码进应用。

## 存储与写入边界

```text
Milkdown → REST → KnowledgeTools → Kùzu（结构与属性）
                               └→ documents/<节点 UUID>.md（正文）
```

- 浏览器开发数据在 `.graph-kb/dev/`，可设置 `GRAPH_KB_DATA_DIR`。Tauri 数据在 `app_local_data_dir()`，两者隔离。
- `graph.kuzu` 是图库；`documents/` 中 Page 和 Concept 各有 1:1 Markdown；`journal/` 是跨图库/文件提交恢复日志。
- `KnowledgeBase`、`FileCommit` 是容器/提交元数据表，不作为用户图谱节点，不生成虚拟根。
- 接口共用 `KnowledgeTools.execute()`；未来 MCP 适配器应调用同一入口，当前没有 MCP Server。
- 从属子→父、禁止自环/跨库/环；同库顶级 Page 自动建立平行边，排序后只存一条；成为子节点时清理平行边。
- `node:<UUID>` 只存正文，不创建引用边。Concept 不出现在页面列表。
- 保存携带 `revision`，冲突返回 409，界面保留草稿。抽取管线只新增/复用；旧概念清理策略待定。

## Phase 0 REST 范围

| 方法 | 路径 | 用途 |
|---|---|---|
| GET / POST | `/api/kbs` | 列出 / 创建知识库 |
| GET | `/api/kbs/{id}/nodes` | 列出可见页面 |
| POST | `/api/nodes` | 创建页面及 Markdown |
| GET / PATCH | `/api/nodes/{id}` | 读取 / 保存文档 |
| POST | `/api/edges` | 校验后创建关系 |
| GET | `/api/nodes/{id}/neighbors` | 一跳图查询，含后台 Concept |
| GET / PATCH | `/api/settings` | 读取脱敏设置 / 更新云端配置 |

底层 REST 仅监听 `127.0.0.1` 随机端口，需随机会话 Bearer API Key；Tauri 通过私有 IPC 获取连接。浏览器开发服务的同源 `/api` 代理代填 Key，仅用于本地开发，不是生产认证方案。当前不提供删除、重命名、回收站、搜索、完整图视图、导入导出。

主仓库采用 [Apache-2.0](LICENSE)；第三方组件保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

协议依据：[OpenAI Responses 结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[Gemini 结构化输出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)、[MiMo Chat API](https://mimo.mi.com/docs/en-US/api/chat/openai-api)。接口适配通过本地协议测试，不等于供应商实测；模型需支持对应接口和 JSON 输出。

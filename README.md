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
- 真实 LLM 未接入。抽取默认关闭，测试注入固定实体 JSON，夹具不包含生产识别逻辑，也不调用网络模型。

## Tauri

安装 [Windows 前置依赖](https://v2.tauri.app/start/prerequisites/)：Rust MSVC toolchain、Microsoft C++ Build Tools（Desktop development with C++ 和 Windows SDK）、WebView2，然后运行 `npm run desktop`。

当前机器缺 Rust/MSVC/SDK，原生编译尚未通过。`src-tauri/` 已配置 Tauri 2、文档多窗口权限、CSP、后台进程启动/退出、私有 API 握手。默认从 PATH 启动 Node，可用 `GRAPH_KB_NODE` 指定可执行文件。

**当前仅支持开发态设计**：正式构建主动拒绝启动，`bundle.active=false`。自包含 Node/Kùzu 打包、Rust 依赖锁定、Windows 安装包尚未验证，`dist/` 不是可分发桌面应用。

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

底层 REST 仅监听 `127.0.0.1` 随机端口，需随机会话 Bearer API Key；Tauri 通过私有 IPC 获取连接。浏览器开发服务的同源 `/api` 代理代填 Key，仅用于本地开发，不是生产认证方案。当前不提供删除、重命名、回收站、搜索、完整图视图、设置、导入导出。

主仓库采用 [Apache-2.0](LICENSE)；第三方组件保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

已确认云端 API 采用可配置供应商方向，覆盖 DeepSeek、OpenAI（GPT）、Google Gemini、MiMo 等。具体默认供应商、模型及首次实测配置未定；目前尚未实现这些适配器，不代表已经支持或验证。自动抽取仍默认关闭。

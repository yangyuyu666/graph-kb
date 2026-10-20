# graph-kb

基于知识图谱的本地知识管理应用，当前为 **0.2.6 本地 MVP**。依据见 [产品大纲](docs/outline.md) 与 `mockups/`，结果与阻塞见 [PROGRESS.md](PROGRESS.md)，未确认项见 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)。

0.2.6：目录展开箭头、文件夹和文档改为统一的 SVG 线条图标，文件夹随展开/折叠切换形态；统一尺寸与对齐，选中图标使用青色提示。文件夹图标仅表示该节点有子节点，节点仍可编辑 Markdown。

0.2.5：图谱改为父子分支布局，同一分支连续排列，左右分配空间，独立项目分区排布。共享节点只画一次，全部关系保留；复杂多父图仍可能有交叉。边长调节改变横向层间距；“重新布局”恢复自动排列。标题最多显示两行，深层大图默认保持可读比例，拖动画布继续浏览，“适应画布”查看完整概览。

右键图谱或目录节点 → **只看此节点及全部子节点**，包含全部递归后代，不受 3 跳限制；也可在图谱选择中心，再将“图谱范围”设为“全部递归子节点”。共享后代保留，但其外部父节点、祖先和兄弟不会自动带入。“全库图谱”退出分支范围，保留当前文字/类型/关系筛选。右键进入分支会清空这些筛选以显示完整分支；随后搜索只筛选分支内节点。切换目录/图谱或编辑关系后保留本次分支范围，重新打开知识库恢复全库。

API 同步支持 `GET /api/kbs/{kbId}/graph?center={nodeId}&scope=descendants`；MCP 使用 `get_graph({kbId,center,scope:"descendants"})`，center 必填。默认 `scope:"neighbors"` 保留旧版 1–3 跳双向邻域。递归范围先沿完整 CHILD_OF 父→子计算，再应用 kind/q/edgeType 展示筛选，不沿平行边扩展，不修改图数据。固定 MCP 连接 JSON 不变，客户端重新加载工具定义即可看到新增 scope 参数。

0.2.4：修复图谱右键节点时系统“刷新/打印”菜单叠在应用菜单上的问题；节点和边操作菜单统一拦截原生右键菜单，编辑区的常规右键功能保留。

0.2.3：文档标题、保存按钮、附件/引用工具栏和保存状态固定在编辑区顶部，目录内和独立窗口均适用。库内“搜索节点标题或正文”支持搜索按钮、回车和输入后自动筛选，显示命中数量，自动展开匹配节点的父级目录；清空搜索框恢复全部节点。搜索范围为当前知识库中的已保存内容，未保存草稿不参与搜索。

## 开发运行

需要 Node.js 24+、npm；浏览器测试使用本机 Edge。

```powershell
cd C:\Users\27783\graph-kb
npm ci
npm run dev
```

打开 <http://127.0.0.1:1420>。新建知识库 → 进入目录 → 创建顶级节点 / 右键创建子节点 → 左键在右侧编辑（右键可选独立窗口） → Milkdown 编辑 → 保存或 Ctrl+S → 重新打开。数据实际落在 Kùzu 与 Markdown 文件中。

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

本机已实际安装并验证 `.tools/installed-smoke/graph-kb.exe`，可以直接双击运行。该版本是未签名的本地 MVP 测试包，验证记录见 PROGRESS.md。

`npm run runtime:prepare` 后运行 `npm run test:runtime`，会把运行时复制到临时目录并清空 PATH，验证启动、存储、重启与退出。原生 UI 验证：启动测试用桌面进程时设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`，再运行 `npm run test:desktop`；脚本会创建带“桌面验证”前缀的测试知识库并关闭测试窗口。日常启动不要设置调试端口。

## 云端自动建图

设置 → 选择 DeepSeek、OpenAI/GPT、Google Gemini、MiMo 或其他兼容服务 → 填写模型 ID 和自己的 API Key → 勾选自动建图 → 保存设置。没有预选的供应商或模型。内置地址可修改，自定义地址须为 HTTPS；不要将 Key 发到聊天或提交 Git。

开启后，保存会先将正文写入本地，再发送正文提取概念；结构校验通过后创建/复用隐藏 Concept 和 CHILD_OF 边。失败会显示“已保存到本地 · 抽取失败”。单次请求限时 45 秒、返回最多 100 个概念；失败不自动重试，避免重复计费。当前串行工具队列在抽取期间会等待，异步任务调度留待后续。

Key 只保存在本次进程内存，不回传页面、不写配置文件/日志；重启后清空并关闭自动建图。供应商、地址、模型写入数据目录的 `cloud-settings.json`。切换服务/地址会清除旧 Key；持久化密钥方案记录在 OPEN_QUESTIONS.md。网络需要代理时，可在启动进程环境配置 Node 的 `HTTPS_PROXY`、`NO_PROXY` 和 `NODE_USE_ENV_PROXY=1`；不将这台机器的代理地址硬编码进应用。

## 存储与写入边界

```text
Milkdown → REST / MCP → LibraryStore（知识库定位与跨库查询）
                        └→ 每库 KnowledgeTools → 独立 Kùzu + Markdown + 附件
```

- 浏览器开发数据在 `.graph-kb/dev/`，可设置 `GRAPH_KB_DATA_DIR`。Tauri 数据默认在 `app_local_data_dir()`，两者隔离；桌面也支持绝对路径 `GRAPH_KB_DATA_DIR`，原生测试用它隔离测试数据。
- 0.2.0 起，每库位于 `libraries/<知识库 UUID>/`，各自包含 `graph.kuzu`、`documents/`、`journal/`、`trash/`、`blobs/` 和 `library.json`，不共用图数据库。根目录 `catalog.json` 仅记录库的位置，启动会从目录清单重建；`cloud-settings.json` 与 `mcp-session.json` 仍属应用级配置。
- 首次启动自动将旧共享图库拆分，保留 ID、正文、边标签、附件、抽取缓存和回收站，旧的裸 UUID 引用在可确定目标库时补全库 ID。全部库构建完成后才一次性发布 `libraries/`；失败不发布半份结果，修复问题后可重试。根目录旧 `graph.kuzu`、`documents/` 等保留为迁移前备份，不再参与新版本读写。
- `KnowledgeBase`、`FileCommit` 是容器/提交元数据表，不作为用户图谱节点，不生成虚拟根。
- UI、REST 和 MCP 共用独立库路由与 `KnowledgeTools.execute()`；MCP 是 stdio 适配器，不另外持有数据库。同一工作区只能由一个服务实例打开；按需切换图库连接，避免每库常驻一份 Kùzu 缓存。
- 从属子→父、禁止自环/跨库/环；同库可见顶级节点自动建立平行边，排序后只存一条；成为子节点时清理平行边。
- 新引用使用 `node:<知识库UUID>/<节点UUID>`，旧 `node:<节点UUID>` 仍兼容；引用只存正文，不创建跨库图边。目标库未加载时保留链接并提示，导入目标库后刷新/聚焦文档即可恢复。引用节点对话框可以选择其他库；全局搜索及反向链接汇总已加载各库。Concept 不出现在页面列表。
- 保存携带 `revision`，冲突返回 409，界面保留草稿。抽取管线只新增/复用；旧概念清理策略待定。

## REST 与 MCP

完整中文说明见 [应用与 MCP 使用指南](server/mcp-guide.md)，包含界面操作、图模型、编辑/删除恢复流程、导入导出示例和错误处理。MCP 初始化会返回核心 `instructions`；客户端可以调用 `get_usage_guide` 或读取资源 `graph-kb://guide/usage` 获得同一份手册。`tools/list` 包含各工具用途、参数含义与关键返回行为。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET / POST | /api/kbs | 列出 / 创建知识库 |
| GET / PATCH / DELETE | /api/kbs/{id} | 读取 / 重命名 / 软删除 |
| GET | /api/kbs/{id}/nodes、/graph | 可见节点、筛选图谱 |
| POST | /api/kbs/{id}/import、/export | 导入 / 导出 |
| POST | /api/databases/{id}/export | 整库备份，保留 ID、附件和回收站 |
| POST | /api/databases/import | body 为 {data, mode}，迁移恢复或作为副本 |
| POST | /api/nodes | 创建，支持 parentId、kind 和 properties |
| GET / PATCH / DELETE | /api/nodes/{id} | 读取 / 保存正文或更新 title、properties / 软删除 |
| POST | /api/edges | 创建并校验关系 |
| GET / PATCH / DELETE | /api/edges/{id} | 读取 / 原子修正 / 删除关系 |
| GET | /api/nodes/{id}/neighbors | 1–3 跳，type 筛选，含后台 Concept |
| GET | /api/nodes/{id}/backlinks、/related | 反向链接 / 共享概念推荐 |
| GET | /api/search?q=…、/api/path?kbId=…&source=…&target=… | 全文 / 最短路径 |
| GET / POST | /api/trash、/api/trash/{id}/restore | 列表 / 恢复 |
| POST / GET | /api/assets、/api/assets/{id} | 附件写入 / 读取 |
| GET / PATCH | /api/settings | 脱敏设置 / 云端配置 |
| POST | /api/tools | 同一工具入口，JSON 为 name 与 arguments |
| GET | /api/connection | 鉴权后读取本地连接和 MCP 启动配置 |

关系 ID 为 TYPE:sourceUUID:targetUUID，放入 URL 时编码。文档保存/重命名携带 revision。错误含 code、message、suggestion；过期保存 409，已删除文档 410。

**自定义属性（0.2.2）：** 每个节点和两种边都有 `properties` JSON 对象，默认 `{}`，直接存入其所属图库（内部以 JSON 字符串保存），不是外部指针。支持字符串、有限数值、布尔值、null、数组和嵌套对象；顶层必须是对象，序列化后最多 64 KiB、嵌套深度最多 16。省略字段保留原值，传对象整体替换，传 `{}` 清空；不会与 title、kind、label 等核心字段合并。非法值返回 `INVALID_PROPERTIES`。

- 节点创建：POST `/api/nodes` 可带 `"properties":{"priority":2}`。修改前 GET `/api/nodes/{id}` 取得 revision，再 PATCH 同一路径，body 为 `{"revision":3,"properties":{"priority":2,"source":"人工录入"}}`；可同时传 title，成功递增 revision。正文与属性分开提交，每次使用最新版本，冲突返回 409。
- 边创建和 PATCH `/api/edges/{编码后的关系ID}` 可带 `{"properties":{"confidence":0.95}}`；可与 label 一同修改，无 revision，按最后一次成功写入生效。自动维护平行边、重复创建已有边且省略 properties 时保留原值。
- MCP 共 35 项工具，新增 `update_node({id,revision,title?,properties?})`（至少提供 title/properties 一项）；`create_node`、`create_edge`、`update_edge` 增加 properties 参数，旧 rename_node 保持兼容。get_node/list_nodes/get_graph/get_edge/query_path 返回完整属性；query_neighbors 中 properties 属于邻居节点，edgeProperties 属于该次遍历的边。
- 旧库自动逐表升级；旧备份缺失属性时按 `{}` 处理。JSON、Markdown ZIP 的 graph.json、整库迁移/副本及回收站恢复保留属性。属性内部的 ID/链接只是普通数据，复制导入不自动改写；已存在的同名隐藏概念被复用时保留已有节点属性。属性不自动成为图关系，也不参与当前全文检索、筛选或云抽取；暂未增加界面属性编辑面板。迁移属性数据请使用 0.2.2 或更新版本。

**图谱与边文字（0.2.1）：** 图谱采用浅色文档卡片和按连接数分层的居中布局，顶部边长滑块及 − / ＋ 可调整间距（100–400），按知识库在当前设备记忆；调整时保留缩放，超出画布可点“适应画布”。 图谱中右键线条 →“编辑边文字”→ 保存，第一行显示在线条旁（过长省略），第二行起仅在点击边弹出的小窗口中显示；编辑框支持换行；目录中也可右键节点 → 管理关系 → 修改。每条边有可选 `label` 属性，最多 200 字符，留空清除；仅为注释，不改变 CHILD_OF / SIBLING_OF 结构语义。旧库启动时自动补充属性，原关系和正文保留。JSON 导入导出、Markdown ZIP 中的 graph.json、回收站恢复均保留标签。

REST 创建边可带 `label`；`PATCH /api/edges/{编码后的关系ID}` 仅传 `{"label":"参考资料"}` 即可修改文字，`{"label":""}` 清除。MCP 同样使用 `update_edge({id,label:"参考资料"})`。修改时省略字段保持原值；重复创建已有边时省略 label 保留原文字。get_graph/get_edge/query_path 返回边的 label。更新 MCP 程序后需让客户端重新加载工具定义，固定连接 JSON 无需改动。

底层 REST 仅监听 127.0.0.1 随机端口，需当前会话 Bearer Key；Tauri 通过 IPC 取得连接。开发服务同源 /api 代理仅用于本地开发。

**连接外部 AI：** 设置 → 显示本地连接配置 → 将显示的 mcpServers 配置交给支持 MCP 的客户端。0.1.2 起配置固定，只含启动路径和 `GRAPH_KB_CONNECTION_FILE`，不含临时令牌。应用重启后，已运行的 MCP 在下一次调用自动读取新会话，无需重新复制 JSON 或重启 MCP。应用关闭时可读取使用手册，业务操作需先打开应用。更换安装位置或数据目录后才需更新配置。MCP 使用 stdio JSON-RPC（2025-11-25），调用同一 REST 工具边界；不是远程 HTTP MCP 服务。

**后台使用：** 将 Graph KB 最小化即可保留本地服务；直接说“通过 Graph KB MCP 在后台操作，不打开窗口或截图”。数据读写使用 MCP 工具并检查返回结果，不需要 Computer Use 界面验证。用户确认关闭应用仍退出，不采用托盘驻留。MCP 调用链本身不显示窗口或请求焦点；若窗口被唤起，应区分 API 调用与客户端的界面自动化行为。

**接入本机 Codex：** 将上述完整 JSON 保存到已被 Git 忽略的 `.tools/mcp-connection.json`，在项目目录运行 `node scripts/connect-codex.mjs`。脚本先通过 MCP 初始化、发现工具和只读查询知识库，再用 `codex mcp add` 注册用户级 `graph-kb` 服务；不打印令牌或知识库内容。可追加 `--check` 只验证、不改 Codex 配置，也可传入其他 JSON 路径。Codex CLI 不在 PATH 时，用环境变量 `GRAPH_KB_CODEX_COMMAND` 指定其可执行文件绝对路径。此连接不需要 DeepSeek/GPT 等云端 API Key。

首次注册或从旧配置迁移后，在 Codex 设置 → MCP servers 中刷新/Restart，并用 `/mcp` 检查连接；尚未加载的当前会话不能视为已接通。以后普通应用重启无需更新。数据目录下 `mcp-session.json` 由应用自动发布并轮换端口/令牌，Windows 文件 ACL 仅允许当前用户，正常关闭删除，异常退出残留在下次启动时替换；请勿公开或提交该私有文件。固定 JSON 不再把令牌写入 Codex 配置；旧版 URL/token 配置仍兼容，但仍会随应用重启失效。配置机制参考 [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp)。

**常用操作：** 知识库顶部切换“图谱 / 目录”；目录节点左键在右侧编辑，左右分栏可拖动；图谱和目录均右键打开节点操作菜单（创建子节点、重命名、关系管理、两种删除、新窗口打开），图谱左键仍开独立窗口；图谱控制区选择中心/跳数/路径终点，画布下方导出 PNG 或当前子图；全库导出用顶部“导出”。Markdown ZIP 含结构清单 graph.json，可用 JSON 导入完整还原并重映射 ID；CSV 必须有 title，可选 id、parentId、markdown、kind。所有导入事务整批校验，失败不留半份图。

删除节点可指定 DELETE /api/nodes/{id}?mode=single 或 mode=cascade；默认 single 仅删当前节点，cascade 删除独占后代，保留有外部父节点的共享分支。MCP delete_node 也接受 mode。两种删除均进入回收站，可整批恢复。

回收站保留 30 天，运行时每小时清理，启动和请求维护也检查。恢复尽量恢复原边，因其他节点删除或结构变化产生的冲突边会跳过并提示。图谱/目录隐藏 Concept；后台纠正及合并可经 MCP 完成。候选池功能不在本版，逐项映射见 [MVP 验收表](docs/MVP_ACCEPTANCE.md)。

主仓库采用 [Apache-2.0](LICENSE)；第三方组件保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 整库迁移、导入与导出（0.2.0）

- 首页知识库卡片的 `⋯ → 导出知识库` 生成 `.graphkb.json`；首页“导入知识库”可导入该文件。库内原来的 Markdown/CSV/JSON 导入仍用于向当前库合并文档。
- “迁移 / 恢复”保留库与对象 ID；已有同 ID 库或对象时拒绝覆盖。“作为副本”生成新的库、节点、附件、回收站 ID，并改写副本内部引用；对其他库的引用保持原指向。
- 整库备份是版本化的可移植数据包，不是直接上传 Kùzu 二进制：包含图结构、正文、边属性、附件、回收站与抽取缓存，导入时重建独立 Kùzu；不包含云端 Key 或本机 MCP 配置。副本因 ID/正文变化会丢弃可重建的抽取缓存。
- 当前整库文件限 24 MiB。更大的库可关闭应用后复制整个 `libraries/<UUID>/` 文件夹到另一工作区的 `libraries/` 中，保留文件夹名与 `library.json`，重启发现；不要覆盖已有同 ID 文件夹，不要在应用运行时复制打开的图库。
- 迁移来源库不会自动带走它引用的其他库，需分别迁移目标库。跨机器尚未加载的目标会提示“目标知识库未加载”。同一副本的新 ID 不会让其他库已有链接自动改指向副本。
- 旧根目录备份仅反映迁移前状态，新写入在 `libraries/`；不要直接用旧版打开新工作区。常规备份优先使用整库导出，或关闭应用后复制完整工作区。

协议依据：[OpenAI Responses 结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[Gemini 结构化输出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)、[MiMo Chat API](https://mimo.mi.com/docs/en-US/api/chat/openai-api)。接口适配通过本地协议测试，不等于供应商实测；模型需支持对应接口和 JSON 输出。

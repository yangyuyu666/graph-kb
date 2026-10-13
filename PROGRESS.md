# 开发进度

更新：2026-10-13。项目版本：0.1.2。工作目录：C:/Users/27783/graph-kb。

## 当前结果

已从 Phase 0 骨架扩展到大纲第 5 节已确认的本地 MVP。用户确认的 Cytoscape.js、图谱/目录切换、可折叠层级目录、在具体节点下创建子节点均已落地。详细逐项映射见 [MVP 验收表](docs/MVP_ACCEPTANCE.md)；候选池和未定产品决策见 [开放问题](OPEN_QUESTIONS.md)。不把候选池、Beta、商店发布称为已完成。

已生成并实际安装 Windows x64 **0.1.2** 测试包，安装目录为 [.tools/installed-smoke](.tools/installed-smoke/graph-kb.exe)。默认数据目录标识保持不变，不迁走用户数据。原生测试使用 GRAPH_KB_DATA_DIR 指向独立 QA 目录；验收后已启动默认数据目录的应用并迁移 Codex 固定连接配置。

## 本次交互修订

- 图谱与目录共用右键菜单：新建子节点、重命名、管理关系、仅删除当前节点、级联删除、在新窗口中打开；支持点外关闭、Esc、方向键和目录 Shift+F10。
- 图谱左键仍开独立窗口；目录左键改为右侧直接编辑 Markdown，移除行内 ＋ 和 ⋯；左右分栏可鼠标拖动，分隔条也支持方向键调整。
- 复用同一个 Milkdown 编辑组件，保存、附件、链接、版本冲突与独立窗口一致；目录折叠、筛选、拖动、视图切换保留草稿；切换文档/离开知识库提示未保存修改。
- 删除方式 single 保持原行为；cascade 沿 CHILD_OF 递归删除独占后代，保留有外部父节点的共享后代及其依附分支。一次删除形成一个回收站批次，可整批恢复。界面、REST、MCP 使用同一规则。
- 图片仅参考右键菜单的外观；未添加截图中的置顶、归档、分享等未授权功能。

## 实现内容

- 首页：知识库卡片、数量/更新时间、名称筛选、新建、重命名、二次确认删除；全局全文搜索、回收站、设置。
- 目录：父子缩进、折叠展开、右键创建子节点、管理关系；顶部明确“新建顶级节点”。多父按已有边投影，同一 ID 打开同一文档，不擅加单父规则。
- 图谱：Cytoscape.js 力导向、缩放/拖动、节点/关系/全文筛选、中心 1–3 跳、最短路径、PNG 和当前子图 JSON 导出。CHILD_OF 子→父实线箭头，SIBLING_OF 顶级平行虚线。Concept 仍隐藏。
- 编辑：Milkdown 常用 Markdown 块、文件/图片附件、受限媒体嵌入预览、内部节点引用、独立文档窗口、Ctrl+S、冲突保草稿、未保存关闭提示。附件/媒体以 Markdown 链接插入，点击预览或下载。
- 图谱管线：写正文即更新真实 Kùzu 节点；已开启云抽取时生成/复用隐藏 Concept 和 CHILD_OF；跨文档去重、内容/模型缓存、相关文档、反向链接。云失败保正文；缓存不复活人工删边。可见关系可在 UI 修正/移除，后台概念可通过统一工具合并。
- 数据迁移：Markdown 文件夹、CSV、Graph KB JSON 原子导入；Markdown ZIP 和完整 JSON 导出，包含图结构、正文与附件；同批链接相对化 / 导入 ID 重映射，重复导入复用同库概念。
- 删除：单节点或整库 30 天回收站，边级联移除、正文随迁，恢复 ID/正文/可恢复关系；已删除链接灰色占位且禁点；过期附件一起清理。启动、每小时及请求维护检查过期，应用关闭时不后台唤醒。
- API：REST CRUD、图查询、导入导出、附件、回收站、配置；MCP stdio 2025-11-25 适配器调用同一工具层。设置页导出固定 MCP JSON，只引用本机会话文件；普通应用重启不必重新配置，MCP 每次调用自动读取新端口与令牌。

Tag、File、Person、Task 支持创建、编辑及图关系，共享文档能力；没有自行添加大纲未定义的专属工作流。

## 项目结构

| 位置 | 职责 |
|---|---|
| docs/outline.md、mockups/ | 产品大纲与 5 张原始设计图 |
| src/library.ts | 首页、全局搜索、回收站 |
| src/workspace.ts | 目录、Cytoscape 图谱、关系管理、导入导出 |
| src/main.ts、src/document-extras.ts | Milkdown、独立窗口、稳定引用、附件、媒体、相关文档 |
| src/api.ts、src/settings.ts、src/ui.ts、src/style.css | 共用 REST、云配置、对话框、样式 |
| server/graph-store.mjs | 嵌入 Kùzu、磁盘文档、文件提交日志与故障恢复 |
| server/tools.mjs、server/operations.mjs | 唯一工具边界、约束、抽取/缓存、CRUD、查询、迁移、回收站 |
| server/http.mjs、server/mcp.mjs | 鉴权 loopback REST、stdio MCP |
| server/cloud-settings.mjs、cloud-extractor.mjs | 多供应商适配、Key 内存保存、结构校验 |
| server/desktop.mjs、src-tauri/ | 后台服务与 Tauri 壳、权限/CSP、打包配置 |
| scripts/ | 开发/构建、许可证收集、独立运行时与已安装应用验收 |
| tests/、docs/evidence/ | 真实图库/协议/UI/运行时测试、截图、包哈希、许可证清单 |
| OPEN_QUESTIONS.md、docs/MVP_ACCEPTANCE.md | 未确认项与逐项验收边界 |

Kùzu 保存节点、关系及内部元数据；documents/UUID.md 保存正文，trash/批次/ 保存回收站正文，blobs/ 保存附件，journal/ 支持提交恢复。所有 UI/REST/MCP 写入经 KnowledgeTools.execute，不开放原始 Cypher；数据库和文件应一起备份。测试库、密钥、工具下载、构建产物不进 Git。

## Phase 0 与 MVP 验证结果

Windows x64；Node 24.19.0、Kùzu 0.11.3、Milkdown 7.22.3、Cytoscape.js 3.34.3、Tauri Rust 2.12.3、Rust 1.99.0、MSVC 14.51、Windows SDK 10.0.26100.0。

| 检查 | 结果 |
|---|---|
| 后端测试 | 36 项通过（含 MCP 子测试）：真实磁盘 Kùzu、约束/并发/恢复、云协议、软删除/恢复/过期、导入导出、附件、缓存/合并、MCP 手册和操作流程、跨应用重启自动重连、Windows 会话文件 ACL |
| Edge 界面测试 | 0.1.2 针对设置页 1 项通过：固定 JSON 导出和既有云设置流程。0.1.1 的 9 项全套加 1 项快速保存回归历史通过；此次未重复整套 |
| 独立运行时 | 1 项通过，复制出仓库、空 PATH、实际保存和重启回读 |
| TypeScript / Vite | 构建通过；主 bundle 约 1.97 MB、gzip 624 KB，存在体积提示 |
| Tauri release / NSIS | 0.1.2 构建成功，安装退出 0 |
| 已安装原生应用 | 空 PATH、临时工作目录、隔离数据；真实 IPC、目录右侧编辑保存、右键创建子节点、Cytoscape 画布、删除恢复、中文保存、新窗口链接、设置默认关闭、关闭退出通过 |
| npm 许可元数据 | 368 个锁条目，无 GPL/AGPL/LGPL/未知项；随包收集 294 项非 dev npm 许可及 242 项 Windows Rust 许可 |
| npm audit --omit=dev | 0 vulnerabilities |

新截图：[目录右侧编辑](docs/evidence/inline-directory.png)、[图谱右键菜单](docs/evidence/graph-context-menu.png)、[原生目录编辑](docs/evidence/tauri-inline-directory.png)。

截图：[层级目录](docs/evidence/mvp-tree.png)、[图谱与路径](docs/evidence/mvp-graph.png)、[原生图谱](docs/evidence/tauri-graph.png)、[原生文档](docs/evidence/tauri-editor.png)。历史 Phase 0 详细记录见 [PHASE0_REPORT.md](docs/PHASE0_REPORT.md)。

Phase 0 的最小闭环已验证：Milkdown 输入 → REST → Kùzu 节点/版本 + UUID Markdown → 重启回读；固定云响应经结构校验生成隐藏 Concept 和子→父边。测试没有将模拟云响应冒充真实供应商调用。

## 图库选型结论

继续使用锁定的 Kùzu 0.11.3：本机验证满足嵌入、Cypher、持久化、事务和 MIT 核心依赖要求，无需单独部署图库服务。图谱是数据模型本身，画布和目录均查询真实结构。

Kùzu 官方仓库已归档，是长期维护风险；LadybugDB 为候选，未验证兼容，不擅自更换。Neo4j、NebulaGraph、ArangoDB 均未引入。归档/许可核查依据与历史选型表见 Phase 0 记录。主仓库 Apache-2.0，新增 Cytoscape.js 和 fflate 为 MIT；第三方保留其原许可，不能把整棵依赖树称为全 MIT。GPL/AGPL 组件不嵌入、不随包分发。

## 桌面产物

安装包：[Graph KB_0.1.2_x64-setup.exe](src-tauri/target/release/bundle/nsis/Graph%20KB_0.1.2_x64-setup.exe)，约 29 MiB；校验值及验收见 [windows-package.json](docs/evidence/windows-package.json)。所有已安装服务文件与源码逐项哈希一致，主程序通过 release 对比（仅预期 NSIS 标记差异）。安装后程序：[graph-kb.exe](.tools/installed-smoke/graph-kb.exe)。包含 Node、Kùzu、服务、前端、完整 MCP 指南、固定连接支持及许可证；使用者无需 Rust/Node。保持旧 app identifier 以兼容现有数据目录。

未签名、未公开发行，未执行商店上架。WebView2 在本机已有，缺失环境仍待验收。仅测试进程开启 CDP 调试端口，日常运行不开启。

## 阻塞与验收限制

| 阻塞 / 未验项 | 影响与处理 |
|---|---|
| 当前 Codex 客户端需一次性加载固定连接配置 | 已迁移到 GRAPH_KB_CONNECTION_FILE，旧端口/令牌已从当前 graph-kb 配置移除；真实新 MCP 子进程验证通过。Codex MCP 设置 Restart 一次后加载；之后普通应用重启自动恢复，无需再复制 JSON |
| 无用户选定的真实模型/API Key | DeepSeek、GPT、Gemini、MiMo 协议已模拟验证，但真实抽取质量、费用、速度未验。在应用设置填写即可；不用在聊天发 Key |
| 无签名证书、商店账户与干净 Windows VM | 无法完成商店分发和跨机器发行验收；不阻塞本机 MVP |
| 无已确认的规模/性能指标 | 全文为本地扫描、顶级平行边为两两建边，只有功能规模测试；大图、大批附件、断电、跨平台未验收 |

原缺 SDK 已解决；安装器提示重启但当前编译可用，未重启电脑。Key 仅会话内存，重启清空并关闭抽取；非密配置落盘。媒体网站实际网络可用性及 Windows 中文输入法组合输入仍需人工验收。后台抽取串行等待最多 45 秒，无自动重试；旧概念清理与语义对齐待定。

已安装服务文件和主程序再次校验一致；原生鼠标右键图节点、菜单关闭且不多开窗口也已验证。修复 Milkdown 延迟通知导致的快速保存后误报草稿，保存状态改为比较实际 Markdown 内容。

2026-10-13：新增 Codex 接入脚本与 README 操作步骤。`node --test tests/mcp.test.mjs` 通过 2 项（含子测试）：真实隔离 Kùzu/MCP 读写，以及接入脚本的只读检查、失效令牌拒绝、输出脱敏。用户保存连接配置后，运行脚本成功完成本机真实应用的 MCP 初始化、31 项工具发现和 `list_kbs` 只读调用，再注册 Codex 用户级 `graph-kb` 服务；CLI 确认 enabled=true。未修改知识库数据，令牌未打印或提交。当前对话工具列表尚无 graph-kb，客户端刷新后的对话内调用仍待验收。无需重新构建桌面安装包。

## MCP 使用说明补全（2026-10-13）

- `server/mcp-guide.md` 是唯一完整手册来源，README 链接到它。覆盖目录/图谱界面用法、稳定 ID、多父图结构、子→父方向、全文替换与版本冲突、共享分支保护、批次恢复、云端抽取状态及隐私、导入导出和附件示例。
- 初始化返回核心 `instructions`；`tools/list` 为全部工具及参数提供中文说明；新增 `get_usage_guide`，共 32 项工具。资源 `graph-kb://guide/usage` 与帮助工具返回同一内容，不需要 AI 另找本地 README。资源只接受固定 URI，不提供任意文件读取。
- 打包脚本收集手册及说明模块。`node --test --test-concurrency=1 tests/*.test.mjs`：34 项通过；`node --test tests/runtime/standalone.test.mjs`：1 项通过，含复制出仓库、空 PATH 下读取手册，以及原有图库保存/重启回读。
- MCP 流程测试覆盖版本冲突不覆盖正文、原子改父关系、级联删除共享分支保护及批次恢复。指南资源、帮助工具内容一致；未知 URI 拒绝；参数说明可通过工具发现取得。
- 已备份旧 MCP 入口，并将 `mcp.mjs`、`mcp-help.mjs`、`mcp-guide.md` 同步到当前 Codex 配置指向的 `.tools/installed-smoke/resources/runtime/server/`，逐文件校验哈希。未重启用户桌面应用，未改用户数据。`node scripts/connect-codex.mjs --check` 对真实会话验证通过：32 项工具、知识库只读查询、初始化说明、指南资源和帮助工具均正常。
- 已运行的客户端 MCP 子进程仍需在 MCP 设置中 Restart 后加载更新；本次验证使用新启动的真实 MCP 子进程，不冒充当前对话已加载。旧 NSIS 安装包未重打，重装旧包会覆盖本次本机 MCP 文件更新；新版打包流程已包含这些文件。

## 固定 MCP 配置（0.1.2）

0.1.2 固定连接：`server/local-connection.mjs` 在发布令牌前限制文件访问（Windows 当前用户 SID ACL；非 Windows 0600），原子更新数据目录 `mcp-session.json`，正常关闭删除；崩溃残留在下次启动替换。清理校验令牌归属，旧服务退出不会删新服务文件。这个私有文件与用户导出的固定 JSON 是不同文件，云端 API Key 仍仅保存在进程内存。

新增重连测试从应用未启动开始，保持同一个 MCP 进程，启动→创建隔离夹具→关闭→重新启动→读取原库；验证两次导出 JSON 完全一致、令牌已轮换、无需重启 MCP。失败写入不自动重试，避免重复创建。设置导出、Codex 接入脚本及手册同步更新；旧 URL/token 方式仍兼容。首次构建因主包版本升级后 Cargo.lock 未同步而失败，补齐根包版本后构建成功；设置测试增加等待异步 JSON 返回后通过。

0.1.2 安装时用户应用已关闭；仅结束旧 MCP 桥接进程以释放安装文件。实际安装后在隔离数据上完成原生验收，再启动默认数据的应用。已自动更新 `.tools/mcp-connection.json` 和 Codex 配置，确认 env 仅有 GRAPH_KB_CONNECTION_FILE；真实会话只读验证通过，未创建或编辑用户文档。

## Git 与运行

后台运行对齐：用户选择“只需最小化后不抢焦点，关闭窗口仍退出”，不引入托盘。检查 MCP→HTTP→工具层没有显示窗口或请求焦点的代码；前端 setFocus 仅在主动打开已存在文档时执行。当前会话直接 MCP 的 list_kbs/get_settings 均成功。Computer Use 窗口验证返回“coordinate input geometry is unavailable”，未能自动证明前台焦点是否保持，因此不宣称已复现或修复窗口置顶缺陷。MCP 初始化指南、完整手册和 README 加入后台操作约定：数据任务只走 MCP，不为检查结果激活窗口或截图。两个说明文件已同步到本机安装目录，新 MCP 子进程读取及真实只读查询通过；已有客户端在下次重启 MCP 时读取新说明，本次未重新生成安装包。后续具体跳窗时机仍待用户观察确认。

main 已建仓。交互修订提交 f6c709e，后续保存状态修复与验收记录分别提交；历史 MVP 按后端、桌面界面、验收文档分组提交。功能提交：02384dd（图工具、导入、回收站、MCP）、797d23d（目录、Cytoscape、桌面 MVP）；无远端、未推送，不修改全局 Git 配置。开发运行 node scripts/dev.mjs 或 node scripts/desktop.mjs dev。标准 npm 命令见 README；本机 npm 可用 node .tools/package/bin/npm-cli.js 替代。原始设计 PNG 保留不改，大纲仅同步已确认决策。

# 开发进度

更新：2026-10-13。项目版本：0.1.0。工作目录：C:/Users/27783/graph-kb。

## 当前结果

已从 Phase 0 骨架扩展到大纲第 5 节已确认的本地 MVP。用户确认的 Cytoscape.js、图谱/目录切换、可折叠层级目录、在具体节点下创建子节点均已落地。详细逐项映射见 [MVP 验收表](docs/MVP_ACCEPTANCE.md)；候选池和未定产品决策见 [开放问题](OPEN_QUESTIONS.md)。不把候选池、Beta、商店发布称为已完成。

已生成并实际安装 Windows x64 **0.1.0** 测试包，安装目录为 [.tools/installed-smoke](.tools/installed-smoke/graph-kb.exe)。关闭旧版窗口后重新启动该程序即可使用；默认数据目录标识保持不变，采用增量建表，不迁走用户数据。原生测试使用 GRAPH_KB_DATA_DIR 指向独立 QA 目录。

## 实现内容

- 首页：知识库卡片、数量/更新时间、名称筛选、新建、重命名、二次确认删除；全局全文搜索、回收站、设置。
- 目录：父子缩进、折叠展开、节点旁 ＋ 创建子节点、⋯ 管理；顶部明确“新建顶级节点”。多父按已有边投影，同一 ID 打开同一文档，不擅加单父规则。
- 图谱：Cytoscape.js 力导向、缩放/拖动、节点/关系/全文筛选、中心 1–3 跳、最短路径、PNG 和当前子图 JSON 导出。CHILD_OF 子→父实线箭头，SIBLING_OF 顶级平行虚线。Concept 仍隐藏。
- 编辑：Milkdown 常用 Markdown 块、文件/图片附件、受限媒体嵌入预览、内部节点引用、独立文档窗口、Ctrl+S、冲突保草稿、未保存关闭提示。附件/媒体以 Markdown 链接插入，点击预览或下载。
- 图谱管线：写正文即更新真实 Kùzu 节点；已开启云抽取时生成/复用隐藏 Concept 和 CHILD_OF；跨文档去重、内容/模型缓存、相关文档、反向链接。云失败保正文；缓存不复活人工删边。可见关系可在 UI 修正/移除，后台概念可通过统一工具合并。
- 数据迁移：Markdown 文件夹、CSV、Graph KB JSON 原子导入；Markdown ZIP 和完整 JSON 导出，包含图结构、正文与附件；同批链接相对化 / 导入 ID 重映射，重复导入复用同库概念。
- 删除：单节点或整库 30 天回收站，边级联移除、正文随迁，恢复 ID/正文/可恢复关系；已删除链接灰色占位且禁点；过期附件一起清理。启动、每小时及请求维护检查过期，应用关闭时不后台唤醒。
- API：REST CRUD、图查询、导入导出、附件、回收站、配置；MCP stdio 2025-11-25 适配器调用同一工具层。设置页显示本地 MCP 连接配置；每次服务重启需更新随机端口/会话 Key。

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
| 后端测试 | 30 项通过：真实磁盘 Kùzu、约束/并发/恢复、云协议、软删除/恢复/过期、CSV/Markdown/JSON 原子导入、附件、缓存/合并、真实 MCP 子进程 |
| Edge 界面测试 | 6 项全通过；之后补强并复跑 3 项 MVP 测试，验证 PNG 文件签名、子图 JSON 节点/边、目录/回收站/附件/搜索/MCP 配置 |
| 独立运行时 | 1 项通过，复制出仓库、空 PATH、实际保存和重启回读 |
| TypeScript / Vite | 构建通过；主 bundle 约 1.97 MB、gzip 624 KB，存在体积提示 |
| Tauri release / NSIS | 0.1.0 构建成功，安装退出 0 |
| 已安装原生应用 | 空 PATH、临时工作目录、隔离数据；真实 IPC、子节点创建、Cytoscape 画布、删除恢复、中文保存、新窗口链接、设置默认关闭、关闭退出通过 |
| npm 许可元数据 | 368 个锁条目，无 GPL/AGPL/LGPL/未知项；随包收集 294 项非 dev npm 许可及 242 项 Windows Rust 许可 |
| npm audit --omit=dev | 0 vulnerabilities |

截图：[层级目录](docs/evidence/mvp-tree.png)、[图谱与路径](docs/evidence/mvp-graph.png)、[原生图谱](docs/evidence/tauri-graph.png)、[原生文档](docs/evidence/tauri-editor.png)。历史 Phase 0 详细记录见 [PHASE0_REPORT.md](docs/PHASE0_REPORT.md)。

Phase 0 的最小闭环已验证：Milkdown 输入 → REST → Kùzu 节点/版本 + UUID Markdown → 重启回读；固定云响应经结构校验生成隐藏 Concept 和子→父边。测试没有将模拟云响应冒充真实供应商调用。

## 图库选型结论

继续使用锁定的 Kùzu 0.11.3：本机验证满足嵌入、Cypher、持久化、事务和 MIT 核心依赖要求，无需单独部署图库服务。图谱是数据模型本身，画布和目录均查询真实结构。

Kùzu 官方仓库已归档，是长期维护风险；LadybugDB 为候选，未验证兼容，不擅自更换。Neo4j、NebulaGraph、ArangoDB 均未引入。归档/许可核查依据与历史选型表见 Phase 0 记录。主仓库 Apache-2.0，新增 Cytoscape.js 和 fflate 为 MIT；第三方保留其原许可，不能把整棵依赖树称为全 MIT。GPL/AGPL 组件不嵌入、不随包分发。

## 桌面产物

安装包：[Graph KB_0.1.0_x64-setup.exe](src-tauri/target/release/bundle/nsis/Graph%20KB_0.1.0_x64-setup.exe)，约 28.99 MiB；校验值见 [windows-package.json](docs/evidence/windows-package.json)。安装后全部服务文件与源码哈希一致；主程序与 release 仅有预期的 NSIS 标记 3 字节差异。安装后程序：[graph-kb.exe](.tools/installed-smoke/graph-kb.exe)。包含 Node、Kùzu、服务、前端与许可证；使用者无需 Rust/Node。保持旧 app identifier 以兼容现有数据目录。

未签名、未公开发行，未执行商店上架。WebView2 在本机已有，缺失环境仍待验收。仅测试进程开启 CDP 调试端口，日常运行不开启。

## 阻塞与验收限制

| 阻塞 / 未验项 | 影响与处理 |
|---|---|
| 无用户选定的真实模型/API Key | DeepSeek、GPT、Gemini、MiMo 协议已模拟验证，但真实抽取质量、费用、速度未验。在应用设置填写即可；不用在聊天发 Key |
| 无签名证书、商店账户与干净 Windows VM | 无法完成商店分发和跨机器发行验收；不阻塞本机 MVP |
| 无已确认的规模/性能指标 | 全文为本地扫描、顶级平行边为两两建边，只有功能规模测试；大图、大批附件、断电、跨平台未验收 |

原缺 SDK 已解决；安装器提示重启但当前编译可用，未重启电脑。Key 仅会话内存，重启清空并关闭抽取；非密配置落盘。媒体网站实际网络可用性及 Windows 中文输入法组合输入仍需人工验收。后台抽取串行等待最多 45 秒，无自动重试；旧概念清理与语义对齐待定。

## Git 与运行

main 已建仓，本次按后端、桌面界面、验收文档分组提交。功能提交：02384dd（图工具、导入、回收站、MCP）、797d23d（目录、Cytoscape、桌面 MVP）；无远端、未推送，不修改全局 Git 配置。开发运行 node scripts/dev.mjs 或 node scripts/desktop.mjs dev。标准 npm 命令见 README；本机 npm 可用 node .tools/package/bin/npm-cli.js 替代。原始设计 PNG 保留不改，大纲仅同步已确认决策。

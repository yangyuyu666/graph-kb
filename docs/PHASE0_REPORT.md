# Phase 0 历史记录

以下是本地 MVP 扩展前的历史验证记录，路径相对于项目根目录；当前状态以根目录 PROGRESS.md 为准。

# 开发进度

更新：2026-10-13。工作目录：C:\Users\27783\graph-kb。

## 结论

**Phase 0 的 Milkdown + 真实 Kùzu + Tauri 桌面闭环已跑通，已生成 Windows x64 安装包。可配置云端抽取已实现；尚无用户 API Key，真实供应商调用未验收。**

已通读大纲及全部 5 张 PNG。图谱是存储主体：创建页面即写 Kùzu 节点，正文在独立 Markdown 文件；保存经统一工具层更新节点版本，抽取返回经校验后生成/复用隐藏 Concept，并写入 `Concept -[:CHILD_OF]-> Page`。查询直接执行 Cypher，不从正文临时拼展示图。

界面沿用浅灰侧栏、紫色操作、知识库卡片和独立文档窗口，只提供验证所需入口。删除图的永久删除文案与已确认软删除冲突，未照搬。PNG 保留原样；大纲仅随用户确认更新许可证和云端 API 决策。主仓库 Apache-2.0，第三方组件保留各自许可证。

## 项目结构

```text
graph-kb/
├─ docs/outline.md                  产品大纲
├─ docs/evidence/                   浏览器/原生窗口截图、许可证清单
├─ mockups/                         5 张原始设计 PNG
├─ src/main.ts                      Milkdown、知识库/页面、独立窗口、内部链接
├─ src/api.ts                       浏览器 / Tauri 共用 REST 客户端
├─ src/settings.ts                  云端供应商、模型、Key 和开关
├─ src/style.css                    基于 mockup 的最小布局
├─ server/graph-store.mjs            Kùzu、参数查询、文件日志和恢复
├─ server/tools.mjs                  统一写入校验、概念管线、图查询
├─ server/http.mjs                   loopback REST、会话鉴权、结构化错误
├─ server/desktop.mjs                Tauri 后台进程握手与生命周期
├─ server/cloud-extractor.mjs        云端协议、超时、实体结构校验
├─ server/cloud-settings.mjs         非密配置落盘、Key 仅会话保存
├─ src-tauri/                        Tauri 2 Rust 壳、权限、CSP、图标
│  ├─ Cargo.lock                    Rust 依赖锁文件
│  └─ resources/runtime/            生成的 Node/Kùzu 运行时（不进 Git）
├─ scripts/dev.mjs                   Vite + 图服务启动器
├─ scripts/desktop.mjs               桌面启动 / 构建入口
├─ scripts/prepare-runtime.mjs       组装独立 Windows x64 运行时
├─ scripts/collect-rust-licenses.mjs  Rust 声明与 MPL 源码收集
├─ scripts/verify-desktop.mjs         实际 WebView2 窗口验证
├─ tests/*.test.mjs                  18 项图库 / REST / 云端协议 / 进程测试
├─ tests/ui/                        3 项 Edge 端到端测试
├─ tests/runtime/                   空 PATH、仓库外运行与持久化验证
├─ licenses/vendor/                 上游缺失许可文本和固定提交来源
├─ package.json / package-lock.json  前端与 Node 依赖锁定
├─ README.md                        启动、验证、API 和存储说明
├─ THIRD_PARTY_NOTICES.md            第三方协议与核查边界
└─ OPEN_QUESTIONS.md                 未确认项和文档冲突
```

原有 Codex 诊断/启动脚本未覆盖或执行，通过 .gitignore 排除。个人数据、Key、测试数据库、构建产物和本地工具下载不进 Git。

## Phase 0 验证结果

环境：Windows 10 x64，Node 24.19.0，Rust/Cargo 1.99.0，MSVC 14.51.36231，Windows SDK 10.0.26100.0，Kùzu 0.11.3，Milkdown 7.22.3，Tauri Rust 2.12.3，Edge/WebView2 154.0.4258.62。Kùzu 使用 npm Windows x64 原生绑定，嵌入随包 Node 进程，无需数据库服务器。

| 验证 | 结果与边界 |
|---|---|
| 真实编辑链路 | 建库/页 → Milkdown 中文输入 → REST → Kùzu 和 Markdown → 重载回读；通过 |
| Markdown 往返 | 标题、加粗、待办、表格、代码、node 链接保留；不声称字节级无损 |
| 内部链接 / 窗口 | 原页面保持打开，链接打开独立文档窗口；浏览器、Tauri 开发版与 release 均通过 |
| 写入即建图 | 固定实体响应含重复项，生成/复用 Concept 和 CHILD_OF，重复保存不增节点/边；真实图库通过 |
| 正文与结构分离 | Page、Concept 各有 UUID.md；Node 无正文字段；Concept 在页面列表隐藏 |
| 知识库隔离 | 同名概念在另一库独立创建；拒绝跨库边 |
| 关系约束 | CHILD_OF 子→父且无环；SIBLING_OF 限同库顶级 Page，单边存储、双向查询；成为子节点时清理平行边 |
| 引用不建边 | node 链接不创建引用边；仅两种业务边 |
| 并发保存 | 同 revision 两次提交只接受一个；另一个 409，界面保留草稿 |
| 持久化 / 恢复 | 重启保留正文/节点/边；事务失败回滚；提交后文件提升失败，重启恢复 |
| REST | 随机会话 Key、127.0.0.1、来源/Host/JSON 校验、错误原因和建议 |
| 云端协议 | OpenAI Responses、DeepSeek Chat、Gemini generateContent、MiMo Chat、其他兼容接口：模拟请求/响应通过，未调用付费供应商 |
| 云端失败 | 超时、HTTP 错误、截断、拒绝、无效 JSON、超大响应均失败；正文仍保留，不产生半份概念数据 |
| 设置 / Key | 无预选厂商/模型，默认关闭；Key 不落盘/不回传；换服务清除旧 Key；重启清空并关闭 |
| 原生桌面 | Tauri IPC、建库/页、中文编辑、保存、独立链接窗口、设置与关闭通过；退出后无遗留应用/后台服务进程 |
| 独立运行时 | 复制到仓库外临时目录并清空 PATH，随包 Node 可启动 Kùzu、保存、重启回读及退出 |
| release 运行 | 临时工作目录、空 PATH 启动 release exe，同套原生 UI 验证通过；页面来自 http://tauri.localhost/，不依赖 Vite |
| 安装包构建 / 安装 | NSIS 安装退出 0；安装到项目 .tools/installed-smoke 后，在空 PATH、临时工作目录下通过完整原生 UI 验证；退出 0；干净虚拟机与签名尚未验收 |

```text
npm test                       18 passed / 0 failed
npm run test:ui                  3 passed / 0 failed（真实 Edge）
npm run test:runtime             1 passed / 0 failed（空 PATH、仓库外）
npm run test:desktop             开发版 / release / 安装后程序原生窗口验证通过
npm run build                   TypeScript 与 Vite 构建通过
npm audit                       0 vulnerabilities（Phase 0 基线核查）
npm run check:licenses           365 个锁文件条目，无 GPL/AGPL/LGPL/未知项
cargo check                     通过
node scripts/desktop.mjs build   release 与 NSIS 安装包构建通过
```

基线曾执行全新 npm ci 并复跑测试，确认锁文件可复现。云端功能没有新增 npm 依赖。Milkdown 主 bundle 仍约 1.50 MB（gzip 约 473 KB），存在体积提示。未做大图性能、Windows IME 人工验收、断电或跨平台测试。

截图：[知识库](docs/evidence/phase0-home.png)、[浏览器文档](docs/evidence/phase0-editor.png)、[云端设置](docs/evidence/cloud-settings.png)、[Tauri release 文档](docs/evidence/tauri-editor.png)、[Tauri release 设置](docs/evidence/tauri-settings.png)。原生截图通过 WebView2 调试协议截取，日常运行不开启调试端口。

### 实现中解决的问题

- Kùzu 不支持无向匹配 DELETE，分别删除入向/出向平行边；避免自动回滚后的二次回滚掩盖原始错误。
- Milkdown 默认移除 node 协议地址，仅扩展合法 UUID 内部链接，其他 URL 保留原过滤逻辑。
- tar、KaTeX 审计告警通过锁定修复版消除，Windows 预编译绑定可用；不推断源码构建或其他平台兼容。
- 旧 VS 安装器因版本要求退出 5008，改用 Microsoft 当前 stable 安装器成功安装。退出 3010 提示重启，实际构建已可用。
- Rust 下载使用官方源并校验组件 SHA256，最终安装完成；未关闭 TLS 校验。
- Tauri release 补齐 custom-protocol feature，确保嵌入前端；Windows 扩展资源路径导致 Node EISDIR，传给子进程前规范化后实际运行通过。
- Vite 监听 Rust 产物引发 EBUSY，排除 src-tauri、数据和工具目录后解决。

### 一致性、云端与隐私边界

写入在单服务队列串行；Markdown 先暂存，图事务连同提交标记提交后，再提升为 documents/UUID.md，启动恢复未完成提交。已测程序异常/重启，未做断电/磁盘损坏测试，不宣称跨文件系统完全 ACID。图库与正文须一起备份，不支持绕过 API 改文件后自动同步。

正文先提交，抽取成功后再单独提交概念和边。模型输出必须经过本地结构校验，不能直接执行 Cypher 或工具。单次请求限时 45 秒，返回最多 100 个概念，不自动重试。云端失败仍返回已保存的新 revision。当前串行队列在抽取期间等待，尚无异步任务调度。

概念对齐仅为同库 NFC 名称精确匹配，不代表最终语义算法。旧概念/旧抽取边不自动清理，删除语义待定。知识库和提交标记是元数据表，不是用户图谱节点，不创建虚拟根。内容块不创建图节点。

Key 只留在后台内存，接口仅返回 hasApiKey；不写文件/日志，重启清空并关闭抽取。非密配置写入 cloud-settings.json；长期凭据存储仍是开放问题。开启前界面说明正文将发到云端并可能计费。协议官方依据见 README.md，实际模型质量/成本未验。

## 图库选型结论

**Phase 0 使用 Kùzu 0.11.3：满足 Windows 单机、嵌入式、Cypher、持久化和 MIT 核心依赖目标，不代表长期生产选型已定。** GraphStore 隔离连接/执行，上层仍用 Cypher，换库需要查询和文件迁移验证。

| 方案 | 结论 |
|---|---|
| Kùzu 0.11.3 | 实测通过并锁定；官方归档及 npm deprecated 是进入 MVP 的维护风险 |
| LadybugDB | MIT 社区后续项目，官方仓库仍活跃；候选验证，未切换，不假定文件/API 无缝兼容 |
| Neo4j Community | 未引入/嵌入/分发；依大纲仅可考虑外部独立服务，本次不需要 |
| NebulaGraph | 服务端路线，未部署，不作为单机验证首选 |
| ArangoDB | 未引入；官方 devel/LICENSE 为 BSL 1.1，不能沿用大纲 Apache-2.0 表述 |

2026-10-13 官方 GitHub API 核查：kuzudb/kuzu archived=true，最后推送 2025-10-10，HEAD 89f0263cc7a1fd9c396d2c4953747a013556a7f9；LadybugDB/ladybug archived=false，最后推送 2026-10-13，读取时 HEAD cf236ad5d20d57555d6f85f618c9360b41d65ec2（提交时间 2026-10-12T19:03:12Z）。活跃不等于通过兼容验收。

依据：[Kùzu 官方仓库](https://github.com/kuzudb/kuzu)、[0.11.3 发布](https://github.com/kuzudb/kuzu/releases/tag/v0.11.3)、[Kùzu MIT](https://github.com/kuzudb/kuzu/blob/v0.11.3/LICENSE)、[Ladybug 官方仓库](https://github.com/LadybugDB/ladybug)、[ArangoDB LICENSE](https://github.com/arangodb/arangodb/blob/devel/LICENSE)。

## 桌面产物与协议

安装包：`src-tauri/target/release/bundle/nsis/Graph KB_0.0.1_x64-setup.exe`，约 28.85 MiB，校验值见 [构建记录](docs/evidence/windows-package.json)。已实际安装到 `.tools/installed-smoke/`，安装及程序退出均为 0；可直接运行该目录的 graph-kb.exe。包含 Node、Kùzu 原生绑定、后台服务和嵌入前端；用户不需要 Rust 或本机 Node。WebView2 由 Tauri 安装器检测处理，本机已有；无 WebView2 环境尚未验收。安装包未签名，未公开发行。

核对原生测试数据库仅包含本次 QA 知识库后，已将它们移入项目忽略目录 `.graph-kb/native-qa-20261013/` 留存。下次启动安装后的应用会建立空白知识库环境，不混入验证数据。

随包保留 Node 完整声明、Kùzu 第三方许可、292 项 npm 许可及 242 项 Windows Rust 许可（含构建依赖的保守超集），并附 MPL Rust 库未修改源码。未发现 GPL/AGPL/LGPL/未知元数据；预编译原生绑定完整 SBOM 审计仍待发行前复核，详见 THIRD_PARTY_NOTICES.md。未来 GPL/AGPL 组件只作外部独立进程调用、不嵌入分发。

## 阻塞

| 阻塞 | 影响 | 后续动作 |
|---|---|---|
| 尚无真实云端 API Key / 用户选择的模型 | 真实成功率、识别质量、速度、成本未验 | 在应用设置填写自己的 Key、模型并开启，用小文档实测；无需在聊天里发 Key。协议适配和模拟测试已完成 |
| 没有干净 Windows 虚拟机及签名证书 | 不能宣称跨机器发行、SmartScreen 和无 WebView2 环境已验收 | 当前用于本地 Phase 0；公开发行前做干净环境验收和签名，不阻塞本机使用 |

原缺 SDK 阻塞已解除。按用户“开始吧”安装了 Rust 与 Microsoft C++ Build Tools/SDK；安装器提示重启，未自动重启电脑。实际编译、窗口和 release 检查已通过。环境要求依据：[Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 范围边界与 Git

未实现完整 MCP Server、全部 CRUD、回收站、图可视化、路径/多跳、导入导出、搜索、Tag/File/Person/Task 工作流。候选池的数据库视图、GraphRAG、协作和移动端未实现。未确认事项统一见 OPEN_QUESTIONS.md。

已初始化 main；按基线、实现、验证分组提交，见 git log。提交身份 Codex <codex@local.invalid>，未改全局 Git 配置；无远端、未推送。

本机桌面启动：`node scripts/desktop.mjs dev`；浏览器启动：`node scripts/dev.mjs` 后打开 http://127.0.0.1:1420。标准环境用 npm ci、npm run desktop / npm run dev。详细配置与验证命令见 README.md。

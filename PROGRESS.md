# 开发进度

更新：2026-10-13。工作目录：`C:\Users\27783\graph-kb`。

## 结论

**Phase 0 的编辑器 + 真实嵌入式图库闭环已跑通；Tauri 原生编译和真实 LLM 抽取仍有阻塞，不能宣称整个桌面应用已验收。**

已通读产品大纲和全部 5 张设计图。实现以图谱为存储主体：创建页面即写 Kùzu 节点，正文在独立 Markdown 文件；保存经统一工具层更新节点版本，测试抽取器生成/复用 Concept，并写入 `Concept -[:CHILD_OF]-> Page`。查询直接执行 Cypher，不从正文临时拼展示图。

界面沿用设计图的浅灰侧栏、紫色操作、知识库卡片、独立文档窗口。只提供验证所需入口，没有装作可用的搜索、删除、图视图按钮。删除图的永久删除文案与确认的软删除冲突，未照搬。PNG 保留原样；大纲仅随用户后续确认的许可证与云端 API 决策更新。

## 项目结构

```text
graph-kb/
├─ docs/outline.md                  原始产品大纲
├─ docs/evidence/                   实际页面截图、npm 许可证元数据
├─ mockups/                         5 张原始设计 PNG
├─ src/main.ts                      界面、Milkdown、独立窗口、内部链接
├─ src/api.ts                       浏览器 / Tauri 共用 REST 客户端
├─ src/style.css                    依据 mockup 的最小布局
├─ server/graph-store.mjs            Kùzu 适配、参数查询、文件日志和恢复
├─ server/tools.mjs                  统一写入校验、概念管线、图查询
├─ server/http.mjs                   localhost REST、API Key、结构化错误
├─ server/desktop.mjs                Tauri 后台进程握手与生命周期
├─ src-tauri/                        Tauri 2 Rust 壳、权限、CSP、图标
├─ scripts/dev.mjs                   Vite + 图服务启动器
├─ scripts/check-licenses.mjs        npm 锁文件许可证扫描
├─ tests/*.test.mjs                  10 项真实图库 / REST / 进程测试
├─ tests/ui/editor.spec.ts           2 项 Edge 端到端测试
├─ package.json / package-lock.json  锁定前端与 Node 依赖
├─ README.md                        启动、验证、API 和存储说明
├─ THIRD_PARTY_NOTICES.md            第三方协议与核查边界
└─ OPEN_QUESTIONS.md                 未确认项和文档冲突
```

没有覆盖或执行原有 Codex 诊断/启动脚本；它们仍在目录中，通过 `.gitignore` 排除。个人数据、测试数据库、构建产物和本地下载 npm 同样不进 Git。

## Phase 0 验证结果

环境：Windows 10 x64，Node 24.19.0，Kùzu 0.11.3，Milkdown 7.22.3，Edge/WebView2 154.0.4258.62。Kùzu 使用 npm 包内 Windows x64 原生绑定，嵌入本地 Node 进程，无需数据库服务器。

| 验证 | 结果与证据 |
|---|---|
| 真实编辑链路 | Edge 中创建库/页 → Milkdown 中文输入 → REST 保存 → 实际 Markdown 回读 → 重载显示；通过 |
| Markdown 往返 | 标题、加粗、待办、表格、代码、node 链接保留；不声称字节级无损 |
| 内部链接 / 窗口 | 原页面保持打开，链接打开独立文档窗口；只扩展合法 UUID 的 node 协议，其他链接保留 Milkdown 默认过滤；浏览器通过，原生待验 |
| 写入即建图 | 3 条固定实体 JSON（含重复）生成 2 个 Concept；重复保存不增节点/边；第二文档复用后共 4 条 CHILD_OF；通过 |
| 正文与结构分离 | Page、Concept 均有 UUID.md；Node 无正文字段；Concept 不在页面列表展示；通过 |
| 知识库隔离 | 同名概念在另一个库独立创建；跨库边被拒绝；通过 |
| 关系约束 | CHILD_OF 子→父且无环；SIBLING_OF 限同库顶级 Page，按 ID 排序单边存储、双向查询；成为子节点时清理平行边；通过 |
| 引用不建边 | node 链接不创建引用边；仅有两种业务边；通过 |
| 默认抽取关闭 | 不调用模型；强制开启但缺模型时明确报错、不留半份数据；通过 |
| 并发保存 | 同 revision 两次提交只接受一个；另一个 409，界面保留草稿；通过 |
| 持久化 / 恢复 | 关闭连接后重开，正文/节点/边保留；图事务失败回滚；提交后文件提升失败，重启恢复；通过 |
| REST | API Key、127.0.0.1、来源/Host/JSON 校验、错误含原因和建议；通过 |
| 后台进程 | 使用与 Tauri 相同的 Node 入口，验证私有 stdout 握手、stdin 关闭退出、重启保留数据；通过 |
| 原生桌面 | 已建壳与接口；tauri dev 在 cargo metadata 阶段失败，未编译 Rust 或启动原生窗口 |

实际命令结果：

已额外执行全新 `npm ci`（成功，审计为 0），随后重新运行以下后端、UI 和构建检查，均通过，确认锁文件可复现本次安装。

```text
npm test                  10 passed / 0 failed
npm run test:ui             2 passed / 0 failed（真实 Edge，非模拟 DOM）
npm run build              TypeScript 与 Vite 构建通过
npm audit                  0 vulnerabilities
npm run check:licenses     365 个锁文件条目，无 GPL/AGPL/LGPL/未知项
tauri info                 缺 Rust、Cargo、MSVC、Windows SDK；已有 WebView2
tauri dev --no-watch       失败：cargo metadata → program not found
```

构建仍有 Milkdown 主 bundle 约 1.50 MB（gzip 约 471 KB）的体积提示。未做大图性能、Windows IME 人工输入验收或跨平台测试。

实际运行截图：[知识库页面](docs/evidence/phase0-home.png)、[Milkdown 文档](docs/evidence/phase0-editor.png)。

### 验证中发现并解决的问题

- Kùzu 不支持无向关系匹配的 DELETE，改成分别删除入向/出向平行边；保留原始事务错误，避免自动回滚后的二次回滚掩盖问题。
- Milkdown 默认将 node 协议渲染为无地址链接；扩展链接 schema，只允许合法 UUID 内部链接，保持 Markdown 往返和正常拦截跳转。
- Kùzu 旧构建链 tar、Milkdown 传递依赖 KaTeX 触发审计告警，固定修复版本后审计为 0；源码编译和其他平台仍待验证。

### 数据一致性与抽取边界

写入在单服务队列内串行；Markdown 先暂存，图事务连同提交标记提交后，再提升为 `documents/<UUID>.md`，启动恢复未完成提交。已测程序异常/重启，未做断电或磁盘损坏测试，不宣称跨文件系统完全 ACID。图库与正文须一起备份；不支持绕过 API 修改文件后自动同步。

概念对齐仅演示“同库、NFC 后名称精确匹配”；测试固定返回名称、类型、简介，不是真正实体识别。旧概念/旧抽取边暂不自动清理，避免擅自决定删除语义。知识库与提交标记存于独立元数据表，不是用户图谱节点，不创建虚拟根。

## 图库选型结论

**Phase 0 确定使用 Kùzu 0.11.3。已满足 Windows 单机、嵌入式、Cypher、磁盘持久化和 MIT 核心依赖目标；不代表长期生产选型已定。** GraphStore 隔离连接/查询执行，但上层仍用 Cypher，换库需要查询和文件迁移验证。

| 方案 | 本次结论 |
|---|---|
| Kùzu 0.11.3 | 实测通过并锁定用于 Phase 0；官方归档、npm deprecated 是进入 MVP 的明确维护风险 |
| LadybugDB | MIT 的社区后续项目，查证仍活跃；列入后续验证候选，本次不切换，不假定文件/API 无缝兼容 |
| Neo4j Community | 未引入/嵌入/分发；依大纲只可考虑外部独立服务，本次不需要 |
| NebulaGraph | 服务端路线，未部署，不作为当前单机验证首选 |
| ArangoDB | 未引入；官方 devel/LICENSE 为 BSL 1.1，不能直接沿用大纲 Apache-2.0 表述 |

2026-10-13 从 GitHub 官方 API 读取的维护状态：

- `kuzudb/kuzu`：archived=true，最后推送 2025-10-10，HEAD `89f0263cc7a1fd9c396d2c4953747a013556a7f9`。
- `LadybugDB/ladybug`：archived=false，最后推送 2026-10-13；读取时 HEAD `cf236ad5d20d57555d6f85f618c9360b41d65ec2`，提交时间 2026-10-12T19:03:12Z。活跃不等于已通过本项目兼容验收。

依据：[Kùzu 归档公告](https://github.com/kuzudb/kuzu)、[0.11.3 发布](https://github.com/kuzudb/kuzu/releases/tag/v0.11.3)、[Kùzu MIT](https://github.com/kuzudb/kuzu/blob/v0.11.3/LICENSE)、[Ladybug 官方仓库](https://github.com/LadybugDB/ladybug)、[ArangoDB 当前 LICENSE](https://github.com/arangodb/arangodb/blob/devel/LICENSE)。

npm 元数据中未发现 GPL/AGPL/LGPL；Lightning CSS 的 MPL-2.0 仅为构建工具。预编译原生绑定完整分发义务未验收，详见 THIRD_PARTY_NOTICES.md。

## 阻塞

| 阻塞 | 影响 | 后续动作 |
|---|---|---|
| 缺 Rust/Cargo、MSVC C++ Build Tools、Windows SDK | 无法编译/运行 Tauri 壳，未生成 Cargo.lock；原生窗口权限未验 | 安装官方依赖后运行 npm run desktop，验证多窗口与退出 |
| Node/Kùzu sidecar 发行打包未验证 | 桌面目前仅开发态，依赖本机 Node 和源码 | 原生构建后验证自包含运行时、绑定加载、第三方声明、安装包；目前 bundle 关闭，release 入口明确拒绝启动 |
| 已确认可配置多家云端 API，但适配器和首次实测的模型、接口地址、API Key 未配置 | 真实抽取链路、质量、速度、成本未验 | 按 DeepSeek、OpenAI/GPT、Google Gemini、MiMo 等可配置方向开发，不固定供应商；自动抽取仍默认关闭，当前仅用测试夹具 |

环境要求依据：[Tauri 官方 Windows prerequisites](https://v2.tauri.app/start/prerequisites/)。本次未全局安装大型 SDK，也未空等。

## 范围边界

用户后续确认：主仓库采用 Apache-2.0，已从 Apache 官方取得完整 LICENSE，并同步 package.json、package-lock.json、Cargo.toml 的协议标识。第三方组件继续遵守各自许可证。云端 API 采用可配置多供应商方向，不擅自指定默认厂商/模型；目前只记录设计决策，尚未实现或实测供应商适配器。

未实现完整 MCP Server、全部 CRUD、抽取设置页、回收站、图可视化、路径/多跳查询、导入导出、搜索、Tag/File/Person/Task 工作流；按后续阶段推进。候选池的数据库视图、GraphRAG 问答、协作和移动端完全未实现。编辑器内容块不创建图节点。

## Git 与复现

已初始化 main 仓库；按产品基线、实现、验证记录分组提交，见 `git log --oneline`。自动化提交使用 `Codex <codex@local.invalid>`，未改用户全局 Git 配置，无远端、未推送。

当前机器运行 `node scripts/dev.mjs` 后打开 <http://127.0.0.1:1420>。标准环境用 `npm ci`、`npm run dev`。详细步骤和接口范围见 README.md。

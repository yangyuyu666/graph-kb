# 开发指南

[← 返回 README](../README.md) · [API 参考](API.md) · [MCP 使用指南](../server/mcp-guide.md)

## 环境与运行

当前验证平台为 Windows x64。前端与本地服务需要 Node.js 24+ 和 npm；版本以 [package.json](../package.json) 和锁文件为准。

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:1420`。开发启动器同时管理 Vite 和本地 API，默认数据位于 `.graph-kb/dev/`。不要同时运行多个使用同一图库目录的服务。

桌面开发还需要 Rust MSVC 工具链、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

```powershell
npm run desktop
```

桌面脚本会准备随包运行时，再启动 Tauri。首次准备运行时需要网络获取许可证文本；普通用户安装成品后不需要 Node 或 Rust。

## 构建

```powershell
# 类型检查与前端产物
npm run build

# Windows 桌面安装包
npm run desktop:build
```

安装包位于 `src-tauri/target/release/bundle/nsis/`。当前版本为 `Graph KB_0.2.6_x64-setup.exe`，未签名。`dist/` 仅为前端产物，不能替代完整桌面应用。

打包会包含 Node.js、Kùzu、本地服务、MCP 手册和第三方许可证。不要把测试库、连接文件、个人配置或云端 Key 放进资源目录。

## 验证

按修改范围选择检查；纯文档改动无需重新生成安装包。

| 命令 | 验证内容 |
| :--- | :--- |
| `npm test` | 真实磁盘图库、图约束、版本冲突、恢复、HTTP/MCP 与导入导出 |
| `npm run test:ui` | Edge 下的编辑、目录、图谱和设置交互 |
| `npm run runtime:prepare` | 准备可复制的独立运行时 |
| `npm run test:runtime` | 独立运行时的保存、重启与手册读取 |
| `npm run check:licenses` | 检查 npm 锁文件中的许可证元数据 |
| `node scripts/test-installed.mjs src-tauri/target/release/graph-kb.exe` | 使用隔离数据验证构建的原生应用 |

UI 测试需要 Microsoft Edge，并使用本机 1420 端口；运行前关闭占用该端口的开发进程。原生测试使用专用调试配置，日常应用不开放调试端口。许可证元数据检查不等同于完整法律审计。

云端协议测试使用模拟响应；它验证协议与错误处理，不代表已经验证真实供应商的抽取质量、费用或延迟。

## 重新生成 README 配图

```powershell
node scripts/capture-readme.mjs
```

脚本启动真实前端与 API，在 `.graph-kb/readme-*` 创建独立演示数据，使用无头 Edge 生成：

- `docs/images/graph.png`：图谱与控制栏。
- `docs/images/directory.png`：目录与 Markdown 编辑器。
- `docs/images/edge-detail.png`：边文字详情窗口。

脚本不读取桌面知识库；端口被占用时会停止。完成后关闭自己启动的浏览器和开发服务，演示数据库留在 Git 忽略的目录内。截图内容属于演示数据，不是用户笔记。

## 项目结构

```text
src/                         前端：目录、图谱、文档编辑器、设置
├── main.ts                  页面入口与路由
├── workspace.ts             知识库工作区
├── document-view.ts         Milkdown 编辑器
├── graph-layout.ts          图谱布局
└── directory-icons.ts       目录 SVG 图标
server/                      本地数据与接口
├── library-store.mjs        独立知识库目录与定位
├── graph-store.mjs          Kùzu 图存储
├── tools.mjs                共享操作入口
├── operations.mjs           参数与操作定义
├── http.mjs                 本机 REST API
├── mcp.mjs                  stdio MCP 入口
└── mcp-guide.md             用户和 AI 共用手册
src-tauri/                   Rust 桌面宿主与打包配置
scripts/                     开发、打包、接入与验收脚本
tests/                       后端、界面与运行时测试
docs/                        大纲、验收映射、证据与文档
```

UI、REST、MCP 共用操作边界。图数据库保存结构和元数据，Markdown 文件保存正文；写入通过版本校验和恢复日志协调。不要绕过服务直接修改 `graph.kuzu` 或正文文件。

## 数据与提交边界

桌面默认数据位于 `%LOCALAPPDATA%/local.graph-kb.phase0/`，每个库独占 `libraries/<UUID>/`。数据、附件、回收站应一起迁移，具体规则见 [MCP 使用指南](../server/mcp-guide.md)。

`.graph-kb/`、`.tools/`、`node_modules/`、构建产物和 `.env*` 已被 Git 忽略。MCP 的固定配置示例可以公开，真实 `mcp-session.json` 含运行时凭据，不能提交。

主仓库 Apache-2.0。新增依赖应核实许可证及分发要求；GPL/AGPL 组件不嵌入、不随本应用分发。待定产品决策记录在 [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md)。

# 第三方组件记录

核查日期：2026-10-13。已生成本地 Windows x64 测试安装包，未对外发布或签名。本记录说明本次携带的文本和核查边界。

| 组件 | 版本 | 许可证 / 来源 |
|---|---|---|
| Kùzu | 0.11.3 | [MIT](https://github.com/kuzudb/kuzu/blob/v0.11.3/LICENSE) |
| Node.js | 24.19.0 | [MIT 及内含第三方声明](https://github.com/nodejs/node/blob/v24.19.0/LICENSE)，完整文本随运行时保存为 NODE-LICENSE |
| Milkdown Crepe / Kit | 7.22.3 | [MIT](https://github.com/Milkdown/milkdown/blob/main/LICENSE) |
| Tauri JS API / CLI | 2.12.3 / 2.12.2 | [Apache-2.0 OR MIT](https://github.com/tauri-apps/tauri) |
| Vite | 8.3.4 | MIT，见安装包 LICENSE |
| TypeScript | 7.0.2 | Apache-2.0，见安装包 LICENSE |
| Playwright | 1.64.0 | Apache-2.0，测试依赖 |

`npm run check:licenses` 从锁文件生成 [npm 元数据清单](docs/evidence/npm-licenses.json)。本次 365 个条目（含未安装的平台可选包）没有 GPL/AGPL/LGPL 或未知项。DOMPurify 双协议采用 Apache-2.0 分支；构建工具 Lightning CSS 为 MPL-2.0，未修改源代码且当前不随产品打包，不能笼统说全部依赖都是 MIT。

Kùzu 安装包含引擎源码及第三方许可证。对 `kuzu-source/third_party` 的 LICENSE/COPYING/NOTICE 文本扫描未匹配 GNU GPL/LGPL/AGPL；例如 zstd 随包 LICENSE 使用 BSD 分支。打包脚本保留这些文本、Kùzu MIT、Node 完整声明，以及 292 项已安装非 dev npm 依赖的许可证/含完整许可段落的 README（含构建链的保守超集）。这不等同于预编译二进制链接内容的完整审计。

Windows Cargo 解析的 242 项第三方依赖（含构建依赖）记录在 [Rust 清单](docs/evidence/rust-licenses.json)，没有 GPL/AGPL/LGPL/未知许可证。MPL-2.0 项包括 cssparser、cssparser-macros、dtoa-short、option-ext、selectors；未修改这些库，包中保留完整许可证，并附带本次 crate 源码。不要将整个桌面依赖树称为“全 MIT”。

安装包内 `resources/runtime/licenses/` 包含 npm、Rust 和 Kùzu 第三方声明。部分上游包漏带 LICENSE，按该版本的 gitHead / .cargo_vcs_info.json 从官方仓库固定提交补齐，存放于 `licenses/vendor/`；来源见 [SOURCES.json](licenses/vendor/SOURCES.json)。selectors 源码明确引用 MPL-2.0，补入标准许可文本。打包时缺少已登记的许可文本会失败。

尚未做干净 Windows 虚拟机验收和预编译原生绑定完整 SBOM 审计；当前产物用于本地 Phase 0 验证，公开发行前仍需复核二进制与声明覆盖。

未引入 Neo4j、Logseq、AFFiNE 实现代码或二进制。未来 GPL/AGPL 组件只可作为外部独立进程调用，不嵌入或随本应用分发。

overrides 将旧构建链的 tar 固定为 7.5.22、KaTeX 固定为 0.19.0，消除了本次 npm 审计已知告警。已验证 Windows x64 Kùzu 预编译绑定；其他平台与从源码编译未验证，不能推断 overrides 全平台兼容。

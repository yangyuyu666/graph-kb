# 第三方组件记录

核查日期：2026-10-13，当前没有发布安装包。本记录不替代未来发行包必须携带的完整许可证文本与原生依赖清单。

| 组件 | 版本 | 许可证 / 来源 |
|---|---|---|
| Kùzu | 0.11.3 | [MIT](https://github.com/kuzudb/kuzu/blob/v0.11.3/LICENSE) |
| Milkdown Crepe / Kit | 7.22.3 | [MIT](https://github.com/Milkdown/milkdown/blob/main/LICENSE) |
| Tauri JS API / CLI | 2.12.3 / 2.12.2 | [Apache-2.0 OR MIT](https://github.com/tauri-apps/tauri) |
| Vite | 8.3.4 | MIT，见安装包 LICENSE |
| TypeScript | 7.0.2 | Apache-2.0，见安装包 LICENSE |
| Playwright | 1.64.0 | Apache-2.0，测试依赖 |

`npm run check:licenses` 从锁文件生成 [npm 元数据清单](docs/evidence/npm-licenses.json)。本次 365 个条目（含未安装的平台可选包）没有 GPL/AGPL/LGPL 或未知项。DOMPurify 双协议采用 Apache-2.0 分支；构建工具 Lightning CSS 为 MPL-2.0，未修改源代码且当前不随产品打包，不能笼统说全部依赖都是 MIT。

Kùzu 安装包含引擎源码及第三方许可证。对 `kuzu-source/third_party` 的 LICENSE/COPYING/NOTICE 文本扫描未匹配 GNU GPL/LGPL/AGPL；例如 zstd 随包 LICENSE 使用 BSD 分支。这不等同于预编译二进制链接内容的完整审计。发行前须保留引擎、原生依赖、Node 及 Tauri 所需许可证和声明，当前未完成发行核查。

未引入 Neo4j、Logseq、AFFiNE 实现代码或二进制。未来 GPL/AGPL 组件只可作为外部独立进程调用，不嵌入或随本应用分发。

overrides 将旧构建链的 tar 固定为 7.5.22、KaTeX 固定为 0.19.0，消除了本次 npm 审计已知告警。已验证 Windows x64 Kùzu 预编译绑定；其他平台与从源码编译未验证，不能推断 overrides 全平台兼容。

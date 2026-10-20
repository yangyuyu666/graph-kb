# API 参考

[← 返回 README](../README.md) · [开发指南](DEVELOPMENT.md) · [MCP 使用指南](../server/mcp-guide.md)

本文对应 0.2.6。REST 和 MCP 调用同一操作层；参数 schema 见 [mcp.mjs](../server/mcp.mjs) 或 MCP `tools/list` 返回值，业务校验见 [operations.mjs](../server/operations.mjs) 与 [library-store.mjs](../server/library-store.mjs)。

## 连接与认证

桌面应用启动后，本地 HTTP 服务仅监听 `127.0.0.1` 的动态端口，使用当前会话的 Bearer token。端口与凭据写入应用数据目录内的 `mcp-session.json`，重启后可能变化。

MCP 客户端应使用 README 中的**固定 stdio 配置**，不需要手工复制端口或 token。MCP 在每次业务调用时读取连接文件，应用最小化时可正常使用，退出应用后业务接口不可用。

PowerShell 只读查询示例：

```powershell
$connectionPath = Join-Path $env:LOCALAPPDATA 'local.graph-kb.phase0/mcp-session.json'
$connection = Get-Content -LiteralPath $connectionPath -Raw | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($connection.token)" }
Invoke-RestMethod -Uri "$($connection.url)/api/kbs" -Headers $headers
```

自定义数据目录时替换文件路径。不要打印、分享或提交连接文件。这里的本机会话 token 与云端模型 API Key 无关。

POST/PATCH 使用 `Content-Type: application/json`，请求体必须为 JSON 对象，HTTP 请求体上限为 32 MiB。接口不提供原始 Cypher 执行入口。

## 路由

路径中的 ID 必须来自实际查询结果。边 ID 放入 URL 前需用 `encodeURIComponent` 编码。

| 方法 | 路径 | 功能 / 对应工具 |
| :--- | :--- | :--- |
| GET / POST | `/api/kbs` | `list_kbs` / `create_kb` |
| GET / PATCH / DELETE | `/api/kbs/{id}` | `get_kb` / `rename_kb` / `delete_kb` |
| GET | `/api/kbs/{id}/nodes` | `list_nodes` |
| GET | `/api/kbs/{id}/graph` | `get_graph`，支持中心、范围和筛选 |
| POST | `/api/kbs/{id}/import`、`/export` | `import_kb` / `export_kb`，文档级交换 |
| POST | `/api/databases/{id}/export` | `export_database`，整库备份 |
| POST | `/api/databases/import` | `import_database`，恢复或副本导入 |
| POST | `/api/nodes` | `create_node` |
| GET / PATCH / DELETE | `/api/nodes/{id}` | 读取、修改、删除节点 |
| GET | `/api/nodes/{id}/neighbors` | `query_neighbors`，1–3 跳 |
| GET | `/api/nodes/{id}/backlinks`、`/related` | 反向链接 / 共享概念关联 |
| POST | `/api/edges` | `create_edge` |
| GET / PATCH / DELETE | `/api/edges/{id}` | `get_edge` / `update_edge` / `delete_edge` |
| GET | `/api/search` | `search`，使用查询参数 |
| GET | `/api/path` | `query_path`，无向最短路径 |
| GET | `/api/trash` | `list_trash` |
| POST | `/api/trash/{id}/restore` | `restore`，按删除批次恢复 |
| POST / GET | `/api/assets` / `/api/assets/{id}` | `upload_asset` / `get_asset` |
| GET / PATCH | `/api/settings` | 读取 / 修改云端设置 |
| GET | `/api/connection` | 当前连接信息，需要认证；含敏感凭据 |
| POST | `/api/tools` | 按工具名调用共享操作 |

`/api/tools` 请求结构：

```json
{
  "name": "get_graph",
  "arguments": {
    "kbId": "<实际知识库 UUID>",
    "center": "<实际节点 UUID>",
    "scope": "descendants"
  }
}
```

尖括号内容是占位符，不能直接发送。该入口也可调用没有独立 REST 路由的操作，例如链接解析或概念合并；完整清单由 MCP 工具发现提供。

## 节点与正文

创建节点时指定 `kbId`、`title`，可选 `parentId`、`kind`、`properties`。在某节点下创建必须传 `parentId`，省略则为顶级节点。可见类型为 `Page`、`Tag`、`File`、`Person`、`Task`。

创建只产生空正文。保存 Markdown 前读取 `get_node`，使用返回的 `revision`：

```json
{
  "revision": 4,
  "markdown": "# 更新后的标题\n\n这是完整正文。\n"
}
```

上例提交给 `PATCH /api/nodes/{id}`，MCP 等价操作为 `update_doc({id, revision, markdown})`。Markdown 是完整替换，不是追加。成功后使用返回的新版本。

修改标题或扩展属性另行 PATCH：

```json
{
  "revision": 5,
  "title": "实验记录",
  "properties": {
    "status": "draft",
    "tags": ["research"],
    "source": {"url": "https://example.com"}
  }
}
```

对应 MCP `update_node`。至少提交 `title` 或 `properties` 之一；正文不能与这两项在同一个 PATCH 中混合。

版本不一致返回 HTTP 409 / `REVISION_CONFLICT`。先重新读取并合并，再提交；不要猜测下一个版本。保存结果 `extraction: "failed"` 仍表示正文已保存，仅云端抽取失败，不能盲目重复写入。

## 关系与扩展属性

- `CHILD_OF`：`source` 是子节点，`target` 是父节点。允许多父，禁止自环、跨库和从属环。
- `SIBLING_OF`：同库顶级节点间的平行关系，自动维护，端点按 UUID 规范化。
- 边 ID 形如 `TYPE:sourceUUID:targetUUID`。优先使用返回值，不自行拼接或把节点 ID 当作边 ID。
- `label` 最多 200 字符，可换行；画布显示第一行，点击显示完整内容。空字符串清除标签。
- 边的 `label`、`properties` 修改不使用节点 `revision`，以最后一次成功写入为准。

节点和边的 `properties` 均是 JSON 对象，默认 `{}`，可嵌套，最多 16 层、UTF-8 编码 64 KiB。**提交即整体替换**：省略保留，`{}` 清空；不是局部合并。

扩展属性目前不参与全文搜索、自动推理，也没有界面属性编辑器。整库备份、JSON 交换和回收站恢复会保留它们。属性中的任意字符串不被解释为节点引用，副本导入不会自动重写其中的 ID。

## 图谱范围

`get_graph` 返回可见节点和关系，默认隐藏后台 `Concept`。

| 参数 | 说明 |
| :--- | :--- |
| `kbId` | 必填，目标知识库 |
| `center` | 可选中心节点；递归后代模式必填 |
| `scope: "neighbors"` | 默认模式；有中心时按 1–3 跳双向邻域查询 |
| `scope: "descendants"` | 中心及全部递归后代，不受 hops 限制 |
| `hops` | 邻域深度，1–3 |
| `kind`、`q`、`edgeType` | 类型、标题/正文和关系筛选 |

递归后代只沿父→子遍历 `CHILD_OF`，共享后代去重，不带入外部父节点、祖先或兄弟，不沿平行边扩展。先确定范围，再应用筛选，因此筛选可能隐藏中心或中间节点；需要完整分支时不要附加筛选。

`query_neighbors` 可包含 Concept，结果不提供足够方向信息来直接判断父子。`query_path` 按无向路径查找，返回的边仍保留真实方向。

## 删除、引用与迁移

删除节点使用 `DELETE /api/nodes/{id}?mode=single` 或 `mode=cascade`，MCP 为 `delete_node({id,mode})`。前者只删当前节点；后者删除独占后代，保留有外部父节点的共享分支。删除返回批次 ID，恢复使用该批次 ID，保留期为 30 天。

跨库链接格式为 `[标题](node:知识库UUID/节点UUID)`，旧裸节点 UUID 链接仍兼容。跨库引用不等于跨库结构边。未导入目标库时保留链接，可在目标库可用后重新解析。

整库 `export_database` 生成 `graph-kb-database` 版本 1 备份，区别于文档级 JSON 的 `graph-kb` 版本 1：

- `import_database` 使用 `{data, mode}`，其中 `data` 是解析后的备份对象；省略 `mode` 默认为 `"restore"`。整库文件上限为 24 MiB。
- `mode: "restore"` 保留 ID，拒绝覆盖同 ID 库或冲突数据。
- `mode: "copy"` 生成新 ID，重写内部正文引用与附件链接；外部引用保持原目标，任意属性字符串不改写。
- 备份包含文档、结构、附件、属性和回收站，不含模型 Key 或 MCP 会话配置。

## 错误格式

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "错误说明",
    "suggestion": "建议处理方式"
  }
}
```

REST 使用相应 HTTP 状态码，例如 401 未认证、409 版本冲突、410 节点已删除。MCP 工具失败应同时检查 `isError` 与返回内容；请求正常到达 MCP 进程不代表业务操作成功。

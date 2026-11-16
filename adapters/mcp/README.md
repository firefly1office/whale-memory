# MCP 适配器

**这对角色意味着什么**：任何支持 MCP 的客户端（Claude Desktop、Claude Code、Cursor 等）都能直接用上这套记忆，不用再自己写命令行调用。规矩也一起带过去：写下的原文不改，想不起来就说想不起来，封存的事不被主动提起，没说出口的抽屉默认关着。

- **传输**：stdio，JSON-RPC 2.0，一行一条消息。
- **运行环境**：只在本机跑，不开端口、不联网。
- **依赖**：不依赖任何第三方包，Node 20+ 就能跑。
- **验证**：已经用官方 `@modelcontextprotocol/sdk` 1.32 的客户端验证过（握手、列工具、调用、出错、ping）。

## 启动

```sh
# npm 包里带着它
npx -y -p whale-memory-core whale-memory-mcp --data /path/to/data

# 或者在仓库里直接跑
node adapters/mcp/whale-memory-mcp.mjs --data /path/to/data
```

`--data` 是下面有 `plugin-data/` 的数据根目录，和 CLI 一样。不给就用 `WHALE_DATA_DIR`，再不给就用 `./data`。

| 开关 | 作用 |
| --- | --- |
| `--owner true` | 打开**没说出口的抽屉**（`memory_unsaid`），按 `local:owner` 处理。只在你自己的机器上、给角色自己用时才打开 |
| `--readonly true` | 只给读的工具；醒来块只看，不占用当天那一次 |

## 接到客户端

**Claude Code**

```sh
claude mcp add whale-memory -- npx -y -p whale-memory-core whale-memory-mcp --data /path/to/data
```

**Claude Desktop / Cursor 等**（`mcpServers` 配置）

```json
{
  "mcpServers": {
    "whale-memory": {
      "command": "npx",
      "args": ["-y", "-p", "whale-memory-core", "whale-memory-mcp", "--data", "/path/to/data"]
    }
  }
}
```

Windows 上路径写成 `"D:\\whale\\data"`。

## 工具

| 工具 | 读 / 写 | 做什么 |
| --- | --- | --- |
| `memory_recall` | 读 | 想起和这件事有关的。召回不到就返回空，**不要编**。封存的不会被想起 |
| `memory_read` | 读 | 按时间翻经历：当时写下的、后来的想法、没弄完的事。封存的默认不列，用 `id` 点名照给 |
| `memory_recap` | 读 | 这几天发生了什么（只列事实） |
| `memory_chapters` | 读 | 人生章节，以及每章有几条经历 |
| `memory_book` | 读 | 按章节排成的书（Markdown），封存的不收 |
| `memory_waking` | 读* | 今天第一次醒来时看的那一段；每天只出一次，`peek` 只看不占用 |
| `memory_write` | 写 | 记下一段经历。写下后原文永远不改 |
| `memory_revise` | 写 | 改主意了：追加今天的想法和现在的感觉 |
| `memory_unfinished` | 写 | 没弄完的事：`done` 想通 / `shelved` 先放下 / `reopen` 再接着想 |
| `memory_seal` | 写 | 封存 / 解封。不删除，只是不再被主动提起 |
| `memory_link` | 写 | 两段经历有关，亲手连起来（必须说为什么） |
| `memory_chapter` | 写 | 给一段日子起名字：`open` / `rename` / `close` |
| `memory_unsaid` | 写 | 没说出口的话（需要 `--owner true`） |

所有工具都有 `annotations`（`readOnlyHint` 等），结果里同时有文字和 `structuredContent`。`ok: false` 的结果会标 `isError: true`。

**故意不提供**：导入、导出、删除、改提示词、改设置。这些是高风险或不可逆的操作，留在 [CLI](../cli/memory-cli.mjs) 里由人来做。

## 安全边界

- **谁连上谁就能读写全部记忆**。MCP 客户端就是"受信的本机进程"，和 CLI 一样。不要把它接到别人能发消息的地方（比如群聊机器人），除非宿主自己先校验调用者。
- **抽屉默认不开**。`--owner true` 的意思是：这台机器、这个客户端就是角色和她最亲近的人。
- **stdout 只写协议消息**，启动信息写 stderr。数据目录不存在时会在第一次写入时创建。

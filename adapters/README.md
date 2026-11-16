# 适配层

目标是让非 QQ Agent 的宿主也能用这套记忆。两条路：

## 1. CLI（推荐，任何宿主都能用）

```
adapters/cli/memory-cli.mjs
```

任何能执行命令的 agent（DSH、自建、别的框架）都能调用，输出 JSON。
示例与命令表见 [`dsh/SKILL.md`](dsh/SKILL.md)。

```bash
export WHALE_DATA_DIR=/path/to/data
node adapters/cli/memory-cli.mjs write --text "..." --feeling "轻松" --weight important
node adapters/cli/memory-cli.mjs recall --query "那本书里那个人" --limit 2
node adapters/cli/memory-cli.mjs waking --chat "local:owner"
node adapters/cli/memory-cli.mjs unfinished --id exp_xxx --state done
node adapters/cli/memory-cli.mjs revise --id exp_xxx --thought "现在想起来没那么难过了" --feeling "释然"
node adapters/cli/memory-cli.mjs write --text "我好像总在等别人先开口" --kind 回想 --refs exp_aaa,exp_bbb
node adapters/cli/memory-cli.mjs read --id exp_xxx --as-of 2026-11-15
node adapters/cli/memory-cli.mjs export --out D:\备份
```

也可以每条命令带 `--data /path/to/data`，优先于环境变量。`/path/to/data` 是下面有 `plugin-data/` 的数据根目录。

输出是 UTF-8 的 JSON。宿主用 Node / Python 调用时按 UTF-8 解码即可；在 **Windows PowerShell 5.1** 里把输出接到 `ConvertFrom-Json` 之前，先执行一次 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`，否则中文会被当成本地代码页解码，JSON 解析失败（数据本身没坏）。

## 2. 直接 import（有 JS 运行时的宿主）

```js
import * as exp from './packages/core/lib/self-experience.js'
```

适合你在自己的 agent 里已经有工具注册与提示词拼接，只缺记忆内核。
完整契约见 [`../docs/porting.md`](../docs/porting.md)。

## 还没有的适配

- LangChain / LlamaIndex 的 Memory 接口
- OpenAI Assistants 的 memory tool
- MCP server（如果要做，CLI 已经是现成的底座）

需要哪个，提 issue。做适配时不需要改内核，CLI 的命令表就是接口。

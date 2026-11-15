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
```

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

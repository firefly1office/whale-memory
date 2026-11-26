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

## 2. MCP（支持 MCP 的客户端：Claude Desktop、Claude Code、Cursor…）

```
npx -y -p whale-memory-core whale-memory-mcp --data /path/to/data
```

stdio、只在本机、零依赖。抽屉默认不开（`--owner true` 才开），`--readonly true` 只给读的工具；导入、导出、删除、改提示词这些留在 CLI。配置写法和工具表见 [`mcp/README.md`](mcp/README.md)。

## 3. 直接 import（有 JS 运行时的宿主）

```js
import * as exp from './packages/core/lib/self-experience.js'
```

适合你在自己的 agent 里已经有工具注册与提示词拼接，只缺记忆内核。
完整契约见 [`../docs/archive/porting.md`](../docs/archive/porting.md)。

## 4. Python（零第三方依赖的单文件封装）

```
adapters/python/whale_memory.py
adapters/python/smoke.py
```

`whale_memory.WhaleMemory(数据根)` 把每个动作转成一次 `node adapters/cli/memory-cli.mjs ...` 子进程，
结果解析成 dict；只用 CPython 标准库。自查：`python adapters/python/smoke.py`。

```python
from whale_memory import WhaleMemory
mem = WhaleMemory('/path/to/data')          # 库在 <数据根>/plugin-data/biomimetic-memory
made = mem.write('今天把柜子修好了', weight='important')
hits = mem.recall('柜子', limit=3)
mem.seal(made['id'], note='先不提这件事')
```

## 还没有的适配

- LangChain / LlamaIndex 的 Memory 接口
- OpenAI Assistants 的 memory tool

需要哪个，提 issue。做适配时不需要改内核，CLI 的命令表就是接口。

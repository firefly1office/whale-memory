# SKILL: whale-memory（她自己的记忆）

给 DSH 或其他能执行命令的 agent 用。不需要 QQ Agent，不需要插件 API。

## 安装

1. 把整个 `whale-memory` 仓库放到你的工作目录（或子目录）
2. 设一个数据目录：

```sh
export WHALE_DATA_DIR=/path/to/data
```

Windows PowerShell：

```powershell
$env:WHALE_DATA_DIR = "$env:LOCALAPPDATA/whale-memory-demo"
```

3. 所有命令都通过：

```bash
node adapters/cli/memory-cli.mjs <命令> [参数]
```

输出是 JSON，直接读 stdout。

## 什么时候用它

| 场景 | 命令 |
|---|---|
| 她做了一件事/读到什么/有了想法，想留下 | `write` |
| 想不起某件事，先翻自己的记录 | `recall --query "..."` |
| 列出最近的经历 | `read --limit 8` |
| 想法变了，改主意（旧的不删） | `revise --id ... --thought "..."` |
| 再想起时感觉变了（当时的感觉不改） | `revise --id ... --thought "..." --feeling "释然"` |
| 回想、归纳，写明是从哪几件事想到的 | `write --text "..." --kind 回想 --refs id1,id2` |
| 被问"你那时怎么想" | `read --id ... --as-of 2026-11-15` |
| 那件没弄完的事想通了 / 先放下 / 又接着想 | `unfinished --id ... --state done\|shelved\|reopen` |
| 她不想再被某件事提醒（不删除，可解封） | `seal --id ...` / `unseal --id ...` |
| 想写回想前，先看看这几天的事实 | `recap --days 7` |
| 每天第一次醒来，给昨天的自己一条线 | `waking --chat "local:owner"` |
| 被问到自己、想带上自己的经历 | `memory --query "..." [--diary true]` |
| 她想改自己的说话方式 | `prompt set --text "..." --reason "..."` |
| 她想改自己的节奏/上限 | `settings set --json '{"readingPerDay":60}'` |

## 硬规则（别省）

1. **没记录就说没有**。`recall` 返回空就是空，不要顺着编。
2. **`--diary true` 只在跟主人一对一私聊时用**；群聊、别人的会话不许带日记。
3. **别人的私事不跨会话**：只跨她自己（`self`）和主人。
4. **改主意用 `revise`**，不要覆盖"当时"的记录。
5. 主动发消息、改提示词、改设置，都是"她想不想"的事，不是流程要求。
6. **感觉变了由她自己说**（`--feeling`），不要替她写"应该已经不难过了"。
7. **回想要带出处**（`--refs`）；说不出是从哪几件事想到的归纳，不要写。
8. **问"那时"就翻那时**（`read --as-of`），不要拿后来才明白的事冒充当时就知道。
9. **封存是她的选择**：只有她自己说不想再被提醒时才 `seal`；别人不能替她封存，也不要用 `--sealed true` 把她封存的事翻给别人看。

## 每天该做的三件事

```bash
# 1) 每天第一次唤醒
node adapters/cli/memory-cli.mjs waking --chat "local:owner"

# 2) 她自己的时间（没有任务、不等回复）
#    提示语里只说：这段时间是你的，做什么都行，记不记也随你
#    她想记就调用 write

# 3) 睡前
node adapters/cli/memory-cli.mjs prompt history   # 想回看自己改过什么
```

## 示例：一次完整交互

```bash
# 她说今天读了书，但有件事不舒服
node adapters/cli/memory-cli.mjs write \
  --text "读到社办门口那段，有点替他难受" \
  --scene "晚上十一点，屋里很静" \
  --feeling "闷,有点酸" \
  --thought "再不说就真的没牵扯了" \
  --unfinished "想知道他们后面有没有说开" \
  --quote "我也很开心" --source "《败北女角太多了》第3章" \
  --weight important --kind 读书

# 第二天被问"你最近在读什么"
node adapters/cli/memory-cli.mjs recall --query "你最近在读什么" --limit 2

# 她改主意
node adapters/cli/memory-cli.mjs revise --id exp_xxx --thought "现在觉得那样也挺好"
```

## 移植与设计说明

- [docs/porting.md](../../docs/porting.md)：宿主契约、模块通用性、隐私规则
- [packages/core/README.md](../../packages/core/README.md)：内核库与 `demo.mjs`

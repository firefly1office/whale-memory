---
name: whale-memory
description: 她自己的记忆。用 CLI 记录/回想她自己的经历（scene、feeling、thought、quote、later），带隐私边界；不依赖插件 API。
---

# whale-memory

这个 skill 给「角色自己」用，不是给用户画像用。

## 命令位置

本 skill 目录下的脚本：

```bash
node <skill目录>/scripts/memory-cli.mjs <命令> [参数]
```

数据目录用 `--data <目录>` 或环境变量 `WHALE_DATA_DIR` 指定（`--data` 优先）；都不给就用当前目录下的 `data/`。

## 命令

```bash
# 写下一条自己的经历（重要的写细；不重要的可只写 text）
node scripts/memory-cli.mjs write \
  --text "读到社办门口那段，有点替他难受" \
  --scene "晚上十一点，屋里很静" \
  --feeling "闷,有点酸" \
  --thought "再不说就真的没牵扯了" \
  --unfinished "想知道他们后面有没有说开" \
  --quote "我也很开心" --source "《败北女角太多了》第3章" \
  --weight important --kind 读书

# 想起来（返回「当时/现在」两段）
node scripts/memory-cli.mjs recall --query "那本书里那个人后来怎样" --limit 1

# 先体检（写入/读回/导出导入/白名单）
node scripts/memory-cli.mjs doctor

# 列最近的经历
node scripts/memory-cli.mjs read --limit 8

# 改主意：旧的留在原位，只加 later
node scripts/memory-cli.mjs revise --id exp_xxx --thought "现在觉得那样也挺好"

# 那件没弄完的事后来怎么样了：
#   done=想通了，shelved=先放下，reopen=又决定接着想
# 只改这一条经历的状态，不改当时的正文，也不冒充后记
node scripts/memory-cli.mjs unfinished --id exp_xxx --state done

# 每天第一次醒来
node scripts/memory-cli.mjs waking --chat "local:owner"

# 被问到自己时，带上自己的经历（日记只在跟主人一对一私聊时加 --diary true）
node scripts/memory-cli.mjs memory --query "你最近在做什么" --diary true
```

她还拥有：

```bash
node scripts/memory-cli.mjs prompt get|set --text "..."|history|revert --version ...
node scripts/memory-cli.mjs settings get|set --json '{"readingPerDay":60}'
```

## 硬规则

1. 没记录就说没有；`recall` 返回空就是空，不要顺着编
2. `--diary true` 只在一对一私聊用；群聊和别人的会话不许带
3. 别人的私事不跨会话；只有她自己的经历和主人相关的内容可以跨
4. 改主意用 `revise`，不要覆盖"当时"
5. 那件事想通、先放下、又接着想，用 `unfinished --state`，不要写成后记
6. 主动发消息、改提示词、改设置，都是"她想不想"的事

## 一句话用法

被问到"你自己"的时候先 `memory` 或 `recall`；她做了值得留的事时 `write`；第二天第一次醒来 `waking`。

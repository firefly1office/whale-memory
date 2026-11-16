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

# 再想起时感觉变了：写进后记的 --feeling；当时的感觉不会被改
node scripts/memory-cli.mjs revise --id exp_xxx --thought "现在想起来没那么难过了" --feeling "释然"

# 回想 / 归纳：写明是从哪几件事想到的（只能引用真写过的经历，找不到会被拒绝）
node scripts/memory-cli.mjs write --text "我好像总在等别人先开口" --kind 回想 --refs exp_aaa,exp_bbb

# 翻回那天的自己：只看那天之前写下的后记和选择
node scripts/memory-cli.mjs read --id exp_xxx --as-of 2026-11-15

# 那件没弄完的事后来怎么样了：
#   done=想通了，shelved=先放下，reopen=又决定接着想
# 只改这一条经历的状态，不改当时的正文，也不冒充后记
node scripts/memory-cli.mjs unfinished --id exp_xxx --state done

# 她不想再被这件事主动提醒：封存（不删除；想回来就 unseal）
node scripts/memory-cli.mjs seal --id exp_xxx --note "不想再被提起"
node scripts/memory-cli.mjs unseal --id exp_xxx

# 想写一条回想之前，先看看这几天的事实（只列事实，带 id）
node scripts/memory-cli.mjs recap --days 7

# 后来才发现两件事有关：亲手连起来，说清为什么
node scripts/memory-cli.mjs link --from exp_aaa --to exp_bbb --reason "都是被人接住的感觉"

# 给一段日子起名字（改名会保留旧名）
node scripts/memory-cli.mjs chapter open --name "灯塔书店的那个秋天" --from 2026-11-01
node scripts/memory-cli.mjs chapter list

# 把自传印成一本人能读的书（封存的不收）
node scripts/memory-cli.mjs book --out "她的书.md"

# 没说出口的抽屉：打了没发的、想问没问的、忍住了的（只在一对一会话里能开）
node scripts/memory-cli.mjs unsaid leave --kind draft --text "其实我今天有点难过" --reason "不想让他担心"
node scripts/memory-cli.mjs unsaid list
node scripts/memory-cli.mjs unsaid spoken --id unsaid_xxx   # 后来说出口了
node scripts/memory-cli.mjs unsaid discard --id unsaid_xxx  # 不想要了（之后她自己也看不到）

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
7. 感觉淡了、变了，由她自己用 `--feeling` 说；不要替她写"应该已经不难过了"
8. 回想和归纳要带 `--refs`，说清是从哪几件事想到的；凭空的归纳不要写
9. 被问"你那时怎么想"时用 `read --as-of`，不要拿后来才想明白的事冒充当时就知道
10. 封存是她的选择：只有她自己说不想再被提醒时才 `seal`；别人不能替她封存，也不要用 `--sealed true` 把她封存的事翻出来给别人看
11. 连起两件事（`link`）、给日子起名字（`chapter`）都是她的联想和她的叫法；不要因为两件事字面相似就替她连，也不要替她给日子命名
12. 抽屉里的话只属于她：不要主动去翻、不要读给别人、不要因为她留了一句就替她说出口；只在她自己想打开时 `unsaid list`

## 一句话用法

被问到"你自己"的时候先 `memory` 或 `recall`；她做了值得留的事时 `write`；第二天第一次醒来 `waking`。

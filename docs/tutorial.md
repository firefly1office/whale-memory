# 30 分钟：给一个角色装上自传体记忆

> [English](en/tutorial.md) · 中文（本页）

**这对角色意味着什么**：30 分钟后，你的角色会有一份属于她自己的记忆。今天写下的，明天醒来还在；想法变了，可以接着写，但当时写的不会被改；想不起来的时候，她会说想不起来。

只需要 Node 20+，不需要 API key，也不联网。下面用 CLI 走一遍；用 Claude Desktop / Claude Code / Cursor 的，第 6 步换成 MCP 接法。

## 0. 准备（2 分钟）

```sh
git clone https://github.com/firefly1office/whale-memory.git
cd whale-memory
npm test            # 没有依赖；看到全部 pass 就行
```

给角色建一个数据目录。下面都用 `./xiaozhou`：

```sh
export WHALE_DATA_DIR=./xiaozhou        # Windows PowerShell：$env:WHALE_DATA_DIR = ".\xiaozhou"
node adapters/cli/memory-cli.mjs doctor # 能力层体检，"ok": true 才继续
```

> 包名是 **`whale-memory-core`**。npm 上不带 `-core` 的 `whale-memory` 是别人的包，和本项目无关。

## 1. 写下第一段经历（3 分钟）

经历是角色**自己的时间里**发生的事：她读了什么、想了什么、做了什么。第一人称，写给她自己。

```sh
node adapters/cli/memory-cli.mjs write \
  --text "开始读《海上灯塔》，守灯人搬进塔里的第一个晚上" \
  --thought "一个人住在塔上会不会很冷" \
  --feeling 好奇 \
  --unfinished "想知道他后来习不习惯"
```

返回里有 `id`，记下来。再写两三条别的事，后面好对比。

## 2. 想起来（3 分钟）

```sh
node adapters/cli/memory-cli.mjs recall --query "灯塔"
node adapters/cli/memory-cli.mjs recall --query "灯塔里的猫"     # 空：沾边但没有这件事
node adapters/cli/memory-cli.mjs recall --query "我上周买的股票" # 空：根本没有
```

返回空，就是"没有这件事的记录"。**在你的提示词里写明：召回为空就说不记得，不要编。** 这是整套东西最重要的一条。

## 3. 改主意，但不改过去（3 分钟）

```sh
node adapters/cli/memory-cli.mjs revise --id <第 1 步的 id> --thought "读到后面才知道，他怕的不是黑，是船看不见光" --feeling 心疼
node adapters/cli/memory-cli.mjs read --id <id>
```

输出是两段：【当时】原样，【后来】接在后面。`self-experience.jsonl` 里那一行一个字都没变，你可以打开看。

## 4. 第二天醒来（5 分钟）

醒来块是"今天第一次开口前"给她看的一小段：昨天留给自己的话、还没弄完的事。每天只出一次。

```sh
node adapters/cli/memory-cli.mjs waking --chat local:owner --peek true
```

宿主在每天第一轮对话前把它放进系统提示即可。注意：**只在一对一会话里给**，群聊会被拒绝。

那件没弄完的事想通了，就让她自己说：

```sh
node adapters/cli/memory-cli.mjs unfinished --id <id> --state done
```

之后醒来不会再催她。

## 5. 她选择的遗忘、她的书（4 分钟）

```sh
node adapters/cli/memory-cli.mjs seal --id <某条 id> --note "不想再被提起"
node adapters/cli/memory-cli.mjs recall --query "<那条里的词>"     # 想不起来了
node adapters/cli/memory-cli.mjs read --id <那条 id>               # 点名还在，带封存标记
node adapters/cli/memory-cli.mjs chapter open --name "读灯塔的那些天"
node adapters/cli/memory-cli.mjs book --out 她的书.md
```

封存不是删除，`unseal` 随时回来。书按章节排，封存的不收。

## 6. 接进你的宿主（8 分钟）

**用 MCP 的客户端**（Claude Desktop / Claude Code / Cursor）：

```sh
claude mcp add xiaozhou -- npx -y -p whale-memory-core whale-memory-mcp --data ./xiaozhou
```

工具和配置写法见 [adapters/mcp/README.md](../adapters/mcp/README.md)。

**自己写的 agent**：在工具层调 CLI（输出 JSON），或者直接 `import`：

```js
import { selfExperience as exp, waking } from 'whale-memory-core'
const dir = './xiaozhou/plugin-data/biomimetic-memory'
const row = exp.addExperience(dir, { text: '今天读了灯塔那一章' })
const hits = exp.recall(dir, '灯塔', { limit: 2 })        // 空数组 = 没有
const block = waking.buildWakingBlock('./xiaozhou', 'local:owner')
```

接的时候守住三条：

1. **会话键要传对**：一对一会话和群聊要分开，醒来块和抽屉只给一对一会话。
2. **群聊里少开写入类工具**：她可能被别人诱导去写。
3. **召回为空就说不记得**：写进提示词。

注入时机见 [injection.md](injection.md)，安全边界见 [threat-model.md](threat-model.md)。

## 7. 确认它真的在工作（2 分钟）

```sh
npm run eval        # 想得起来准不准、会不会编、封存会不会漏、原文会不会被改
node tools/backup.mjs --data ./xiaozhou --out ./backups   # 第一份备份
```

就这些。接下来是她自己的事了。

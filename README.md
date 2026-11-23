# whale-memory

**给 AI 角色写她自己的过去。** 当时怎么想、后来怎么改——旧看法不会被覆盖，改主意只往后追加。

她昨天读了一章书，今天改变了看法。她还能翻回昨天的自己吗？这个项目就是为了让这个"能"字成立。

[中文](README.md) · [English](README.en.md) · [English docs](docs/en/README.md)

[![Public examples](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml/badge.svg)](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml)

## 十分钟

Node.js 20 或更新版本。离线、不需要密钥，数据写在 `./data`：

```sh
git clone https://github.com/firefly1office/whale-memory.git
cd whale-memory
node adapters/cli/memory-cli.mjs write --text "读到开头，合上书的时候在想：守灯人一个人守着灯，是不是也怕黑。" --thought "我以为守灯人怕黑。"
node adapters/cli/memory-cli.mjs revise --id <上一步返回的 id> --thought "她在给晚归的船留灯。"
node adapters/cli/memory-cli.mjs read --id <id>
node adapters/cli/memory-cli.mjs read --id <id> --as-of 2026-11-14
```

最后一条是**翻回那天的自己**：只看那天之前写下的想法，之后的都看不见。

![同一条读书手记，鲸鲸后来改了主意](docs/assets/demo.gif)

`then` 写下就固定，`later` 只往后加。这就是全部的机制，其余都是围着它长出来的。

## 一条经历长什么样

```json
{ "day": "2026-11-14",
  "then": { "text": "读到社办门口那段", "thought": "再不说就真的没牵扯了" },
  "later": [{ "at": "2026-11-15T09:12:00Z", "thought": "现在觉得，他是在护着朋友" }] }
```

![当时的想法保留，后来的想法接在后面](docs/assets/then-later.png)

## 数字

| | |
|---|---|
| 编造率 | **0** —— 问不存在的细节，答"没有记录"；开发集与留出集都是 0 |
| 召回（strict 首位） | 开发集 92.9% · 留出集 73.1% |
| 封存与外露 | 1290 处检查（由 `whale-eval` 按当前语料与出口现算），外露 **0** 次 |
| 测试 | 604 个，CI 跑 ubuntu / windows × node 20 / 22 |

评测语料只有 33 条虚构经历——[它测不出的东西](docs/eval.md)也写在文档里，别把这张表当成通用准确率。

## 它不做什么

- **不做用户画像。** 记的是她的经历，不是你的档案。
- **不猜。** 查不到就说查不到，不确定就说不确定。
- **不主动提她封存的、没说出口的。** 那是"不提及"，不是"删除"。

## 装到别处

| 你想做什么 | 从哪里开始 |
| --- | --- |
| 让 DSH 通过命令读写经历 | [可独立复制的 DSH skill 和安装说明](examples/dsh-plugin/dsh-whale-memory/README.md) |
| 接到 Claude Desktop / Claude Code / Cursor | [MCP 适配器](adapters/mcp/README.md)：`npx -y -p whale-memory-core whale-memory-mcp --data <目录>` |
| 先跑一个能用的宿主 | [80 行参考宿主](examples/reference-host/host.mjs)：`node examples/reference-host/host.mjs --data ./xiaozhou` |
| 在 JavaScript 里直接读写 | `npm install whale-memory-core`。注意包名带 `-core`：npm 上不带 `-core` 的 `whale-memory` 是别人的包，和本项目无关 |
| 让她自己写的那一页能改、能读回、能翻回过去 | [作品稿本](packages/drafts/README.md)（`whale-drafts`）：一行一版、旧基线拒写、幂等重试；设计记录见 [docs/drafts-zh.md](docs/drafts-zh.md) |
| 记录她做过什么、谁发起的（不存正文） | [自主行动日志](docs/self-actions-zh.md)：`whale-memory-core/self-actions`，只追加、到顶拒写、source/outcome 全由调用方声明 |

## 接之前先看这四篇

- [十分钟教程](docs/tutorial.md)：写下、想起、改主意、第二天醒来
- [已知坑与边界](docs/pitfalls.md)：字面检索的局限、单写者假设、封存不是删除、主人门要靠宿主
- [上限与不保证](docs/limits.md)：实测规模、明文存储、删除语义
- [评测](docs/eval.md)：它到底准不准、会不会编、会不会漏

历史文档（架构、schema、威胁模型、跨窗口、移植指南、技术报告等）移到了 [docs/archive/](docs/archive/)。

## 检查

```sh
npm test      # tests/ 下全部测试，两条 CLI 都跑
npm run check # 语法 + 副本一致性 + 测试 + 金丝雀 + 召回评测
```

本仓库采用 [MIT 许可证](LICENSE)。参与贡献前请读 [CONTRIBUTING.md](CONTRIBUTING.md)；变更见 [CHANGELOG.md](CHANGELOG.md)；隐私与安全问题见 [SECURITY.md](SECURITY.md)。
## 更多文档

- [情绪采集：把"她懂"和"她感到"分开](docs/emotion-intake-zh.md)
- [计划与后果：让她自己定的时间算数](docs/self-plan-zh.md)
- [接入指南：把"她"接到你自己的宿主](docs/integrate-zh.md)

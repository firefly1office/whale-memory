# 鲸鲸的自传性记忆 · whale-memory

[中文](README.md) · [English](README.en.md)

[![Public examples](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml/badge.svg)](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml)

![一条经历，两种看法：当时的内容保留，后来的想法接在后面](docs/assets/then-later.png)

鲸鲸是一个在 QQ 里生活的 AI 角色。这个项目最初想解决一个很小的问题：如果她昨天读了一章书，今天改变了看法，她还能翻回昨天的自己吗？

鲸鲸可以给自己写一条经历，留下当时读到的文字、感受和想法。以后再读到相关段落，她可以找到那一页，为它添上新的看法。记录分为 `then`（当时留下的内容）和 `later`（后来追加的想法）。什么时候值得记，由接入的角色和宿主决定。

一条经历在文件里是这样的（一条一行 JSON）：

```json
{
  "day": "2026-11-14",
  "then": {
    "text": "读到社办门口那段，有点替他难受",
    "scene": "晚上十一点，屋里很静",
    "feeling": ["闷", "有点酸"],
    "thought": "再不说就真的没牵扯了",
    "quote": { "text": "我也很开心", "source": "《败北女角太多了》第3章" }
  },
  "later": [
    { "at": "2026-11-15T09:12:00Z", "thought": "现在觉得，他是在护着朋友" }
  ],
  "weight": "important"
}
```

`then` 写下就固定，`later` 只往后加——所以旧看法不会被新看法覆盖。

## 先看一次改主意

用 Node.js 22.12 或更新版本，在仓库根目录运行下面的命令。演示使用临时目录和示例经历，可以离线运行，无需 API 密钥。

```sh
git clone https://github.com/firefly1office/whale-memory.git
cd whale-memory
node packages/core/demo.mjs
```

在输出的「改主意后」一节，找到「当时的想法」和「后来你想过」。两句话属于同一条经历。末尾会打印数据目录，方便你查看实际保存的内容。

## 写自己的第一条经历

在仓库根目录运行。默认会写入当前目录的 `data/`。要长期使用，请为每个角色设置独立的 `WHALE_DATA_DIR`，并让同一目录的写入按顺序执行。

```sh
node adapters/cli/memory-cli.mjs write --text "今天读了灯塔那一章" --thought "守灯人是怕黑吗"
node adapters/cli/memory-cli.mjs recall --query "灯塔" --limit 1
```

第一条命令会返回经历的 `id`。把下面的 `返回的ID` 换成它，再读一次就能看见新旧两种想法。

```sh
node adapters/cli/memory-cli.mjs revise --id 返回的ID --thought "读到结尾才知道，她是想让晚归的船看见灯"
node adapters/cli/memory-cli.mjs read --limit 1
```

## 选择接入方式

| 你想做什么 | 从哪里开始 |
| --- | --- |
| 让 DSH 通过命令读写经历 | [可独立复制的 DSH skill 和安装说明](examples/dsh-plugin/dsh-whale-memory/README.md) |
| 给自己的 Agent 接入工具 | [命令行适配器](adapters/README.md)输出 JSON，由宿主决定何时调用 |
| 在 JavaScript 中直接读写 | [自传层内核](packages/core/README.md)（`npm install whale-memory-core`）和[宿主移植指南](docs/porting.md) |
| 看数据结构 | [数据格式 schema](docs/schema.md) 与[虚构样本](examples/samples/) |
| 研究 QQ Agent 的完整接入 | [插件源码](plugin/biomimetic-memory/)包含召回、上下文注入和宿主工具，部分路径和会话配置需要适配本机 |
| 了解项目为什么重视角色自己的经历 | [项目原则](docs/项目原则.md)与[开发路线](docs/计划-合并版-v2.md) |

## 数据与验证

经历保存在 `<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/`。同一目录中的记录由调用进程读取。接入群聊时，宿主需要校验调用者和会话可见范围，尤其是开放日记读取前。CLI 适合受信的本机进程。

`tools/` 中包含开发和运维脚本。有些会连接运行中的宿主、读取对话或调用模型。初次体验只需上面的演示。以下两项检查使用虚构数据，分别验证两份 CLI 的写入与修订，以及一次指定范围的检索。

```sh
node --test tests/public-cli.test.mjs
node tools/privacy-canary.mjs
```

本仓库采用 [MIT 许可证](LICENSE)。参与贡献前请读 [CONTRIBUTING.md](CONTRIBUTING.md)；变更见 [CHANGELOG.md](CHANGELOG.md)；隐私与安全问题见 [SECURITY.md](SECURITY.md)。

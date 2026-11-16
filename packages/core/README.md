# whale-memory/core

**自传层**内核：只管"她自己的经历"这一层，不是完整的记忆系统。纯 ESM、只用 Node 内置模块。

```js
import * as exp from 'whale-memory-core/self-experience'
```

## 包含什么、不包含什么

包含：

- `then` / `later` 两层经历，改主意不覆盖旧想法
- 召回（相关度 × 重要度）、想起计数、两段式渲染
- 醒来块、她自己的提示词 overlay、她自己的设置

不包含（完整引擎与具体宿主部署耦合，不随本仓库分发）：

- vault 存储与索引、evidence-policy 取证、consolidator 合并、注入预算
- 跨会话可见性判断、宿主工具注册

如果你要的是"一个 agent 的自传记忆"，这个包够用；如果你要的是"完整记忆系统"，看 [`docs/architecture.md`](../../docs/architecture.md) 与 [`docs/porting.md`](../../docs/porting.md)。

包名 `whale-memory-core`，入口：`whale-memory-core`（命名导出）以及五个子路径：`/self-experience`、`/self-memory`、`/waking`、`/self-prompt`、`/self-settings`。

| 模块 | 作用 |
|---|---|
| `self-experience.js` | 经历两层（then / later）、重要度、两段式回想 |
| `self-memory.js` | 经历 + 日记的统一读取与渲染 |
| `waking.js` | 醒来块：每天第一次唤醒给昨天的时间线（是否注入由调用方决定） |
| `self-prompt.js` | 提示词 overlay：版本只追加、可回退 |
| `self-settings.js` | 她自己的设置（软限制归她），改动写进她的经历 |

## 安装

```sh
npm install whale-memory-core
```

已发布在 npm：`whale-memory-core`（[npmjs.com](https://www.npmjs.com/package/whale-memory-core)，最新版本以 npm 为准）。也可以从仓库本地安装：`npm install ./packages/core`。

> 包名带 `-core`。npm 上不带 `-core` 的 `whale-memory` 是别人的包，和本项目无关，别装错。

从零开始接一个角色，看 [30 分钟教程](https://github.com/firefly1office/whale-memory/blob/main/docs/tutorial.md)。

## 当 MCP 服务用

包里带一个 MCP 服务（stdio、只在本机、零依赖），接到 Claude Desktop、Claude Code、Cursor 等客户端：

```sh
npx -y -p whale-memory-core whale-memory-mcp --data /path/to/data
```

抽屉默认不开（`--owner true` 才开），`--readonly true` 只给读的工具。工具表与配置写法见仓库里的 [adapters/mcp/README.md](https://github.com/firefly1office/whale-memory/blob/main/adapters/mcp/README.md)。

## 运行示例

```bash
node demo.mjs
```

不需要配置文件、不需要 API key、不联网。演示会在临时目录里建一份数据，结束时会输出目录位置，方便检查记录。

## 路径约定（容易踩）

不同模块接受的目录不一样：

| 传什么 | 模块 |
| --- | --- |
| **记忆目录** `<data>/plugin-data/biomimetic-memory` | `self-experience`（`addExperience` / `loadAll` / `recall`）、`self-memory`、`recall-events`、`later-events` |
| **数据根目录** `<data>` | `waking`、`self-prompt`、`self-settings` |

传错不会报错，只会写到另一个位置。CLI 已经替你处理好了：`exp.*` 收 `MEM_DIR`，其余收 `DATA`。

## 数据

一条经历一行 JSON，格式见 [`docs/schema.md`](../../docs/schema.md)。三条虚构样本在 [`examples/samples/`](../../examples/samples/)。

移植说明见仓库根目录 [`docs/porting.md`](../../docs/porting.md)。
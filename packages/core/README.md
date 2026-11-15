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

已发布在 npm：`whale-memory-core@0.1.0`（[npmjs.com](https://www.npmjs.com/package/whale-memory-core)）。也可以从仓库本地安装：`npm install ./packages/core`。

## 运行示例

```bash
node demo.mjs
```

不需要配置文件、不需要 API key、不联网。演示会在临时目录里建一份数据，结束时会输出目录位置，方便检查记录。

## 数据

一条经历一行 JSON，格式见 [`docs/schema.md`](../../docs/schema.md)。三条虚构样本在 [`examples/samples/`](../../examples/samples/)。

移植说明见仓库根目录 [`docs/porting.md`](../../docs/porting.md)。
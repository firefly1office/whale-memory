# whale-memory/core

不依赖 QQ Agent 的记忆内核，纯 ESM、只用 Node 内置模块。

```js
import * as exp from './lib/self-experience.js'
```

| 模块 | 作用 |
|---|---|
| `self-experience.js` | 经历两层（then / later）、重要度、两段式回想 |
| `self-memory.js` | 经历 + 日记的统一读取与渲染 |
| `waking.js` | 醒来块：每天第一次唤醒给昨天的时间线（是否注入由调用方决定） |
| `self-prompt.js` | 提示词 overlay：版本只追加、可回退 |
| `self-settings.js` | 她自己的设置（软限制归她），改动写进她的经历 |

运行示例：

```bash
node demo.mjs
```

不需要配置文件、不需要 API key、不联网。演示会在临时目录里建一份数据，结束时会输出目录位置，方便检查记录。

移植说明见仓库根目录 [`docs/porting.md`](../../docs/porting.md)。

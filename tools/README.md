# tools/

这里的脚本分两类。只用合成数据、不连网的可以放心跑；其余是鲸鲸部署时用的运维脚本，会读真实数据目录、连接运行中的宿主或调用模型，**放在这里是为了展示做法，不保证在你的环境里能直接跑**。

## 公开：检查与评测（合成数据，离线）

| 脚本 | 做什么 |
| --- | --- |
| `run-tests.mjs` | 跑 `tests/` 下所有 `*.test.mjs`（`npm test`） |
| `check-syntax.mjs` | 给每个 `.js` / `.mjs` 跑 `node --check` |
| `sync-dsh-core.mjs` | 把 `packages/core` 同步到 DSH 示例副本；`--check` 只校验漂移 |
| `privacy-canary.mjs` | 隐私金丝雀：用合成记录验证跨会话可见性规则 |
| `eval-recall.mjs` | 召回小评测：命中率 + 无关查询是否真的返回空 |
| `preflight.mjs` | 外发预检：扫路径/用户名/账号样式数字/长哈希/私钥头；命中退出码 1 |

`npm run check` 会依次跑以上五项。

## 公开：数据维护（读你自己的数据目录）

| 脚本 | 做什么 |
| --- | --- |
| `metrics.mjs` | 她有没有在长：`node tools/metrics.mjs --data=<dir>` |
| `migrate-later-events.mjs` | 把旧格式的 `later` 数组迁移成 `later-events.jsonl`；默认 dry-run |
| `migrate-recall-events.mjs` | 把旧格式的 `recalls` 迁移成 `recall-events.jsonl`；默认 dry-run |
| `migrate-drill.mjs` | 迁移演练：造 0.27.0 形态数据 → 迁移 → 对拍 → 回滚 → 再迁移（两次结果一致）；`--from <目录>` 只读真实数据、只在临时目录里演练 |

## 内部：鲸鲸的部署脚本

依赖完整引擎（不随本仓库分发）、宿主的数据目录布局或 `config.json` 里的模型密钥。

| 脚本 | 依赖 | 做什么 |
| --- | --- | --- |
| `app-guard.mjs` | 宿主进程 | 宿主不在时自动拉起 |
| `daily-backup.mjs` | 宿主数据目录 | 每日备份记忆库、日记、配置，保留 30 天 |
| `her-own-time.mjs` | 运行中的宿主 | 每天固定时段给她一段自己的时间 |
| `her-self-facts.mjs` | 对话记录 | 从她说过的话里提炼"待确认"的自我事实 |
| `self-summary.mjs` | 模型 API | 从日记提炼一周主线 |
| `self-profile-candidates.mjs` | 完整引擎 + 模型 API | 从 self 卡片生成 self-profile 候选 |
| `fabrication-watch.mjs` | 对话记录 | 扫她关于自己的断言，记下查不到出处的 |
| `fake-memory-probe.mjs` | 运行中的宿主 | 问没发生过的事，她应当说不记得 |
| `isolated-acceptance.mjs` | 运行中的宿主 | 清空上下文后的 20 题线上验收 |
| `threads-shadow.mjs` | 完整引擎 + 对话记录 | 只记录"本来会注入什么"，不注入 |
| `virtual-harness.mjs` | 完整引擎 | 虚拟对话全链路沙盘 |

`lib/visibility.mjs` 是可见性判定的共用函数，`privacy-canary.mjs` 用它。

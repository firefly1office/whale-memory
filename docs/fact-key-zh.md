# 事实键式取代（`factKey`）

> 2026-11-27（阶段 5 · S1）。状态：**默认关，只做数据层**——不接召回、不进注入、不参与封存判定。
> 借鉴 Yuuyuko-uu/dsh-fish-memory 的"事实键（对象.方面）"设计（自定义许可，只学思路、未复制代码），
> 见 [借鉴与致谢](attribution-zh.md)。

## 一、它解决什么

经历记录是**整条不可变**的：`then` 一个字都不改，"改主意"是追加 `later` 事件，"别再提起"是封存事件。
但有些事比"整条"细——她上个月说爱喝拿铁，这个月说戒了。把整条经历封掉太重，改 `then` 又违反契约。

事实键把这类事按 **`对象.方面`** 切开：同一个键再记一次，就是**取代**上一代；旧的不会被修改或删除，
只是在读的时候标成 `supersededBy`——不再出现在"现行事实"里，但**东西留着、能撤销**。

## 二、文件：`fact-events.jsonl`

一行一条，只追加，永不回写（<memory-dir> 下；**只在显式调用 `factKey.setFact` 时才出现**）：

```json
{"v":1,"type":"fact_set","id":"fact_mhx7k2a9","key":"她.咖啡","value":"戒了，改喝无糖茶",
 "about":"鲸鲸","expId":"exp_mhx7k2a9","note":"她自己说的","at":"2026-11-27T00:41:02.113Z","day":"2026-11-27"}
```

| 字段 | 口径 |
| --- | --- |
| `v` / `type` | 恒为 `1` / `fact_set`（认不出的事件当坏行） |
| `id` | `fact_` 前缀，不透明、永不复用（与经历 id 一样不许解析） |
| `key` | `对象.方面`：中间**至少一个点**，两边都不为空；≤ 120 字。`她.喜欢.咖啡` 这种更细的方面也过 |
| `value` | 这一面现在是什么；必填，≤ 500 字 |
| `about` | 可选：这件事是关于谁的（人/物），只用于展示与排查，**不参与键的同一性判断** |
| `expId` | 可选：写这条事实时依据的那条经历。`erase` 撤回那条经历时，这条事实一起清 |
| `note` | 可选：人写的一句说明，≤ 200 字 |
| `at` / `day` | 写入时刻（ISO 8601）与本地日 |

**取代关系不存在文件里**：它由"同一 `key` 的下一条事件"推出来（读时标 `supersededBy` / `supersededAt`）。
这样写路径永远只有追加，不需要回写历史——也就不会出现"改了一半"的文件。

## 三、API

```js
import * as factKey from './packages/core/lib/fact-key.js'

factKey.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁', about: '鲸鲸', expId: row.id })
// → { event, noop: false, supersededBy: '<被取代那条的 id，第一次写是空串>' }

factKey.currentFacts(dir)            // 每个键只剩最新一条；坏行 fail closed
factKey.readFacts(dir)               // { all, current, byKey, bad }；all 里旧的一代带 supersededBy
factKey.historyOf(dir, '她.咖啡')     // 一个键的完整家谱（旧 → 新）
factKey.factsForExp(dir, expId)      // 某条经历带出来的事实，每条带 isCurrent
factKey.derive(rows, { until })      // 纯函数：事件行 → 现行（将来其它容器走这里）
```

- **noop**：同一个键同一个值、同一个 `about` / `expId` 再写一次，不产生新事件，返回那一条（`noop: true`）。
- **as-of**：`readFacts / currentFacts / historyOf` 收 `{ until }`（毫秒时间戳），按那一刻重放——
  之后写的事件看不见，于是看到的是当年那一代。
- **撤销**：读全量 → 想退回旧值，再 `setFact` 一次就行（家谱不会丢）。

## 四、坏行 fail closed

读现行事实时有坏行就抛 `FACT_EVENTS_CORRUPT`，不把看不清的东西当成"没有"（与契约 §3.2 同一个口径）。
`setFact` 也拒绝在坏行上面继续叠——那时说不清哪条才算数。
`allowCorrupt: true` 是给备份 / 计数这类"不对外展示"的用途留的后门，**宿主不得用它做展示**。

## 五、与 `erase` 的关系

`fact-events.jsonl` 已登记进 `erase.js` 的事件文件清单：撤回一条经历时，`expId` 指向它的那些事实事件一起清，
返回的 `removed` 里多一个 `fact` 计数。

两个后果，都是想要的：

1. 被撤回的那条经历带出来的事实**不会孤零零留着**（"她喜欢拿铁"不会在读路径上继续存在）；
2. **上一代自然重新成为现行**——这正是"东西留着能撤销"：撤掉新的那一代，旧的说法自动生效。

事实文件里有坏行时，擦除整次拒绝（`ERASE_EVENTS_CORRUPT`，`file: 'fact-events.jsonl'`）：
坏行说不清是不是那一条，不假装删干净了。

## 六、默认关怎么证明

1. **零调用点**：`git grep -n "fact-key" packages adapters examples` 只命中 `packages/core/index.js`、
   `packages/core/index.d.ts`（导出面）与示例副本；没有任何既有模块 import 它；
2. **不产生文件**：不调用 `setFact`，记忆目录里不会出现 `fact-events.jsonl`（测试 `未传参数时一行都不写`
   断言目录里只有 `self-experience.jsonl`）；
3. **读路径不动**：`loadAll` / `recall` / 注入 / 封存判定一个字都没改（`git diff main --stat` 可见：
   改动只有新文件 + `erase.js` 的三处登记 + 导出面 + 文档）；
4. 全量测试数只增不减，原有用例一条没改。

## 七、这一轮明确没做（写清，免得被当成"已经有了"）

- **不接召回**：事实键不影响 `recall` 排序、不参与注入、不进 `waking` / `book` / `recap`；
- **不进 SQLite**：`backend: 'sqlite'` 时事实事件仍只在 JSONL 里（将来接的时候走 `derive(rows)` 那条纯函数）；
- **不做冲突检测**：同一个键写两个互相矛盾的值，后写的赢——没有"哪个更可信"的判断；
- **不自动抽取**：事实由宿主（或她自己）显式写，库不从对话里猜；
- **不合并 `fact-cards.jsonl`**：那是另一套「关于他的稳定事实」（`fact-store.js`），口径不同，先并存；
- **没有"撤销"的 API**：撤销 = 再写一次旧值（家谱在，够用；真要做 undo 事件是下一轮的事）。

## 八、测试

`tests/fact-key.test.mjs`（9 条）覆盖：同键取代、不同键独立、默认关不产生文件、noop、坏行 fail closed、
参数上限与形状、`erase` 连带清理 + 上一代重新生效、坏行阻断擦除、as-of 重放。

**变异验证**（手工做过，记录在这里）：把 `derive()` 里标 `supersededBy` 的两行注释掉 →
`同一个键写两次……` 立刻红；把 `erase.js` 的 `EVENT_FILES` 去掉 `fact-events.jsonl` →
`erase 撤回一条经历时……` 红。改回后全绿。
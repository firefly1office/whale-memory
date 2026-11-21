# 事实时间线（timeline）

> [English](en/timeline.md) · 中文（本页）

同一件事被说了几次，记忆里就有了几个「版本」。这份契约回答三个不同的问题，不把它们塞进一个字段：

| 轴 | 回答什么 | 字段 |
| --- | --- | --- |
| 值轴（世界时间） | 这件事在世界上什么时候为真 | `validFrom` / `validUntil`，区间 `[from, until)`，`until=null` 表示仍为真 |
| 知轴（记录时间） | 她什么时候知道、什么时候不再这么认为 | `factVersionAt`（起点）/ `invalidatedAt`（终点） |
| 序轴（版本） | 同一槽位里谁在谁后面 | `version`（链内序号，从 1 连续） |

为什么要拆：一个 `validUntil` 同时承担三个语义，读的人就永远分不清「事实过期」和「她改了看法」。

**序轴为什么不用时间戳**：时钟不可信（秒/毫秒混用、同一秒多条、补录旧事），而追加顺序永远可信。`version` 就是给「不信任时钟」准备的定序手段。

## 用法

```js
import { applySuccession, validateLineage, planChainVersions } from 'whale-memory-core/timeline'

// 后继取代前驱：两边各补什么
applySuccession(before, after, { reason: 'correction' })
// before.invalidatedAt = after.factVersionAt
// after.version = before.version + 1（链头按 1 算）

// 校验一条链
const issues = validateLineage(chainRows)   // [] 表示通过

// 迁移：给存量链排序号（指针优先，排不出来退回时间排序并标记）
const plan = planChainVersions(chainRows)
// plan.orderBy === 'pointer' | 'time'
// plan.patches 是每条记录该补的字段，plan.issues 是排不出来的原因
```

## 不变量

- **I1** 同一 `lineageId` 内 `version` 唯一、从 1 连续、不跳号
- **I2** 被取代记录的 `invalidatedAt` 等于后继的 `factVersionAt`
- **I3** 后继的 `revisionOf` 指向前驱，前驱的 `supersededById` 指向后继
- **I4** `supersedeReason` 只能取 `update | correction | expiry | retraction | dedupe | unknown`
- **I5** 指针成环或断链时 `planChainVersions` 会报出来，不会静默乱排

## 不做什么

- **不写值轴**：`validFrom` / `validUntil` 必须来自证据或人工裁决，不能因为看到一条更晚的记录就替它编一个有效期
- 不合并事实、不删除记录、不调用模型
- 不假设时钟单调：只按指针或显式排序

## 测试

`tests/timeline-contract.test.mjs`，16 项：序号、取代补丁、链头补号、校验各分支、迁移规划、成环、空链。
# 自主行动日志：她做过什么，谁发起的（设计记录）

> 这块很小，但它是"她有没有主动性"唯一可核对的来源。
> 原则只有一条：**这里只存事实，不存判断**——是不是"她自己发起的"由调用方声明，
> 库不推断、不打分。

## 为什么要单独一层

计划闭环（`docs/self-plan-zh.md`）里已经证明过一次：**"她自己定的"和"系统安排的"是两件事**，
而且 `done` 只认真实的翻页记录、不靠模型自述。这条经验适用于所有动作，不只计划：

- 她存了一版稿、读回来、开了一件事、登记了一个计划——这些是"做过"；
- 是谁要她做的（用户要求 / 她自己 / 说不清），是另一个字段；
- 结果如何（成功 / 冲突 / 没发出去），是第三个字段。

三件事分开存，才可能在事后回答："这一周她自己动手了几次"而不靠回忆。

## 存什么

一行一条 JSONL：

```json
{"v":1,"at":1795433813075,"day":"2026-11-23","action":"draft_save","source":"self","outcome":"ok","itemRef":"it_9k79oqcn","triggerLen":3}
```

| 字段 | 谁决定 | 说明 |
| --- | --- | --- |
| `action` | 宿主 | 白名单在创建日志时传入，库不内置词表（不同产品词表不一样） |
| `source` | 宿主声明 | `asked` / `self` / `unknown`；传别的值一律记 `unknown`，不猜 |
| `outcome` | 宿主声明 | 小写短标识（`ok` / `conflict` / `disabled` …），非法值记 `unknown` |
| `itemRef` | 宿主 | 指向被操作对象的 id，可选 |
| `triggerLen` | 宿主 | 触发文本长度，可选 |
| `triggerDigest` | 宿主 | 宿主自己算的摘要（建议 HMAC），可选 |
| `day` | 库 | 本地时区的日期，用来按天分组 |

## 不存什么（这是重点）

**不存触发文本，也不存它的裸哈希。** 短句（"第三章""继续""好"）对字典枚举几乎不设防，
存 sha256 等于存明文。要留痕就让宿主自己用密钥算 HMAC 传进来，密钥在宿主手里。

**不判断 source。** "她自己发起的"是个产品口径，不是一个可以从日志里算出来的事实。
库如果替你判，公开之后就会被当成"归因准确率"，而它其实只是启发式。

## 保证

- 只追加：`O_APPEND` + `fsync`，一行一次写；**历史行永远不重写**。
- 末尾停在半行（崩溃/掉电）时，下一次写入先补换行，旧半行留作坏行，新记录照常可读。
- 并发：复用 `lib/file-lock.js`（mkdir + owner.json + pid 判活 + token 校验）。
- 容量：默认 5000 行，到顶**拒绝写入**（`limit`），不裁剪历史、不悄悄丢最早的行。
- 坏行跳过并计数（`corrupt`）；整份读不出来返回 `storage_error`，不假装空。
- 失败码只有四个：`invalid_input` / `limit` / `busy` / `storage_error`。

## 留给宿主的四件事

1. **asked / self 的判定口径**——是看触发句里的祈使词，还是看有没有人在场，宿主自己定；
2. **outcome 的语义**——`conflict` 在你的产品里是什么，库不知道；
3. **日志进不进提示词**——一旦角色能读到自己的计数，"观测"就变成了"目标"；
4. **要不要算"自主率"**——算的话，分母是什么必须写清楚，否则三个零解释不了任何事。

## 接口

```js
import { createSelfActionLog } from 'whale-memory-core/self-actions'

const log = createSelfActionLog({ dir, actions: ['draft_save', 'draft_read', 'project_start'] })
log.record({ action: 'draft_save', source: 'self', outcome: 'ok', itemRef: 'it_1' })
log.read({ since, source: 'self' })
log.summarize({ days: 7 })
```

## 测试

`tests/self-actions.test.mjs`（15 项）：白名单拒绝、source/outcome 归一、到顶拒绝、
坏行跳过、半行保护、过滤、按天统计（本地日跨早晚八点不分裂）、自动建目录、
**八进程并发写不丢行**、不存触发原文。
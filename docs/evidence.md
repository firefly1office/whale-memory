# 证据策略（开源子集）

[中文](evidence.md) · [English](#english)

`packages/core/lib/evidence-policy.js` 是完整引擎里 evidence-policy 的**可检验子集**：只做判定，不做存储。它回答三个问题——**as-of**（那时知道什么）、**被取代**（旧值是谁、谁取代了它）、**后继缺席**（之后有没有新记录）。

## 为什么单独拿出来

`architecture.md` 写过这三件事，但公开仓库里原本一行代码都没有。一个只有文档的"证据优先"，外部读者没法判断它是设计还是口号。这个子集把判定写成纯函数，配 fixture 就能跑。

它不是完整的 vault：不存数据、不做索引、不碰会话。`fact` 是通用结构，和 `then/later` 是两层东西：

| | 经历（then/later） | 事实（fact） |
| --- | --- | --- |
| 谁写的 | 她自己 | 宿主从记录里抽取 |
| 形状 | 一段经历 + 当时看法 | `{subject, slot, value, at}` |
| 用途 | 人格连续性 | 回答"那时她怎么想/他去了哪" |
| 覆盖 | 永不覆盖 | 可被 `supersedes` 取代 |

## 用法

```js
import { query, hasSuccessor, render } from 'whale-memory-core/evidence-policy'

const verdict = query(facts, { subject: 'her', slot: 'mood', at: '2026-11-11T00:00:00+08:00' })
// { status: 'known', value: '闷', fact, evidence: [...], reason: ... }
// 或 { status: 'unknown', reason: '截至该时间没有记录', evidence: [] }

render(verdict) // "闷 · 2026-11-10（日记）" 或 "没有记录：截至该时间没有记录"
```

## 四条规则

1. **as-of 只认当时已成立的记录**：未来才发生的取代不算数。
2. **旧值不消失**：`evidence` 里保留取代链，`reason` 写明"有后续记录，旧值被取代"。
3. **没有就明说没有**：不返回"可能""大概"，`status` 只有 `known` / `unknown`。
4. **同一时刻互相矛盾就说说不清**：同一 `slot`、同一时间、值不同、又没有明确取代关系时，返回 `unknown`，`evidence` 里两条都给出来——不按 id 顺序替她挑一个。

## 测试

`tests/evidence-policy.test.mjs` 覆盖：as-of 前/后、取代链、无记录、未来记录不算、后继缺席、坏时间输入。

## 接到自己的数据上

1. 从 `then.quote` / `then.state` / 日记里抽出 `{subject, slot, value, at, source}`
2. 发生改口时，新 fact 带 `supersedes: 旧 id`
3. 查询时传 `at`（通常是"现在"或对话里的某个时间点）
4. 拿 `render()` 的结果给模型，别自己拼"应该是"

## 现成的桥：从她的经历抽 fact

`evidence-from-experience.js` 只抽有出处的两样东西，不推断：

```js
import * as bridge from 'whale-memory-core/evidence-from-experience'

const facts = bridge.factsFromExperiences(experiences)
// 情绪快照 → { slot: 'mood', value: '闷', at, source: 'then.state' }
// 原文锚   → { slot: 'quote:《灯塔》第2章', value: '灯还亮着', at, source: 'then.quote' }

bridge.ask(experiences, { slot: 'mood', at: '2026-11-11T00:00:00+08:00' })
// known / unknown，不猜
```

没有被记录的情绪、没有原文锚的想法，不会变成 fact——桥只搬已经存在的东西。

---

## 追问经历里的细节

在项目根目录执行 `node adapters/cli/memory-cli.mjs detail --data <数据根目录> --query "那条围巾是什么颜色？"`。JavaScript 可从 `whale-memory-core` 导入 `recallDetail`，传记忆目录和完整问题。MCP 工具名为 `memory_detail`。CLI 的 `--as-of` 和库的 `{ asOf }` 可以限定可见时间。宿主应先按会话选择允许读取的记忆目录。

结果最多带三条候选，每条有经历 ID、日期和带字段出处的原文摘录。只有 `supported` 有直接提取的值；`related` 表示可结合原文核对，`ambiguous` 表示有多条可能，`unmatched` 表示本次查询无候选。仅词语同现时标为 `match: "terms"`，据此还无法判定谁借给谁。候选为零或三条候选均缺细节时，都应限定在本次查询范围内回答。

首版识别部分中文问法，可从主体明确、单句直接记录的颜色、品牌和元价中提取原文值。复杂叙述、猜测、冲突或追加后记时优先提供摘录。摘录可以由宿主在当前回合阅读，工具自身只读，不调用模型。通用召回与自动注入仍由原有入口提供。

## English

`evidence-policy.js` is a testable subset of the full engine: judgment only, no storage. It implements **as-of**, **supersession**, and **absence of successor**, over generic facts `{subject, slot, value, at, supersedes?}`. `query()` returns `known` with evidence chain, or `unknown` with a reason — never a guess. Facts are a different layer from experiences: experiences are self-authored and never overwritten; facts are extracted claims that can be superseded.

Run `tests/evidence-policy.test.mjs` for the cases.

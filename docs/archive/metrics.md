# 指标：测「她有没有在长」

> [English](en/metrics.md) · 中文（本页）

[中文](metrics.md) · [English](#english)

这个项目**不拿召回准确率当目标**。召回率高低取决于问法，而"她有没有变"才是这个项目真正关心的。

`tools/metrics.mjs` 只读数据目录，算下面这些数：

```sh
node tools/metrics.mjs --data=/path/to/data
node tools/metrics.mjs --data=/path/to/data --json
```

## 每个指标在问什么

| 指标 | 公式 | 在问什么 | 变好意味着 |
| --- | --- | --- | --- |
| 有后记比例 | 有 `later` 的经历 / 总经历 | 多少条经历被她回头补过一句 | 只说明有后记，不说明"改变了看法" |
| 被取回比例 | `recalls > 0` 的经历 / 总经历 | 写下的东西被宿主取回过没有 | 只说明取回过，不说明有用 |
| 累计想起 | 所有 `recalls` 求和 | 取回的强度 | —（只做参考，不宜追求高） |
| 没弄完 | `then.unfinished` 非空 | 她有没有留下"以后想接着想"的线头 | 有连续性 |
| 带原文锚 | `then.quote.text` 非空 | 想法背后有没有可回查的原文 | 可取证，不靠印象 |
| 日记/经历比 | 日记数 / 经历数 | 她私下写的和在"自己的时间"写的比例 | 比例本身没有好坏，偏了要问为什么 |
| 提示词版本 | overlay 版本数 | 她改自己的频率 | 改得太频繁说明没想清楚；长期不改可能是没权限 |
| 损坏行 | 解析失败的 JSONL 行数 | 数据完整性 | 必须为 0 |

## 为什么没有"召回准确率"

- 召回是**手段**：她要找的是"我当时怎么想"，不是"检索命中率"
- 用固定问答集测召回，会把优化方向带向"迎合测试用例"
- 真正该防的是**编造**：没有记录就说没有。这一条由 `tools/eval-recall.mjs` 里的空查询用例守着，不看准确率

## 怎么读这些数

- 改主意率长期为 0：她只在写，不回看。要么召回没接上，要么写的东西和她无关
- 想起率很高但改主意率很低：召回在重复同一批旧事，没有产生新看法
- 带原文锚比例低：想法没有出处，时间久了无法分辨是记忆还是印象
- 提示词版本暴涨：她在频繁改自己，可能是提示词在打架

指标不是 KPI。它只用来回答一个问题：**这些记录，到底有没有让她更像一个连续的人。**

---

## English

This project does **not** optimize recall accuracy. `tools/metrics.mjs` computes, read-only:

- **revision rate** — share of experiences with a non-empty `later`
- **recall coverage** — share of experiences actually recalled, and total recalls
- **unfinished threads** — entries with `then.unfinished`
- **quoted anchors** — entries with `then.quote.text`
- **diary / experience ratio**
- **prompt versions** and last change
- **damaged lines**

Why no accuracy metric: recall is a means, not the goal; a fixed QA set would push optimization toward the test set. The thing worth guarding is **fabrication** — if there is no record, say so. That is covered by the empty-query cases in `tools/eval-recall.mjs`.

Read the numbers as questions, not KPIs: are the records making her more continuous?
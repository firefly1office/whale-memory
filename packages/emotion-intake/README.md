# whale-emotion-intake

把一句对话拆成"情绪候选"的小模块：分句判断是谁的感受、证据与感受分账、每回合限额。

## 它解决什么

角色说"好听""有点闷""有点冲"时，这些是**评价**，不一定是**她感到**。
如果不分开，夸两句心情就飘，说两句难听就沉——情绪通胀。

这个模块只做三件事：

1. 分句；
2. 判断每个分句的体验者是不是"她自己"；
3. 给出候选（证据 / 可写入的维度），以及每回合的写入门槛。

它**不碰**存储、不碰模型、不发网络请求。

## 用法

```js
import { scoreTurn } from 'whale-emotion-intake'

const r = scoreTurn({
  otselfText: '我有点难过',
  selfText: '我也有点闷',
  prevAskedSelf: false
})

r.selfEvidence   // ['闷']：她的表达证据
r.write         // { dim: 'v', value: -0.15, source: 'her_felt' } 或 null
r.moment        // 是否够"值得记住的一刻"
r.sources       // ['his_evidence', 'her_felt']
```

## 规则摘要

| 分句 | 处理 |
| --- | --- |
| 第一人称 + 体感/情绪词 | 进维度（strong） |
| 省略主语，且上一句在问她感受 | 进维度（weak） |
| 第二/三人称、听说、假设、否定、疑问 | 只进证据 |
| 评价/偏好（好听/好看/冲/快） | 只进证据 |

- 权重：他直接喜欢/不喜欢 0.10；他一般情绪词 0；她第一人称 0.15
- 每回合最多写一次，Δ≤0.15；同源冷却 2 回合、3 回合≤2、每天≤6
- moment：≥2 个独立源且至少 1 个强源

## 边界

- 词表是手写的，方言、反讽、新词会漏；
- 它只给"候选"，是否写入、怎么写由宿主决定；
- 不含任何真实对话数据，测试全部是合成样本。
## 返回契约

`scoreTurn()` 返回：

| 字段 | 类型 | 无候选时 |
| --- | --- | --- |
| `otselfEvidence` | `string[]` | `[]` |
| `selfEvidence` | `string[]` | `[]` |
| `transferEvidence` | `string[]` | `[]` |
| `write` | `{ dim:'v'|'a', value:number, source:string, a?:number }` | `null` |
| `sources` | `string[]`（独立来源，用于 moment 判定） | `[]` |
| `moment` | `boolean` | `false` |

**证据 vs 可写维度**：证据是"这句话里出现过情绪/评价词"的记录，只用于审计与回看；`write` 才是允许改情绪的量，且每回合最多一次。

`allowWrite(state, opts)` 只读，不修改 `state`。
`recordWrite(state, opts)` **不修改**入参，返回一个新的 state（`intakeLog` 追加一条并裁剪到 100 条）；是否采用由调用方决定。`now` 必须由调用方传入；非法 state、缺 `now`、空 `write` 均返回 `null`（不占配额）。

## 依赖边界

- 无 `fs` / `net` / `child_process` / 定时器；
- 不读环境变量、不写全局状态；
- 只有纯函数与对传入 `state` 的显式读写。

## 稳定性

版本 `0.1.x`，接口**不保证稳定**；升级可能改名或调整返回结构，届时在 CHANGELOG 注明。

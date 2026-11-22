# whale-emotion-intake

把一句对话拆成"情绪候选"的小模块：分句判断是谁的感受、证据与感受分账、每回合限额。

## 装

```sh
npm i whale-emotion-intake
```

## 它解决什么

角色说"好听""房间有点闷""有点冲"时，这些是**评价**，不一定是**她感到**（评价的对象是房间/声音/菜）。
只有"我觉得心里闷""我有点难过"这类第一人称体验才是她的感受。
如果不分开，夸两句心情就飘，说两句难听就沉——情绪通胀。

这个模块只做三件事：

1. 分句；
2. 判断每个分句的体验者是不是"她自己"；
3. 给出候选（证据 / 可写入的维度），以及每回合的写入门槛。

它**不碰**存储、不碰模型、不发网络请求。

## 跑一下

```sh
npm i whale-emotion-intake
node node_modules/whale-emotion-intake/example.mjs
```

在仓库里则用：

```sh
node packages/emotion-intake/example.mjs
```

## 用法

```js
import { scoreTurn } from 'whale-emotion-intake'

const r = scoreTurn({
  otherText: '我有点难过',
  selfText: '我也有点闷',
  prevAskedSelf: false
})

r.selfEvidence   // ['闷']：她的表达证据
r.otherEvidence  // ['难过']：对方的表达证据
r.write         // { dim: 'v', value: -0.15, source: 'self_felt' } 或 null
r.moment        // 是否够"值得记住的一刻"
r.sources       // ['other_evidence', 'self_felt']
```

## 规则摘要

| 分句 | 处理 |
| --- | --- |
| 第一人称 + 体感/情绪词 | 进维度（strong） |
| 省略主语，且上一句在问她感受 | 进维度（weak） |
| 第二/三人称、听说、假设、否定、疑问 | 只进证据 |
| 评价/偏好（好听/好看/冲/快） | 只进证据 |

- 权重：他直接喜欢/不喜欢 0.10；他一般情绪词 0；她第一人称 0.15
- 每回合最多写一次，Δ≤0.15；跨来源冷却 2 回合（任何来源写入后都要等 2 回合）、3 回合≤2、每天≤6
- moment：≥2 个独立源，且至少一个是强源（`self_felt` / `other_direct` / `other_evidence`）；`self_weak` + `contagion` 这组弱源组合也算够（与 `scoreTurn` 的判定一致）

## 边界

- 词表是手写的，方言、反讽、新词会漏；
- 它只给"候选"，是否写入、怎么写由宿主决定；
- 不含任何真实对话数据，测试全部是合成样本。
## 返回契约

`write` 与 `moment` 都只是**候选**：是否写入、是否记下由宿主决定，模块本身不碰存储。
`source: 'self_felt'` 表示“候选来源是她第一人称的自感句”，不是模型真的感觉到了什么。

`scoreTurn()` 返回：

| 字段 | 类型 | 空值条件 |
| --- | --- | --- |
| `otherEvidence` | `string[]` | 该侧没有命中任何情绪/评价词时 `[]` |
| `selfEvidence` | `string[]` | 同上 |
| `transferEvidence` | `string[]` | 没有转述/引用时 `[]` |
| `write` | `{ dim:'v'|'a', value:number, source:string, a?:number }` | 没有可写候选时 `null` |
| `sources` | `string[]`（独立来源，用于 moment 判定） | 没有来源时 `[]` |
| `moment` | `boolean` | 不够 moment 时 `false` |

**注意**：证据与 `write` 相互独立。「房间有点闷」会得到 `write: null`，但 `otherEvidence: ['闷']`——宿主不要在 `write` 为空时丢弃证据。

**证据 vs 可写维度**：证据是"这句话里出现过情绪/评价词"的记录，**不会直接改情绪**，但可以作为 moment 的独立来源参与判定；`write` 才是允许改情绪的量，且每回合最多一次。

`allowWrite(state, opts)` 只读，不修改 `state`；省略 `now` 会读系统时钟，跨上海时区午夜可能得到不同的“当天”，生产建议显式传入。
`recordWrite(state, opts)` **不修改**入参，返回一个新的 state（`intakeLog` 追加一条并裁剪到 100 条）；是否采用由调用方决定。`now` 必须由调用方传入；非法 state、缺 `now`、缺 `dim/value/source` 的候选均返回 `null`（不占配额）。

## 依赖边界

- 无 `fs` / `net` / `child_process` / 定时器；
- 不读环境变量、不写全局状态；
- 纯函数：`scoreTurn` / `classifyClause` / `featureFlags` 等；`allowWrite` 只读，但省略 `now` 时会读系统时钟；
- `recordWrite` 返回**新状态**，不修改入参；
- `mergeMomentWindow` / `recordMoment` 是状态机，**会原地更新**传入的 `state`（窗口与每日记录），调用方需自备状态容器。

## 稳定性

版本 `0.1.x`，接口**不保证稳定**；升级可能改名或调整返回结构，届时在 CHANGELOG 注明。

## 已知局限（首版保留）

这是词表 + 规则的启发式模块，不做句法分析。下面几类会误判，已在测试里固定为“当前行为”，用前请知道：

- 条件句只按分句判断：「如果下雨，我会很难过」的后半句会被当作她当前的自感；
- 名词里的「的话」与条件词可能混淆（已排除「你的话」，其他名词未穷举）；
- 「让我」只看是否直接支配感受词，复杂句式可能漏判；
- 评价对象词表有限，新名词（新作品、新物件）可能被当成她的体感；
- 否定、反讽、方言、新词都可能漏。

它的定位是“候选”，不是判定器；宿主应保留采纳/拒绝的余地。
- 同伴/听者人称会误拦第一人称：「和你在一起我很开心」「我告诉她我喜欢你」当前不会产生候选（首版保留）。
- 条件「…的话」与名词「你的话」在「喜欢你的话」这类句子里会被当成名词，条件句漏判；
- 说话者在 \`otherText\` 里带同伴/听者代词（「我告诉她我喜欢你」）时，直接偏好会被误拦；\`otherText\` 里单独的「我喜欢你」仍正常。
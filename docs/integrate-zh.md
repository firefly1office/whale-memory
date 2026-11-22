# 接入指南：把「她」接到你自己的宿主

> 这份文档给想复用的开发者：`whale-memory-core` 负责“经历过什么、后来怎么想”，`whale-emotion-intake` 负责“这句话是不是她的感受”。两者都不绑定 QQ Agent。

## 1. 装

```sh
npm i whale-memory-core whale-emotion-intake
```

Node.js 20+。两个包都是 ESM，无原生依赖。

## 2. 最小可用：一条经历

```js
import { selfExperience } from 'whale-memory-core'

const dir = './data'
const text = '读到守灯人怕黑'
const { id, at } = selfExperience.addExperience(dir, {
  text,
  thought: '我以为他怕黑'
})
await new Promise((r) => setTimeout(r, 5)) // 让修订严格晚于写入
selfExperience.reviseExperience(dir, { id, thought: '他在给晚归的船留灯' })

selfExperience.currentView(dir, id, { asOf: at })  // 只有「当时」
selfExperience.currentView(dir, id, {})            // 「当时」+「后来」
```

`then` 写死，`later` 只追加；`asOf` 是“翻回过去”的关键，别用普通覆盖写。
`asOf` 传写入时刻的时间戳，就能看到修订前的自己；传当天日期则包含当天所有修订。

## 3. 情绪候选：一条消息

```js
import { scoreTurn } from 'whale-emotion-intake'

const r = scoreTurn({
  otherText: '房间有点闷',        // 评价对象是房间 → 只进证据
  selfText: '我觉得心里闷',       // 第一人称体验 → 她的感受
  prevAskedSelf: false
})
// r.write          → 可写候选（没有就 null）
// r.moment         → 时刻候选（没有就 false）
// r.selfEvidence   → ['闷']，只做证据，不改情绪
// r.otherEvidence  → ['闷']，只做证据
```

**关键约定**：`write` 才能改情绪；证据不直接改情绪，但可以参与时刻候选判定。`recordWrite` 返回新状态，不修改入参。

## 4. 宿主接线的四个点（示例，事件名与工具名由宿主决定）

| 时机 | 做什么 |
| --- | --- |
| 上下文注入 | 到点的计划、后果回看、跨天陈述、相关旧经历 |
| 回合结束 | 采集：`scoreTurn` → 宿主决定是否采纳 `write`/`moment` |
| 工具注册 | 给她定时/跨天小事的工具——她主动用才算数 |
| 定时任务 | 巩固、封存、清理；不要替她决定做什么 |

下面是**宿主示例**（`on('after-turn')`、`self_plan`、标记文件都只是 QQ Agent 侧的名字）：

```js
import { allowWrite, recordWrite, scoreTurn } from 'whale-emotion-intake'

// 示例宿主选择：采纳所有配额内的候选；真实宿主可以在这里加自己的判断
const adopt = (r) => true

on('after-turn', (turn) => {
  const r = scoreTurn({ otherText: turn.other, selfText: turn.self, prevAskedSelf })
  const now = Date.now()
  if (r.write && adopt(r) && allowWrite(state, { turnIndex, now })) {
    const next = recordWrite(state, { turnIndex, now, write: r.write })
    if (next) {                 // 可能返回 null（非法 state / 缺 now / 空候选）
      state = next
      applyToMood(r.write)
    }
  }
  if (r.moment && adopt(r)) queueMoment(r)
})
```

注意：`allowWrite` 只管配额（冷却/每日上限），**不等于采纳**；示例里的 `adopt` 才是宿主的采纳决定。

停用是否立即生效，取决于宿主：注入层若每轮读取开关，删标记后下一轮即停；工具是否消失取决于宿主何时重新注册。QQ Agent 侧实测：删标记后注入立即停，重启后工具消失。确认方法：停用后观察下一轮上下文是否仍有该段、工具列表是否还在、定时任务是否还产生注入记录。

## 5. 隐私边界

- 情绪模块只发候选，不向外发原句；如果要把候选送模型，参考公开文档里的“粗语义 + 句法标记”脱敏做法；
- 只采“主人私聊”是常见选择；群聊/他人默认不写她的情绪；
- 状态文件原子写；损坏时宁可不出声，也不当空记录。

## 6. 回滚

每个新能力都要有独立开关（一个标记文件即可）。注意开关的作用范围：

- 删文件 → **只停这一个功能的注入/工具**，不一定会停后台的巩固、封存、清理；
- 要停掉全部后台写入：禁用整个插件，或取消宿主的定时任务；
- 重启 → 工具消失；历史数据保留，不删。

确认方法：删标记后等一个定时周期，检查是否还有该功能的新注入记录、工具是否还在、后台任务是否仍产生写入；只看“没有新注入”不足以证明后台已停。

## 7. 不要做什么

- 别把“评价词”直接写成情绪（好听 ≠ 她开心）；
- 别用完成率、截止日、优先级去管理她的计划；
- 别让回看写成“你没做到”；
- 别让提醒变成催办。

先读 `docs/emotion-intake-zh.md` 的失败记录，再决定要不要模型候选——那一轮端到端实测未达标（P0.5 / R0.43），原因未定；样本只有 20 条，也没有做区分原因的实验。
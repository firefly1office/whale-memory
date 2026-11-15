# 移植指南：把「她的记忆」装进别的宿主

这份文档写给非 QQ Agent 的使用者（DSH、自建 agent、别的框架）。
结论先说：**完整引擎不随仓库分发，但核心库和设计可以直接用。**

## 1. 哪些在仓库里，哪些不在

仓库里（`packages/core`，通用、可依赖）：

| 模块 | 说明 |
|---|---|
| `self-experience.js` | 经历两层（then/later）、重要度、两段式回想、想起计数 |
| `self-memory.js` | 她自己的经历 + 日记的统一读取与渲染 |
| `waking.js` | 醒来块：`buildWakingBlock` 只读计算，`consumeWaking` 确认已展示 |
| `self-prompt.js` | 提示词 overlay：版本只追加、可回退 |
| `self-settings.js` | 她自己的设置（软限制归她） |

不在仓库里（作者本机 QQ Agent 部署的一部分，与宿主强耦合）：

| 模块 | 说明 |
|---|---|
| vault（index/events/cards） | 纯文件存储与索引，26k 行引擎的一部分 |
| `evidence-policy.js` | 证据判定：as-of、被取代、后继缺席、未来记录不返回 |
| consolidator | 记忆合并与去重 |
| injection-budget | 上下文注入预算 |
| 宿主入口 | registerTool / promptSections / storage 的具体实现 |

这些的设计写在 [`architecture.md`](architecture.md) 里；要接自己的宿主，按下面的最小契约自己实现一层即可。

## 2. 宿主需要提供什么（最小契约）

```js
// 1) 存储：一个目录，下面挂 plugin-data/biomimetic-memory/
const dataDir = '/path/to/data'

// 2) 工具注册：模型能调用的函数
registerTool({ id, name, description, parameters, execute(ctx, args) })

// 3) 提示词拼接：每轮把块加进 system prompt
buildPrompt(ctx) -> string

// 4) 调度：每天一次「她自己的时间」、每日备份、周摘要
schedule(cron, fn)

// 5) 模型调用（可选）：自述提炼、偏好判断
llm(messages) -> string
```

对应关系：

| QQ Agent | 你的宿主 |
|---|---|
| `api.registerTool` | 你的工具表 |
| `api.storage` | 任意 KV（这里直接用了文件） |
| `promptSections` / before-context 注入 | 你的 system prompt 组装 |
| `api.log` / `api.warn` | 你的日志 |
| `ctx.chatKey` | 会话标识（**必须**，隐私隔离靠它） |

## 3. 最小可用组合（不看 QQ 也能跑）

```js
import { addExperience, recall, renderTwoPart, reviseExperience } from './packages/core/lib/self-experience.js'

const dir = './data/plugin-data/biomimetic-memory'

// 她写下一条经历
const e = addExperience(dir, {
  text: '读到烤肉那段，笑了一下',
  scene: '晚上十一点多，屋里很静',
  feeling: ['轻松', '有点羡慕'],
  thought: '这种好事只在书里',
  quote: { text: '那就让妳重新迷上我一百年吧', source: '《败北女角太多了》' },
  weight: 'important'
})

// 第二天她想起
const hits = recall(dir, '那本书里那个人', { limit: 1 })
console.log(renderTwoPart(hits[0]))

// 她改主意（不改"当时"）
reviseExperience(dir, { id: e.id, thought: '现在觉得他是在护着朋友' })
```

完整的可运行示例见 `packages/core/demo.mjs`（不依赖任何宿主，`node demo.mjs` 即可）。

## 4. 隐私规则（别省这一步）

这几条不是可选优化，是能不能给别人用的前提：

1. **会话必须带上 chatKey**；所有读取都按 chatKey 过滤
2. **她自己的经历**可以跨会话；**别人的私事**永不跨
3. **日记只给一对一私聊**（本项目只给主人私聊），群聊不注入
4. 醒来块同样只在一对一私聊注入，避免把昨天私下的话带到群里
5. 跨会话召回要写审计日志（哪条记录、从哪到哪），出事能查

## 5. 接进 DSH（示例思路）

DSH 的 skill 是 `SKILL.md + 脚本`，不需要 QQ Agent 的插件 API：

1. 把 `packages/core/lib/*` 放进你的 skill 目录
2. 写一个 `skill` 脚本，用 DSH 的工具注册方式暴露：
   - `self_experience_write` / `read` / `revise`
   - `self_prompt_read` / `set` / `history`
   - `self_settings_read` / `set`
3. 在每轮系统提示里调用 `renderTwoPart` / `renderSelfProfileBlock` 的等价实现
4. 用 DSH 的定时任务跑「她自己的时间」与每日备份

## 6. 不要照搬的部分

- QQ 号、路径、OneBot 配置：换宿主时请重新检查
- 计划任务（schtasks）：Linux/macOS 用 cron/systemd timer
- 任何需要拿到 QQ 会话键（`private_*` / `group_*`）的判断：那是宿主层的事，不要塞进核心库

## 7. 验收清单

移植完成至少验证：

```
[ ] 写下一条经历 → 读回，then 字段完整
[ ] 改主意 → later 多一条，then 不变
[ ] 第二天（同会话）醒来块出现昨天的经历
[ ] 群聊/别的会话 → 读不到日记
[ ] 假记忆探针：5 个没发生的事，全部回答"不记得"
[ ] 隐私金丝雀：暗号在主人私聊可检索、在群聊不可检索
```
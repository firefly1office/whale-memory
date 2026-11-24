# 发起来源判据：只认结构化证据（设计记录）

> 这块属于「能帮到外面」的那一类：不含私有数据、不碰封存与抽屉、不依赖宿主。
> 它只回答一个问题——**这条动作，是别人要她做的，还是她自己做的？**

## 第一版错在哪（记下来，免得再走一遍）

第一版想从句子里直接判："有祈使词" + "命中话题" = 被要求。两轮外部审查把它打穿了：

- 「初稿**看起来**还行」——「看」是祈使词，陈述句被判成请求；
- 「**先别存**稿」——否定句被判成请求，把"不许删"记成"他要她删"是最不该出的错；
- 「帮我看看我**删掉**的初稿」——他要看、她删了，同一个分句里两种动词，仍然算 asked；
- 「日记**记**录」——话题词自己带着祈使字，两道闸门被同一个字同时满足；
- 「可以告诉我日记是什么吗」「你千万不能删初稿」——再加标记词表也堵不完。

结论：**中文口语没有可依赖的边界，关键词匹配在"判不出就记 unknown"的原则下只会越改越假。**

## 第二版：证据必须结构化

调用方在自己那边判出这一轮的触发种类，再交给库；库只做受约束的判定。**自由文本一律不当证据。**

| `trigger` | 结果 | 理由 |
| --- | --- | --- |
| `null` | `self` | 调用方显式声明"这一轮没有外部输入"。**这是 self 唯一的入口** |
| `{kind:'none'}` | `self` | 同上，只是写法不同 |
| `{kind:'system'}` | `unknown` | 定时器 / 空闲窗口 / 提醒。**系统触发永远不算她自己发起** |
| `{kind:'user-mention'}` | `unknown` | 提到了，但不是要求 |
| `{kind:'user-request'}` | `asked` | 用户要求。若带了 `action` / `tool`，必须与本次一致，否则 unknown |
| `undefined` / 字符串 / 数组 / 其它 | `unknown` | 取不到值、或者是自由文本，都不当证据 |

还有一条硬约束：**动作对得上才算**。触发里写了 `action: 'draft_read'`，这次却在 `draft_delete`，返回 `unknown`——他要的那件事和她做的这件事不是一件。

## 为什么系统触发要单列

定时任务叫醒她、她在窗口里做了一件事——如果这算"自己发起"，指标一夜之间从 0 变成 7，量的是排程，不是她。

所以 `kind: 'system'` 一律 `unknown`，并且 `describeSource('unknown', {system:true})` 会写成"系统触发，不计入自己发起"。想统计主动性，分子只能来自 `self`，而 `self` 只有"这一轮真的没有人跟她说话"才可能拿到。

## 明确不做的事

- **不从文本里猜。** 传字符串直接 `unknown`；没有"智能一点"的开关。
- **不因为"没人叫她"就自动判 self。** 没触发有太多原因（文本没采到、会话键对不上、长回合过期），只有调用方显式声明才算。
- **不做"看起来像请求"的启发式。** 请求与否是调用方的回合模型该给的事实，不是词表能猜的。
- **永不抛错。** 任何异常输入（`null`、数字、对象、数组、抛错的 getter）都落到 `unknown`。

## 用法

```js
import { classifySource, noExternalInput, describeSource } from 'whale-memory-core/action-source'

classifySource({ action: 'draft_read', trigger: null })                       // 'self'
classifySource({ action: 'draft_read', trigger: noExternalInput() })          // 'self'
classifySource({ action: 'draft_read', trigger: { kind: 'system' } })         // 'unknown'
classifySource({ action: 'draft_read', trigger: { kind: 'user-mention' } })   // 'unknown'
classifySource({ action: 'draft_read', trigger: { kind: 'user-request' } })   // 'asked'
classifySource({ action: 'draft_delete', trigger: { kind: 'user-request', action: 'draft_read' } }) // 'unknown'
classifySource({ action: 'draft_read', trigger: '帮我看看初稿' })              // 'unknown'（文本不是证据）

describeSource('unknown', { system: true }) // '系统触发（定时/空闲/提醒），不计入自己发起'
```

## 边界（什么不进这个包）

- **私有**：vault、取证、版本合并、注入预算、真实对话数据，都不随仓库分发，也不在这个模块里出现。
- **公开**：只需要"把一条动作落到三个桶里"这一层判定，谁都能用，也谁都能改。
- 这个模块不接触任何真实内容——它拿到的只是调用方已经判好的种类与名字。


## 已知边界与取舍（外部审查提出，非阻塞）

1. **`self` 挂在 `null` 上，而 `null` 容易被意外造出来**——`turn.trigger ?? null`、数据库 NULL、JSON 往返都会把"没取到"变成"没有外部输入"。这是本模块唯一会放行到 `self` 的方向，调用方要自己保证只在"确实没有外部输入"时传。
   之所以仍保留 `null` 这条写法，是因为它是宿主里最常见的"空"的表示；怕写错就用 `noExternalInput()`，名字本身就是一次提醒。若宿主不放心，可以只用 `{kind:'none'}`。
2. **原型链上的 `action` / `tool` 也算"标了"**：判定用 `!== undefined` 而不是自有属性，避免 `Object.create({kind:'user-request',action:'draft_read'})` 这类对象绕过核对。
3. **"标了但标坏"一律 unknown**：触发里的 `action`/`tool` 是空串、`null`、数字，或本次动作名不是字符串，都按调用方错误处理，不放过成 `asked`。
## 测试覆盖（	ests/action-source.test.mjs，21 条）

- `self` 只有 `null` / `{kind:'none'}` 两条写法；`undefined`、不传、`map.get` 取不到值都是 `unknown`
- 自由文本（含第一版全部反例）一律 `unknown`
- `system` 触发 → `unknown`，且描述文本写明"不计入自己发起"
- `user-request` 且动作/工具不一致 → `unknown`
- `user-mention`、未知 kind、空对象 → `unknown`
- 异常输入不抛错（`null`、字符串、数字、数组、`Object.create(null)`、抛错的 getter）
- 常量表、`describeSource`、包入口命名空间
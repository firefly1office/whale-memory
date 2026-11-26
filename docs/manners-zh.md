# 知道不等于说（manners）

> 0.27 线的最小实现。默认关闭；不显式打开时，宿主行为与 0.26.3 逐字相同。
> 代码：`packages/core/lib/manners.js`；测试：`tests/manners.test.mjs`（12 条）。

## 解决什么

记忆里有的事她**知道**，但不一定**能说**：

- 别人在私聊里讲的事，被拿到群里复述；
- 主人在私聊里说的话，被带到别人面前；
- 她自己知道的私事，在任何场合都直说。

这套机制不改记忆、不改召回，只在**出口**上给一句话：这次能说、说个大概，还是不提。

## 三种出口

| 出口 | 意思 |
| --- | --- |
| `say` | 原话可以说 |
| `paraphrase` | 说个大概：不引原话、不点具体细节 |
| `withhold` | 这次不提。不是忘了，是这次不说 |

第三种最容易写错。它绝不能被写成「我不记得」「没有这回事」——那是把「选择不说」说成了「不知道」，等于用假话保护隐私。提示行里写明「不是忘了，是这次不说」。

## 判断表

只做判断，不做识别：**场合、敏感度、来源都由调用方给**（受信宿主判断），库不猜。

| # | 条件 | 出口 | 理由 id |
| --- | --- | --- | --- |
| 1 | 没打开（默认） | `say` | `disabled` |
| 2 | 敏感度 `secret` | `withhold` | `secret` |
| 3 | 私密 + 非主人一对一（群、公开、别人私聊） | `withhold` | `private-outside-owner` |
| 4 | 来源是主人 + 不在主人一对一 | `withhold` | `owner-topic-outside-owner` |
| 5 | 私密 + 别人说的 + 主人一对一 | `paraphrase` | `third-party-private-in-owner-dm` |
| 6 | 来源不明 + 私密 | `withhold` | `unknown-source-private` |
| 7 | 其余 | `say` | `normal` |

认不出的取值按最严处理：`place` 认不出当群，`sensitivity` 认不出当 `secret`，`source` 认不出当 `unknown`。

## 用法

```js
import { decideManners, renderMannersHint } from 'whale-memory-core/manners'

const d = decideManners({
  enabled: true,              // 不传就是关
  place: 'owner-private',     // owner-private | other-private | group | public
  sensitivity: 'private',     // normal | private | secret
  source: 'other-said',       // owner-said | other-said | herself | unknown
})
// d = { mode: 'paraphrase', reason: 'third-party-private-in-owner-dm' }

const line = renderMannersHint(d) // '这次只说个大概：不引原话、不点具体细节。'
```

关闭时 `decideManners()` 返回 `{ mode: 'say', reason: 'disabled', off: true }`，`renderMannersHint()` 返回空串——宿主不需要额外分支。

## 不做什么

- 不判断哪句话敏感：那是宿主/调用方的事，库只按给它的标签执行。加一层“自动识别敏感词”会把它变成另一套会出错的判断。
- 不改记忆、不改召回、不改措辞以外的任何东西。
- 不做「礼貌模式」或「说谎」：出口只有三种，`withhold` 不等于编一个理由。
- 默认关闭。打开它会让她的表达发生变化，按承诺第 4 条，上线前要先问她。

## 已知边界

1. 同一条记忆在不同场合可能有不同敏感度，调用方必须按**当前场合**传值，不能缓存第一次的判断。
2. 「说个大概」不是脱敏器：它只约束模型不要引原话、不要点细节；真正的数字/密钥脱敏仍由 `conversation-privacy` 那一层负责。
3. 这条线没有接进任何宿主；接的时候只需要在出口处多传三个标签，并处理一行提示。默认关闭意味着可以先接线、后决定开不开。
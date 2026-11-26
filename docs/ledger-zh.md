# 四本账与信任六档（ledger + trust）

> T6 / T7 的数据层。**默认关**：没有接进任何宿主、任何既有模块，包入口也没登记。
> 代码：`packages/core/lib/ledger.js`、`packages/core/lib/trust.js`（各带 `.d.ts`）；
> 测试：`tests/ledger.test.mjs`（25 条）、`tests/trust.test.mjs`（10 条）。
> 借自 [dsh-emotion-state](https://github.com/zxl176463834/dsh-emotion-state)（MIT）的
> 四本账 / 信任六档设计；实现自写，未复制其代码（见 [attribution-zh.md](attribution-zh.md)）。

## 为什么分开记

关系里「欠下的东西」不是一种东西：

- **承诺**：答应了却没做到 —— 拖得越久，欠得越重；
- **边界**：说好了不越的线被越了 —— 记次数，不记情绪；
- **拒绝**：她拒绝过什么、后来立场有没有变 —— 拒绝不是错误，改口也不是背叛；
- **和解**：为上面某一处欠账做过的弥补 —— 补到哪一步了。

把四类揉成一个「好感分」，就会把「他越过我的线」和「他答应的事没做到」算成同一件事。
分开记之后，每一本账可以有自己的口径、自己的权重，也可以单独关掉。

**这一层只是数据**：记账（追加事件）、折叠（重放成当前状态）、算权重、算档位。
不写文件、不读文件；时间由调用方给（构造事件时可以不传 `at`，那就取当下作默认），
也不生成任何提示词。
落盘、加锁、擦除、注入提示词，都是以后接宿主时的事（见「以后怎么接」）。

## 事件格式

一行一个 JSON（将来落盘时直接写），四条信封字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `book` | 是 | `promise` / `boundary` / `refusal` / `repair` |
| `action` | 是 | 见下表；不认识的 book / action 直接报错 |
| `id` | 是 | 这条账的 id（不透明，不解析格式） |
| `at` | 是 | ISO 8601；构造时不传就取当下 |

各本账的动作与额外字段：

| 账 | action | 额外字段 | 意思 |
| --- | --- | --- | --- |
| 承诺 | `made` | `text`（必填，≤500）、`dueAt?`（ISO / null） | 许下一件事；没定什么时候还就不填 `dueAt`，不算逾期 |
| 承诺 | `kept` | `note?`（≤200） | 做到了 |
| 承诺 | `overdue` | `note?` | 又逾期了一次（每记一次权重翻倍） |
| 承诺 | `released` | `reason?` | 这个承诺算了 / 撤了（不是失信） |
| 边界 | `set` | `text`（必填） | 立一条边界（或重新立起来） |
| 边界 | `crossed` | `note?` | 这条线被越了一次 |
| 边界 | `lifted` | `reason?` | 这条边界撤了 |
| 拒绝 | `declined` | `text`（必填）、`reason?` | 拒了一件事 |
| 拒绝 | `repeated` | `note?` | 同一件事又拒了一次（立场没变） |
| 拒绝 | `withdrew` | `reason?` | 改口了 |
| 和解 | `attempted` | `target`（必填：`{book, id}`，只认前三本账）、`scope`（`partial` / `full`）、`note?` | 为某一处欠账做了一次弥补 |

字段一律**原样保留**，不裁剪、不改写（和「记录不可变」同一个道理）；
超长、空 id、认不出的取值、缺必填字段都在构造时就报错（`LEDGER_EVENT_INVALID`），
不把坏事件留到折叠那一步。多出来的未知字段不报错但也不会带出去（只加不减的兼容）。

## 折叠后的状态

`foldLedger(events)` 按写入顺序重放，返回四个 `Map<id, state>`：

| 账 | 状态字段 |
| --- | --- |
| 承诺 | `text`、`dueAt`、`status`（`open` / `kept` / `overdue` / `released`）、`overdueCount`、`weight`、`totalWeight`、`lastAt` |
| 边界 | `text`、`status`（`active` / `lifted`）、`crossings`、`firstCrossedAt`、`lastCrossedAt`、`lastAt` |
| 拒绝 | `text`、`reason`、`status`（`held` / `withdrew`）、`repeats`、`lastAt` |
| 和解 | `target`、`level`（`open` / `partial` / `repaired`）、`attempts`、`lastAt` |

几个口径：

- 同一条账**只追加**，没有「删掉一条」的事件；`lifted` / `withdrew` / `released` 都只是新事件。
- 同一 id 再记一次 `made` 只更新文案与期限，**不清历史欠账**（`overdueCount` 留着）。
- 边界撤了，越界次数照样留着：撤了不等于没越过。
- `foldLedger` 遇到坏事件直接抛（fail closed），带第几条与错误码，不返回一个「看起来正常」的快照。
- 一条和解记录只能对着一处欠账；同一 id 的 `target` 前后不一致就报错，不悄悄改口径。

## 逾期翻倍与封顶

第 n 次逾期的权重 = 2^(n-1)：

| 第几次逾期 | 1 | 2 | 3 | 4 | 5 | 6 | … |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 单次权重 | 1 | 2 | 4 | 8 | 8 | 8 | 8 |
| 累计 `totalWeight` | 1 | 3 | 7 | 15 | 23 | 31 | … |

- **封顶 8**（`OVERDUE_WEIGHT_CAP`）：第 4 次及以后每次都是 8，不再翻。
  为什么不封顶：第 20 次是 52 万，一本账会把其余三本全压没；惩罚的意义在「越来越重」，不在「无穷重」。
- `weight` 是**最近一次**逾期的权重（当前惩罚档位），`totalWeight` 是历次之和（累计欠了多少）。
  给提示词用 `weight` 说「这次多重」，给管理页用 `totalWeight` 看总账。
- `overduePromises(snapshot, {now})` 只列**到期且没了结**（`open` / `overdue`）的承诺；
  排序是「累计权重降序 → 逾期天数降序 → id」，同一份数据同样输出，不靠 Map 的插入顺序碰运气。
- `summarize().promise.weight` 只算没了结的承诺：补上（`kept`）或撤掉（`released`）的承诺不再压着总权重，
  但它的逾期历史仍然留在状态里。

## 和解三档

| 档 | 名字 | 什么时候到这一档 |
| --- | --- | --- |
| `open` | 未和解 | 一次尝试都没有 |
| `partial` | 部分和解 | 有一次 `scope: 'partial'` 的尝试 |
| `repaired` | 已和解 | 有一次 `scope: 'full'` 的尝试 |

- **只升不降**：已经 `repaired` 之后再记一次 `partial`，还是 `repaired`。
  要「反悔」就追加一条新的欠账（例如新的 `overdue`），而不是把旧和解改成没发生过。
- `repairLevelForAttempts(scopes)` 是给「手上只有一串尝试、没有完整事件流」的调用方用的纯函数；
  正常路径走 `foldLedger`。
- 不记「谁道的歉」「他接不接受」：那是对话内容，属于经历与后记，账本只记「补到哪一步」。

## 信任六档

分数 0..100，档位阈值：

| 档 | key | 名字 | 进这一档的最低分（`enter`） |
| --- | --- | --- | --- |
| 1 | `stranger` | 陌路 | 0 |
| 2 | `acquaintance` | 相识 | 12 |
| 3 | `familiar` | 相熟 | 30 |
| 4 | `trusted` | 信赖 | 50 |
| 5 | `entrusted` | 托付 | 70 |
| 6 | `confidant` | 交心 | 88 |

`levelForScore(score)` 是纯阈值分档（只看分数落在哪一段），用来解释「这个分数在哪一档」；
真正的**当前档位**由 `advanceTrust(state, score)` 一步一步走出来，两者可以不一样。

### 升档慢、掉档快（硬口径）

- **升档**：分数达到下一档还不够，要**连续 3 次**（`UP_CONFIRMATIONS`）观测都停在下一档及以上；
  而且每次只升一档——从第 1 档直接打 100 分，三次也只到第 2 档。
  中途落回同档或掉档，之前攒的证据清零，重新数。
- **掉档**：分数跌破本档的下限（本档的 `enter`），**一次**观测就掉，而且可以直接掉多档。
- 结果：跨同一个分界的同样大小变化，往上一格先「记下来」，往下那一格立刻算。
  例：69 分在第 4 档、71 分在第 5 档。
  - 第 4 档 +2 分（69→71）：第 1 次只算「攒了 1 次」，档位不动；
  - 第 5 档 −2 分（71→69）：一次就掉回第 4 档。
  这条写死了测试（`tests/trust.test.mjs` 的「掉档比升档快」），改慢/改快都会红。
- 为什么这么定：信任是要攒的证据，失去只要一次。升档门槛低会让一次偶然的好表现顶掉长期观察；
  掉档设缓冲带，会让她在事实已经变了之后还挂着「交心」的牌子。

### 里程碑

| id | 名字 | 到第几档时拿 |
| --- | --- | --- |
| `known` | 认下这个人 | 2 |
| `trusted` | 敢把一件事托给她 | 4 |
| `confidant` | 交过心 | 6 |

- 里程碑只在**第一次**升到该档时记；重升不重复记。
- **掉档不收回**：「到过」是经历，经历不改写。状态里保留 `milestones` 数组，
  当前档位是另一回事。要是以后想算「现在还剩几条」，用 `level` 与 `milestonesForLevel(level)` 比。
- `createTrustState({ level, upStreak, milestones })` 可以从存档恢复；未知里程碑 id 直接报错。

`advanceTrust` 不修改传入的 state（返回冻结的新对象）；`foldTrust(scores)` 回放一串分数，
返回最终状态与每一步的判定，排错时能看到「哪一次观测把档位推上去了」。

## 默认关怎么证明

1. **零调用点**。`git grep` 三条口径（在 `packages` / `adapters` / `examples` 里搜）：

   ```
   $ git grep -n "ledger\.js\|trust\.js" -- packages adapters examples
   packages/core/lib/ledger.d.ts:1:// 四本账（承诺 / 边界 / 拒绝 / 和解）与事件形状。实现见 ledger.js。
   packages/core/lib/trust.d.ts:1:// 信任六档与里程碑。实现见 trust.js。
   （examples/ 下的副本同样各一行；这四行都是这两个新文件自己写的注释，
     没有任何别的模块按路径引用它们）
   $ git grep -n "import.*ledger\|import.*trust" -- packages adapters examples
   （空：整个仓库没有一处 import）
   $ git grep -n "ledger\|trust" -- packages adapters examples
   28 行 = 20 行来自这两个新模块自己（ledgerEvent / 注释里的 docs/ledger-zh.md 与 trust.js /
   第 4、5 档的 key trusted、entrusted / 里程碑 id trusted）+ 0.27.0 就有的 8 行无关标识符：
     examples/emotion-bridge/appraisal.mjs:122-126  局部变量叫 ledger（读封存事件文件）
     packages/emotion/context.js:11                 注释里的 trusted host
     packages/emotion/index.js:47/52/121/124        projectEmotion 的 trust 维度
   ```

   判据是「没有任何模块 import 它们」，不是「仓库里没有 trust 这个词」。
   两个新测试在 `tests/` 下（不在上面三条口径的搜索范围里），它们 import 的是相对路径。

2. **包入口与 exports 都没登记**：`packages/core/index.js` 与 `packages/core/package.json` 一个字没动。
   `tests/trust.test.mjs` 有一条断言盯着这件事（入口不许 re-export、`exports` 不许出现 `./ledger` / `./trust`），
   将来真要接宿主，得连测试一起改——不会悄悄打开。

3. **模块本身没有副作用**：`ledger.js` 不 `import fs`、不读写文件、没有顶层副作用；
   `tests/ledger.test.mjs` 里有一条读源码的断言盯着它（纯数据层不许碰盘）。
   `trust.js` 是纯函数，没有 I/O，也不读系统时间。

4. **既有行为不变**：本段没有改任何既有文件（只有新增）；
   全量测试从 769 条涨到 804 条（+35），原有用例全绿。

## 以后怎么接（这一段没做，写清以免误会）

- **落盘**：`ledger.js` 故意不带文件层。接的时候建议复用 `event-log.js` 的 `createLog('ledger-events.jsonl')`
  （只追加、坏行计数、同一把锁里「重读→判断→追加」），或者单独建一个事件文件；
  事件形状已经是可以直接 `JSON.stringify` 一行的形状。
- **擦除**：`erase` 的 `EVENT_FILES` 目前不包含账本文件。真落盘时必须登记进去，否则撤回一条经历会留下它的欠账。
- **提示词**：`overduePromises` 与 `summarize` 只出数字与短文案，怎么写成一句话由宿主决定；
  建议和 [manners](manners-zh.md) 一样做成「默认返回空串」的渲染函数，别让账本自己开口。
- **信任分数**：`trust.js` 不生成分数。分数由谁给（关系桥、评测、人工）是下一个决定；
  这不属于数据层，也不该在数据层里猜。
- **包入口**：要给别人按包名引，需要往 `packages/core/package.json` 的 `exports` 里加
  `./ledger` / `./trust` 两条，并在 `types/smoke.mts` 里各 import 一次。这一段有意没做。

## 没验什么

- **没接宿主、没跑真实对话**：四本账与六档都是纯函数，测试只用固定时间戳。
  没有验证「真实聊天里谁来记这几本账、记漏了会怎样」。
- **阈值是拍的**：12 / 30 / 50 / 70 / 88 与「连续 3 次」没有数据支撑，
  也没做过标注回放；这不是校准过的参数，只是一个可测的起点。
- **没跑类型**：`.d.ts` 是手写的，`tsc --strict`（`npm run types`）依赖联网装 typescript，
  本段没有跑；三个闸门（语法 / 测试 / 副本一致）都不包含类型检查。
- **没落盘、没并发、没擦除**：没有账本事件文件，也就没有验证多进程追加、坏行处理、
  与 `erase` / `purge` / SQLite 后端的配合。见「以后怎么接」。
- **没接提示词、没有 UI**：没有任何一行会被注入对话；管理页（S9）也没接。
- **没验证长期演化**：90 天以上、反复升降档之后 `upStreak` 与里程碑的表现没有回放数据。
- **时区与日期口径**：`overduePromises` 用 `Date.parse` 算毫秒差再除一天，
  跨时区 / 夏令时的「逾期几天」可能与本地日历差一天；计数与排序不受影响。
- **没验 `ledger` 与情绪模块的关系**：`packages/emotion` 里已经有 `trust` / `closeness` 的投影，
  这一段的六档与它还没有对齐（也没有互相引用）。两边怎么合是接入时的事。

## 变更记录

- 2026-11-27：初版（S8）。四本账 + 信任六档的数据层，默认关，零调用点。
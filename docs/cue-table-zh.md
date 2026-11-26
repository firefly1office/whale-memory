# 线索表（`cueTable`）

> 2026-11-27（阶段 5 · S7）。状态：**默认关**。借自 abrahamadams2436-glitch/dsh-xiaoyu-wake 的 cue 表
> （覆盖率门槛 + 频控，MIT，只学设计、未复制代码），见 [借鉴与致谢](attribution-zh.md)。

## 一、它解决什么

`injection.surface()` 每条用户消息都要跑一次全库 recall（10,000 条约 68ms），而大多数消息根本不涉及记忆。
线索表是一个便宜的旁路：先看这条消息里有没有"她可能被问到的词"。

它**不做召回、不给内容**，只回答两件事：

1. 要不要在递记忆前**带一句迟疑**（"我好像有点印象，但不一定对得上"）；
2. （可选）一个线索都对不上时，要不要**跳过这次全库检索**。

## 二、线怎么抽、覆盖怎么算

- 切词复用召回那套 `contentUnits`：英文整词（≥2 字符）+ 中文两字组。
- 每条经历一张线索表：从不封存的记录的 `then.text` / `then.thought` / `then.quote.text` 里取词，
  **按稀有度排序**（≤ 全库一半记录都有的词不算线索），每条最多 `CUE_PER_RECORD = 8` 个。
- 查表：消息里的词能盖住某条经历多少比例（`cover`）。例：消息 5 个词，某条经历的表里有 3 个 → 0.6。
- 门槛：`CUE_HINT_COVER = 0.6` 才插迟疑提醒。
- **封存的经历不进表**：连"提不提"都不该由这张表决定。

## 三、452 条用例上的对照（`tools/eval-cue.mjs`，本机实测）

语料：`eval/corpus-v2.json`（200 条经历）+ `eval/cases-v2.json`（452 条用例）；线索 1512 个 / 有线索的记录 194 条。
每一条都从干净的 `seen` 开始（模拟"这一轮之前没递过"）。

| 方案 | 递了 | 迟疑提醒 | 旁路跳过 | **少注**（基线递了它没递） |
| --- | --- | --- | --- | --- |
| 基线（现状） | 291 | 0 | — | — |
| 线索表 · 只插迟疑（**默认**） | 291 | 99 | — | **0** |
| 线索表 · 短问句也跳过（`cuePrefilter:'short'`） | 257 | 99 | 95 | 34 |
| 线索表 · 一律跳过（`cuePrefilter:'any'`） | 256 | 99 | 102 | 35 |

- **多注 = 0**：线索表不会新增任何一条召回，只在 block 前面多一行字。
- **负面用例（none / near 共 34 条）上的迟疑提醒 = 0**：不对"没有的事"暗示有记忆。
- **迟疑提醒精度 99.0%**：插了 99 条，其中 98 条期望记录真的被召回（剩 1 条是"提醒了但召回没中"——属于诚实范围：
  提醒本来就说"不一定对得上"）。
- **预筛会少注 34–35 条（约 12%）**：所以**默认不跳过**，只有显式 `cuePrefilter` 才开。
  这就是"短问句别做全库检索"的代价，数字摆在这里，不做默认。

跑：`node tools/eval-cue.mjs`（`--json` 出机器可读；`--split=holdout` 只看留出集）。不达标会 `exit 1`。

## 四、频控

`createCueGate({ maxStreak: 3, minGapTurns: 2 })`：

- 同一标题（默认 `cue:<经历id>`）**连贴 ≤3 次**，第 4 次起不再贴；
- 同一个键两次之间**至少隔 2 轮**；
- 状态 `toJSON()` / `load()` 可存可恢复（宿主负责跨轮保存）；
- `cueHintFor()` 只判断、不记状态——**真贴了才** `gate.note(key, turn)`。

## 五、API

```js
import { buildCueTable, lookupCues, createCueGate } from 'whale-memory-core'
import { surface } from 'whale-memory-core/injection'

const table = buildCueTable(loadAll(dir))        // 每次 loadAll 之后重建（纯函数，不读盘）
const gate = createCueGate()                     // 宿主保存状态

const r = surface(dir, {
  chatKey: 'local:owner',
  text: userText,
  cueTable: table,      // ← 不传就是老路径，一个字节没变
  cueGate: gate,
  turn: n
})
// r.block 前面可能多一行 CUE_HINT_LINE；r.cue = { cover, bestId, hint, hintReason, hintKey }
```

## 六、默认关怎么证明

1. 不传 `cueTable` 时 `surface` 走的是原路径（`tests/cue-table.test.mjs` 断言 block 一个字都不多）；
2. `cuePrefilter` 默认 `false`：不传就照样跑全库 recall；
3. `cueTable` 是纯函数，不读盘不联网（测试扫源码：没有 `node:fs` / `node:http` / `fetch(`）；
4. 全量测试只增不减，原有用例一条没改。

## 七、没验什么

- **判据没有人工标注集**：线索表好不好，只能看"少注/多注/负面/精度"这四个代理指标；"该不该迟疑"本身没人标过。
- 迟疑提醒的措辞只有一句话（`CUE_HINT_LINE`），**没有在真实对话里试过**该不该用这种语气；
- 452 条是**我们自己的语料**，词分布和真实聊天不同（评测集本来就偏书面）；
- 没有跨会话/跨人的线索隔离（同一记忆目录只服务一个人，这条不在本库职责里）；
- 没有并发（频控状态是内存对象，宿主多进程各存各的）；
- 预筛的"少注 12%"没有做进一步优化（比如按会话历史动态调门槛）——要做是下一轮的事。
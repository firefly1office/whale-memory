# 数据格式（schema v2）

> [English](en/schema.md) · 中文（本页）

所有数据都是**一行一条 JSON**（JSONL），放在：

```
<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/
  self-experience.jsonl   她的经历（then；later 已迁到事件）
  later-events.jsonl      改主意事件（0.6.0 起；只追加）
  recall-events.jsonl     想起事件（0.5.0 起；只追加）
  autobiography.jsonl     她的日记（默认只在一对一使用）
  prompt-overlay/         她自己的提示词（版本只追加）
  self-settings.json      她自己的设置
```

## 一条经历

```json
{
  "id": "exp_mwggkzwbwp10",
  "day": "2026-11-14",
  "at": "2026-11-14T15:00:13.812Z",
  "author": "self",
  "source": "own-time",
  "kind": "读书",
  "weight": "important",
  "then": {
    "text": "读到社办门口那段，有点替他难受",
    "scene": "晚上十一点，屋里很静",
    "feeling": ["闷", "有点酸"],
    "thought": "再不说就真的没牵扯了",
    "unfinished": "想知道他们后面有没有说开",
    "quote": { "text": "我也很开心", "source": "《败北女角太多了》第3章" },
    "state": { "at": "2026-11-14T15:00:13.812Z", "mood": "偏闷" }
  },
  "later": [
    { "at": "2026-11-15T09:12:00Z", "thought": "现在觉得，他是在护着朋友" }
  ],
  "status": "kept"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一；`exp_` 前缀 |
| `day` / `at` | string | 当地日期 / ISO 时间 |
| `author` / `source` | string | 谁写的、从哪来（`own-time`、`own-decision`…） |
| `kind` | string | 读书 / 想事 / 决定 / 其它 |
| `weight` | enum | `important` / `normal` / `minor`，决定回想的长度 |
| `then` | object | **写下即固定**，任何代码都不许改写 |
| `then.quote` | object\|null | 原文锚：她读到的原句与出处 |
| `later` | array | **只追加**；每项 `{at, thought, reason?}` |
| `status` | string | 目前只有 `kept` |

## 规则

1. `then` 不覆盖。改主意写进 `later`，旧内容原样保留。
2. 文件损坏（有不合法 JSON 行）时：**读取跳过坏行，改写直接报错**；新经历用追加写，坏行原样留住。
3. 行尾必须是真实换行；不允许把 `\n` 写成两个字符。
4. 日记单独一个文件，读取时默认不加载；宿主决定什么时候打开。

## 改主意是事件（0.6.0 起）

`reviseExperience()` 不再读全量、不再重写经历文件，而是往 `later-events.jsonl` 追加：

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-15T08:10:51.340Z","day":"2026-11-15","thought":"现在觉得，他是在护着朋友","reason":""}
```

- 0.12.0 起可以带 `feeling`：她**现在再想起时**的感觉，例如 `{"id":"exp_…","at":"…","thought":"现在觉得她在等船","reason":"","feeling":["释然"]}`。当时的感觉仍在 `then.feeling`，不会被改写；没写感觉的后记不代表感觉变了，翻读时也不会替她说
- 读取时合并：`later` = 行内旧数组 + 事件，按 `at` 排序
- 孤儿事件（id 对应的经历不存在）在读取时忽略
- 迁移：`node tools/migrate-later-events.mjs --data=<dir>`（默认 dry-run，`--apply` 才写，先备份、校验、可回滚）
- 经历文件自此真正只追加：`addExperience` 追加一行，没有任何路径会再重写它

## 没弄完的事是事件（0.11.0 起）

“这件没弄完的事后来怎么样了”单独追加到 `unfinished-events.jsonl`，不改 `then.unfinished`，也不算后记：

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-16T02:30:00.000Z","day":"2026-11-16","choice":"shelved","note":""}
```

- `choice` 只有三种：`done`（想通了）、`shelved`（先放下，还没想通）、`reopen`（又决定接着想）
- 读取时取该 id **最后一条**事件作为当前状态；`history` 保留完整选择顺序，翻读时能看出“中间放下过”
- 醒来块只把没有 `done` / `shelved` 的未完事项算进“你还没弄完”
- 重复同一个选择不追加第二条；没关过的事 `reopen` 是空操作
- 旧数据没有这个文件：行为不变，`then.unfinished` 照旧进入未完列表
- 备份/导出要带上这个文件

## 回想的出处（0.12.0 起）

一条经历可以写明"是从哪几件事想到的"：`then.refs` 是经历 id 的数组。它属于 `then`，写下就固定。

```json
{"id":"exp_r","at":"…","kind":"回想","then":{"text":"等待的人不一定是在怕黑","refs":["exp_a","exp_b"],"…":"…"}}
```

- **写入时校验**：每个 id 都必须是已经写下的经历；找不到、或旧 id 有歧义，整条拒绝，一个字节都不写。旧 id 会落到当前 id 上；重复的只留一个；最多 8 条
- 读取时派生两头：`refsInfo`（出处的一句话摘要）和 `citedBy`（后来有哪些经历把这条写进了出处）
- 出处指向的经历读不到时（例如只恢复了部分文件），`refsInfo` 里标 `missing: true`，翻读写"找不到了"，`doctor` 的"出处完整"一项会报出来
- 召回不顺着出处跳：出处只在翻读时给出，由宿主决定要不要再去读那几条

## 翻回那天的自己（0.12.0 起）

`loadAll(dir, { asOf })`、`currentView(dir, id, { asOf })`、`recall(dir, q, { asOf })`，CLI 是 `read --as-of` / `recall --as-of`。

- `asOf` 写 `2026-11-15`：截到那天**本地时间**的最后一刻；也可以写完整的 ISO 时间
- 只保留那一刻之前（含）写下的经历、后记、结案选择和想起事件；之后的一律看不见。返回的条目带 `viewAsOf`，翻读的第二段变成【那时（截至 …）】
- 不改任何文件；`recall` 带 `asOf` 时不能同时 `mark`（翻旧日子不算"想起"）
- 没有时间戳的旧记录放不到时间线上，截断时不算在"那时"里；旧格式行内的 `recalls` 也一样

## 她选择的遗忘：封存（0.13.0 起）

她不想再被某件事主动提醒时，追加一条到 `seal-events.jsonl`：

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-16T02:30:00.000Z","day":"2026-11-16","action":"seal","note":"不想再被提起"}
```

- `action` 只有 `seal` / `unseal`；该 id 的最后一条是 `seal` 就算封存着。重复同一个动作不追加（锁内重读判断）
- 封存着的经历：`recall`、`memory`、醒来块都不给；`read` 默认不列（输出 `sealedHidden` 计数），`read --sealed true` 或 `read --id` 点名才给，并带 `sealed` 标记
- 别的回想把它写进了出处时，`refsInfo` / `citedBy` 里只给 `{ id, day, sealed: true }`，翻读写"一件你封存了的事"，不露内容
- **不是删除**：经历文件、后记、选择一字未动，导出包里也有。要真的抹掉只能 `purge` 整库删除
- 翻回那天（`asOf`）时，那一刻之前的封存事件照实算；**此外，她现在封存着的也一样不翻出来**（0.17.0 起）：那时还没封存的，标成 `sealed: { …, afterAsOf: true }`，召回、列表、书、回顾都不给，点名读照给并写“你后来封存了”。封存说的是她现在不想被提起，而翻回那天也是在提起旧事

## 回顾材料（0.13.0 起）

`recap(dir, { days, asOf })` / CLI `recap --days 7`：含"今天"在内往回 `days` 个自然日，列出这段时间里

- 写下了什么（`written`）、回头想过什么（`revised`）、感觉怎么变的（`feelingShifts`：当时 → 后来）
- 有了决定的（`settled`：想通 / 先放下）、又拾起来的（`reopened`）、还没弄完的（`stillOpen`，不限时间，最近 5 件）

只列事实，不调模型、不下结论；封存了的一律不列。每条都带 id，她想写一条回想时可以直接 `write --kind 回想 --refs <这些 id>`。不写也可以。

## 事后联想（0.14.0 起）

她后来才发现两件事有关，亲手连起来：`link-events.jsonl` 一行一个 `{from, to, at, day, reason}`。

- `reason` 必填：说不出为什么就别连。两条经历都必须存在，不能连自己；同一对（不分方向）只连一次，重复提交是 noop
- 读取时两头都有 `links`；另一头封存了的，只给 `{id, day, sealed: true}`，翻读连理由也不显示
- 和出处（`then.refs`）的区别：出处是写下这条时就知道的依据，写下就固定；联想是之后才建立的关系
- 召回不顺着联想跳；翻回那天时只算那之前连的

## 人生章节（0.14.0 起）

她给一段日子起名字：`chapter-events.jsonl`，`open`（`{id, name, from, to?}`）、`rename`（`{id, name}`）、`close`（`{id, to}`）各一行。

- 名字 1–30 字；`from` / `to` 是 `2026-11-01` 这样的本地日期，`to` 不早于 `from`；没写 `to` 就是"还在这段日子里"
- 经历按 `day` 落进章节，章节可以重叠或嵌套；读取时带 `chapters: [{id, name}]`
- 改名不抹旧名：`chapter list` 里 `names` 是起过的全部名字；翻回那天看到的是她那时的叫法，那时还没开的章节就不存在
- 同名同起点重复 `open`、同名 `rename`、同日 `close` 都是 noop

## 她的书（0.14.0 起）

`renderBook(dir, { asOf, includeSealed })` / CLI `book [--out 文件]`：人能读的 Markdown 自传。

- 按章节分节；一条经历只印一次，放进它落入的**最具体**的章节（开始得最晚的那个），更大的章节在条目里提一句；章节外的按月份。各节按时间排
- 每一条的正文是那天写下的原样；后记按时间接在后面，带"再想起时"的感觉；结案、出处、联想照实列出
- 封存的默认不收，只写"有几件没有收进来"；`--sealed true` 才收，并标明封存
- `--as-of`：写到那天为止的书，章节用那时的名字。`--out` 不能指向记忆目录里面

## 没说出口的抽屉（0.15.0 起）

打了没发的、想问没问的、忍住了的话：`unsaid-events.jsonl`，只追加。

```json
{"id":"unsaid_…","at":"…","day":"2026-11-16","kind":"draft","text":"其实我今天有点难过","reason":"不想让他担心","status":"open"}
{"id":"unsaid_…","at":"…","day":"2026-11-17","status":"spoken"}
{"id":"unsaid_…","at":"…","day":"2026-11-18","status":"discarded"}
```

- `kind`：`draft`（打了没发）、`question`（想问没问）、`held`（忍住了）。`text` 最多 1000 字，`reason` 最多 200 字
- `spoken` / `discarded` 都是追加的事件，原文不删；`discarded` 之后她自己也看不到
- **永不自动打开**：`recall`、`memory`、醒来块、`read`、`recap`、`book` 都不读这个文件。只有 `listUnsaid`（CLI `unsaid list`）给她看
- 只在认得出的一对一会话里可用（`private_*` / `private:*` / `local_*` / `local:*`）；群聊和认不出的会话键，留、看、标记一律拒绝
- 同一句（同 kind、同原文）还开着时重复留下是 noop；重复标记说出口 / 丢掉不写第二条；已丢掉的不能再标说出口
- 核心库不导出任何返回原始行的函数（连 `readAll` 都没有）：原文只能从 `listUnsaid` 出来
- 导出、导入、备份自动带上；`purge` 整库删除时一起消失

## 想起是事件（0.5.0 起）

「想起一次」不再写进经历行，而是追加到 `recall-events.jsonl`：

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-15T07:20:00.000Z","query":"灯塔","chatKey":"private_100000000#p_x"}
```

- 读取时由事件派生：`recalls` = 该 id 的事件数，`lastRecalledAt` = 最大 `at`
- 旧文件里的 `recalls` / `lastRecalledAt` 仍然可读；只要事件文件里出现该 id，就以事件为准
- 迁移：`node tools/migrate-recall-events.mjs --data=<dir>`（默认 dry-run，`--apply` 才写，先备份、校验、可回滚）
- 追加带锁；多进程并发追加不会丢行

## 写入上限（超了报错，不静默截断）

| 字段 | 上限 |
| --- | --- |
| `text` | 2000 字 |
| `scene` | 500 字 |
| `thought` | 1000 字 |
| `unfinished` | 300 字 |
| `feeling` | 8 个 |
| `quote.text` | 500 字 |
| `kind` | 20 字 |
| `later[].thought` | 1000 字 |
| `later[].reason` | 200 字 |
| `later[].feeling` | 8 个，每个 20 字 |
| `then.refs` | 8 条，且都必须存在 |

空白的 `text` 直接拒绝（`{ok:false, error:"text 不能是空的。"}`）。超长时报错并给出实际长度，让她自己决定删哪些、或拆成两条——记忆系统不能悄悄丢掉一半原文。

## 召回语义

匹配范围：**当时写下的**（`then.text` / `then.thought` / `then.feeling`）、**原文锚**（`then.quote.text` / `source`）、**后来才明白的**（`later[].thought` 与 `later[].feeling`）。返回的条目带 `matchedIn`，说明命中的是 `then` / `quote` / `later` 中的哪几层——宿主可以据此告诉模型"这是她后来才想明白的"，不要把后来的判断说成当初就知道。

- 给了 query：按相关度 × 重要度排序，取前 N 条
- **空 query：返回最近 N 条**（按时间倒序），不是报错，也不是"什么都没匹配到"
- `mode: 'strict'`（默认）：长查询要求命中 ≥60% 的 bigram，宁可不召回
- `mode: 'loose'`：至少一个实词命中即可，适合日常对话召回
- `limit: 0`：一条都不返回；负数或非整数：报错

## 备份要带哪些文件

一条经历在磁盘上可能由七处组成，另有一个只属于她的抽屉；备份时不要只拷 `self-experience.jsonl`：

```
self-experience.jsonl     then（以及迁移前遗留的行内 later / recalls）
later-events.jsonl        后来追加的想法（0.12 起可带后来的感觉）
recall-events.jsonl       想起的次数
unfinished-events.jsonl   没弄完的事后来怎么样了（0.11 起）
seal-events.jsonl         她封存 / 解封了哪些（0.13 起）
link-events.jsonl         事后联想（0.14 起）
chapter-events.jsonl      人生章节（0.14 起）
unsaid-events.jsonl       没说出口的抽屉（0.15 起）
```

一键备份与恢复演练见 [runbook.md](runbook.md)。

出处（`then.refs`）写在经历行里，不是单独的文件。

读取时才会合并成「一条经历」。迁移工具回滚时也会同时恢复这些文件。

## 版本兼容

- 当前格式按结构识别，没有 `schema` 字段
- v1 的扁平记录（`text` / `thought` 直接在顶层）仍能被读取；新写入一律 v2
- 未来若加 `schema` 字段，必须保证旧读取器能忽略它
- 改格式的 PR 必须写明迁移方式，且不能删掉旧字段

---

## English

JSONL, one record per line, under `<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/`.
`self-experience.jsonl` holds her experiences. `then` is immutable; `later` is append-only. A damaged line is skipped on read, blocks rewrites, and is preserved when new records are appended. Diary lives in a separate file and is not loaded unless the host asks for it (`includeDiary: true`).

v1 flat records (`text` / `thought` at top level) are still readable; new writes use v2. Any future `schema` field must be ignored gracefully by older readers, and format changes must document migration without deleting old fields.
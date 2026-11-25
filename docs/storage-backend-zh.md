# 存储后端（阶段 1）

> 目标：把「记录存在哪」从「记录长什么样」里拆出来。换引擎**不改变契约**——`docs/contract-v1-zh.md` 只加了一个可选参数，五条「不承诺」一条没动。

## 一、现在有什么

| 后端 | 文件 | 依赖 | 适合 |
| --- | --- | --- | --- |
| `file` | `self-experience.jsonl` + 六个事件 JSONL | 无 | 现有部署、可读性、手工修复 |
| `sqlite` | `memory.sqlite` | Node 内置 `node:sqlite`（**>= 22.5**；22.13 起默认可用），不装第三方包 | 十万级以上、需要事务与索引 |

`memory.sqlite` 里三张表：

| 表 | 列 | 说明 |
| --- | --- | --- |
| `records` | `id` 主键、`day`（索引）、`at`、`json` | 经历，一条一行；`json` 就是 JSONL 里那一行 |
| `events` | `seq` 自增主键、`kind`、`exp_id`、`at`、`json`；索引 `(kind, exp_id)` | 六类事件，`seq` 就是追加顺序；`json` 就是原来那一行，形状不变 |
| `sources` | `file` 主键、`size`、`migrated_at` | 迁移时每个源 JSONL 的字节数，读库时拿来判断过没过期 |

`kind` 的六个值和原来的文件一一对应：

| kind | 原文件 | `exp_id` 存的是 |
| --- | --- | --- |
| `later` | `later-events.jsonl` | 经历 id |
| `seal` | `seal-events.jsonl` | 经历 id |
| `recall` | `recall-events.jsonl` | 经历 id |
| `unfinished` | `unfinished-events.jsonl` | 经历 id |
| `link` | `link-events.jsonl` | `from` 那条经历的 id |
| `chapter` | `chapter-events.jsonl` | 章节 id（不是经历 id） |

契约点名的是前四类。`link` 和 `chapter` 也一起搬，原因是 `loadAll` 同样要读它们：只搬四类，sqlite 读出来就没有联想和章节，正是「只搬一半、读一半就断」。

## 二、后端接口（两个后端都一样）

```js
import { openBackend } from 'whale-memory-core/storage/backend'
const db = await openBackend({ kind: 'sqlite', dir: memoryDir })
await db.append(record)
const rows = await db.all()
```

`node:sqlite` 拿不到时，**`openBackend` 这一步就报错**（`SQLITE_UNAVAILABLE`），不静默降级。要降级就显式写：

```js
try { db = await openBackend({ kind: 'sqlite', dir }) }
catch { db = await openBackend({ kind: 'file', dir }) }
```

| 方法 | 语义 |
| --- | --- |
| `append(record)` | 追加一条。sqlite 遇到重复 id 抛错（id 永不复用） |
| `appendEvent(kind, row, { mustExist })` | 追加一条事件，原样存这一行。`mustExist`：先确认指向的经历都在（联想两头都查；章节不指向经历，不查）；sqlite 里查和写在同一个事务。这是低层追加，不做「重复封存算 noop」这类业务判断 |
| `appendWithEvents(record, events)` | 仅 sqlite：一条经历加若干 `{ kind, row }`，**同一个事务**——任何一条失败（重复 id、事件不合格），整组都不落盘；在 `transaction()` 里调用也一样（这一组是一层 SAVEPOINT） |
| `all()` | 全部记录，按写入顺序。坏数据整体失败，不当空 |
| `events(kind)` | 某一类事件，按追加顺序。坏行、不合格行整体失败 |
| `byId(id)` | 取一条，没有返回 `null` |
| `byDay(day)` | 按本地日取（sqlite 有索引；file 走全量过滤） |
| `count()` | 条数 |
| `transaction(fn)` | 仅 sqlite：记录与事件都在这一个事务里，失败自动回滚；在 `fn` 里再调 `transaction()` 是一层 SAVEPOINT，内层失败只撤内层。file 后端没有（`capabilities.transactions === false`） |
| `close()` | 释放连接 |

不认识的 `kind` 两个后端都拒绝（包括 `constructor` 这类原型上的名字）。合格判据和读文件时完全同一条（各事件模块的 `isValid`）；读行时也和 `loadAll` 一样**不先 trim 再解析**，行首带 BOM 的行两边都算坏行。

sqlite 后端的事务规矩（一个后端对象只有一条连接）：

- **同一时刻只有一个事务**。不在这个事务调用链里的读写一律排队，等它结束——不会悄悄并进别人的事务、跟着别人一起回滚，也读不到别人还没提交的东西；
- 在事务自己的调用链里（`transaction(fn)` 的 `fn` 以及它 await 的一切），写入直接进这个事务；`appendWithEvents` / `appendEvent` / 嵌套的 `transaction()` 各包一层 SAVEPOINT；
- 同一个事务里别并发跑两个嵌套分组（`Promise.all` 两个嵌套 `transaction`）：SAVEPOINT 是栈，交错会乱；
- 事务里不能 `close()`（会自己等自己），直接拒绝。

## 三、上层读路径：`loadAll` / `recall` / `currentView` 的 `backend`

```js
import { loadAll, recall } from 'whale-memory-core/self-experience'
loadAll(dir)                          // 默认 file：和以前一模一样
loadAll(dir, { backend: 'sqlite' })   // 读 memory.sqlite
recall(dir, '海边', { backend: 'sqlite', limit: 3 })
```

- **默认 file，零行为变化**：不传 `backend` 走的还是原来那些读文件函数，调用顺序和参数都没变；默认路径的原有测试一条没改、全过。独立复审专门找过这一条的反例（错误抛出的先后、allowCorrupt、asOf、旧格式、重复 id、想起次数的缓存、示例副本），没找到。
- **逐条一致**：sqlite 在一次读事务里取整库快照（记录 + 六类事件），然后走**同一套**合并逻辑（后记合并、封存与 as-of、想起次数、出处与反向引用、联想、章节）。合并逻辑只有一份，所以同一份数据上两个后端结果逐条相等。测试在 936 个召回组合上逐条比过 id 序列和内容。
- **API 仍是同步的**：`node:sqlite` 的 `DatabaseSync` 本来就是同步的，用 `process.getBuiltinModule('node:sqlite')` 同步取。宿主不用改一行。只 import 不会碰 `node:sqlite`，Node 20 照常能加载。

sqlite 读路径的 fail closed（全部**抛错**，不当成空，也不退回 file）：

| 情况 | `error.code` |
| --- | --- |
| 拿不到 `node:sqlite` | `SQLITE_UNAVAILABLE` |
| 没有 `memory.sqlite`，但目录里有 JSONL 数据（没迁移过） | `STORAGE_NOT_MIGRATED` |
| 阶段 1 早期只有 `records` 表的库 | `STORAGE_INCOMPLETE` |
| 迁移之后 JSONL 又被写过（任何一个源文件字节数对不上） | `STORAGE_STALE` |
| 库本身读不出来 | `STORAGE_UNREADABLE` |
| 封存事件有坏行（和 file 一样） | `SEAL_EVENTS_CORRUPT` |

目录里既没有库、也没有任何 JSONL 数据：如实返回空数组。读路径**不会顺手建库**。

`recall({ backend: 'sqlite', mark: true })` 直接拒绝：写路径还在 JSONL 上，记下的想起 sqlite 看不见，两边的账会对不上。

## 四、迁移

```bash
node tools/migrate-storage.mjs <memory-dir>               # 演练：读、检查、报数，不写盘
node tools/migrate-storage.mjs <memory-dir> --write       # 建 memory.sqlite（记录 + 六类事件）
node tools/migrate-storage.mjs <memory-dir> --verify-only # 已有的库和源文件逐条对拍
```

规矩：

1. **源文件一个字节不改**——迁移是叠加，不是替换；
2. **同事务**：记录与六类事件在同一个事务里写；
3. **逐条对拍**：写完重新打开库，用 `loadAll` 同一条读路径读回来；条数、顺序、每条 JSON 逐字节相同，才算成功；
4. 任何一步失败（包括对拍失败）→ **整体回滚**，删掉半成品（连同 `-wal` / `-shm`），删完再确认一遍，删不掉就照实列出来，不留「迁移了一半」的库。库先建在临时文件 `.memory.sqlite.migrating-<pid>` 上，提交、关库之后才改名成 `memory.sqlite` 再对拍：进程中途被杀只会留下临时文件，不占正式文件名、不挡下一次迁移（下次运行会提示可以删）；
5. **拒绝迁移**、说清是哪一类，先修复再来：经历或事件文件有坏行或不合格行（迁过去会把「状态不确定」变成「确定」）；没有 id 的旧格式记录（0.10 之前写的）；重复 id；读的过程中源文件变了；
6. 目标已存在时**拒绝覆盖**，要重来请手工移走；
7. **回滚**：删掉 `memory.sqlite`（及 `-wal` / `-shm`）即可。源文件没动，file 后端照常。

退出码：`0` 成功 / `1` 失败（已回滚或对拍不一致）/ `2` 用法或前提不满足 / `3` 目标已存在。

## 五、实测（本机，Node 24）

**写入与按 id 取**（`node tools/bench-storage.mjs --n 20000 --lookups 500`，2 万条）：

| 后端 | 写入 2 万条 | byId p50 | byId p99 | 全量读（后端 `all()`） |
| --- | --- | --- | --- | --- |
| file | **133,242 ms** | 20.6 ms | 30.7 ms | 19 ms |
| sqlite | **206 ms** | 0.012 ms | 0.084 ms | 55 ms |

**上层读路径**（2 万条经历 + 23,400 条事件，取 5 次的中位数）：

| 后端 | `loadAll` | `loadAll`（asOf） | `recall`（limit 5） | 迁移耗时 |
| --- | --- | --- | --- | --- |
| file | 89 ms | 79 ms | 198 ms | — |
| sqlite | 127 ms | 105 ms | 208 ms | 0.7 s |

读法：

- **写入差 600 倍、byId 差 1700 倍**：file 后端每写一条都要 `open + 读末字节 + 写 + close`；file 的 `byId` 是「读全量 + 线性找」；
- **全量读和 `loadAll` 是 file 快**：sqlite 要逐行 `JSON.parse`，`loadAll` 又是全量合并。现在把读路径切到 sqlite **不会更快**（2 万条慢 1.4 倍左右，召回基本持平）。**别把 sqlite 当「一切更快」**——它的价值在写入、事务和按 id 取。读路径要受益，得等上层改成按需取（下一步）。

## 六、这一阶段没做的

- **写路径没切**：`addExperience` / `reviseExperience` / `setSealed` / `markRecalled` / `setUnfinishedState` / `linkExperiences` / 章节，仍然只写 JSONL。所以迁移之后再写，sqlite 就过期了——读库会报 `STORAGE_STALE`，不会悄悄读出一份少了东西的记忆。后端 API（`appendEvent` / `appendWithEvents`）已经备好，切写路径是下一步；
- **没有 id 的旧格式记录**不进 sqlite（`records` 按 id 存），这样的目录先留在 file 后端；
- **过期判断只比字节数**：只追加的文件，追加一定变长；同长度的手工改写查不出来；
- **没有多写者支持**：sqlite 有事务，但契约里「单写者」的承诺没改；
- `unsaid.jsonl`（抽屉）不在 `loadAll` 里，这一轮没搬；
- **只在 Node 24 上实测过**。没有 node:sqlite 的 Node（20、22.5 以下）上 sqlite 用例会跳过，file 用例照跑——用 `--no-experimental-sqlite` 模拟过，复审时也在真 Node 20 上复现过原来的失败；22.5–22.12（要加 `--experimental-sqlite`）没测。

## 七、下一步

1. 写路径接到后端：同一个动作（写经历、改主意、封存……）在 sqlite 下走 `appendEvent` / `appendWithEvents`，一次一个动作切，切一个对拍一个；
2. 写路径切完之后，`STORAGE_STALE` 的判据改成「切换之后 JSONL 不应再变」；
3. 读路径按需取：召回先用 sqlite 索引缩小候选，再合并——这时 sqlite 才在读上有优势。

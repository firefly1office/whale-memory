# 擦除与审计（阶段 4）

> 这一段只回答两个问题：**一条经历能不能真的从库里拿掉**，以及**拿掉之后还剩下什么可核的痕迹**。
> 方案是「整条撤回 + 墓碑」：正文物理删除，墓碑只留 id / 时间 / 原因 / 哈希。
> 契约里的扩写见 [`contract-v1-zh.md`](contract-v1-zh.md) 第一节与第六节。

## 一、能做到什么

| 能力 | 入口 | 说明 |
| --- | --- | --- |
| 单条物理删除 | `eraseExperience(dir, { id, reason, actor })` | 经历正文 + 关联事件一起删；`seal` 事件保留 |
| 墓碑 | 同一次调用自动追加 | `tombstones.jsonl`，只含 id / 时间 / 原因 / 哈希，**不含正文** |
| 审计 | `audit.*` | `audit.jsonl` 只追加；只记 id 与动作，不记正文；库内 API 删不掉 |
| 导出 | `exportMemory(dir, {...})` | 只读；封存内容默认导出并标 `sealed: true` |

配套：`loadAll` / `recall`（字面、混合、旧门槛）/ `page` / `doctor` / 导出 在擦除后都查不到被撤回的那条
（`tests/erase-audit-export.test.mjs` 逐项验过）。

## 二、擦除 `eraseExperience`

```js
import { eraseExperience } from 'whale-memory-core/erase'

eraseExperience('/path/to/memory-dir', {
  id: 'exp_xxx',        // 也收 0.10 之前那个唯一对应的旧 id
  reason: '她本人要求撤回', // 必填：写进墓碑（不写进审计）
  actor: 'self'          // 必填：谁要求的（self / leo / host……）
})
// → { ok: true, id, alreadyGone: false, at, hash, removed: { records: 1, later: 1, recall: 1, ... } }
```

- **谁调**：只由宿主在「她本人或 Leo 明确要求」时调用。库不自动擦除，也没有定时清理。
- **删什么**：
  - `self-experience.jsonl` 里那一行（同一个 id 的重复行一起删，结果里 `removed.duplicates` 记份数）；
  - `later-events.jsonl` / `recall-events.jsonl` / `unfinished-events.jsonl` / `link-events.jsonl` 里指向它的行；
  - 目录里有 `memory.sqlite` 时，同一个事务里删 `records` + `events`（联想两头都看）。
- **留什么**：
  - `seal-events.jsonl` 不动——封存是"别再主动提起"的状态记录，不是正文；删了反而让"曾经封存过"断掉；
  - `chapter-events.jsonl` 不动——章节按日子命名一段时间，不指向某一条经历；
  - 别的记录的正文**一个字节都不动**。包括它们 `then.refs` 里引用了被撤回这条：那是她当时写下的原文，
    不许替她删改；读的时候那段引用显示成「找不到了」（只留 id）。
- **幂等**：第二次调用返回 `{ ok: true, alreadyGone: true }`，不再写第二条墓碑。
- **原子**：每个文件都是「读全量 → 过滤 → 写 `.tmp` → `rename()`」（`file-lock.writeFileAtomic`），
  不会出现写了一半的经历文件。中途崩了最多留下"记录已删、墓碑还没写"的窗口：重跑一次会把残留事件清掉
  （`alreadyGone: true`），但**不会补写墓碑**——我们没看见过那条记录，写不出它的哈希。
- **拒绝的情形**（整次拒绝，一个字节都不改）：
  - 经历文件或要重写的事件文件里有坏行（坏行说不清是不是那条，不假装删干净）；
  - 墓碑文件有坏行（确认不了这条是不是已经撤回过）；
  - 目录里有 `memory.sqlite` 但打不开 / 缺表（一边能删一边删不了最糟）；
  - 旧 id 被几条旧经历共用（不猜，先用 `read` 看当前 id）。
- **SQLite 的两个取舍**：
  - 墓碑在删除提交之后才写：**墓碑写失败不回滚删除**（记录已经没了，回滚等于把正文放回去）。这时抛
    `ERASE_TOMBSTONE_FAILED`，消息里明说"记录已删、墓碑没写"。
  - 擦除前库和 JSONL 对得上 → 删完刷新 `sources` 的字节数，库继续可读；本来就过期 → 照删，但**不刷新**，
    库继续保持过期（读路径 fail closed），不让一个缺记录的库看起来是新的。

## 三、墓碑 `tombstones.jsonl`

一行一个 JSON：

```json
{ "v": 1, "id": "exp_xxx", "at": "2026-11-26T10:00:00.000Z", "reason": "她本人要求撤回", "actor": "self", "hash": "<64 位十六进制>" }
```

- `hash` = 删除前**那一行原样字节**的 sha256（不含行尾换行；Windows CRLF 的 `\r` 也不算）。
  拿一份备份就能对：那一行的哈希必须和墓碑对上。
- **不含正文，不可用于恢复**。它只说"有过这一条、什么时候、为什么没的"。
- 只追加；库内没有删除/清空墓碑的 API（要动只能人拿编辑器来）。
- 体检（`doctor`）会核对两件事：封存事件指向的 id 在墓碑里也算"存在"；**已撤回的 id 不许又出现在经历文件里**
  （撤回没生效或被恢复）。

## 四、审计 `audit.jsonl`

```js
import * as audit from 'whale-memory-core/audit'

audit.noteRead(dir, { actor: 'self', ids: ['exp_a'] })            // 读
audit.noteRecall(dir, { actor: 'self', query: '灯塔', ids: ['exp_a'] }) // 召回：只留查询的 sha256
audit.readRecord(dir, id, { actor: 'self' })                      // 读一条并留痕（找不到也留）
audit.recall(dir, '灯塔', { actor: 'self', limit: 3 })             // 召回并留痕
audit.read(dir, { since, until, action, actor })                  // 只读查询
```

- 行形状：`{ at, actor, action, ids, note }`。`action` 至少三类：`read` / `recall` / `erase`。
- **不记正文**：不记原话、不记后记、不记摘要；召回只写 `note: "qsha256:<hex>"`（查询的 sha256）与命中 id。
  擦除时 `reason` 也不进审计（它可能有人写的话），只写 `note: "tombstone"`。
- **库内 API 删不掉**：只导出追加与只读查询，没有删除/清空/改写。擦除不会碰审计文件。
- **为什么不自动挂在读路径上**：`loadAll` / `recall` 是纯读（备份、体检、评测都靠它们），在库里偷偷写文件
  会让"读"不再只读，只读盘上的库也会直接报错。宿主在"要留痕"的边界调 `noteRead` / `noteRecall`；
  `eraseExperience` 自己写 `erase` 那一条。
- 审计文件有坏行 → `audit.read` 抛 `AUDIT_CORRUPT`（宁可报错，也不给一份看起来没问题的审计），
  `doctor` 的「坏行」项也会因此变红。

## 五、导出 `exportMemory`

```js
import { exportMemory } from 'whale-memory-core/export-memory'

exportMemory(dir)                                   // 整份：封存内容也在，标 sealed: true
exportMemory(dir, { includeSealed: false })         // 完全排除封存内容
exportMemory(dir, { from: '2026-11-01', to: '2026-11-30' })  // 按本地日截，含端点
exportMemory(dir, { personId: 'p_2' })              // 只导这个人的
```

- 每一行就是 `loadAll` 在同条件下返回的那一条，唯一差别是封存状态记成 `true`（不导出封存理由）。
  因此"导出与同条件全量读逐条一致"是可验证的。
- `personId`：v1 记录本身不带 person 字段；只有宿主把 `personId` 写进 `then.state` 时这个过滤才有意义
  （没有这个字段的记录不算这个人）。
- 只读：不写回任何数据文件，不建目录，不追加审计/墓碑。
- 规模：整份导出必然把全部记录读进内存（`loadAll` 的代价）。十万条以上内存吃紧时，用
  `self-experience.iterate` 一条一条自己写文件。

## 六、做不到什么（显眼写在这里）

- **加密**：数据是明文（JSONL / SQLite 都是）。磁盘加密、文件系统权限归宿主，库不做。
- **多写者**：同一目录并发写会丢行（契约 §6）。擦除与写入也不能并发；擦除自己串行化，但跨进程的
  其它写入不在它的锁里。
- **备份 / 快照里的历史副本不追溯**：擦除只动当前数据目录。之前打过的备份包、系统快照、别的机器上的副本，
  里面那一行还在；要把它们也抹掉，得自己处理。恢复旧备份会把正文带回来，墓碑也会一起回来，
  `doctor` 会报"已撤回的 id 又出现"——这正是"不追溯"的可见后果。
- **SQLite 文件里的残留字节**：删行之后旧字节可能还留在数据库文件页里（没有 `VACUUM` / `secure_delete`）。
  逻辑上查不到，物理碎片不承诺。
- **引用悬空**：别的记录 `then.refs` 里指向被撤回那条的 id 会留着（记录不可变，不替她删改），
  读的时候显示「找不到了」。
- **封存事件保留**：`seal-events.jsonl` 里那条 id 还在（只有 id / 动作 / 她写的封存理由，没有正文）。
- **整库删除**：仍是 CLI 的 `purge`（连目录一起）；不在这个 API 里。

不写「满足合规要求」这类话——这里只有上面这些能力，够不够用由用的人自己判断。

## 七、文件一览（一个目录里会多出什么）

| 文件 | 什么时候出现 | 谁写 |
| --- | --- | --- |
| `tombstones.jsonl` | 第一次撤回成功后 | `eraseExperience` |
| `audit.jsonl` | 第一次调 `audit.*` 或第一次撤回 | `audit` / `eraseExperience` |
| `erase.lock` | 撤回进行中（一个目录，结束自动删） | `eraseExperience` |

两个文件都跟着备份包走（`archive.exportArchive` 收目录里的全部文件）。

## 八、没验什么

- 没在**真实数据目录**上跑过擦除（只跑临时目录）。真实目录的擦除应由宿主在明确要求时做，并先备份。
- 没验 Windows 上杀进程正好落在"记录已删、墓碑未写"那一瞬的重跑（只按代码路径推演过，见第二节）。
- 没验十万条规模下擦除的耗时与内存（擦除要整读一遍经历文件 + 要重写的事件文件）。
- 没验 SQLite 已过期时擦除后的重迁移（预期：过期照旧，重迁移后正常）。
- 没验备份恢复与墓碑同时存在时的完整流程（只验了 `doctor` 会报"已撤回的 id 又出现"）。
- 没做外部独立复审（写这一段时的做法：先写测试再写实现，测试全部是临时目录）。

## 九、复跑

```bash
node --test tests/erase-audit-export.test.mjs
node tools/check-syntax.mjs
node tools/run-tests.mjs
node tools/sync-dsh-core.mjs --check
node tools/eval-v2.mjs --check
```
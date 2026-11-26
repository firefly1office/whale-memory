# 擦除与审计（阶段 4）

> 这一段只回答两个问题：**一条经历能不能真的从库里拿掉**，以及**拿掉之后还剩下什么可核的痕迹**。
> 方案是「整条撤回 + 墓碑」：正文物理删除，墓碑只留 id / 时间 / 原因 / 哈希。
> 契约里的扩写见 [`contract-v1-zh.md`](contract-v1-zh.md) 第一节与第六节。

## 一、能做到什么

| 能力 | 入口 | 说明 |
| --- | --- | --- |
| 单条物理删除 | `eraseExperience(dir, { id, reason, actor })` | 经历正文 + 关联事件一起删（含挂在 0.10 之前旧 id 上的事件）；`seal` 事件保留 |
| 墓碑 | 同一次调用自动追加 | `tombstones.jsonl`，只含 id（及用过的 ids）/ 时间 / 原因 / 哈希，**不含正文** |
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
// → { ok: true, id, alreadyGone: false, at, hash, tombstone: true, removed: { records: 1, later: 1, recall: 1, ... } }
```

- **谁调**：只由宿主在「她本人或 Leo 明确要求」时调用。库不自动擦除，也没有定时清理。
- **删什么**：
  - `self-experience.jsonl` 里那一行（同一个 id 的重复行一起删，结果里 `removed.duplicates` 记份数）；
  - `later-events.jsonl` / `recall-events.jsonl` / `unfinished-events.jsonl` / `link-events.jsonl` 里指向它的行；
  - **挂在 0.10 之前旧 id 上的事件也一起删**（那时文件里没有 `id`，后记/想起挂在 12 位旧 id 上；
    这一条在 0.26.1 修过：只按当前 id 删会留下后记正文）；
  - 目录里有 `memory.sqlite` 时，同一个事务里删 `records` + `events`（联想两头都看）。
- **留什么**：
  - `seal-events.jsonl` 不动——封存是"别再主动提起"的状态记录，不是正文；删了反而让"曾经封存过"断掉；
  - `chapter-events.jsonl` 不动——章节按日子命名一段时间，不指向某一条经历；
  - 别的记录的正文**一个字节都不动**。包括它们 `then.refs` 里引用了被撤回这条：那是她当时写下的原文，
    不许替她删改；读的时候那段引用显示成「找不到了」（只留 id）。
- **幂等**：第二次调用返回 `{ ok: true, alreadyGone: true, tombstone: true }`，不再写第二条墓碑。
  id 抄错（本来就没有这条）同样是 `alreadyGone: true`，但 `tombstone: false`——宿主能分清「已撤回」和「根本没有」。
- **原子**：每个文件都是「读全量 → 过滤 → 写 `.tmp` → `rename()`」（`file-lock.writeFileAtomic`），
  不会出现写了一半的经历文件；**墓碑写下之前任何一步失败，已经改过的文件按原样放回去**（`journal`），
  所以"事件文件只读"这类失败不会留下半条。先删事件、再删经历：万一进程在中间被杀，记录还在，
  重跑还能把墓碑补出来（墓碑的哈希取自那条记录）。中途崩了只剩一种窗口：记录已删、墓碑还没写、
  重跑走 `alreadyGone` 时**补不出墓碑**——我们没看见过那条记录，写不出它的哈希。
- **拒绝的情形**（整次拒绝，一个字节都不改）：
  - 经历文件或要重写的事件文件里有坏行（坏行说不清是不是那条，不假装删干净）；
  - 墓碑文件有坏行（确认不了这条是不是已经撤回过）；
  - 目录里有 `memory.sqlite` 但打不开 / 缺表（一边能删一边删不了最糟）；
  - 旧 id 被几条旧经历共用（不猜，先用 `read` 看当前 id）。
- **SQLite 的两个取舍**：
  - 删除与 `sources` 更新在**同一个事务**里：要么都成、要么都不成，不会出现"记录删了、source 还挂着旧尺寸"。
  - 擦除前库和 JSONL 对得上 → 事务里把 `sources` 刷成现在 JSONL 的字节数，库继续可读；本来就过期 →
    照删，但把 `sources` 全写成 `-1` 哨兵，库**继续保持过期**（读路径 fail closed）。只靠"不刷新"不够：
    JSONL 删小之后可能恰好缩回迁移时记的字节数，会被误判成"对得上"（0.26.1 修过这个巧合）。
  - 墓碑在 SQLite 删除之后才写（墓碑不会早于删除出现）。墓碑写失败会回滚文件、抛 `ERASE_TOMBSTONE_FAILED`；
    万一 SQLite 那边的删除已经提交，库会因为 `sources` 对不上而判为过期，重新迁移即可。
- **审计追加上失败**：墓碑写完之后审计追加失败会抛 `ERASE_AUDIT_FAILED`；重跑是 `alreadyGone`，
  不会再补这一条（避免每次重试都堆一行审计）。要补齐只能人拿编辑器核对。
- **record 已经不在、事件还在**（崩溃后重跑）：返回 `alreadyGone: true, tombstone: false`，顺手清掉残留事件；
  **不写墓碑**——我们从没看见过那条记录，写不出它的哈希。但这次如果确实清掉了东西（事件或库里的行），
  审计会留一条 `note: "already-gone-cleanup"`（0.26.2 起）：真删了东西，事后就得能查到。
  这条审计**失败不再被吞掉**：返回里带 `auditFailed: true`（0.26.3 起），调用方能知道"删了但没留痕"。
- **已经撤回过、记录又被带回来**（手工恢复备份）：再撤一次会**真的删掉**，返回 `resurrected: true`，
  不写第二条墓碑，审计记 `erase-resurrected`（0.26.3 起）。0.26.2 在这里会返回"已撤回"但什么都不删。
- **共用旧 id 的一条被撤回之后**：同一个旧 id 被两条以上经历用过时，撤回其中一条，剩下那条会"独占"这个旧 id，
  原本指向旧 id 的后记可能被算到它名下——旧数据里没有区分手段。0.26.2 起墓碑会记下这个旧 id
  （`ambiguousIds`），`doctor` 会提示"N 个共用旧 id 仍有别的记录在用"，读路径维持"对不上就不归任何人"。
  要彻底干净，先迁移到带当前 id 的版本，再撤回。

## 三、墓碑 `tombstones.jsonl`

一行一个 JSON：

```json
{ "v": 1, "id": "exp_xxx", "ids": ["exp_xxx"], "at": "2026-11-26T10:00:00.000Z", "reason": "她本人要求撤回", "actor": "self", "hash": "<64 位十六进制>" }
```

- `hash` = 删除前**那一行原样字节**的 sha256（不含行尾换行；Windows CRLF 的 `\r` 也不算）。
  拿一份备份就能对：那一行的哈希必须和墓碑对上。
- `ids`（0.26.1 起，可选）：这一条经历在库里用过的所有 id（当前 id + 0.10 之前的旧 id）。
  按旧 id 撤回时墓碑的 `id` 是旧 id，封存事件却挂在当前 id 上——体检靠这个字段把两边的账对上；
  老墓碑没有这个字段照样读。
- **不含正文，不可用于恢复**。它只说"有过这一条、什么时候、为什么没的"。
- 只追加；库内没有删除/清空墓碑的 API（要动只能人拿编辑器来；整目录导入见第六节）。
- 体检（`doctor`）会核对：封存事件指向的 id 在墓碑里也算"存在"；**已撤回的 id 不许又出现在经历文件里**
  （撤回没生效或被恢复）；墓碑 / 审计有坏行时「坏行」项要红。

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
- **库只校验形状**：`note` 限 500 字；`ids` / `actor` / `note` 里"不含正文"是由宿主保证的——
  库挡不住一个故意把原话当 id 或 note 塞进来的宿主。要证明默认路径不漏，见测试里"正文关键词 0 命中"那条。
- **库内 API 删不掉**：只导出追加与只读查询，没有删除/清空/改写。擦除不会碰审计文件。
  （整目录导入是另一件事：`archive.importArchive` 按导入包整体替换目录，见第六节。）
- **为什么不自动挂在读路径上**：`loadAll` / `recall` 是纯读（备份、体检、评测都靠它们），在库里偷偷写文件
  会让"读"不再只读，只读盘上的库也会直接报错。宿主在"要留痕"的边界调 `noteRead` / `noteRecall` /
  `readRecord` / `recall`；`eraseExperience` 自己写 `erase` 那一条。
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
  里面那一行还在；要把它们也抹掉，得自己处理。
  **库自己的恢复（`importArchive`，0.26.3 起）不会把已撤回的经历带回来**：导入时会把现有墓碑里的 id 从
  新目录里剔掉（返回 `skippedTombstoned` 是剔掉几条），墓碑与审计也一并保留。所以"翻出擦除前的备份"不能
  让这条经历复活。别的工具手工覆盖目录不在此列——那种情况下记录会回来，但再撤一次也能真的删掉
  （返回 `resurrected: true`，审计记 `erase-resurrected`）。
- **SQLite 文件里的残留字节**：擦除路径会先开 `secure_delete`（0.26.2 起），删完再按原始字节搜整个目录
  搜不到正文（`tests/erase-audit-fixes.test.mjs` 有一条按字节扫全目录的测试）。
  **前提是没有别的连接正开着**：WAL 模式下如果另有读者，`wal` 可能来不及截断，旧页会留到下次检查点；
  这时删不掉的是"物理字节"，接口层依旧读不到。`VACUUM` 不做——代价是擦除期间空闲页被写零，慢一点。
- **引用悬空**：别的记录 `then.refs` 里指向被撤回那条的 id 会留着（记录不可变，不替她删改），
  读的时候显示「找不到了」。
- **正文的三处副本不在范围内**：① `seal-events.jsonl` 里那条封存的 `note`（最多 200 字自由文本，
  可能提到原话）；② **别的记录**的 `recall-events.query`（查询原文，可能提到这件事）；③ 别的记录的后记里
  转述的话。擦除只按"这条经历自己的 id"删，扫不到别人的文本；记录不可变，也不许替别人改。
- **封存事件保留**：`seal-events.jsonl` 里那条 id 还在（只有 id / 动作 / 她写的封存理由，没有正文）。
- **整目录导入会整体替换**：`archive.importArchive(..., { force: true })` 按导入包替换整个记忆目录，
  墓碑与审计也跟着被替换（旧目录会留在 `*.pre-import-*`，可人工救回）。所以"库内 API 删不掉墓碑/审计"
  说的是本模块没有删除接口，不是说任何库内操作都动不了它们。
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
- 没验 Windows 上杀进程正好落在"记录已删、墓碑未写"那一瞬的重跑（只按代码路径推演过，见第二节；
  写入失败的回滚用注入 `rename` 失败验过）。
- 没验十万条规模下擦除的耗时与内存（擦除要整读一遍经历文件 + 要重写的事件文件）。
- 没验 SQLite 已过期时擦除后的重迁移（预期：过期照旧，重迁移后正常；已验过期不会被误判成"对得上"）。
- 没验备份恢复与墓碑同时存在时的完整流程（只验了 `doctor` 会报"已撤回的 id 又出现"）。
- 0.26.0 之后做过一次**独立只读复审**（同模型的新会话、只读仓库）：确认主路径干净，抓到三个必须修
  ——旧 id 上的事件没删、按旧 id 撤回后体检永久红灯、过期库的字节数巧合——都在 **0.26.1** 修掉并补了测试
  （见 `tests/erase-audit-export.test.mjs` 的 5 条新用例）。复审不是外部第三方，只算第二双眼睛。
- 本地 Node 20/24 跑过全量；**GitHub Actions 的 Windows 两项在阶段 3（447d438）就已经是红的**（同名 `tests`
  步骤），和本段无关，没有去查它；发布走的 workflow 在 ubuntu Node 24 上 `npm run check` 通过。

## 九、复跑

```bash
node --test tests/erase-audit-export.test.mjs
node tools/check-syntax.mjs
node tools/run-tests.mjs
node tools/sync-dsh-core.mjs --check
node tools/eval-v2.mjs --check
```
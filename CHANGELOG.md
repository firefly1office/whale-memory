# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.28.1] - 2026-11-27

### Fixed

- **npm 包里带上了 schema 与契约正文**：新增 `prepack`，发布前把 `schemas/record.v1.json` 与
  `docs/contract-v1-zh.md` 复制进包内；tarball 从 109 个文件变成 111 个。之前装包的人看不到"数据长什么样"。
- **契约里的版本口径**：`erase` / `exportMemory` / 墓碑 / 审计这几处原来写"v1.1 起"，它们在 0.26 就已实现，
  改成"0.26 起"，避免和库版本号混着读。

## [0.28.0] - 2026-11-27

### Added

- **`factKey`：事实键式取代（默认关，只做数据层）**：`packages/core/lib/fact-key.js` + `fact-events.jsonl`。
  同一个 `对象.方面` 再记一次就是取代上一代——旧的只标 `supersededBy`、不进"现行事实"，但**东西留着能撤销**；
  不同键互不影响；坏行 fail closed。**这一版不接召回、不进注入、不进 SQLite、不自动抽取**。
  `erase` 撤回一条经历时连带清掉 `expId` 指向它的事实事件（`removed.fact`），上一代自动重新生效。
  口径与"没做"清单见 `docs/fact-key-zh.md`；借鉴 Yuuyuko-uu/dsh-fish-memory 的设计（自定义许可，未复制代码）。
- **`sessionCard`：开局短卡（默认关，纯函数）**：`packages/core/lib/session-card.js`。一觉醒来的第一段话，
  只钉三件最容易出事的事——认人（名字）、档案位置、"**读不到别编**"；≤ 220 字，超长字段按方向截断
  （名字留头、路径留尾），纪律那一行永不截断。**不读盘、不发请求**（源码里没有 fs / http / fetch）；
  不传 `enabled: true` 返回空串，宿主不用加分支。
- **`docs/discipline-zh.md`：三档纪律**（可数 7 / 半可数 4 / 不可数 6，共 17 条）——按"机制能不能查"
  把我们说过要守的规矩分档，避免把"希望"写成"系统保证"。三档写法借自 dsh-xiaoyu-wake 的 `DISCIPLINE.md`。
- **写路径切 SQLite（阶段 1 的尾巴）**：`addExperience` / `reviseExperience` / `setSealed` / `markRecalled`
  收可选参数 `{ backend: 'sqlite', dualWrite }`——记录与事件进 `memory.sqlite`，一次写入一个事务，
  提交前刷新 `sources`；`dualWrite: false` 时只写库、JSONL 一个字节不动；`recall({ backend: 'sqlite', mark: true })`
  解禁。默认仍是 `file`，不传参数行为与 0.27.0 逐字相同。
  **对拍**：同一串 8 个动作在 file / sqlite 两个后端读出来逐字段相同（唯一不同的是随机 `exp_` id）。
  **崩在两步之间**：JSONL 多一行、库没提交 → 读库报 `STORAGE_STALE`（fail closed），移走库重新迁移即恢复。
  `setUnfinishedState` / `linkExperiences` / 章节仍只写 JSONL，迁移后用它们会让库过期（同样 fail closed）。
  见 `docs/storage-backend-zh.md` §3.1。
- **真向量接入通路（Ollama bge-m3，默认关）**：`recall({ ranker:'embed', embed, embedKind })` 可以注入
  同步向量函数；每条命中带 `embedKind` 自报家门（默认 `stub:char-ngram-hash`，一眼看出是桩）。
  新增 `tools/ollama-embed.mjs`（零依赖）：`probe` / `warm`（批量喂 Ollama、向量落磁盘缓存、原子替换）/
  `makeCachedEmbedder`（同步只查缓存，缺了抛 `EMBED_CACHE_MISS`，**不偷偷退回桩**）。
  `tools/eval-v2.mjs` 加 `--embed-cache`/`--embed-model`，报告首行明写"真向量"还是"桩——未接入真模型"。
  **本机没有 Ollama**：HTTP 通路只用本地假服务验过，真模型的三组数没有（见 `docs/embed-zh.md`）。
  评测里的 embed 仍是桩（452 条 recall@10 77.1% / MRR 0.761），**不能当语义效果**。
- **线索表（T12，默认关）**：`packages/core/lib/cue-table.js` + `injection.surface({ cueTable, cueGate, turn })`。
  给每条没封存的经历抽"将来可能被问到的词"（复用召回的两字组/英文整词，按稀有度取前 8 个）；消息的
  词被某条经历盖住 ≥60% 时，在递记忆的 block 前插**一行**迟疑提醒（"我好像有点印象，但不一定对得上"），
  频控为同标题连贴 ≤3 次、间隔 ≥2 轮。**452 条用例对照**：基线递 291 条，只插迟疑仍 291 条（少注 0、多注 0），
  迟疑提醒 99 条、精度 99.0%、负面用例上 0 条。可选的旁路预筛（`cuePrefilter:'short'|'any'`）会少注
  34–35 条（约 12%），所以**默认不跳过**。见 `docs/cue-table-zh.md`。

## [0.27.0] - 2026-11-26

### Added

- **`recall({ ranker: 'embed' })`（默认关）**：`packages/core/lib/embed-recall.js`，接在 `recall` 的 ranker 分支上；
  门禁仍走防编造覆盖率，不参与放行。**这一版是"通路"不是"效果"**：本机没有 Ollama，用的是确定性的字符
  n-gram 哈希桩，不是 bge-m3；接口留了 `embed` 注入参数，有真模型时替换即可。452 条用例三组数：
  literal 71.1% / hybrid 77.6% / embed 77.1%（留出集 70.7 / 77.8 / 76.8）——**embed 这个数不能当语义收益**。
  `tools/eval-v2.mjs` 支持 `--ranker=embed`；`tests/embed-recall.test.mjs` 守着"默认关时与 0.26.3 逐字相同"。
- **`manners`（知道不等于说，默认关）**：`packages/core/lib/manners.js`——场合（owner-private / other-private /
  group / public）× 敏感度（normal / private / secret）× 来源（owner-said / other-said / herself / unknown）
  → `say` / `paraphrase` / `withhold`，命中顺序写死七条，认不出的取值按最严兜底。不传 `enabled` 时恒为
  `say` 且标 `off`，关闭时提示行返回空串，宿主不用加分支。口径与边界见 `docs/manners-zh.md`
  （`withhold` 不得写成"我不记得"；`paraphrase` 不是脱敏器）。
- 借鉴说明：`manners` 的分寸模型参照 dsh-rugu（MIT）的"知道不等于说"；衰减/钉住（未合入本仓库）参照 Lysmor
  （AGPL，只学设计不抄代码）。见 `docs/attribution-zh.md`。

## [0.26.3] - 2026-11-26

### Fixed

- **恢复"擦除之前"的备份之后，那条记录再也擦不掉**（独立复审必修 1）。0.26.2 里 `erase` 一看到墓碑就直接返回
  "已撤回"，可记录其实被恢复带回来了：正文还读得到、体检永久红灯。现在：
  - 判断改成"墓碑有、记录真的不在"才算已撤回；记录在就照删，返回 `resurrected: true`、审计记
    `erase-resurrected`、不写第二条墓碑；
  - `importArchive` 恢复时**不再把已撤回的记录带回来**：导入时按墓碑 id 剔掉，返回 `skippedTombstoned`。
    墓碑与审计照旧并入新目录。
- **共用旧 id 的读路径会误伤显式 id 的记录**（复审必修 4）。0.26.2 直接删事件 map 的键；如果某条记录的
  **显式 id 恰好等于那个旧 id**，它自己的后记会从读路径消失。现在改成不删键，由 `mergeRow` / `attachLinks`
  在"这条记录自己的旧 id"这一层跳过。
- **清理残留时审计写失败被吞掉**（复审必修 3）：这条路上如果审计追加失败，返回里带 `auditFailed: true`。
- **文档口径**（复审必修 2、5）：恢复备份后的行为、以及"WAL 模式下另有连接开着时旧页可能留到下次检查点"
  这两处照实改；上一版 CHANGELOG 里"文档同步写明"那句补上对应的两段。
- **共用旧 id：读路径没有真的"对不上就不归任何人"**（小鱼复审 P4 抓到）。0.26.2 只把共用旧 id 记进了墓碑
  （`ambiguousIds`），读的时候仍然会把挂在旧 id 上的后记算到剩下那条记录名下。现在 `readSide` 会把这些
  旧 id 上的事件（后记 / 未完成 / 想起次数）从读路径上跳过：擦除不该改变别的记录读出来的样子。
  事件本身留在盘上（它属于那个旧 id，不属于剩下那条），文档同步写明。
  补一条读路径的测试：擦掉甲之后，写给甲的旧后记不会出现在乙名下。

### Tests

`tests/erase-audit-fixes.test.mjs` 6 条：按字节扫全目录、恢复不复活、残留清理留审计、共用旧 id 记墓碑、
共用旧 id 读路径、复活后重撤。每条都在对应实现被改坏时变红。

## [0.26.2] - 2026-11-26

### Fixed

验收（`交接/验收-阶段4-擦除与审计-20261126.md`）里的三条必修 + 一条需要拍的，全部修掉，并补了会红的测试
（`tests/erase-audit-fixes.test.mjs`，4 条；5 处变异都能被它抓住）：

- **恢复「擦除之前」的备份会悄悄撤销擦除**：`importArchive` 整目录替换时，把现有目录的 `tombstones.jsonl` 与
  `audit.jsonl` 并进新目录。记录按备份回来，但墓碑和擦除审计不会被抹掉，`doctor` 的「已撤回的 id 又出现」才真的会亮。
- **有 `memory.sqlite` 时擦除后正文还留在库文件里**：`eraseFromStore` 在事务前开 `PRAGMA secure_delete = ON`。
  新增一条按**原始字节扫整个目录**的测试：正文、当时的想法、没弄完的事、后记、结案备注、联想理由六样，擦完都搜不到。
- **记录行已不在、但清掉了残留事件时没有审计**：`alreadyGone` 且 `removed` 非零时补一条
  `action: "erase", note: "already-gone-cleanup"`。文档同步改口（原来只说"不写墓碑"）。
- **共用旧 id**（两条 0.10 前的记录同一分钟、共用一个旧 id）：擦掉其中一条时，墓碑新增可选 `ambiguousIds`
  记下这个旧 id；`doctor` 在「封存一致性」里提示"N 个共用旧 id 仍有别的记录在用"。读路径维持"对不上就不归任何人"，
  文档写清这是已知限制与绕法（先迁移再撤回）。

文档 `docs/erase-audit-zh.md` 第六节改了两处口径：备份恢复（库自己导入会并入账本）、SQLite 残留字节
（擦除路径承诺按字节搜不到；其余删除路径不保证）。

## [0.26.1] - 2026-11-26

### Fixed

独立只读复审抓到的三个必须修（都在 `tests/erase-audit-export.test.mjs` 里补了会红的用例）：

- **按当前 id 撤回 0.10 之前的旧格式记录时，挂在旧 id 上的后记/想起不删**：`eventIds` 只收了当前 id，`later-events.jsonl` 里后记正文留在盘上、`removed.later` 还谎报 0。现在把「这条记录用过的旧 id」一起算进要删的事件 id；SQLite 那侧同样带上。
- **按旧 id 撤回一条封存过的经历后体检永久红灯**：`seal-events.jsonl` 里的 id 是当前 id，墓碑只记了调用方给的旧 id，体检就把它当成孤儿。墓碑新增可选 `ids`（当前 id + 旧 id，只加不减、老墓碑照样读），体检的「已撤回」集合同时认 `id` 与 `ids`；`tombstones.byId()` / `ids()` 也跟着认。同时把「已撤回的 id 又出现在经历文件里」做成测试。
- **过期 SQLite 库能被擦除「伪装成新的」**：擦除会把 JSONL 删小，若恰好缩回 `sources` 里记的字节数，`checkFresh` 就误判成对得上——`loadAll(backend:'sqlite')` 静默少记录、`doctor` 还写「和 JSONL 对得上」。现在删除与 `sources` 更新在同一个事务里；擦除前就过期的库，事务里把 `sources` 全写成 `-1` 哨兵，让它继续过期（读路径 fail closed）。`doctor` 的「迁移状态」另外核对两边的条数。

### Added

- `eraseExperience` 的返回新增 `tombstone: boolean`：`alreadyGone` 时区分「已撤回（墓碑在）」与「本来就没有（id 可能抄错）」。
- **写到一半失败会整体回滚**：写每个文件之前把原文记进 journal；墓碑写下之前任何一步失败（含 SQLite 步骤失败），已经改过的文件按原样放回去，并抛「擦除没有完成（已放回）」。删除顺序改成先事件、后经历——万一进程被杀，记录还在，重跑能把墓碑补出来。
- `audit.record` 的 `note` 限 500 字（审计只记动作，不记正文）；文档写明 `ids` / `actor` / `note` 的「不含正文」由宿主保证。

### Docs

- `docs/erase-audit-zh.md`：旧 id 事件、墓碑 `ids`、回滚与顺序、`sources` 哨兵、`tombstone` 标志，以及三处**做不到**的正文副本（seal 的 note、别的记录的 recall query、别人后记里的转述）与整目录导入会替换墓碑/审计。
- `docs/contract-v1-zh.md`：§2.1 补登记 `tombstones.jsonl` / `audit.jsonl`；§3.6 第一条改成「展示型导出必须尊重封存」（原文无条件，与新增的数据导出口径冲突）。

## [0.26.0] - 2026-11-26

### Added

- **整条撤回 `eraseExperience(dir, { id, reason, actor })`（阶段 4，方案 A）**：把一条经历连同挂在它身上的 `later` / `recall` / `unfinished` / `link` 事件**物理删除**；目录里有 `memory.sqlite` 时同一个事务里删 `records` + `events`（联想两头都看）。`seal-events.jsonl` 留着（封存是"别再主动提起"的状态记录，不是正文），`chapter-events.jsonl` 不指向经历所以不动。每写一个文件都是「读全量 → 过滤 → 写 `.tmp` → rename」，不会出现写了一半的经历文件。**幂等**：第二次调用返回 `{ ok: true, alreadyGone: true }`，不再写第二条墓碑。参数不全、经历/事件文件有坏行、墓碑文件有坏行、SQLite 副本打不开或缺表、旧 id 被几条旧经历共用——**整次拒绝，一个字节都不改**。
- `packages/core/lib/tombstones.js` + `tombstones.jsonl`：撤回成功后只留一块墓碑 `{ v: 1, id, at, reason, actor, hash }`；`hash` = 删除前那一行**原样字节**的 sha256（不含行尾换行）。**不含正文、不可恢复**；只追加，库内没有删除/清空 API。
- `packages/core/lib/audit.js` + `audit.jsonl`：只追加的审计 `{ at, actor, action, ids, note }`，三类动作 `read` / `recall` / `erase`。**只记 id 与动作，不记正文**；召回只写 `note: "qsha256:<hex>"`（查询的 sha256）与命中 id；擦除的 `reason` 也不进审计。`audit.read({ since, until, action, actor })` 只读查询；`audit.readRecord` / `audit.recall` 是宿主边界用的「读了就留痕」包装。库内 API 删不掉审计；有坏行时 `audit.read` 抛 `AUDIT_CORRUPT`，不返一份看起来没问题的审计。
- `packages/core/lib/export-memory.js`：`exportMemory(dir, { personId?, from?, to?, includeSealed? })` → JSONL 文本，只读、不写回任何数据文件。每一行就是 `loadAll` 在同条件下返回的那一条，唯一差别是封存状态记成 `sealed: true`（不导出封存理由）；`includeSealed: false` 时完全排除。`personId` 匹配 `then.state.personId`（v1 记录本身不带 person 字段）。
- `tools/doctor.mjs`：封存一致性现在把**墓碑里的 id 当成「存在」**（否则每撤回一条封存过的经历体检就永远红灯），并反着核对「已撤回的 id 不许又出现在经历文件里」；坏行项额外检查 `tombstones.jsonl` 与 `audit.jsonl`。仍然是六项、仍然只读、仍然不记正文。
- 测试：`tests/erase-audit-export.test.mjs`（8 条）——擦除后 `loadAll` / `recall`（字面 / 混合 / 旧门槛 loose）/ `recallForContext` / `page` / `exportMemory` / `doctor` 都查不到；其它记录的原始行一个字节没动；墓碑只有 id/时间/原因/哈希且哈希对得上；幂等；参数不全、坏行、事件文件读不出来都整次拒绝；审计三次动作各一条且正文关键词 0 命中（含查询原文不进审计）；导出与同条件全量读逐条一致；SQLite 副本一起删且刷新 `sources` 后仍可读。
- `docs/erase-audit-zh.md`：能力、三个文件的格式、拒绝 / 崩溃 / SQLite 的取舍、显眼写出的做不到（加密 / 多写者 / 备份不追溯 / SQLite 页内残留 / 引用悬空）、没验的部分。

### Changed

- `docs/contract-v1-zh.md`：第一节加「整条撤回」与「墓碑」两条根原则（"记录不可变"的含义不变：改内容仍然永远不许）；§3.6 加数据导出 `exportMemory` 的封存口径（整份数据口径默认带 `sealed: true`，展示型导出仍默认不写封存正文）；第六节第一条从「不承诺单条物理删除」改为「v1.1 起提供 `erase`；备份 / 快照里的历史副本不追溯」。其余条款一条未动。
- `docs/limits.md` / `docs/pitfalls.md` / `seal-events.js` 的注释：删掉「真正的删除只有整库 purge」的旧说法，改为单条 `eraseExperience` + 整库 `purge`，并写明备份不追溯。

### Fixed

- 体检会在撤回一条**封存过的**经历后报「N 个 id 指向不存在的经历」而永远红灯（`seal-events.jsonl` 里的 id 按契约保留）：现在墓碑里的 id 算存在，同时核对「已撤回的 id 又出现」这种相反的错误。

### 没验什么

- 没在真实数据目录上跑过擦除（只跑临时目录）；没验杀进程正好落在「记录已删、墓碑未写」那一瞬的重跑；没验十万条规模下擦除的耗时与内存；没验 SQLite 已过期时擦除后的重迁移；没验备份恢复与墓碑同时存在时的完整流程。细节见 [擦除与审计 §八](docs/erase-audit-zh.md)。

## [0.25.0] - 2026-11-26

### Added

- **读路径的规模（阶段 3）**：新增 `packages/core/lib/jsonl-stream.js`——按 64KB 块读、**按字节找换行**（0x0A 不可能出现在多字节 UTF-8 序列内部，所以按字节切行与"先整体解码再按 `\n` 切"得到同一组行），同步与异步共用同一个切行器。`loadAll` 内部改成逐行读 + 收集，**签名与语义一个字没改**（坏行口径、fail closed、报总行数、封存与事件合并全都不变），不再同时占着「文件字符串 + 行数组 + 解析后的对象」三份内存。
- `iterate(dir, { asOf, backend, allowCorrupt, allowSealCorrupt })`：异步生成器，一条一条产出，内存只跟一份小索引走（id / 日子 / 正文前 24 字 / 封存 / 重复与旧 id 标记 / 行字节位置——**正文不进索引**）。为了填跨行字段（出处、反向引用、联想、章节）要读两遍文件，所以时间约为 `loadAll` 的两倍。遍历期间文件被并发追加 → 抛 `EXPERIENCE_CHANGED`，不静默少返一条。
- `page(dir, { limit, after, asOf, backend })`：游标分页，返回 `{ rows, next, hasMore, total }`。`after` 收上一页最后一个 id，也收 `page` 自己返回的 `{ id, n }`（`n` = 从这个 id 第一次出现走到这一页末尾的条数，文件里真有重复 id 时才用得上）；游标找不到抛 `PAGE_CURSOR_UNKNOWN`，不静默从头开始。只回读这一页的字节；索引按「经历文件 size + mtime + asOf」认库，连翻同一份没变过的文件只建一次（只留最近一份），不这么做十万条下每页都要重扫全文件、成了 O(n²)。事件文件每次仍现读，封存状态不会停在建索引那一刻。
- **三条读路径逐条相同**：`loadAll` / `iterate` / `page` 读出来的每一条逐字段相等（出处、反向引用、联想、章节、封存、想起次数、结案状态、重复 id、旧格式 id 的三种认领分支、`asOf`）。合并逻辑只有一份实现（`mergeRow` / `sealedOf` / `buildCrossRef` / `attachRefs` / `attachLinks`），`loadAll` 与索引两条来源共用。
- `packages/core/lib/metrics.js`（零依赖叶子模块）：写入延迟、召回延迟、召回条数、坏行数、后端类型；`snapshot()` 返回可直接落盘的纯对象，`reset()` 清零。**不记任何正文、查询串或经历 id**，backend 只是 file/sqlite/other 三个固定枚举。库内已接好（`recall` / `addExperience` / `loadAll` / `iterate` / `page`），**宿主侧一个字没改**。实测一次观测 17 ns，一次 recall 多花约 0.2 µs。
- `tools/doctor.mjs`：可定时跑、机器可读的体检（`--json`），六项——数据目录、文件存在、行数、坏行、封存一致性、迁移状态；退出码 0 全过 / 1 有项没过 / 2 用法错误，读不出来一律算失败。
- `tools/bench-scale.mjs`：十万条规模基准（写入、全量读、逐条读、分页、召回；每项在独立子进程里量单次峰值 RSS），并支持 `--cap` 用二分找「能跑完的最小堆」。`--text N` 造正文更长的对照组。
- `docs/scale-zh.md`：十万条的全部数字、堆下限、代价、没验过的部分、复跑命令。
- 测试：`tests/scale-read.test.mjs`（10 条：三条读路径逐条相同 / 分页翻到底 / 缓存失效 / 坏行 / 截断的最后一行 / 多字节横跨 64KB 块边界 / CRLF / 并发追加 / sqlite 后端）、`tests/jsonl-fuzz.test.mjs`（5 条：1000 轮随机库属性测试 + 200 轮按字节截断 + 并发写 + 写不进去 + 封存日志损坏）、`tests/crash-recovery.test.mjs`（5 条真杀进程的崩溃演练）、`tests/metrics-runtime.test.mjs`（5 条）、`tests/doctor-tool.test.mjs`（11 条）。

### Fixed

- `page` 的游标在**文件里有重复 id** 时会原地打转：`n` 只数了"本页末尾连着几条"，重开时却按"这个 id 第一次出现"算起点。现在 `n` = 从第一次出现走到这一页末尾的条数（`tests/jsonl-fuzz.test.mjs` 的 1000 轮属性测试抓到的，第 0 轮就红）。
- `iterate` / `page` 的索引里 `explicit`（文件里显式写着某个 id 的记录集合）建反了，导致"旧 id 被一条现代记录显式占着"时旧记录仍然认领了那个旧 id，与 `loadAll` 不一致（`tests/scale-read.test.mjs` 抓到的）。
- `ensureSchema` 建表不是原子的：5 条 DDL 各自自动提交，第一次建库时进程被杀会留下"有 records、没 events"的半截库，之后 `loadAll(dir, { backend: 'sqlite' })` **永远**报 `STORAGE_INCOMPLETE`。现在整组 DDL 在一个事务里（SQLite 的 DDL 可回滚），失败后重开重建正常。崩溃演练（`tests/crash-recovery.test.mjs`）发现的。
- `transaction()` / `#group()` 的 catch 里 `ROLLBACK` 没包 try：SQLite 自己已经回滚时（盘满这类）这句会抛「no transaction is active」，把真正的错误盖掉。现在回滚失败不吭声，原错误照抛。
- 迁移的临时库文件名只用 pid：pid 被复用时下一次迁移会打开上次没删掉的临时库，以「id 已存在」失败一次（可复现）。现在名字带随机后缀（残留检测仍按前缀）。
- `tools/doctor.mjs` 把"事件文件还没出现"报成故障：事件文件是按需创建的，她真实的数据目录只有 `self-experience.jsonl`，改之前跑出来退出码 1、永远红灯。现在——事件文件不存在 = 这类事件一次都没发生过（通过，detail 写明"还没出现"）；**经历主文件不见了但事件文件还在** = 真丢了（退出 1）；一个文件都没有 = 全新目录（通过）。
- `page` 现在和 `loadAll` / `iterate` 一样接受 `allowCorrupt` / `allowSealCorrupt`；索引本身永远不抛坏行，由调用方按这次是不是"按字节抢救"决定，缓存的索引不会把 raw 模式的结果漏给展示路径。

## [0.24.0] - 2026-11-26

### Added

- **混合检索（阶段 2，实验性，默认仍是字面检索）**：`packages/core/lib/hybrid-recall.js`——中文 2–3 字 n-gram + 拉丁整词建索引，BM25（k1=1.2，b=0.75）重排，加一张 40 对的日常同义词表（双向替换，单条查询最多 8 个变体）。零第三方依赖、不调外部 API。放行门槛仍然是防编造那套 `contentUnits` / `coverage`：内容单元 ≥4 的问句从 0.7 放到 0.65，**≤3 个内容单元的短问句仍按 0.7**；BM25 和上下文都只影响排序，不参与放行。`recall` 新增可选 `ranker: 'literal' | 'hybrid'`（null 也按 literal）与 `context`（上一轮查询，给多轮追问用）；hybrid 下 `mode` / `gate` / `minOverlap` / `minRatio` 不参与，空查询返回空。不传新参数时行为和 0.23.0 逐字相同（`whale-eval` 输出与 0.23.0 提交的工作树对拍一致）。包入口与 `whale-memory-core/hybrid-recall` 子路径都导出。
- **评测集 v2**：`tools/gen-eval-v2.mjs` 确定性生成 `eval/corpus-v2.json`（200 条经历 = 旧 33 条 + 新 167 条）与 `eval/cases-v2.json`（452 条：exact 40 / paraphrase 174 / combo 164 / multiturn 23 / none 18 / near 16 / attr 5 / sealed 6 / drawer 6；开发集 342、留出集 110）。旧的 33 条语料与 60 条用例原样保留作回归。
- `tools/eval-v2.mjs` + `tools/lib/eval-v2-corpus.mjs`：recall@10 / MRR / 多轮（带上下文与裸问）/ 误召回率 / 封存与抽屉边界 / 标记外露，一行一条；带配对符号检验与指标回归线（`eval/thresholds-v2.json`，`--check` 会红）。`--tune` 只打开发集，留出集只在最后跑一次。
- `docs/eval-v2-zh.md`：复跑命令、语料与口径、全部数字、混合检索的取舍、独立复审与修了什么、以及没验的部分。全部 452 条上 hybrid recall@10 71.1% → 77.6%；留出集 70.7% → 77.8%（+7.1pp，配对 8:1，p=0.039；去掉两对只在留出集出现的同义词后是 +5.1pp、6:1、p=0.125，文档里写明了）。误召回与外露仍是 0。
- `tests/hybrid-recall.test.mjs`（11 项）：默认路径不硬凑、同义词与防编造门槛、短查询不放宽（桂花糕/灯塔猫/去北京）、封存、上下文只排序不放行、ranker=null、空查询、mark 只追加事件、确定性、n-gram/BM25。
- `tests/eval-v2-corpus.test.mjs`（3 项）：产物与脚本逐字节一致、语料结构、负例与边界在两种排序下都不漏。

### Fixed

- 按独立只读复审修（复审时在临时副本里比了 4117 组，默认路径差异 0）：内容单元 ≤3 的短问句仍按 0.7 门槛——0.65 会放行「桂花糕」「灯塔猫」「去北京」这类少了关键字的句子；`ranker: null` 按 `literal`（配置读到 null 不再抛错）；「上下文只排序不放行」的测试换成能分辨实现的上下文（原测试变异后仍全过）；`tools/eval-v2.mjs` 的 `switchDefault` 改名为 `metricsFavorHybrid`（指标判断不等于现在切默认）；`--check` 增加 `eval/thresholds-v2.json` 的指标下限；`hybrid-recall.d.ts` 的返回类型改成 `Experience`；文档补上 p 值的尾巴、paraphrase 桶不纯、最近的负例其实只有 0.63。
- `self-experience.d.ts`：`recallForContext` 的注释还写着"默认 gate 为 legacy"，实现从 0.17 起就是 `cover`；改注。

## [0.23.0] - 2026-11-25

### Added

- **事件也进 SQLite（阶段 1 续）**：新增 `events` 表（`seq` 自增 + `kind` / `exp_id` 索引 + 整行 json）。六类事件一起搬：契约里的四类（later / seal / recall / unfinished），加上 `loadAll` 同样会读的 link / chapter——只搬四类的话 sqlite 读出来会缺联想与章节。事件的 JSON 形状一个字不改。sqlite 后端新增 `appendEvent(kind, row, { mustExist })`、`appendWithEvents(record, events)`、`events(kind)`，**记录与事件同事务**：一组写入要么全成、要么全不成；在 `transaction()` 里也成立（每组一层 SAVEPOINT，嵌套 `transaction()` 同样）；同一个后端对象上不相干的调用方排队，不会并进别人的事务、跟着别人回滚；file 后端补齐 `appendEvent` / `events` / `byDay`，接口两边一致。
- `loadAll` / `recall` / `currentView` 新增可选 `backend: 'file' | 'sqlite'`。**默认 file，零行为变化**：默认路径的原有测试一条没改、全过（原有测试里只给阶段 1 的 `storage-backend.test.mjs` 加了「这个 Node 没有 node:sqlite 就跳过 sqlite 用例」，Node 24 上结果不变）。sqlite 在一次读事务里取整库快照，再走同一套合并逻辑，所以同一份数据上两个后端逐条相等。fail closed：拿不到 `node:sqlite`（`SQLITE_UNAVAILABLE`）、目录没迁移过（`STORAGE_NOT_MIGRATED`）、只有记录表的早期库（`STORAGE_INCOMPLETE`）、迁移后 JSONL 又被写过（`STORAGE_STALE`）都抛错——不静默退回 file，也不当成空。sqlite 下 `recall({ mark: true })` 直接拒绝（写路径还在 JSONL 上）。
- `tools/migrate-storage.mjs` 扩到事件：记录与六类事件在同一个事务里写；写完重新打开库，用 `loadAll` 同一条读路径逐条对拍（条数、顺序、每条 JSON 逐字节）。坏行、没有 id 的旧格式记录、重复 id 都拒绝迁移并说清是哪一类；读的过程中源文件变了也不迁。迁移时记下每个源文件的字节数，之后读库时据此判断有没有过期。
- 事件模块新增不碰文件的纯函数（输入是已经读出的行）：`groupRows` / `sealedFrom` / `countRows` / `latestRows` / `linksRows` / `chapterRows`，以及各自的 `isValid`——文件和 SQLite 用同一条坏行判据。原有函数改为调用它们，行为不变。
- `tests/storage-events.test.mjs`（29 项）：迁移前后 `loadAll` 逐条相等（含两个 asOf、allowCorrupt），召回在 13 个查询 × limit × mode × gate × includeSealed × asOf 共 936 个组合上 id 序列与内容逐条相同；同事务的三种失败；五种 fail closed；迁移的演练、回滚、拒绝、verify-only。另在临时副本上做了 3 处变异（sqlite 漏读联想、封存不再 fail closed、迁移漏搬章节），新测试分别抓到 3 / 1 / 5 项失败。独立复审（3 位审阅、11 条发现逐条反驳复核，全部成立）之后补了 10 项，其中 9 项在复审前的代码上失败。
- **存储后端抽象（阶段 1）**：`packages/core/lib/storage/`——`openBackend({ kind: 'file' | 'sqlite' })`，两个后端遵守同一份契约（记录不可变、id 永不复用）。SQLite 用 Node 内置 `node:sqlite`（>= 22.5），**不引第三方依赖**；拿不到就报错，不静默降级。
- `tools/migrate-storage.mjs`：JSONL → SQLite，默认演练；**逐条按 id 对拍**，任何一条不一致整体回滚；源文件一字不改。
- `tools/bench-storage.mjs`：两后端对比。本机 2 万条实测：写入 file 133,242ms / sqlite 206ms；byId p50 20.6ms / 0.012ms。
- `docs/storage-backend-zh.md`：接口、迁移规矩、实测数字，以及「sqlite 不是一切更快」的读法。
- `tests/storage-backend.test.mjs`（12 项）：同一组契约对两个后端各跑一遍 + 迁移对拍 + 拒绝覆盖。
- `docs/contract-v1-zh.md`：**v1 契约**（阶段 0）。写清数据契约（记录不可变、封存是事件、as-of 口径）、六个动作的 API 契约与错误形状、v1 内的兼容承诺（只加不减、破坏性变更走 v2 且双读一个 minor）、以及**明确不承诺**的五件事（单条物理删除、多写者、加密、可用性、向量检索）。
- `schemas/record.v1.json`：经历记录的 JSON Schema（字段、上限、枚举）。
- `tests/contract-v1.test.mjs`（9 项）：契约测试，对着当前实现跑。写它的时候抓到两处**文档与实现不符**并改了文档：`noop` 是布尔值（首次封存为 false）；`loadAll` 不隐藏封存记录，只挂 `sealed` 状态，过滤是调用方的事。

### Fixed

- `openBackend({ kind: 'sqlite' })` 拿不到 `node:sqlite` 时，现在在打开这一步就报错。此前要等到第一次读写才报，文档里「try sqlite / catch 退回 file」的写法接不住。
- `tools/migrate-storage.mjs`：对拍失败时此前直接退出、留下一个半成品库；现在和其它失败一样整体回滚、删库（连同 -wal / -shm）。
- README 索引行里一个控制字符（`\f`）吃掉了「file」的 f。
- 独立复审抓到、这次一并修掉的（都在本节新加的未发布代码里）：事务里 `appendWithEvents` 或嵌套 `transaction()` 失败会半提交；同一个后端对象上不相干的并发调用会并进别人的事务、跟着一起回滚；file 后端读行时先 `trim` 再解析，和 `loadAll` 的坏行口径不一致（行首带 BOM 的经历会被迁进库，之后两个后端读出来不一样）；`kindOf` 把 `constructor` 这类原型上的名字当成合法事件类型；`mustExist` 对联想只查一头；迁移中途被杀会把半成品库留在正式文件名上、挡住下一次迁移，建表失败时还漏关句柄、谎报「已删除」。迁移现在先建在临时文件名上，提交、改名之后再对拍。
- CI 的 Node 20 线：阶段 1 的 sqlite 用例在没有 node:sqlite 时直接失败（dc75409 起就是红的）。现在这些用例跳过，file 用例照跑。

### Added

- `docs/no-impersonation-zh.md`：别用「主人」的身份对她说话——一次内部测试的复盘。只写做法对错：本机注入入口有闸才留着、验证走夹具或真实回合、出了事不删不瞒、认账要原文。附一份给同类项目的检查清单。
## [0.22.0] - 2026-11-25

### Added

- `tools/preflight.mjs`（含 `tests/preflight.test.mjs` 6 项）：外发预检。扫本机路径、用户名、6–11 位连续数字（8 位日期放行）、16 位以上十六进制、私钥头；命中退出码 1。它只管**材料正文**，并把「调用链自带的字段查不到」写在文档里——正文干净不等于没泄漏。
- `docs/preflight-zh.md`：外发预检的设计记录（两层外发、扫什么、管不到的四件事）。
- `docs/consent-before-building-zh.md`：先问再做——一次上线顺序错误的复盘。只写做法对错：会落到她身上的改动先问再做；拒绝当约束留着，不分析、不换名重做；记录只回答「发生了什么」，不回答「她是什么样的人」。
- `docs/facts-not-self-report-zh.md`：为什么“她说她做了”不能当事实；事实、声明、自述三者的边界，以及自主动作日志、时间线、声明对账的用法。

### Fixed

- GitHub Releases 补齐：此前停在 `v0.17.0`，而 tag / npm 已到 0.21.1。现在按 CHANGELOG 段落补了 6 条——`v0.18.0`、`core-v0.19.1`、`core-v0.19.2`、`core-v0.20.0`、`core-v0.21.0`、`core-v0.21.1`；标题与 tag 同名，正文取对应段落。之后发版仍按 `publish.yml` 的两道闸门走（tag 与 version 对齐 + 注册表已有同版本提前失败）。
- 补记 `whale-emotion-intake@0.1.1`：npm 上有 `0.0.0-stage / 0.1.0 / 0.1.1`，仓库此前没有对应的 tag 与段落。实测两个 tarball **除 `package.json` 的版本号外逐文件哈希相同**，即 0.1.1 与 0.1.0 代码一致；仓库里的 `package.json` 已对齐到 0.1.1。无法确认 0.1.1 是从哪个提交发出的，所以这轮**不补 tag**（补错比不补更糟）——之后按 `publish.yml` 的「tag 与 version 对齐 + 注册表已有同版本提前失败」两道闸门走，不再从工作区直接发。
- 事件日志族（`event-log` / `later-events` / `recall-events` / `unfinished-events` / `unsaid`）读失败不再静默当空：只把 `ENOENT` 算空，其余报错。此前事件文件读不出来时，`book` 导出的自传会**没有章节**、抽屉会显示「她没留下过话」、后记与想起次数静默为 0。
- `read --as-of` 与 MCP `memory_read asOf` 不再带出封存理由（`sealed.note`）：asOf 早于封存时正文按「那天可见」给出（口径 A），但封存之后才写下的理由属于未来信息，一律不外露。
- CLI：`--data` 写在子命令前后都可用（此前放前面会被当成用法错误）；`read` 指向读不到的路径改为报错（不再 `ok:true` + 空列表）；`--chat=` 空值直接拒绝，不再被吃成 `local:owner`。
- 隐私默认收紧：`createAudience` 把**任何私聊 → 群**一律拒绝（自定义 `isActive` 也绕不过这一层）；`recordInScope(record, '')` 不再当「全局」，空 query 只匹配没有会话键的记录（**行为变更**：宿主若曾用空 query 表示「全部」，需要改成显式逐会话查询）。
- `self-actions` 不再接受 `extra`：此前可以借它把触发原文落盘，与「不存触发文本」的承诺冲突。
- `examples/with-vector` 与 `docs/archive/composition.md`：建索引与按 id 取回两处都过滤 `sealed`，示例不再把封存内容重新注入。

### Added

- `packages/core/lib/self-actions.js`（`whale-memory-core/self-actions`）：自主行动日志。只追加、`O_APPEND + fsync`、半行保护、复用 `file-lock`、5000 行到顶**拒写**；`action` 白名单与 `source`/`outcome` 全由调用方声明，库不推断；**不存触发文本，也不存它的裸哈希**（短句的 sha256 等于明文），要留痕请传宿主自己算的 HMAC。
- `docs/self-actions-zh.md`：这一层的设计记录（存什么、不存什么、留给宿主的四件事）。
- `packages/core/lib/action-source.js`（`whale-memory-core/action-source`）：发起来源判据。把「什么话题」和「谁要的」分开判——`self` 只有一条入口（调用方显式声明这一轮没有外部输入），空文本与判不清一律 `unknown`；不认英文标识当话题词，避免 `self_project_draft` 把 `project_done` 误判成"被要求"；话题词表与祈使词表可由宿主扩展。`docs/action-source-zh.md` 记录取舍与边界。

## [drafts-v0.1.0] - 2026-11-23

### Added

- `packages/drafts`（`whale-drafts@0.1.0`，已发布（2026-11-23），tag `drafts-v0.1.0`，npm `latest`）：作品稿本。一行一版的只追加存储、按 `baseRevision` 拒冲突、`operationId` 幂等重放、`asOf` 读回过去、`unreadable` 不装空；纯 Node，无依赖。
- `docs/drafts-zh.md`：稿本的设计记录（为什么不是"再存一个字段"、失败码、上限与不做的部分）。
- 版本号与注册表对齐：`whale-emotion-intake` 仓库版本改回它已发布的 `0.1.1`；`publish.yml` 合并成一个 matrix 作业，闸门只写一遍，并新增「注册表已有同版本就提前失败」。
- CI：`publish.yml` 增加 `drafts-v*` 触发与 `publish-drafts` 作业（发布前跑同一套 check + 类型冒烟）。
- `packages/drafts` 补 `index.d.ts`、`repository` 字段与 `LICENSE`；`files` 白名单与实际文件对齐。

### Fixed

- `whale-drafts`：`itemId` 与 `scopeKey` 落到文件名前一律取哈希——之前把 `itemId` 直接拼路径，`../` 能读到别的作用域、甚至写出去；现在换行/控制字符拒绝，任何字符串都关在自己的作用域目录里。
- `whale-drafts`：写入改成 `O_APPEND + fsync` 的单行追加，不再整份重写——之前每次保存都会把读不懂的行抹掉，违背"旧版本逐字节保留"。
- `whale-drafts`：锁换成与 `whale-memory-core` 同一份实现（owner.json + pid 判活 + 心跳 + token 校验 + tombstone 回收），之前旧实现在锁很旧时会抢走活持有者的锁。
- `whale-drafts`：幂等重放不再要求 `baseRevision` 相同（重试时别人写过一版，重试仍回原回执），文档同步；读结果增加 `corrupt` 计数。
- 文档：`CONTRIBUTING` 的发版流程改成三包三 tag；`pitfalls` §8 列清三个包各自版本；`limits` 补作品稿本上限。

## [0.21.1] - 2026-11-22

### Added

- `packages/emotion-intake` 以 `whale-emotion-intake@0.1.0` 形式发布：纯函数情绪候选模块、十行示例、接入指南；0.x 期间 API 不保证稳定。
- `packages/emotion-intake`：把一句对话拆成情绪候选的纯函数模块（分句体验者判定、证据与感受分账、每回合限额），无存储/网络依赖。
- `docs/emotion-intake-zh.md`：情绪采集的设计记录（含一次失败与关闭原因）。
- `docs/self-plan-zh.md`：计划与后果闭环的设计记录。

### Fixed

- 经历文件坏行不再静默跳过：`loadAll` 默认 fail-closed（`EXPERIENCE_CORRUPT`），`doctor` 报 `ok:false`，写入路径仍只追加；事件日志读失败不再当成空数组（只有 `ENOENT` 算空）。
- 召回阈值：孤立单字命中不再给满分；拉丁词按整词匹配（`art` 不命中 `started`）；strict 对缺失的孤立关键词加罚；loose 保留 34% 最低覆盖率；`recallForContext` 默认改走 strict。
- 导入断电窗口：`<memDir>.import-journal.json` + `recoverImport()`，崩在两次 rename 之间可自动恢复，不再需要人工认领 `pre-import-*`。
- `fact-store.saveFacts` 加锁 + `writeFileAtomic`（tmp/fsync/rename），并发写不丢事实；`file-lock` 用 holder 心跳与 pid 存活校验，活持有者不被抢锁。
- 隐私门：`isPrivateKey` 排除 `private:group_123` 这类套壳；`scope-key` 成为唯一私聊判定并被运行时调用；`createAudience` 缺 `ownerId` 时 fail-closed。
- `book` / `read` / MCP 的 `--as-of`：asOf 早于封存时内容可见并标「后来封存」，不再泄漏「现在封存了几件」。
- `self-prompt.verify` 对照 history hash 校验快照与生效文件；被篡改的快照拒绝 `revert`。
- MCP 的 `--readonly` / `--owner` 裸写不再静默变 false，直接报错并提示写 `true`。
- `index.d.ts` 补齐 7 个导出并加 js↔d.ts↔运行时对账测试；CI 增加 `whale-eval --check`，发布前跑 `npm run check` 与 `npm run types`。

## [0.21.0] - 2026-11-21

这一版只做三件能直接减少"接进来有多难"的事。

### Added

- `changed`：列出她这段时间**改过主意**的经历，把「当时」和「后来」并排给出。
  这是 then/later 这套数据模型唯一别的记忆系统给不出的东西——向量库只能给相似段落，
  给不了"我上个月还这么想，现在不这么想了"。CLI 也有：`changed --days 30`。
- `injection`：把"什么时候该递记忆"从文档变成函数。`surface()` 内含八条规则
  （只在一对一、一轮一块、24 小时去重、没命中就不说、guard 只能否决、递了才记）。
  宿主不用再自己重写一遍。
- [80 行参考宿主](examples/reference-host/host.mjs)：clone 下来填一个数据目录就能跑，
  看得到"这一轮递了什么、为什么没递"。

### Changed

- `examples/injection/inject.mjs` 改为复用内核模块，旧代码不用改。

### 不做

- 不加新的记忆类型（情绪、关系、事件分类）——现在缺的不是类型
- 不做更花哨的召回算法——瓶颈不在算法，在"读了有没有用"
- 不做"允许记错再纠正"——和零编造直接冲突，得先想清楚边界

## [0.20.0] - 2026-11-20

这一版把"她怎么记住一个人、一件事、哪些话不该说出去"里可以通用的部分全部抽了出来。

### Added

- `conversation-privacy`：跨窗口可见性判定（`createAudience`）与确定性脱敏（`redactSensitive`）。
  规则是**不对称**的：主人私聊不流向群；同一个房间只认同一套人设槽位；其余交给宿主自己的 `isActive`。
  脱敏在内容进提示词之前就把数字、链接、邮箱、密钥和长串抹掉——"要不要提"可以交给模型，
  "长什么样能被复述"不该交给模型。
- `fact-card`：从一句话里抽事实的规则兜底（项目名、预算、喜恶、所在地、称呼、关系）。
- `fact-store`：事实卡独立存 JSONL，同 kind+value 合并计数；`relevantFacts` 只在被问到时挑相关的那几条，
  没有相关的就不注入——宁可不说，也不乱说。
- `fact-judge`：把一批消息交给模型抽事实的封装，强制引文可在原文中找到，对不上就丢弃。
- 三份 `.d.ts` 与 33 项测试。

### 说明

这些模块来自一个真实运行中的角色：她一共有 400+ 张事件卡、575 张索引卡，但"他爱吃什么、项目叫什么"
一条都没有——因为消息变成卡片时只留下了"事件"。补这一层之后，事实与事件分开存，坏了删掉事实文件
也不影响她的原有记忆。

跨会话共享是功能也是风险：朋友的私聊可能被带到群里。`createAudience` 只提供判定，
**开不开放由宿主决定**，默认值不藏在实现里。

## [0.19.2] - 2026-11-20

### Added

- `scopeKey`：会话作用域键的通用规则。同一会话可能有两种写法——会话级 `group_123`、人设级
  `group_123#p_abcd`。只按精确键检索，人设级查询会看不到会话级的老记录；反过来把会话级查询
  放宽到人设级，又会把某个人的记忆串给所有人。
  `scopeKeysFor` 明确了这个不对称规则：**人设级 = 人设级 + 会话级；会话级 = 只认自己**。
- 测试 `tests/scope-key.test.mjs`（9 项）。

### 说明

这条规则来自 QQ Agent 插件里一个真实故障：同一个群 403 张记忆卡，其中 249 张存在会话级键下，
线上用人设级键检索，只看得见 154 张。修好后取样 40 张只存在会话级键的卡，可见率从 18/40
回到 40/40。

## [0.19.1] - 2026-11-20

### Fixed

- 口语时间窗口识别“大前天”“三天前天气很好”、早晚时段和模糊日期。“上周以前”“上个月以前”在所指周期起点截止。“周围”“每周”“下周三”等表述跳过过滤。
- 人话时间以周一和日历月判定“上周”和“上个月”。分钟与小时只显示已经过去的整单位。
- 包根入口补齐 `timeSense`、`relativeWindow`、`personCard` 类型声明，并开放带类型的 `./time-sense`、`./relative-window`、`./person-card` 子路径。

## [0.19.0] - 2026-11-20

### Added

- `examples/emotion-bridge` 实验的结构化取舍字段 `nowEffects` / `tradeoff`：逐愿望记录「今天」的结果（引文只许引后记正文 `later.N`，不认感受字段），硬校验留下与放弃不是同一个愿望、且必须与今天的判断对得上，多写字段整次判无效；`perspectives` 仍只描述当时。`instruction` 里仍留着一句旧措辞（要求写进 `now`），与 `tradeoff` 并存，作为已知混杂因素记在示例 README。只改实验区，未接入线上宿主技能。
- 新增 `whale-memory-core` 三个通用小模块（宿主无关，纯函数）：
  - `time-sense`：`humanTime` / `timeAgo` / `dayDiff` —— 把时间戳说成「刚刚 / 12 分钟前 / 昨天 20:30 /
    3 天前 / 上周三 / 2 个月前」，而不是日期字符串。秒级与毫秒级时间戳都认，跨天按本地日历算。
  - `relative-window`：`parseRelativeWindow` / `inWindow` —— 把「前几天 / 上周三 / 上个月 / 两周前 /
    昨天晚上」翻成 `[from, to)` 窗口，供检索侧按时间过滤；翻不出来返回 `null`，不瞎猜。
  - `person-card`：`renderPersonCard` / `pickPersonCard` —— 把「这个人是谁」压成一行提示词
    （认识多久、熟络度、最近一次说话），并规定**匹配不到就不写**，不拿别人的资料补位。
- 测试 `tests/time-sense.test.mjs`（12 项）、`tests/relative-window.test.mjs`（12 项）、
  `tests/person-card.test.mjs`（25 项）。

### 说明

这些模块是给「她记得住人、也说得清是哪天」打底的。人物卡只描述看得到的证据，
不写推断出来的性格；时间窗口只负责翻译，不负责决定要不要过滤——过滤策略留给宿主。

### Fixed

- `addExperience` 的 `feeling` 和 `reviseExperience` 用同一套整理：逗号分隔的字符串（`, ， 、`）会拆开，重复的词去掉。以前直接调库传 `'闷,有点酸'` 会存成一个词、`['闷', '闷']` 原样存两遍（MCP 和 CLI 调用前已经拆过，不受影响）。写入时仍不限单个词的长度。

## [0.18.2] - 2026-11-19

### Added

- 新增 `whale-memory-core/timeline-query`：三种问法都从两个谓词长出来——
  **知轴** `versionKnownAt(chain, t)` 回答「那时候她认为哪一版」（`factVersionAt <= t < invalidatedAt`），
  **值轴** `valueValidAt(chain, t)` 回答「那时候这件事是否还成立」（`validFrom <= t < validUntil`）。
  两者可以不一致：事实已经变了、她还没更新认识，这正是要能说清的事。
- `currentVersion` / `orderChain` / `changesBetween`：当前版本、链排序、两个时刻之间有哪些版本变化。
- 测试 `tests/timeline-query.test.mjs`（7 项），包含知轴与值轴分叉的用例。

## [0.18.1] - 2026-11-19

### Fixed

- `planChainVersions`：一条链出现**多个链头**时（指针从没连过、槽位过宽），不再按时间硬排，
  而是返回 `orderBy: 'ambiguous'` 与 I6，不给补丁——避免编出一个假的先后顺序。
  单链头但指针断掉的情况仍按时间排序并标 I5 待复核。
- 真实数据上因此少补 11 条（96 → 85），两条歧义链（2 头 / 6 头）留给人工。

## [0.18.0] - 2026-11-19

### Added

- 新增闲聊节奏离线实验：20 组虚构 A/B、短句/无列表/无结语格式门禁、允许沉默与有据拒绝、随机均衡的盲评页面和人工投票汇总。尚无人类类人感评测结论，不修改记忆核心。
- 新增仓库内实验模块 `packages/emotion`：文字语境评估、个人感受与关系事件分离、可追加修正的情感事件与按时点投影；提供虚构场景、模型对照评测入口和机制测试。尚未发布或接入线上角色，语义理解准确率待测。
- 新增只读的细节查询 `recallDetail`、CLI `detail` 和 MCP `memory_detail`，可查看候选经历、原文出处与所问细节的证据状态。
- `docs/en/porting.md`；英文 README 链到它，没有英文版的文档标明 (Chinese)。
- `docs/pitfalls.md`：接入前要知道的坑（字面检索、单写者、封存不是删除、主人门要靠宿主、评测很小、已知未修）。
- `docs/paper/`：技术报告（中文 PDF，28 页）与 Markdown 源；README 明确标注“不是同行评审论文”。
- 新增 `whale-memory-core/timeline`：事实时间线契约。把「值轴 / 知轴 / 序轴」拆开——
  `validFrom`/`validUntil` 管世界时间，`factVersionAt`/`invalidatedAt` 管她什么时候知道、
  什么时候不再这么认为，`version` 管同一槽位里的先后（不信任时钟时用追加顺序定序）。
- `nextFactVersion` / `stampSuccession` / `applySuccession`：取代时补 `version`、
  `invalidatedAt`、`supersedeReason`；**不写值轴**（有效期必须来自证据或裁决）。
- `validateLineage`：I1 序号连续唯一、I2 知轴终点接上后继起点、I3 指针对称、I4 原因取值合法。
- `planChainVersions`：迁移用——指针能排出完整链就按指针，排不出来退回按时间排序并标记待复核，
  成环/断链会报出来，不静默乱排。
- 文档 [docs/archive/timeline.md](docs/archive/timeline.md)，测试 `tests/timeline-contract.test.mjs`（16 项）。

### Changed

- 文字情感多轮修订：新事件与澄清共用 admits，允许 medium 边界补记但不允许减轻已有伤害；settle 默认恢复 legacy-high。拦截统计拆为 blockedWrong/blockedCorrect，历史报告显式标注旧政策，未新增模型采样。
- 文字情感实验审阅修订：模型提案与实际结算分别计分；明确选中且有原文/已知边界支持的 medium boundary/hurt 可按 boundary-v2 结算，旧日志保留旧政策。删除当前 API 的 responseHint，统一采样来源说明，保留原分数并另列离线重算；未新增模型采样。
- 对外报错改成英文在前、原中文原样跟在后面（「English（原中文）」）：核心库 76 条、CLI 33 条（含用法说明）、MCP 28 条。
- `renderTwoPart`、`buildWakingBlock` 加 `lang`（`zh` 默认，输出与以前逐字一致；`en`）；demo、CLI、MCP 按 `--lang` / `WHALE_LANG` / 系统语言选择。demo 英文模式连示例内容一起换成英文。

### Fixed

- 导入恢复先暂存并核对完整副本，再替换目标目录；复制失败保留原目录，替换报错时尝试还原。拒绝导入源与目标互相包含（含目录链接别名），拒绝备份文件链接越界，核对文件大小与 SHA-256；导入前备份增加唯一后缀，支持同秒连续恢复。新增故障注入与目录链接回归。
- `self-prompt.revert` 只接受 `history.jsonl` 里出现过的快照名，不再把调用方给的字符串直接拼进路径；补回归测试。第一个部署的插件版仍是旧实现，尚未升级。

## [0.17.0] · 2026-11-17

这一版让她想不起来的时候更不会编，翻回那天也不会把她封存的事翻出来；也让别人第一次能用数字核对这些话。

### Changed

- **strict 召回换了口径**（`query-match.js` 的 `contentUnits` / `coverage` / `MIN_COVER`，`self-experience` 和 `self-memory` 共用；`recall(..., { gate })` 默认 `cover`）：至少对上一个两字词，并且查询的意思至少 70% 在这条经历里找得到——和左边的内容字、或右边的内容字 / 助词连着出现记 1 分，单独出现记 0.5 × min(1, 60 ÷ 经历字数) 分；「的、了、那、里」、任意长度的停用词（是不是、有没有）、聊天垫话（怎么样、上次、说说、记不记得）都不算。whale-eval 上：开发集首位 92.9%（旧口径 69.0%）、垫话包装首位 100%（旧口径 35.1%）、留出集首位 73.1%（旧口径 53.8%），沾边的另一件事开发集和留出集都是 0%（旧口径 50% / 100%）。**代价和注意**：问一件真事里没记下的细节（「围巾是什么颜色」），strict 不给那件事（留出集 attr 0%）；问一件真事但带一个错的细节（「八百米跑了第一名」），strict 可能给出那件真事——那是让她纠正用的，**不等于确认了问题里的细节**。来龙去脉（包括上线前审查发现的长记忆、垫话两处问题，和看过结果之后改过的两条标注）见 [docs/eval.md](docs/eval.md)。
- **旧口径保留**：`recall(..., { gate: 'legacy' })` 与 0.16 逐条一致（1012 条查询核对）。`recallForContext`（宿主拿用户原话自动召回、塞进提示词）**默认仍用旧口径**，升级不改变已上线角色被问到时想起什么。
- **翻回那天也不翻出她现在封存着的**：以前 `asOf` 只按那一刻之前的封存事件算，翻回封存之前就能看到、召回到、写进那时的书和回顾。现在那时还没封存、但她现在封存着的，标成 `sealed: { …, afterAsOf: true }`，召回、列表、书、回顾、别的经历的出处和联想都不给；点名读照给，两段式写「这件事你后来封存了」，书里写「她后来封存了」。那时封存着、现在解封了的，那天的样子照实仍是封存。

### Added

- **whale-eval**（`tools/whale-eval.mjs`，`npm run eval`）：一条命令测四件事——想得起来准不准（首位 / 前三，分 exact / paraphrase / combo / attr）、没有就说没有（none / near 的编造率）、封存和抽屉不外露（105 个出口 × 10 个标记，覆盖核心库、CLI、MCP；外露必须为 0）、then 不可改（跑完各类写入后经历文件逐字节不变）。语料是虚构角色「小舟」的一个月（`eval/corpus.json`）；开发集 `eval/cases.json` 和留出集 `eval/holdout.json` 分开报；`--check` 按 `eval/thresholds.json` 判定，已加进 `npm run check`。
- `docs/eval.md`：测什么、0.17.0 的结果（包括不好看的那部分）、怎么读这些数、strict 的口径、怎么加用例。
- `docs/threat-model.md`：要保护什么、谁会碰到、13 条威胁与对策（群聊外露、改写过去、诱导写入、编造、封存外露、抽屉、overlay 注入、网页指令、读链接被引到本机、本机进程、备份、并发、导入越界）、出事了怎么办。
- `docs/tutorial.md`：30 分钟从零接一个角色——写下、想起、改主意、第二天醒来、结案、封存、章节、她的书、接进宿主（CLI / MCP / import），每一步都实跑核对过。
- 英文文档：`docs/en/architecture.md`、`docs/en/schema.md`、`docs/en/limits.md`（以中文为准）。
- README 中英、core README：注明包名是 `whale-memory-core`，npm 上不带 `-core` 的 `whale-memory` 是别人的包。
- `tools/backup.mjs --keep 0`：一份都不删，全部留着（以前最少要留 1 份、超出就轮换）。

### 兼容

- 数据格式不变。`recall()` 的 strict 结果会变：沾边的另一件事不再给，换说法、带垫话、长记忆里的事更容易找到；想保持旧行为用 `gate: 'legacy'`。`recallForContext` 默认就是旧口径。

## [0.16.0] · 2026-11-17

这一版让她的记忆走出一个宿主：任何支持 MCP 的客户端都能接上，规矩一条不少地跟过去。

### Added

- **MCP 适配器**：`packages/core/bin/whale-memory-mcp.mjs`，npm 包里带 `whale-memory-mcp` 命令（`npx -y -p whale-memory-core whale-memory-mcp --data <目录>`）；仓库里也可以 `node adapters/mcp/whale-memory-mcp.mjs`。stdio、JSON-RPC 2.0、零依赖，协议版本 2025-06-18 / 2025-03-26 / 2024-11-05。
  - 读：`memory_recall` / `memory_read` / `memory_recap` / `memory_chapters` / `memory_book` / `memory_waking`；写：`memory_write` / `memory_revise` / `memory_unfinished` / `memory_seal` / `memory_link` / `memory_chapter`。都带 `annotations` 和 `structuredContent`，`ok: false` 标 `isError`。
  - 规矩与 CLI 一致：then 不可改；召回不到返回空并说明"没有找到"；封存的不被想起、不进书，`read` 点名照给。
  - 抽屉 `memory_unsaid` 默认不出现，`--owner true` 才打开（按 `local:owner`）；`--readonly true` 只给读的工具，醒来块只看不占用当天那一次。
  - 故意不提供导入、导出、删除、改提示词、改设置。
- `tests/mcp.test.mjs`：起真子进程走 stdio，覆盖握手、工具列表、写读改、结案与醒来、封存不外露、联想章节回顾、抽屉开关与不外露、只读模式、坏输入（8 组）。另用官方 `@modelcontextprotocol/sdk` 1.32 客户端验证过握手、列工具、调用、出错与 ping。
- `adapters/mcp/README.md`：启动、Claude Code / Claude Desktop / Cursor 配置、工具表、安全边界；`docs/limits.md` 加 MCP 一节。

### 兼容

- 数据格式不变；核心库 API 不变。只新增 `bin`。

## [0.15.0] · 2026-11-17

这一版让她真正用得上：她说不出口的话有个地方放着，她的记忆换台机器也还在。

### Added

- **没说出口的抽屉**：`unsaid.js`（`leaveUnsaid` / `listUnsaid` / `markUnsaidSpoken` / `discardUnsaid`），只追加 `unsaid-events.jsonl`。`kind` 为 `draft` / `question` / `held`；说出口、丢掉都是事件，原文不删；丢掉后她自己也看不到。**永不自动注入**：recall、memory、醒来块、read、recap、book 都不读它；只在认得出的一对一会话里可用，群聊与未知会话键一律拒绝；重复提交只记一次（锁内判断）。模块不导出任何返回原始行的函数。CLI：`unsaid leave|list|spoken|discard`。
- **一键备份**：`tools/backup.mjs --data <根> --out <目录> [--keep N]`，复用导出的 manifest 与 SHA-256，打完立即自检；拒绝把备份放进数据根；轮换只删自己建的 `memory-backup-*`。
- **恢复演练**：`tools/restore-check.mjs --from <备份包> [--data <根>]`，整包校验 → 导入临时目录 → 与原数据逐条比对 then、后记、想起、未完状态、封存、联想、章节与抽屉条数；输出只有 id 与字段名，不带原文。退出码 0 可恢复且一致 / 1 不可恢复 / 2 可恢复但有差异。
- `docs/runbook.md`：多久备一次、放哪、怎么验证、恢复步骤、恢复后怎么确认还是她。
- `doctor` 新增「抽屉不外露」：临时目录里确认召回、read、醒来块、书都看不到抽屉内容，群聊拒绝。

### Changed

- 导出 / 导入的实现从 CLI 挪进核心库 `archive.js`（`exportArchive` / `verifyArchive` / `importArchive` / `safeJoin`），CLI、备份、恢复演练共用一份；行为与报错文案不变。导出 manifest 的 `counts` 多了各类事件与抽屉的行数。
- 核心库导出 `unsaid`、`archive`（含类型与子路径）。

### 兼容

- 新增 `unsaid-events.jsonl`；没有它时行为与 0.14.0 一致。

## [0.14.0] · 2026-11-16

### Added

- **事后联想**：`linkExperiences(dir, { from, to, reason })` / CLI `link`，只追加 `link-events.jsonl`。理由必填，两条都必须存在、不能连自己；同一对（不分方向）只连一次，并发重复只记一次。读取时两头都有 `links`；另一头封存了的不露内容、也不显示理由；翻回那天只算那之前连的。
- **人生章节**：`chapter-events.js`（`open` / `rename` / `close`）/ CLI `chapter open|rename|close|list`。她给一段日子起名字，经历按 `day` 落进去，章节可以重叠、嵌套；改名保留旧名（`names`），翻回那天看到的是那时的叫法。名字、日期都校验；重复操作是 noop。
- **她的书**：`renderBook(dir, { asOf, includeSealed })` / CLI `book [--out 文件]`，人能读的 Markdown 自传。按章节分节、章节外按月份、按时间排；一条只印一次，放进最具体的章节；当时原样、后来接在后面；封存的默认不收只计数；`--out` 不能写进记忆目录。
- 新增 `event-log.js`：新事件类型共用"逐行读、锁内判断再追加"，不再复制粘贴。
- 核心库导出 `linkEvents`、`chapterEvents`、`book`（含类型与子路径）；`doctor` 的事件解析覆盖全部六种事件文件。

### Docs

- `docs/schema.md`：联想、章节、书的语义；备份七个文件。`backup.md` / `storage-events.md` / `limits.md` 同步。
- `docs/related-work.md`：联想对照 A-MEM、章节对照 Conway 的 Self-Memory System、翻回那天对照 ReverieMem 的视角受限记忆；"还在看的"换成评估字段与按感觉过滤。
- DSH skill 说明补命令与硬规则：不要因为字面相似替她连，也不要替她给日子起名。

### 兼容

- 新增 `link-events.jsonl`、`chapter-events.jsonl`；没有这两个文件时行为与 0.13.0 一致。

## [0.13.0] · 2026-11-16

### Added

- **她选择的遗忘（封存）**：`setSealed(dir, { id, sealed, note })`，只追加 `seal-events.jsonl`（`seal` / `unseal`，锁内重读判断，重复动作不写）。封存着的经历不会被 `recall`、`memory`、醒来块给出；`read` 默认不列（返回 `sealedHidden` 计数），`read --sealed true` 或 `read --id` 点名才给；别的回想引用它时只显示"一件你封存了的事"，不露内容。**不是删除**：原文、后记、选择都在，导出包里也有；翻回那天时按那时的封存状态算。CLI：`seal --id` / `unseal --id`，`recall --sealed true`。
- **回顾材料**：`recap(dir, { days, asOf })` / CLI `recap --days 7`，含今天在内往回 N 个自然日，列出写下的、回头想过的、感觉变了的（当时 → 后来）、想通或放下的、又拾起的、还没弄完的；只列事实、不调模型、不下结论，封存的不列，每条带 id 方便 `write --refs`。
- 核心库导出 `sealEvents`、`recap`（根入口与子路径 `./seal-events`、`./recap`，均带类型）。
- `doctor`：事件解析覆盖 `seal-events.jsonl`；能力探针覆盖封存（召回避开、点名仍在）。

### Docs

- `docs/schema.md`：封存与回顾的语义；备份一节改为五个文件。`docs/backup.md` / `docs/storage-events.md` / `docs/limits.md`（封存 ≠ 删除）同步。
- `docs/related-work.md`：封存（对照 MemoryBank 的遗忘曲线）与回顾（对照 Generative Agents 的 reflection 触发）各一行。
- DSH skill 说明补命令与硬规则：封存只能是她自己的选择，不要替她封存，也不要把封存的翻给别人看。

### 兼容

- 新增事件文件 `seal-events.jsonl`；没有这个文件时行为与 0.12.0 完全一致。旧版本读到新数据会忽略封存（封存的经历会重新可见），升级后请别再降级。

## [0.12.0] · 2026-11-16

这一版回到项目最初的问题：她昨天读了一章书、今天改了看法，还能翻回昨天的自己吗？

### Added

- **翻回那天的自己**：`loadAll` / `currentView` / `recall` 接受 `asOf`（`2026-11-15` 截到那天本地时间的最后一刻，也可以给完整 ISO 时间）。只保留那一刻之前写下的经历、后记、结案选择和想起事件；翻读的第二段变成【那时（截至 …）】。不改任何文件；`recall` 带 `asOf` 时拒绝 `mark`。CLI：`read --as-of`、`recall --as-of`；`read --id` 只看一条并附两段式全文。
- **后来的感觉**：`reviseExperience` 接受 `feeling`（数组或逗号分隔），写进后记事件；`then.feeling` 永远不动。翻读多一行「后来再想起的感觉」，没写感觉的后记不会被当成感觉变了。召回也匹配后来的感觉。CLI：`revise --feeling`。
- **回想的出处**：`addExperience` 接受 `refs`，写进 `then.refs`。写入时校验：引用的经历必须存在，旧 id 落到当前 id，歧义的旧 id 和找不到的 id 整条拒绝，最多 8 条。读取时派生 `refsInfo` 与反向引用 `citedBy`，翻读两头都看得见。CLI：`write --refs`。
- 证据桥 `feelingFacts`：她对每件事的感觉按时间成链（slot `feeling:<id>`），可以问"那时对这件事是什么感觉"；后来的感觉取代前一条，链条可查。
- `doctor` 新增「出处完整」：出处指向找不到的经历时报出来；能力探针覆盖感觉、出处与翻回那天。
- `examples/first-day/run.mjs --keep true` 多打印一条"翻回第 1 天的她"的现成命令。
- `docs/related-work.md`：借了谁的思路（Generative Agents、Zep/Graphiti、MemoryBank、A-MEM、情感引擎、fading affect bias 研究、agent-soul）、我们改成了什么、哪些刻意不做（遗忘曲线、自动改写、自动连线、自动情绪标签、心情自动回落）。

### Changed

- 结案文案去掉连续冒号：「当时没弄完的这件事：后来想通了：X」→「当时没弄完的「X」：后来想通了（日期）」。

### Docs

- `docs/schema.md`：后来的感觉、出处、翻回那天的语义与上限；备份一节改为四个文件。
- `examples/first-day/README.md`：先 done 再 shelved 的说明与 0.11.2 起的实际文案对齐。
- `adapters/README.md`：Windows PowerShell 5.1 解析 JSON 前要先设 UTF-8 输出编码。
- DSH skill 说明（两份）补新命令与三条硬规则：感觉由她自己说、回想要带出处、问"那时"就翻那时。

### 兼容

- 不新增数据文件。旧数据读出来与 0.11.2 一致；旧版本读到新数据会忽略 `later[].feeling` 和 `then.refs`。

## [0.11.2] · 2026-11-16

### Fixed

- `setUnfinishedState` 的“重读 → 判断 → 追加”移进同一把文件锁：两个进程同时提交同一选择只记一次，不会出现 `["done","done"]`。新增并发回归测试。
- `packages/core/index.d.ts` 补上 `unfinishedEvents` 导出：`import { unfinishedEvents } from 'whale-memory-core'` 在 TypeScript 里不再报 TS2305。
- `renderTwoPart` 的结案文案按“最近一次选择之前的那一次”渲染，不再用 `history.includes` 猜：`done → shelved` 会写“想通过一次，后来又决定先放下”；`shelved → reopen → done → reopen` 会写“想通过一次，后来又决定接着想”。
- 文案去矛盾：「这件没弄完的事已经想通了」→「当时没弄完的这件事：后来想通了」；「本来觉得想通了」→「想通过一次」；没有文字后记时不再说“还没回头想过”，改为“还没有文字后记”。

### Docs

- DSH 适配 README：安装 A/B 各给一条从已知目录出发的路径；自检每条命令都带 `--data`，并写明数据目录不能放在 skill / `node_modules` / 仓库克隆里；`waking` 自检加 `--peek true`，说明当天看不到次日效果。
- `examples/first-day/README.md`：`--keep true` 与“默认删掉”不再矛盾；done / shelved 写明二选一、两种各开一个目录；补 `reopen` 与两段输出示例。
- `docs/backup.md` 四件套与校验项；`docs/limits.md` 事件增长补 `unfinished-events.jsonl`；`docs/storage-events.md` 重写为当前语义（0.5.0 的旧描述已移除）。
- 根 README 增加“想让她放下旧念头”入口，备份说明改为四个文件。

## [0.11.1] · 2026-11-16

### Added

- CLI `doctor`：能力层体检，不是“文件在不在”。在临时目录真的走一遍写入 → 后记 → 结案 → 召回、导出 → 导入 → 读回，再检查事件文件逐行解析和醒来白名单。`ok: true` 才算能用。
- 注入示例加 `guard`：**只能否决，不能放行**。返回 `false` 就什么都不递；返回 `true` 也只是不拦，绕不过前面七条规则。

### Docs

- `docs/limits.md`：新增“能力层验证”与索引原则——原文是唯一真相，索引必须在写入时旁路生成、删掉能重建，不能成为来源。
- README / DSH README / SKILL 补 `doctor` 自检步骤。

## [0.11.0] · 2026-11-16

### Added

- **没弄完的事可以结案**：`setUnfinishedState(dir, { id, choice })`，`choice` 为 `done`（想通）/ `shelved`（先放下）/ `reopen`（又接着想）。只追加 `unfinished-events.jsonl`，不改 `then.unfinished`，也不算后记、不加想起次数。
- 醒来块、`currentView()`、`renderTwoPart()` 共用同一份派生状态：想通/暂放的不再进入“你还没弄完”；再拾起会恢复，翻读能看出中间放下过。
- CLI：`unfinished --id ... --state done|shelved|reopen`；`read` 输出带 `unfinished` 与 `unfinishedState`。
- 核心库导出 `unfinished-events` 子路径；`isPrivateKey` 补进类型。
- `examples/first-day/` 加了 `choose.mjs` 和 `--keep true`：读者可以自己选“想通/暂放”，再重开看两种结果。

### Changed

- 旧库没有 `unfinished-events.jsonl` 时行为不变。
- 导出、导入、备份都带上新事件文件；`purge` 删的是整个记忆目录，自然覆盖。

## [0.10.2] · 2026-11-16

### Added

- `docs/composition.md`：和向量 / RAG / BM25 的分工与三条边界；检索层只给 id，`then/later` 负责叙事。
- `examples/with-vector/`：一个不依赖任何服务的玩具向量库 + 组合演示，跑 `node examples/with-vector/host.mjs` 就能看到「向量找候选 → renderTwoPart 渲染 → 改主意后再渲染」。
- `tests/with-vector.test.mjs` 守住组合示例的输出。
- `examples/first-day/`：用一个外部角色的视角跑通「第一天读故事、关掉应用、第二天宿主自己把昨天递回来」。两个独立进程，不输入 recall 命令；`tests/first-day.test.mjs` 守住这段验收。

### Added（2026-11-16）

- CLI `export --out <目录>` / `import --from <目录> [--force true]`：把整份记忆打包成带 manifest 和 SHA-256 的目录；导入先校验、默认不覆盖、覆盖前备份。两个 CLI 都支持，`tests/export-import.test.mjs` 守住。
- CLI `purge [--yes true]`：列出/删除记忆目录、`*.pre-import-*`、迁移备份；默认只列不删。导出目录不在数据根下，需要自己清理。
- `docs/limits.md`：实测规模（2k / 10k 条，`tools/bench-recall.mjs` 可复现）、明文存储、单条删除不支持、提示词 overlay 持久生效、并发与断电边界。
- `docs/injection.md` + `examples/injection/`：什么时候把记忆递回去的七条规则、可跑的 `surface()`（`confirm()` 之后才记「想起」）、提示词模板与真实 `renderTwoPart` 输出对齐。
- `isPrivateKey(chatKey)`：核心库导出，醒来块和注入示例共用同一个私聊判断。
- `tests/injection-example.test.mjs`、`tests/export-import.test.mjs` 的越界路径与 purge 用例。

### Fixed（2026-11-16）

- `import` 的路径校验改为解析后的绝对路径判断：反斜杠、正斜杠、绝对路径、盘符相对路径、`..` 段一律拒绝，拒绝时一个字节都不写。之前只认正斜杠，Windows 反斜杠能跳出记忆目录。

## [0.10.1] · 2026-11-16

### Fixed

- **从 0.9 及更早升级后，旧经历的后记和想起记录重新认回来。** 0.10.0 换了旧格式记录的 id 算法，挂在旧 id 上的事件就对不上了。现在读取时会同时认旧 id：只有一条旧经历对应它时才认领；几条旧经历共用同一个旧 id 时，谁也不给，事件原样留在文件里，由 `pendingLegacyEvents()` 和 CLI `read` 的 `pending` 报告待核对。旧 id 也能继续用来 `revise` / `currentView`。
- 没有 `at` 的旧格式记录，id 不再每次读取都变（之前混入了 `Date.now()`，写过的后记下次就找不到）。
- 迁移回滚可以重复执行：第一次回滚不再删掉事件备份，第二次也就不会把当前事件文件当成"迁移新建的"删掉。迁移前有没有事件文件写在 `<备份>.manifest.json` 里；迁移前没有事件文件的，回滚只把新文件改名挪开，不删除。
- `revise` 给了不存在的 id 时返回 `ok: false` 并说明找不到，不再写下一条谁也看不见的后记。
- CLI `recall` 渲染：如果是凭较早的一条后记找到的，会把那条原样给出（"这次想起它，是因为后来写过"），再给最近一条，各带日子；后记不再截到 80 字。
- CLI 支持 `--data <数据根目录>`（优先于 `WHALE_DATA_DIR`），所有参数都可以写成 `--name=value`。之前 `docs/backup.md` 里的 `read --data=<data>` 会被忽略，读到的是另一个目录。
- `memory` 命令（`self-memory.recall`）和 `recall` 用同一套防编造口径（虚词不算、长查询过比例门槛），也会匹配后记。之前"我昨天买了什么股票"会因为一个"什么"召回无关记录。
- 醒来块改成白名单：只认 `private_*` / `private:*` / `local_*` / `local:*`，认不出的会话键一律不给。之前只拦 `group` 开头，`qq:group:1` 这类键会拿到私下内容。
- `self-settings.save()`：设置文件损坏时拒绝保存（原样留着等人修），不再用默认值把她改过的设置冲掉；加锁、原子写；`patch` 必须是对象。
- `leaveNote()` 在数据目录还不存在时不再报 ENOENT。
- 英文查询按整词匹配、不分大小写，常见英文虚词不参与匹配：`the cat` 不会再召回所有含 "the" 的记录，`LIGHTHOUSE` 能找到 "lighthouse"。

### Changed

- 匹配口径集中到 `lib/query-match.js`，`self-experience` 和 `self-memory` 共用。
- `renderTwoPart()` 去掉了没有用到的 `laterCount` 参数。

## [0.10.0] · 2026-11-15

### Added

- 召回匹配范围扩到**原文锚和后来追加的想法**：`then.quote`、`later[].thought` 都参与匹配。返回的条目带 `matchedIn`（`then` / `quote` / `later`），宿主可以区分"她当时就这么想"和"她后来才想明白"。

### Fixed

- 迁移回滚不再删掉整份事件文件：迁移前已有 `later-events` / `recall-events` 的，回滚时原样恢复；只有迁移新建事件时才会清掉。
- `self-settings.save()` 改走 `addExperience()` 的同一条追加路径：经历文件最后一行缺换行时，不会再和设置决定粘成一行。
- 旧格式（没有 `id`）的记录：ID 改为「时间 + 正文指纹」。同一分钟里的两条旧记录不会再被认成同一条，修订只归到原来那条（**旧 ID 与 0.9 及以前不同**）。
- `metrics` 改为从合并视图统计：通过 API 追加的 `later` 不再被算成"没改过"。
- `eval-recall` 分母改为全部用例；任何一条失败都会退出 1，故意答错一条会让 CI 变红。

### Docs

- 指标改名：`改主意率` → `有后记比例`，`想起率` → `被取回比例`，并写明它们只说明"有没有"，不说明"算不算改变"。
- 首页图示注明是"宿主读到的一条经历"，并列出备份必须带上的三个文件。

## [0.9.0] · 2026-11-15

### Added

- 召回支持 `mode`：`strict`（默认，长查询宁可不召回）与 `loose`（至少一个实词命中，给日常对话召回用）。CLI 加 `--mode strict|loose`。
- 长自然问句在 loose 下能召回：同一句「那本书里那个人后来怎样了」，strict 返回空，loose 命中「书里」那条。

### Changed

- **醒来块默认只给一对一**：`buildWakingBlock()` 在 chatKey 为空或 `group_*` 时返回空；群聊需显式 `allowGroup: true`。`consumeWaking()` 同样拒绝，避免没注入却消耗当天额度。这是把原本"交给宿主"的隐私判断做成代码默认值。

### Docs

- `architecture.md` 更新召回两种模式与醒来块安全默认。

## [0.8.2] · 2026-11-15

### Fixed

- `demo.mjs` 的召回查询是 12 字长问句，撞上「长查询要求命中 ≥60%」的门槛，导致 demo 的「想起」空转、计数显示 0。改成短锚点「烤肉」，并在确实没命中时打印明确说明而不是空一段。
- 新增 `tests/demo.test.mjs`：跑一遍 demo，断言退出码 0、有「想起」、有「想起过 1 次」、有「后来你想过」，防止演示脚本再悄悄空转。

## [0.8.1] · 2026-11-15

### Fixed

- **同一时刻互相矛盾的证据不再被 id 顺序决定**：同一 `slot`、同一时间、值不同、又没有明确 `supersedes` 时，`query()` 返回 `unknown`，`evidence` 里给出全部冲突记录。之前会按 id 排序挑最后一条，理由还写"只有一条记录"。
- `query()` 的「as-of 时间不合法」分支补上 `evidence: []`，与类型声明一致，调用方不会拿到 `undefined`。
- `self-experience` 的 `recallForContext` 补上类型声明（此前 TypeScript 导入会报 TS2305），并加入 `types/smoke.mts` 编译冒烟与运行时测试。

### Docs

- `docs/evidence.md` 增加第 4 条规则：同一时刻矛盾就说说不清。

## [0.8.0] · 2026-11-15

### Added

- **类型声明**：`index.d.ts` + 每个子路径的 `.d.ts`，`package.json` 用 `types` 条件导出。`types/smoke.mts` 在 CI 里跑 `tsc --strict`，保证声明和实现对得上。
- **经历 → 证据的桥** `evidence-from-experience.js`：`moodFacts()`（then.state）、`quoteFacts()`（then.quote）、`factsFromExperiences()`、`ask()`。只搬已有出处的记录，不推断。
- 桥的 3 组测试；`docs/evidence.md` 补桥的用法。

### Changed

- `index.js` 额外导出 `evidencePolicy` / `evidenceFromExperience` 命名空间。
- 根 `package.json` 增加 `npm run types`。

## [0.7.0] · 2026-11-15

### Added

- **证据策略可跑子集** `lib/evidence-policy.js`：as-of、被取代、后继缺席。纯函数，返回 `known` 或 `unknown`，不猜。配 8 组测试与 `docs/evidence.md`。
- `metrics` 增加平均长度与被想起条目的平均长度：短记录是否更占优，现在可观测。
- `docs/evidence.md`：经历（then/later）与事实（fact）两层的分工。

### Changed

- 召回排序按 `重叠数 / √记录长度` 归一化：长记录不再因为"碰巧多命中一个词"占便宜。
- `recall-events` 计数加进程内缓存（mtime + size 校验），同一进程连续召回不再重复解析事件文件。
- 锁等待从空转改为 `Atomics.wait`，不烧 CPU。
- 提示词锁改用共享 `file-lock.js`，少一份重复实现。
- README 定位从句首的「鲸鲸」改为通用描述，鲸鲸放进示例段落。
- 存储文档更新：改主意与想起都是事件。

## [0.6.1] · 2026-11-15

### Changed

- 召回加虚词表（今天/什么/我的/是不是…不参与 bigram）与长查询比例门槛（≥8 字要求命中 ≥60%）：在 200 条合成语料上，「量子力学与广义相对论」「我昨天买了什么股票」「深海热泉的化能合成」三条都不再命中；「灯塔」这类短查询不受影响。
- `tests/recall-quality.test.mjs`：3 组测试守住「该空的空、该中的中」。

### Docs

- `architecture.md` 召回章节写清虚词表与比例门槛，并说明为什么这不是追准确率。

## [0.6.0] · 2026-11-15

### Changed

- **改主意也变成事件**：`reviseExperience()` 只往 `later-events.jsonl` 追加，不再读全量、不再重写 `self-experience.jsonl`。经历文件自此真正 append-only，并发改写不再丢更新，也不会再出现 `EPERM: rename`。
- `loadAll()` 合并「行内 later + later 事件」，按 `at` 排序；孤儿事件在读取时忽略。
- `recall(mark:true)` 记完就地 +1，不再回读全量（原先一次召回读 4 遍全量）。
- `markRecalled()` 不再做存在性检查，直接追加事件。

### Added

- `lib/later-events.js`、`tools/migrate-later-events.mjs`（dry-run / apply / 备份 / 等价校验 / rollback）
- `tools/sync-dsh-core.mjs`：把 `packages/core/lib` 同步到 DSH 示例副本；`--check` 进 CI，副本漂移直接红
- 边界测试参数化：两条 CLI 都跑空白/超长/非法 weight/limit/空 query
- 并发测试：3 进程各改 20 次，60 条 later 一条不丢
- 根 `package.json`：`npm test` / `npm run check` / `npm run demo` / `npm run eval` / `npm run metrics`
- `examples/samples/sample-experiences.jsonl` 真正进仓库（此前被 `.gitignore` 的 `*.jsonl` 挡住）

### Fixed

- `revise --thought` 超长不再静默截成 300 字：超过 1000 字直接报错，文件字节不变
- `revise --reason` 超过 200 字报错
- `porting.md` 里不存在的 `renderSelfProfileBlock` 改成 `self-prompt.render` / `self-memory.renderBlock`
- `packages/core/README` 不再手写死版本号

## [0.5.1] · 2026-11-15

### Fixed

- Windows 下多进程同时追加事件时，锁目录并发 mkdir/rm 会短暂返回 EPERM/ENOENT，导致并发用例失败；现在把这类错误当成「忙」重试，直到超时。提示词锁同样处理。

## [0.5.0] · 2026-11-15

### Changed

- 「想起」从经历行里拆出来，改为追加到 `recall-events.jsonl` 的**事件**。`markRecalled()` 不再重写经历正文；`recalls` / `lastRecalledAt` 在读取时由事件派生。
- 旧数据里的 `recalls` / `lastRecalledAt` 仍可读：事件文件里没有该 id 时回退到旧字段。
- 事件追加带单写者锁（`recall-events.jsonl.lock`，mkdir 独占），多进程并发追加不丢行。

### Added

- `lib/recall-events.js`：`append` / `readAll` / `countByExp` / `list`
- `tools/migrate-recall-events.mjs`：dry-run、`--apply`、写前备份、等价校验、`rollback()`
- 测试 4 组：事件追加与坏行、`markRecalled` 不改正文、迁移与回滚、4 进程并发各 25 条不丢

## [0.4.0] · 2026-11-15

### Added

- 提示词护栏：原子写、单写者锁（超时报错不覆盖）、篡改检测 `verify()`、`render()` 拼接默认段并在超总长时明确报告截断、重复内容不写（`noop`）
- `tools/metrics.mjs` + `docs/metrics.md`：改主意率、想起率、未完成率、原文锚、提示词版本、损坏行；明确不把召回准确率当目标
- `docs/storage-events.md`：定下「经历是事实，想起是事件」的存储语义与迁移/回滚方案（实现留到 0.5.0）
- 提示词护栏 4 组测试、指标 2 组测试

### Changed

- `self-prompt.save()` 会清理不可见控制字符；空白、超长继续拒绝
- `self-prompt.render(basePrompt, dataDir)` 为新增 API；overlay 超总长时返回 `truncated: true` 和说明

## [0.3.0] · 2026-11-15

### Breaking

- **`plugin/` 移出公开仓库**。该目录自带的构建自检标记写着「不可安装」（指定构建未经扫描裁定，历史上出现过 Defender 告警），不应随 MIT 公开仓分发。完整引擎（约 26k 行）与具体宿主部署强耦合，改为在 [`docs/archive/architecture.md`](docs/archive/architecture.md) 里写清设计。
- `recall()` 默认 `mark: false`：**读操作不再写盘**。要记「想起」请显式传 `mark: true`，或调用 `markRecalled`。
- `buildWakingBlock()` 改为纯只读；确认真的注入了，再调用新的 `consumeWaking()` 记「已展示」。CLI 的 `waking` 默认打印即消费，`--peek true` 可只看不消费。

### Fixed

- `minOverlap` 阈值 bug：原来拿「重叠数 × 重要度」和阈值比，导致 important 记录 1 个 bigram 就过线、minor 要 2 个——重要度偷偷改变了召回门槛。现在阈值只比原始重叠数，权重只影响排序。
- `atomicWrite` 临时文件名用 `Date.now()`，同毫秒并发会撞；改为时间 + pid + 随机后缀。

### Changed

- `tools/privacy-canary.mjs` 改为验证「跨会话可见性规则」本身（`tools/lib/visibility.mjs`），不再依赖未公开的引擎；新增「别的私聊看得见自己的记录、但看不见主人的那条」用例。
- 内部文档（`docs/项目原则.md`、`docs/计划-合并版-v2.md`）移出公开仓库：里面有真实部署的规模统计，不适合公开。
- Node 版本要求统一为 **20+**（README、engines、CI 一致）。
- 新增 `docs/archive/architecture.md`：分层、事件溯源、证据策略、召回与写入约束。

## [0.2.1] · 2026-11-15

### Fixed

- `--limit 0` 不再回落到默认条数（原来 `Number(x) || 8` 把 0 当成假值），现在 0 = 一条都不要
- `--limit` 为负数或非整数时报错，不再出现"负数返回全部"的意外行为
- `--text` 为空白（空格、全角空格）时拒绝写入
- 超长文本不再静默截断：`text` > 2000 / `thought` > 1000 / `scene` > 500 / `unfinished` > 300 字，或 `feeling` > 8 个，直接报错并给出实际长度；读取旧记录也不再截断
- 非法 `--weight`（如 `--weight 爆炸`）报错，不再静默存成 `normal`

### Added

- `tools/run-tests.mjs`：自动跑 `tests/*.test.mjs`，新加测试文件不用再改 CI
- schema 文档补「写入上限」「召回语义（空 query = 最近 N 条）」
- 边界测试 3 组，测试总数 17

## [0.2.0] · 2026-11-15

### Changed

- `recall()` 默认会记一次「想起」（`recalls + 1`），返回的对象里计数已是新值；只读场景传 `mark: false`
- 包说明改为「自传层内核」，明确不含 vault、取证、合并与注入预算
- `plugin/README.md` 说明插件是参考实现、非稳定 API，并写清 CI 覆盖范围

### Added

- `tools/check-syntax.mjs`：全仓 126 个 `.js/.mjs` 的 `node --check`，已进 CI
- 测试：召回计数、虚拟时钟模拟「隔天延续」（14 组全部通过）

### Fixed

- demo 输出「这条被你想起过 0 次」但现在这次本身就是第 1 次想起；现在显示 1

## [0.1.0] · 2026-11-15

第一个公开版本。

### Added

- 经历两层结构：`then`（写下即固定）/ `later`（只追加）
- 通用 CLI：`write` / `recall` / `read` / `revise` / `waking` / `memory` / `prompt` / `settings`
- DSH skill 包，可独立复制
- 内核包 `whale-memory-core`，已发布到 npm
- 数据格式文档 `docs/schema.md`、移植指南 `docs/porting.md`
- 三条虚构样本 `examples/samples/`
- 召回小评测 `tools/eval-recall.mjs`（8 条用例）
- 隐私金丝雀 `tools/privacy-canary.mjs`
- CI：Node 20/22 × ubuntu/windows
- 中英双语 README、CONTRIBUTING、SECURITY

### Fixed

- 连续写入时把换行写成字面量 `\n`，导致部分记录读不回来；改为追加写并补尾换行
- 文件含损坏行时，改写操作现在会报错而不是静默覆盖
- `self-prompt` 同一毫秒保存两次会互相覆盖版本；版本号现在保证唯一
- `self-settings` 在没有数据目录时保存会失败；现在自动建目录

### Removed

- 三个早期的回放与备份文件
- 隐私检查里的真实会话编号，改为虚构编号

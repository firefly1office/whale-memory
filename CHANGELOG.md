# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

- **`plugin/` 移出公开仓库**。该目录自带 `build-status=blocked-not-for-install`（指定构建未经扫描裁定，历史上出现过 Defender 告警），不应随 MIT 公开仓分发。完整引擎（约 26k 行）与具体宿主部署强耦合，改为在 [`docs/architecture.md`](docs/architecture.md) 里写清设计。
- `recall()` 默认 `mark: false`：**读操作不再写盘**。要记「想起」请显式传 `mark: true`，或调用 `markRecalled`。
- `buildWakingBlock()` 改为纯只读；确认真的注入了，再调用新的 `consumeWaking()` 记「已展示」。CLI 的 `waking` 默认打印即消费，`--peek true` 可只看不消费。

### Fixed

- `minOverlap` 阈值 bug：原来拿「重叠数 × 重要度」和阈值比，导致 important 记录 1 个 bigram 就过线、minor 要 2 个——重要度偷偷改变了召回门槛。现在阈值只比原始重叠数，权重只影响排序。
- `atomicWrite` 临时文件名用 `Date.now()`，同毫秒并发会撞；改为时间 + pid + 随机后缀。

### Changed

- `tools/privacy-canary.mjs` 改为验证「跨会话可见性规则」本身（`tools/lib/visibility.mjs`），不再依赖未公开的引擎；新增「别的私聊看得见自己的记录、但看不见主人的那条」用例。
- 内部文档（`docs/项目原则.md`、`docs/计划-合并版-v2.md`）移出公开仓库：里面有真实部署的规模统计，不适合公开。
- Node 版本要求统一为 **20+**（README、engines、CI 一致）。
- 新增 `docs/architecture.md`：分层、事件溯源、证据策略、召回与写入约束。

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
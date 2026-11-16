# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

- **`plugin/` 移出公开仓库**。该目录自带的构建自检标记写着「不可安装」（指定构建未经扫描裁定，历史上出现过 Defender 告警），不应随 MIT 公开仓分发。完整引擎（约 26k 行）与具体宿主部署强耦合，改为在 [`docs/architecture.md`](docs/architecture.md) 里写清设计。
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
# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
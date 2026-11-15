# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

- 待定

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
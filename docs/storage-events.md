# 存储语义：经历是事实，想起是事件

状态：**0.5.0 已实现**。`recalls` 字段仍可读，但新写入一律走 `recall-events.jsonl`；迁移工具见 `tools/migrate-recall-events.mjs`。

## 要解决的问题

现在 `markRecalled()` 会读全文件、改一行、整本重写：

- 读路径（召回）一旦 mark，就变成 O(n) 写；批量召回 O(n²)
- 没有锁，两个进程同时写会丢数据
- 「想起」和「经历」混在同一行里，改一个计数字段也要重写她的正文

## 定下的语义

**经历是事实，想起是事件。**

| 数据 | 性质 | 文件 | 写方式 |
| --- | --- | --- | --- |
| 经历（then/later） | 事实，只追加 | `self-experience.jsonl` | 追加一行；改主意 = later 里加一条 |
| 想起 | 事件，只追加 | `recall-events.jsonl` | 追加一行 `{id, at, query, chatKey?}` |
| 提示词版本 | 事件，只追加 | `prompt-overlay/versions/` + `history.jsonl` | 已是这样 |
| 设置 | 状态，可覆盖 | `self-settings.json` | 原子写 |
| 日记 | 事实，只追加 | `autobiography.jsonl` | 追加一行 |

`recalls` / `lastRecalledAt` 不再写入经历行；读取时由事件派生：

```
recalls = len(recall-events where id == exp.id)
lastRecalledAt = max(at) of those
```

## 不变量

1. 经历行一旦写下，字节不改（`later` 是往文件尾部追加新行？不——`later` 仍在同一行内）
2. 任何"计数"都不写进经历行
3. 事件文件只追加，从不重写
4. 派生结果可以随时从原始文件重建
5. 单写者前提下，追加是安全的；多进程写必须拿锁

## 迁移步骤（实现时执行）

1. 备份整个 `plugin-data/biomimetic-memory/` 到带时间戳的目录
2. 读所有经历行，把已有的 `recalls` 数字转成 N 条 `recall-events`（`at` 用 `lastRecalledAt`，缺失则用 `at`），并记为 `backfilled: true`
3. 写 `recall-events.jsonl`（先写临时文件再改名）
4. 重写经历行时**逐行保留原字节**，只去掉 `recalls` / `lastRecalledAt` 两个键——这一步最容易出错，必须 dry-run 对比行数与 JSON 等价性
5. dry-run：新旧两侧各算一遍 `recalls`，逐条比对，不一致就中止
6. 回滚：把备份目录整体换回，事件文件删除

## 为什么不是"把经历也改成事件日志"

- 她的正文是给人读的，不是给数据库读的；保留一行一条 JSON 的可读性比"纯事件溯源"更重要
- `later` 天然就是追加，已经满足事件语义
- 真正需要事件化的是**想起**，因为它高频、改动小、又必须可重建

## 并发

- 追加写在 POSIX 上小于 PIPE_BUF 基本原子；Windows 上不保证
- 实现里给追加加了锁（`recall-events.jsonl.lock`，mkdir 独占，20ms 轮询，默认 3 秒超时）
- 文档里继续写明：**同一目录不要多进程并发写**

## 为什么暂时不按月分片

0.7.0 起事件计数在进程内缓存（按 mtime + size 失效），单次 `loadAll` 在 2 万条事件时约十几毫秒，先不引入分片：分片会破坏「一个文件只追加」的简单性，也要求读取端兼容多文件。等真实数据到十万条量级再考虑，届时先加派生索引，不动原始文件。

## 实现清单（0.5.0 已完成）

- [x] `lib/recall-events.js`：append / readAll / countByExp / list
- [x] `self-experience.js`：读时合并事件计数；`markRecalled` 改为追加事件，不再重写正文
- [x] `tools/migrate-recall-events.mjs`：备份、dry-run、apply、等价校验、回滚
- [x] 测试：并发 4 进程 × 25 条不丢、迁移前后计数一致、坏行跳过、回滚字节一致
- [x] 版本策略：0.5.0，旧 `recalls` 字段仍可读

## 相关

- [schema.md](schema.md)：当前数据格式
- [architecture.md](architecture.md)：分层与写入约束
- [metrics.md](metrics.md)：想起率怎么算
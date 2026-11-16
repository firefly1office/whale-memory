# 存储语义：经历是事实，变化是事件

当前版本：0.11.x。所有“后来的变化”都不改写经历正文，而是追加事件，读取时再合并。

## 一句话

```
then 写一次，永远不改；
之后发生的（改主意、想起、放下），各自追加到自己的事件文件；
读的时候合并成“一条经历现在的样子”。
```

## 文件分工

| 数据 | 性质 | 文件 | 写方式 |
| --- | --- | --- | --- |
| 经历正文（`then`） | 事实，只追加 | `self-experience.jsonl` | 追加一行；写入不加锁 |
| 改主意（`later`） | 事件，只追加 | `later-events.jsonl` | 追加一行 `{id, at, thought, reason?}`；走文件锁 |
| 想起 | 事件，只追加 | `recall-events.jsonl` | 追加一行 `{id, at, query, chatKey?}`；走文件锁 |
| 没弄完的事 | 事件，只追加 | `unfinished-events.jsonl` | 追加一行 `{id, at, day, choice, note?}`；走文件锁 |
| 封存 / 解封 | 事件，只追加 | `seal-events.jsonl` | 追加一行 `{id, at, day, action, note?}`；锁内重读判断，重复动作不写 |
| 事后联想 | 事件，只追加 | `link-events.jsonl` | 追加一行 `{from, to, at, day, reason}`；同一对（不分方向）只连一次 |
| 人生章节 | 事件，只追加 | `chapter-events.jsonl` | `open` / `rename` / `close` 各一行；改名保留旧名 |
| 没说出口的话 | 事件，只追加 | `unsaid-events.jsonl` | 留下一行 `status:open`；说出口 / 丢掉各追加一行；只在私聊里经由 `listUnsaid` 读出 |
| 日记 | 事实，只追加 | `autobiography.jsonl` | 追加一行 |
| 设置 | 状态，可覆盖 | `self-settings.json` | 锁 + 临时文件 + rename |
| 提示词 | 状态/历史 | `prompt-overlay/` | 锁 + 原子写，保留版本 |

## 派生规则

```
later       = 旧行内 later + later-events 里该 id 的事件（按 at 排序）
recalls     = recall-events 里该 id 的事件数
lastRecalledAt = 该 id 事件的最大 at
unfinishedState = unfinished-events 里该 id 的最后一条；history 保留完整顺序
sealed      = seal-events 里该 id 的最后一条是 seal（是 unseal 或没有就不算封存）
links       = link-events 里涉及该 id 的每一对（两头都有）
chapters    = 重放 chapter-events 得到的章节里，from ≤ day ≤ to 的那些
refsInfo / citedBy = 由经历行里的 then.refs 派生（0.12 起）
以上都接受截断时刻 until（翻回那天的自己）：只用那一刻之前的事件重放
```

- 旧文件里的 `later` / `recalls` / `lastRecalledAt` 仍然可读；有事件时以事件为准。
- 0.10.0 之前的旧 id：读取时只在该旧 id 唯一对应一条经历时认领；几条共用时不归给任何一条，`read` 的 `pending` 会列出来。
- 派生结果可以随时从原始文件重建，不需要迁移状态。

## 不变量

1. `then` 一旦写下，字节不改。
2. 计数（`recalls`）不写回经历行。
3. 事件文件只追加，从不重写；删除只能整库删（见 [limits.md](limits.md) 的 `purge`）。
4. 读操作不写盘；`recall` 默认只读，记「想起」要显式 `mark: true` 或 `markRecalled`。
5. 同一个选择重复提交不写第二条；并发提交由锁内“重读→判断→追加”保证只记一次。
6. 经历追加不加锁，事件追走锁：不要让两个宿主进程同时写同一个目录。

## 迁移

- 旧的行内 `later` → `later-events.jsonl`：`tools/migrate-later-events.mjs`
- 旧的行内 `recalls` → `recall-events.jsonl`：`tools/migrate-recall-events.mjs`

两个工具都是默认 dry-run，先备份、校验、可回滚；回滚可以重复执行。

## 为什么不做压缩

压缩会生成摘要，而摘要一旦替代原文，“她当时怎么想”就不可查了。本项目选择保留原文、把抽象留给宿主；宿主可以在写入时旁路建索引，但索引永远不是来源（见 [limits.md](limits.md)）。
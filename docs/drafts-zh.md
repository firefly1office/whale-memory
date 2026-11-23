# 作品稿本：她写下的那一页，隔天还读得回来（设计记录）

> 一个很小的问题：角色能说"我在写一个故事"，但这句话说完就散了。她真写下的正文没有地方停，
> 改到第三版时前两版没了，两个进程同时改还会互相覆盖。
>
> 这里只做三件事：**版本只追加**、**按基线拒冲突**、**能翻回过去**。所有测试都是合成数据。

## 为什么不是"再存一个字段"

聊天记录里的文本是"说过的话"，不是"写下的东西"：

- 说过的话是流水，改口就是新的一句；
- 写下的东西是一页，第二版要能读回第一版，改坏了要能退回去；
- 而且必须能回答："我上次读到的是哪一版？"——不然改稿就变成覆盖。

所以稿本单独存：每件作品一个文件，一行一版，只追加。

## 状态

```
（空）──save(baseRevision 0)──> revision 1 ──save(1)──> revision 2 ──save(2)──> …
                                     │
                                     ├──save(旧基线)──> conflict（附 currentRevision）
                                     └──同 operationId──> 回原回执（不多一版）
```

关键约束：

- **整份正文，不是补丁**：`save` 收的是完整正文，避免补丁叠加出无法回滚的状态。
- **基线由读方提供**：`baseRevision` 必须是调用方真的读到的那一版；对不上就 `conflict`，
  并告诉现在第几版——不猜、不自动合并。
- **幂等键**：`operationId` 相同的同内容重复提交只算一版（网络重试不会凭空多一版）；
  同键但内容不同则 `operation_conflict`，说明"这次不只是重试"。
- **不可变**：旧版本原样保留，包括她的原话。任何"清理禁词/统一措辞"的加工都不许写回稿本。
- **读不到就说读不到**：整份文件坏掉时返回 `unreadable`，不返回空——空会让人以为她还没写。
- **上限**：单版 16 KiB、每件 2000 版；到顶返回 `version_limit` 并拒绝写入，**不静默裁剪**。

## 存储

```
<dir>/drafts/<hash(scopeKey)>/<hash(itemId)>.jsonl
```

两个键都先取哈希再进文件名：`itemId` 是任意字符串（中文、空格、看起来像路径的东西都行），但拼不出 `../`，越不出数据目录。

一行一版：

```json
{"v":1,"scopeKey":"private:owner","itemId":"story-1","revision":2,"baseRevision":1,"operationId":"","at":1795432493803,"text":"…"}
```

同一目录里的 `<itemId>.jsonl.lock` 是目录锁（mkdir 独占；默认等 3 秒，拿不到返回 `busy`）。
锁里写 owner.json（pid + hostname + token + 心跳），同一台机器上按 pid 判活，活着的持有者不会被抢。

写入是 **O_APPEND 单行追加 + fsync**，不重写整份文件：读不懂的旧行原样留着。
追加前会看文件末尾是不是停在半行（崩溃/掉电），是就先补一个换行，让半行保持坏行、
新版本照常可读。

## 接口

```js
import { saveDraft, readDraft, listHistory } from './packages/drafts/index.js'

saveDraft(dir, { scopeKey, itemId, baseRevision, text, operationId })
readDraft(dir, { scopeKey, itemId, revision?, asOf? })
listHistory(dir, { scopeKey, itemId, before?, limit? })
```

失败码：`invalid_input`、`conflict`、`operation_conflict`、`revision_missing`、
`text_too_large`、`version_limit`、`busy`、`unreadable`、`storage_error`。

读结果里还会带 `corrupt`（读不懂的行数，0 表示没有）。整份都读不懂时返回 `unreadable`，
不会返回"空稿"——"她还没写"和"我们弄丢了"必须长得不一样。

## 不做什么

- 不判断内容好坏、不调用模型、不生成正文；
- 不替她决定"该写了"或"该改了"——入口是调用方的事；
- 不做遗忘和裁剪：旧版是她的过去，删不删由调用方决定。

## 测试

`tests/drafts.test.mjs`（28 项）：版本递增、旧基线冲突、旧版可读、幂等重放、幂等冲突、
作用域隔离、as-of、历史分页、坏行跳过、整份坏掉不装空、正文原样落盘、**八个进程同时抢同一基线
（有起跑栅栏，一个成功七个 conflict）**。
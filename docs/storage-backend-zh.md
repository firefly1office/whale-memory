# 存储后端（阶段 1）

> 目标：把「记录存在哪」从「记录长什么样」里拆出来。换引擎**不改变契约**——`docs/contract-v1-zh.md` 一个字没动。

## 一、现在有什么

| 后端 | 文件 | 依赖 | 适合 |
| --- | --- | --- | --- |
| `file` | `self-experience.jsonl` | 无 | 现有部署、可读性、手工修复 |
| `sqlite` | `memory.sqlite` | Node 内置 `node:sqlite`（**>= 22.5**），不装第三方包 | 十万级以上、需要事务与索引 |

打开方式：

```js
import { openBackend } from 'whale-memory-core/storage/backend'
const db = await openBackend({ kind: 'sqlite', dir: memoryDir })
await db.append(record)
const rows = await db.all()
```

`node:sqlite` 不存在时**直接报错**，不静默降级——降级要显式写：

```js
try { db = await openBackend({ kind: 'sqlite', dir }) }
catch { db = await openBackend({ kind: 'file', dir }) }
```

## 二、接口（两个后端都一样）

| 方法 | 语义 |
| --- | --- |
| `append(record)` | 追加一条。sqlite 遇到重复 id 抛错（id 永不复用） |
| `all()` | 全部记录，按写入顺序。坏数据整体失败，不当空 |
| `byId(id)` | 取一条，没有返回 `null` |
| `byDay(day)` | 按本地日取（sqlite 有索引；file 走全量过滤） |
| `count()` | 条数 |
| `transaction(fn)` | 仅 sqlite；file 后端没有这个能力（`capabilities.transactions === false`） |
| `close()` | 释放连接 |

能力和引擎名在 `backend.capabilities` 上，调用方可以据此决定能不能依赖事务。

## 三、迁移

```bash
node tools/migrate-storage.mjs <memory-dir>            # 演练，不写盘
node tools/migrate-storage.mjs <memory-dir> --write    # 建 memory.sqlite
node tools/migrate-storage.mjs <memory-dir> --verify-only
```

规矩：

1. **源文件一个字不改**——迁移是叠加，不是替换；
2. **逐条对拍**：条数相同 + 每条 JSON 逐字节相同，才算成功；
3. 任何一条对不上 → 整体失败，删掉半成品，不留"迁移了一半"的库；
4. 目标已存在时**拒绝覆盖**，要重来请手工移走。

## 四、实测（本机 20,000 条，Node 24）

| 后端 | 写入 2 万条 | byId p50 | byId p99 | 全量读 |
| --- | --- | --- | --- | --- |
| file | **133,242 ms** | 20.6 ms | 30.7 ms | 19 ms |
| sqlite | **206 ms** | 0.012 ms | 0.084 ms | 55 ms |

读法：

- **写入差 600 倍**：file 后端每写一条都要 `open + 读末字节 + 写 + close`，条数一多就是灾难；
- **byId 差 1700 倍**：file 的 `byId` 走的是"读全量 + 线性找"，这是现有实现的真实代价；
- 全量读反而是 file 快（19ms vs 55ms）——SQLite 要逐行 `JSON.parse`。**所以别把 sqlite 当"一切更快"**，它快在写入与按 id 取。

复现：`node tools/bench-storage.mjs --n 20000 --lookups 500`

## 五、这一阶段没做的

- **事件文件没搬**（`later-events` / `seal-events` / `recall-events` / `unfinished-events` 仍是 JSONL）。一次只换一层，好回流；
- **没有把上层读路径切到 sqlite**：`loadAll` 仍读 JSONL。切之前得先把事件也搬完，否则记录在库里、事件在文件里，读一半就断；
- **没有多写者支持**：sqlite 有事务，但契约里"单写者"的承诺没改。

## 六、下一步（阶段 1 剩余）

1. 事件也搬进 sqlite（同一事务里追加记录 + 事件）；
2. `loadAll` 增加 `backend` 选项，默认仍 file（零行为变化），可选 sqlite；
3. 迁移工具扩展到事件，并加一条"迁移后召回结果一致"的对照测试。
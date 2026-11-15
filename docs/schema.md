# 数据格式（schema v2）

[中文](schema.md) · [English](#english)

所有数据都是**一行一条 JSON**（JSONL），放在：

```
<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/
  self-experience.jsonl   她的经历
  autobiography.jsonl     她的日记（默认只在一对一使用）
  self-prompt.json        她自己的提示词 overlay（版本只追加）
  self-settings.json      她自己的设置
```

## 一条经历

```json
{
  "id": "exp_mwggkzwbwp10",
  "day": "2026-11-14",
  "at": "2026-11-14T15:00:13.812Z",
  "author": "self",
  "source": "own-time",
  "kind": "读书",
  "weight": "important",
  "then": {
    "text": "读到社办门口那段，有点替他难受",
    "scene": "晚上十一点，屋里很静",
    "feeling": ["闷", "有点酸"],
    "thought": "再不说就真的没牵扯了",
    "unfinished": "想知道他们后面有没有说开",
    "quote": { "text": "我也很开心", "source": "《败北女角太多了》第3章" },
    "state": { "at": "2026-11-14T15:00:13.812Z", "mood": "偏闷" }
  },
  "later": [
    { "at": "2026-11-15T09:12:00Z", "thought": "现在觉得，他是在护着朋友" }
  ],
  "status": "kept"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一；`exp_` 前缀 |
| `day` / `at` | string | 当地日期 / ISO 时间 |
| `author` / `source` | string | 谁写的、从哪来（`own-time`、`own-decision`…） |
| `kind` | string | 读书 / 想事 / 决定 / 其它 |
| `weight` | enum | `important` / `normal` / `minor`，决定回想的长度 |
| `then` | object | **写下即固定**，任何代码都不许改写 |
| `then.quote` | object\|null | 原文锚：她读到的原句与出处 |
| `later` | array | **只追加**；每项 `{at, thought, reason?}` |
| `status` | string | 目前只有 `kept` |

## 规则

1. `then` 不覆盖。改主意写进 `later`，旧内容原样保留。
2. 文件损坏（有不合法 JSON 行）时：**读取跳过坏行，改写直接报错**；新经历用追加写，坏行原样留住。
3. 行尾必须是真实换行；不允许把 `\n` 写成两个字符。
4. 日记单独一个文件，读取时默认不加载；宿主决定什么时候打开。

## 写入上限（超了报错，不静默截断）

| 字段 | 上限 |
| --- | --- |
| `text` | 2000 字 |
| `scene` | 500 字 |
| `thought` | 1000 字 |
| `unfinished` | 300 字 |
| `feeling` | 8 个 |
| `quote.text` | 500 字 |
| `kind` | 20 字 |

空白的 `text` 直接拒绝（`{ok:false, error:"text 不能是空的。"}`）。超长时报错并给出实际长度，让她自己决定删哪些、或拆成两条——记忆系统不能悄悄丢掉一半原文。

## 召回语义

- 给了 query：按相关度 × 重要度排序，取前 N 条
- **空 query：返回最近 N 条**（按时间倒序），不是报错，也不是"什么都没匹配到"
- `limit: 0`：一条都不返回
- `limit` 为负数或非整数：报错

## 版本兼容

- 当前格式按结构识别，没有 `schema` 字段
- v1 的扁平记录（`text` / `thought` 直接在顶层）仍能被读取；新写入一律 v2
- 未来若加 `schema` 字段，必须保证旧读取器能忽略它
- 改格式的 PR 必须写明迁移方式，且不能删掉旧字段

---

## English

JSONL, one record per line, under `<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/`.
`self-experience.jsonl` holds her experiences. `then` is immutable; `later` is append-only. A damaged line is skipped on read, blocks rewrites, and is preserved when new records are appended. Diary lives in a separate file and is not loaded unless the host asks for it (`includeDiary: true`).

v1 flat records (`text` / `thought` at top level) are still readable; new writes use v2. Any future `schema` field must be ignored gracefully by older readers, and format changes must document migration without deleting old fields.
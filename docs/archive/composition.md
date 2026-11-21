# 和检索层怎么组合

> [English](en/composition.md) · 中文（本页）

[中文](composition.md) · [English](#english)

whale-memory 不是召回系统，是**人格层**。它不回答「哪段最相关」，它回答「这条经历是她当时的想法，还是后来改过」。

所以它和 RAG / 向量库 / 搜索服务不是替代关系，是两层：

```
用户问一句话
   ↓
【宿主的检索层】RAG / 向量 / BM25 / 图查询 —— 找到可能相关的 id
   ↓
【whale-memory】按 id 取回经历 → renderTwoPart() → 「当时 / 现在」
   ↓
宿主把这段塞进上下文，或者选择不塞
```

## 接口只有三个

```js
const rows = loadAll(dataDir)                 // 全部经历（宿主可以按 id 过滤）
const row = currentView(dataDir, id)          // 单条，含合并后的 later
const text = renderTwoPart(row)               // 「当时 / 现在」两段
```

检索层只需要给出 **id**；剩下的事都归 whale-memory。

## 一个可跑的玩具例子

`examples/with-vector/` 里有一个 60 行的假向量库（字符 bigram 哈希成 64 维，余弦相似度），不依赖任何服务：

```sh
node examples/with-vector/host.mjs
```

它演示：向量库找到候选 id → `loadAll()` 取回 → `renderTwoPart()` 渲染 → 角色改主意后再渲染。

## 三条边界

1. **召回质量不是这个项目的问题**：向量、rerank、混合检索，宿主用自己信得过的方案
2. **但"取回来之后怎么办"是**：不能被检索结果直接覆盖 `then`，不能让 `later` 丢失，不能把别人的经历递错会话
3. **写入也别交给检索层**：向量库索引可以重建，经历只能追加

## 常见接法

| 你的检索层 | 怎么接 |
| --- | --- |
| pgvector / sqlite-vec | 索引 `then.text + then.thought`；命中后按 id 取回 |
| Chroma / Qdrant / Milvus | 同上，元数据里存 `id`、`day`、`weight` |
| Elasticsearch / BM25 | 同 id 过滤，效果比 bigram 好 |
| 纯 LLM 路由 | 让模型从 `read` 的列表里挑 id，适合几十条的小库 |
| 不用向量 | 就用内置的 `recall()`；strict 查证，loose 日常 |

## 不要做的事

- 不要用向量相似度决定「她当时怎么想」——那是 `then` 的内容，不是相似度
- 不要把检索分数写进经历文件
- 不要为了省 token 合并两条经历（`then` 不能覆盖）
- 不要把日记索引进群聊可用的索引

## 一句选型

要答得准用 RAG；要事实可追溯用 Zep 那类双时态；要角色有「成长感」、能翻旧账，用 whale-memory 管 `then/later`，检索交给上面任何一层。

---

## English

whale-memory is not a retrieval system; it is the **personality layer**. It does not answer "which passage is most relevant" — it answers "is this what she thought then, or what she changed her mind to later".

Compose it with any retrieval layer:

```
user message → host retrieval (vector/BM25/graph) → candidate ids
            → loadAll()/currentView() → renderTwoPart() → "then / now"
            → host decides whether to inject
```

Only three calls matter: `loadAll`, `currentView`, `renderTwoPart`. Retrieval only needs to produce ids. Run `examples/with-vector/host.mjs` for a dependency-free toy example.

Boundaries: retrieval quality is the host's problem; what happens after retrieval is ours — never overwrite `then`, never drop `later`, never surface another chat's records.
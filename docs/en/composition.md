# How it composes with a retrieval layer

> Translated from the Chinese original ([中文](../composition.md)). If they disagree, the Chinese version is authoritative.

[中文](../composition.md) · English

whale-memory is not a recall system; it is the **personality layer**. It does not answer "which passage is most relevant" — it answers "is this experience what she thought at the time, or what she changed her mind to later".

So it does not replace RAG / vector stores / search services; they are two layers:

```
the user says one sentence
   ↓
【host retrieval layer】RAG / vectors / BM25 / graph queries — find the possibly relevant ids
   ↓
【whale-memory】fetch experiences by id → renderTwoPart() → "then / now"
   ↓
the host puts that into the context, or chooses not to
```

## Only three entry points

```js
const rows = loadAll(dataDir)                 // all experiences (the host can filter by id)
const row = currentView(dataDir, id)          // one entry, including the merged later
const text = renderTwoPart(row)               // the two parts: "then / now"
```

The retrieval layer only has to produce an **id**; everything else belongs to whale-memory.

## A runnable toy example

`examples/with-vector/` contains a 60-line fake vector store (character bigrams hashed into 64 dimensions, cosine similarity), with no service dependency:

```sh
node examples/with-vector/host.mjs
```

It demonstrates: the vector store finds candidate ids → `loadAll()` fetches them → `renderTwoPart()` renders them → render again after the character changes her mind.

## Three boundaries

1. **Recall quality is not this project's problem**: vectors, rerank, hybrid retrieval — the host uses whatever it trusts
2. **But "what happens after the fetch" is**: retrieval results must not overwrite `then` directly, `later` must not get dropped, another person's experiences must not be handed to the wrong conversation
3. **Do not give writes to the retrieval layer either**: a vector index can be rebuilt; experiences can only be appended

## Common wirings

| Your retrieval layer | How to wire it |
| --- | --- |
| pgvector / sqlite-vec | Index `then.text + then.thought`; on a hit, fetch back by id |
| Chroma / Qdrant / Milvus | Same, storing `id`, `day`, `weight` in the metadata |
| Elasticsearch / BM25 | Filter by the same id; works better than bigrams |
| Plain LLM routing | Have the model pick ids from the `read` list; suited to small stores of a few dozen entries |
| No vectors at all | Just use the built-in `recall()`; strict to verify, loose for everyday |

## What not to do

- Do not use vector similarity to decide "what she thought then" — that is the content of `then`, not a similarity
- Do not write retrieval scores into the experience files
- Do not merge two experiences to save tokens (`then` cannot be overwritten)
- Do not put the diary index into an index that group chats can use

## One line on choosing

For accurate answers, use RAG; for traceable facts, use something bitemporal like Zep; for a character with a sense of growth who can bring up old scores, use whale-memory to manage `then/later` and leave retrieval to any layer above.

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
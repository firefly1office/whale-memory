# Architecture: the autobiography layer and the full engine

> Translated from the Chinese original ([中文](../architecture.md)). If they disagree, the Chinese version is authoritative.

This document explains two things: **what is in this repository**, and **the design thinking it originally grew out of**. The full engine is not distributed with this repository.

## Layers

```
┌──────────────────────────────────────────────────────┐
│ Host (QQ Agent / DSH / your own agent)               │
│  tool registration, prompt assembly, scheduling,     │
│  session identifiers                                 │
└───────────────┬──────────────────────────────────────┘
                │ calls
┌───────────────▼──────────────────────────────────────┐
│ Autobiography layer (this repo: packages/core +      │
│ adapters/cli)                                        │
│  experience then/later, recall, recall counts,       │
│  waking, prompt overlay, her own settings            │
└───────────────┬──────────────────────────────────────┘
                │ writes to disk
┌───────────────▼──────────────────────────────────────┐
│ JSONL files (<WHALE_DATA_DIR>/plugin-data/...)       │
└──────────────────────────────────────────────────────┘
```

**The full engine, which is not in this repository** (it lives in the author's local QQ Agent deployment): vault storage and indexing, evidence-policy retrieval, the consolidator (merging), injection budget, cross-session visibility, host tool registration. This part is about 26k lines. It is tightly coupled to a specific host's paths, session keys and deployment habits, so it is not suitable for public distribution as is.

## Three core design choices

### 1. An experience is an event, not a state

`then` is fixed when it is written. `later` is append-only. This is not "version control". It is **event sourcing** applied to the continuity of a persona:

- If she changes her view today, yesterday's words do not disappear
- "Then / now" is known only at read time; it is not merged away at write time
- Overwriting an old view with a new one is tampering with history. This is the most important red line of this project

### 2. Evidence first (evidence-policy in the full engine)

In this repository, `then.quote` / `then.state` are anchors left for evidence retrieval. When the full engine answers questions about historical facts, it does three things:

- **as-of**: return only records that held before a given point in time
- **superseded**: an old value does not pose as a new value; a new value must be able to say which one it supersedes
- **successor absent**: when there is no later record, say plainly "there is nothing after this"; do not infer

No evidence means "no record". This is not a figure of speech. It is a decision made by the retrieval layer.

### 3. Writing and reading are separate

- Write: append one line, with a real line break; if there are bad lines, refuse to rewrite and keep the original lines
- Read: skip bad lines; `recall(mark:false)` only reads, never writes
- To record "recalled once": pass `mark:true` explicitly, or call `markRecalled`

`later` and recall are both appended events (`later-events.jsonl` / `recall-events.jsonl`). The experience body is append-only. Event appends go through a file lock; experience appends rely on the operating system's whole-line append (no lock). Do not let two host processes write to the same directory at the same time. Stop the host before export, import or purge. `then` is still immutable.

## How recall works

```
candidate pool = experiences (optionally + diary)
match fields   = then.text / then.thought / then.feeling + quote.text / quote.source + later[].thought
tokenizer      = Chinese bigrams (no dictionary, zero dependencies)
denoising      = a function-word list (今天/什么/我的/是不是… i.e. today/what/my/is-it…) is kept out of bigrams
mode           = strict (default): long queries require ≥60% hits; better to recall nothing than to force a match
                 loose: one content-word hit is enough; for everyday recall where "it should come up when it comes to mind"; the host bears false recalls
score          = raw overlap count × importance weight (the weight does not affect the threshold)
ordering       = score descending, ties by time
```

Long queries are held to a proportion so that a long, specific question such as 「量子力学与广义相对论」 ("quantum mechanics and general relativity") can honestly return empty on real data, instead of being matched through a single hit on 「相对」 ("relative"). Short queries (such as 「灯塔」, "lighthouse") are not bound by the proportion.

Matched entries carry `matchedIn` (`then` / `quote` / `later`). The host can use it to tell apart "she thought so then" from "she only figured it out later".

It does not aim at "recall accuracy", because recall correctness is not the goal given this project's orientation. `tools/eval-recall.mjs` checks only two things: **what should hit does hit**, and **what should not be made up really is empty**. `tests/recall-quality.test.mjs` guards the latter with 200 synthetic records.

## Why there is no built-in vector search

- The data in this project is in the thousands of records; bigrams are enough
- Vector search would bring in a model dependency and unexplainable similarity, which conflicts with "evidence first"
- What is really missing is not semantic similarity but **source-text anchors and later records**. Get that right first
- But **the host can bring its own vector store**: the retrieval layer only supplies ids; `then/later` are responsible for "is she still herself". How to wire it up is in [composition.md](composition.md); a runnable example is in [`examples/with-vector/`](../../../examples/with-vector/)

## If you want to connect your own host

1. Read the minimum host contract in [`porting.md`](porting.md)
2. Build on `packages/core`; implement injection and scheduling as needed
3. Handle the privacy boundary yourself: the diary only in one-to-one chats; other people's private matters do not cross sessions
4. Guarantee the single-writer constraint yourself
5. The waking block is **one-to-one only by default**: `buildWakingBlock()` only accepts these one-to-one session keys: `private_*` / `private:*` / `local_*` / `local:*`. With no chatKey, or one it does not recognize (`group_*`, `qq:group:1`, channel ids from other platforms...), it always returns empty. To give it to other sessions, the host decides for itself and passes `allowGroup: true` explicitly. `consumeWaking()` rejects these two kinds as well, to avoid "using up the day's quota without injecting anything"

## Related documents

- [schema.md](schema.md): data format, write limits, recall semantics
- [porting.md](porting.md): host contract, module table, privacy rules
- [examples/samples/](../../../examples/samples/): three fictional experiences

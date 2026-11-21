# Where this came from

> Translated from the Chinese original ([中文](../related-work.md)). If they disagree, the Chinese version is authoritative.

Three categories, kept apart: **external things actually adopted**, **work compared against but deliberately not copied**, and **what we arrived at ourselves**.

The design was worked out by the author, starting from one concrete problem: she kept forgetting. It did not start from a paper. The code and the paper were written by AI agents, and those agents did read other people's work along the way; the traceable references are listed below with what they were used for. Anything we cannot trace, we do not claim does not exist.

## 1. External things actually adopted (few)

| Source | What was taken | Where it is used |
| --- | --- | --- |
| Event sourcing (Martin Fowler and the wider pattern) | State changes stored as events, replayed on read | The `later` / `recall` / `seal` / `unsaid` event files; rebuilding the timeline for `asOf` |
| OCC appraisal + PAD mood | Desirability, unexpectedness, agency, control → emotion; pleasure / arousal / dominance | The emotion layer on the host side (`psyche`) |
| Bitemporal models / timelines (Zep and similar) | "When a thing was true" separated from "when the system learned it" | Compared against, not adopted; we answer "what she thought then", not "what was true then" |
| MCP / JSON-RPC | Protocol and stdio transport | The MCP adapter |
| The "abstain" side of evaluation benchmarks | If the information does not exist, returning empty must be possible | LoCoMo / LongMemEval metric framing; the `cover` gate in `recall` |
| Wilson / Clopper–Pearson | Confidence intervals for proportions | Interval estimates in the paper |

These are **general patterns, theory and protocols**, not other people's implementations.

## 2. Compared against afterwards, deliberately not copied

Built first, read later; and after reading, the implementation was not bent to match.

| Close work | What it does | What we deliberately do not do |
| --- | --- | --- |
| Generative Agents: memory stream and reflection | Observations enter a stream; past a threshold a model condenses them into reflections | No automatic condensation; we take only "provenance must be real" — every `--refs` target must exist |
| MemoryBank: forgetting curve | Rarely recalled memories fade along an Ebbinghaus curve | No automatic fading; whether to seal is hers, and sealing is not deletion |
| A-MEM: automatic links | A model builds and updates links by similarity | Links only when she makes them, and she must give a reason |
| Mem0: add / update / delete | An ADD / UPDATE / DELETE memory layer | Append only; `then` is never rewritten |
| MemGPT: context editing | The model reorganises and rewrites memory text itself | The model never edits the text; only she can append later notes |
| Conway: life periods | Memories are layered, with "life periods" on top | Chapters are not cut automatically; she names them, and renaming keeps the old name |

## 3. Arrived at ourselves

These are the skeleton, and they predate any outside reading:

- **`then` is immutable; `later` is append-only** — an old view is never overwritten
- **If it cannot be found, say so** — an empty recall is a valid answer; nothing is invented (fabrication rate is 0 on both the dev and held-out sets)
- **Sealing is not deletion** — not recalled, not shown on waking; the original text stays and can be unsealed at any time
- **The unsaid drawer is never injected automatically** — only she can open it
- **Detail recall returns only source text and an evidence status** — supported / related / ambiguous / unmatched; unrecorded details are never filled in
- **What to remember and whether to let something go are hers to decide** — the system does not judge importance for her and does not expire things on a timer

## One doubtful record

A 0.11.1 handover receipt states that `doctor`, the indexing principle and the injection guard "referenced agent-soul".

The author's account is that he never read other people's work. It is not part of the table above and is not a claim of ours; it stays here so the history is not silently erased.

## Numbers

```
Paper references      35
Systems compared       8
Runtime dependencies   0  (no memory framework used)
Core code          3,778 lines across 34 files, written here
```

Forced into a ratio: **the skeleton is original, the terminology and evaluation method come from outside, the implementation is ours.** There is no precise percentage, and there should not be.

In one line: what was taken is "how to evaluate, how to record events, how to speak a protocol". What was not taken is "who gets to change her past" — and that is the position this project actually holds.

## Deliberately not done

| What others commonly do | Why we do not |
| --- | --- |
| Automatic fading along a forgetting curve | Fading automatically means the system decides the thing no longer matters |
| LLM tidying, merging, rewriting memories | Rewriting erases what she thought at the time |
| Automatic similarity links | A link made by a similarity function is not her own association |
| Automatic emotion labels | A label is an outside inference, not her feeling; `feeling` takes only words she writes |
| Mood decaying back to a baseline | If she did not say she is over it, we do not get over it for her |

## Still being considered

- **"Why did she think that then"**: appraisal-style thinking, possibly an optional `then` field written by her.
- **Finding by feeling**: Emotional RAG-style retrieval; we lean towards an explicit `--feeling` filter instead.

None of it is built; it will be written on this page first.
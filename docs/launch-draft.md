# Launch draft (NOT posted — for review first)

Three versions of the same thing: a Hacker News "Show HN", a r/LocalLLaMA post, and a one-line awesome-list entry. All numbers below are from `npm run eval` on 0.17.0 and can be re-run by anyone; check them again right before posting.

---

## 1. Show HN

**Title:** Show HN: whale-memory – autobiographical memory for an AI character where the past can't be rewritten

**Body:**

I've been running an AI character in a chat app for a few months. The usual memory layers (vector store + summaries) kept doing two things I didn't want: they quietly rewrote what happened ("she said X" drifting into "she said roughly X"), and when nothing matched they returned the nearest thing anyway, so the model confidently "remembered" events that never happened.

whale-memory is the small library I ended up with. It is not a general memory platform. It's the part that holds *her own* story, with four rules:

1. **What she wrote then is never changed.** Each experience has a `then` part that is written once. There is no edit API. If she changes her mind, that's a new `later` entry appended after it, with its own date. You can always see what she thought at the time and what she thinks now.
2. **Events are append-only.** Recalls, changes of mind, "I've let this go", links between memories, sealing — all are JSONL events. Nothing is updated in place, so you can view her "as of" any past day.
3. **Sealing is not deleting.** She can seal something she doesn't want to be reminded of. Sealed memories stop appearing in recall, wake-up summaries, her book, recaps and as-of views, but they still exist and can be unsealed. (Real deletion is a whole-store purge, on purpose; per-item deletion fights "the past can't be rewritten" and I haven't found a good answer.)
4. **No record means "I don't remember".** The default recall mode would rather return nothing than return something near. On the project's eval set, questions about things that never happened, and questions that share words with a *different* event ("the cat in the lighthouse" when only the lighthouse exists), come back empty on every one of the held-out questions — but that set is small (32 questions) and I wrote it myself, so treat it as a sanity check, not a benchmark. The cost is honest too: asking for a detail that was never written down ("what colour was the scarf?") also comes back empty, so she won't even recall knitting the scarf. That's documented, with numbers.

Some things I think are a bit different:

- An "unsaid drawer": things she typed and didn't send, questions she didn't ask. It is never injected automatically and only opens in a one-to-one chat with her owner.
- `npm run eval` checks 105 output surfaces (CLI, MCP server, book, recap, as-of views, links…) for leaks of sealed and drawer content, and checks that the experience file is byte-identical after every kind of write. Both must be zero.
- Plain JSONL on disk, no database, no network, no API key. A local stdio MCP server is included, so Claude Desktop / Cursor / Claude Code can use it: `npx -y -p whale-memory-core whale-memory-mcp --data ./her-data`.

What it is not: semantic search (matching is lexical, CJK bigrams plus whole English words), multi-user, hosted, or fast at 100k memories. If you need those, put a retrieval layer in front and let this hold the narrative; there's a doc on composing them.

The character it was built for speaks Chinese, so the docs started in Chinese. The README, schema, limits, architecture and porting guide have English versions; error messages are English first.

Repo: https://github.com/firefly1office/whale-memory

I'd especially like to hear from people who have thought about "the right to forget" vs append-only memory for agents.

---

## 2. r/LocalLLaMA

**Title:** A tiny memory library for an AI companion that refuses to make things up (append-only, local, MCP server included)

**Body:**

Not another vector DB. This is the layer that keeps a character's *own* story honest:

- What she wrote "then" is immutable; changing her mind appends a "later" note. You can look at her as of any past day.
- Everything is an append-only JSONL event: recalls, changes of mind, letting go of something, links, chapters.
- She can **seal** a memory she doesn't want to be reminded of. Sealed ≠ deleted; it just stops surfacing anywhere.
- Default recall returns **nothing** rather than something close. On the (small, self-written: 32 questions) held-out eval, unrelated and "near-miss" questions return empty every time. The trade-off (it also won't surface an event when you ask about an unrecorded detail) is measured and written down.
- Runs fully local, plain files, no API key. Works with any model, since it never calls one.
- `npx -y -p whale-memory-core whale-memory-mcp --data ./data` gives you a stdio MCP server (drawer off by default, no import/delete/prompt-editing tools exposed).
- `npm run eval` re-runs recall accuracy, fabrication rate, leak checks across 105 surfaces, and a byte-level "the past wasn't rewritten" check.

It's small and opinionated, and it was built for one Chinese-speaking character. Feedback on the recall trade-offs is very welcome.

https://github.com/firefly1office/whale-memory

---

## 3. awesome-list entry

- [whale-memory](https://github.com/firefly1office/whale-memory) – Append-only autobiographical memory for AI characters: immutable "then", appended "later", sealing instead of deleting, and recall that says "no record" instead of guessing. Local JSONL, MCP server, reproducible eval.

---

## Before posting (checklist)

- [ ] Re-run `npm run eval` and update every number above from its output
- [ ] npm has 0.17.0 published (right now npm still shows 0.15.0)
- [ ] GitHub releases v0.16.0 / v0.17.0 exist
- [ ] The English error messages / demo output are merged to `main`
- [ ] Nothing in the post describes the real character's private data (only the fictional eval character「小舟」is used as an example)
- [ ] The owner has read and approved this text

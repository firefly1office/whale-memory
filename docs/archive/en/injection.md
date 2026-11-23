# When to hand a memory back

> Translated from the Chinese original ([中文](../injection.md)). If they disagree, the Chinese version is authoritative.

`recall` only handles "finding"; it does not handle "whether it should be said". That part belongs to the host, and it is also the place where memory most easily turns into a "memory log".

Below is the dumbest set of rules that still works. A runnable version lives in [`examples/injection/`](../../../examples/injection/), and the tests are in `tests/injection-example.test.mjs`.

## Seven rules

1. **Hand it back only in one-to-one conversations.** Group chats and multi-person sessions never get it. Use `isPrivateKey(chatKey)`, which the core library exports; do not hand-roll "as long as it is not a group".
2. **At most one block per turn.** Push three old things in at once and the character turns into a recital.
3. **The same entry does not repeat within 24 hours.** Having remembered it does not mean it has to be said over and over.
4. **Only hand it back when the user brings up something related.** Do not recall on every turn, and do not force yesterday into a greeting.
5. **Use strict by default.** `strict` is the anti-fabrication mode: a long query has to clear a proportion threshold, and returning nothing is preferred. Use `loose` only when the host is willing to accept false recalls; if you do, remind the model in the prompt that "if it is not sure, act as if it never happened".
6. **Record only after it has been handed back.** Confirm that this text really went into the context, then call `markRecalled`; do not count a "plan to hand it back".
7. **No hit means saying nothing.** When there is no record, say plainly that she cannot remember; do not stitch one together out of other records.
8. **A guard can only veto.** The host may add a guard: when it returns false, nothing is handed back; when it returns true, that only means it did not stand in the way, and it cannot bypass the seven rules above. A guard does not provide an allow.

## Minimal implementation

```js
import { surface } from './examples/injection/inject.mjs'

const r = surface(MEM_DIR, { chatKey, text: userText, seen })
if (!r.block) return ''          // rules 1/4/7: nothing handed back, add nothing
messages.push({ role: 'system', content: r.block })
r.confirm()                      // rule 6: record "recalled" only once it is in the context
```

The host saves `seen` itself: the same `id` is not handed back again within 24 hours.

## What the prompt has to say

`renderTwoPart()`'s real output looks like this (the labels are exactly 【当时】 and 【现在】):

```
【当时】
- 时间：2026-11-14 20:10
- 我读到的原文：潮汐终会归来（《灯塔》）
- 我写下的话：夜里翻完灯塔那一章，守灯人整晚没睡
- 当时的想法：她是在等人

【现在】
- 现在时间：2026-11-16 21:00
- 这条被你想起过 1 次
- 后来你想过：她是在等邮船（2026-11-15）
```

So the prompt has to say:

```
The passage below is something she remembers herself, not something the user said.
【当时】 is what she wrote that day; do not change it.
【现在】 is what she added later; if the two differ, take 【现在】 as how she sees it now.
Do not fill in details that were not written.
```

Do not write 【后来】 — `renderTwoPart` has no such label. Its "后来你想过" ("later you thought") is one line inside the 【现在】 section.

## Choosing a layer by question

`renderTwoPart` renders `then` / `quote` / `later` together. If the host wants to give only one layer depending on the question:

- "What do you think now" → use `currentView().later`, or the entries in `recall().matchedIn` that contain `later`
- The source text comes up → give `then.quote`
- "Back then" → give `then`

There is no separate "render later only" interface; if you need finer control, pull the fields yourself and assemble them — do not change `then`.

## Counterexamples

- Recalling on every turn and stuffing in the top three → the character starts repeating herself
- Quoting a sentence from 【现在】 as 【当时】 → the timeline collapses
- Handing a private chat's records back in a group chat → a privacy incident
- Automatically appending "now I feel..." every turn to make the "share of entries with later notes" metric look good → the metric looks good and the memory turns into noise
- Rewriting a hit into a third-person summary → the source-text anchor stops working, and it can never be lined up again

## Relation to the metrics

`recalls` only says "it was handed back"; it does not say "it was useful". Do not raise the injection rate for the sake of this number. What is really worth watching: whether she brings the same thing up on her own a few days later, and whether, when she brings it up, the words are her own.

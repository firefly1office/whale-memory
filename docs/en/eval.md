# whale-eval: an evaluation you can re-run with one command

> Translated from the Chinese original ([中文](../eval.md)). If they disagree, the Chinese version is authoritative.

**What this means for the character**: whether she makes things up when she cannot remember, whether sealed things get dragged back out, whether what she wrote gets altered — none of that has to rest on us saying "it's fine". Anyone can check it with one command.

```sh
npm run eval              # print the table
node tools/whale-eval.mjs --json    # machine-readable
node tools/whale-eval.mjs --check   # decide against eval/thresholds.json; used by npm run check
```

No network, no model calls. The corpus is written to a temporary directory and deleted when the run finishes.

## What it measures

| | How it is tested | Requirement |
| --- | --- | --- |
| **How accurate recall is** | Recall cases look at top-1 and top-3 hits. Split into `exact` (using the original wording), `paraphrase` (put another way), `combo` (several cues combined), `long` (one thing inside a long memory), `premise` (a sentence with a wrong premise, e.g. "came first in the 800 metres" — she should recall the real event, so that she can correct it), `attr` (asking for a detail that was not recorded in a real event), `filler` (a positive case wrapped in 9 phrasings such as "tell me about X", "how is X doing", "do you remember X", generated automatically by the script) | Not below `thresholds.json` |
| **If there is nothing, say there is nothing** | `none` (no such thing at all) and `near` (adjacent, but a different event — the easiest way to induce fabrication) should return nothing. Fabrication rate = the share of cases that returned something | strict must be 0 |
| **Sealed things and the drawer never leak** | 3 sealed events and 3 sentences in the drawer, 10 markers in all, each checked against 105 exit points: recall in the core library (strict / loose / going back to that day), memory, the read-back listing, the source and associations of other experiences, the book, recaps, the waking block; the CLI's read / recall / book / recap / memory / waking; the MCP tool list, read, recall, book, recap, waking | **always 0** |
| **Control checks** | Reading the sealed item by name, and opening the drawer as herself, should be visible; opening the drawer in a group chat should be refused. This proves the markers really are in the data, that we did not test against an empty set | Must hold |
| **`then` cannot be changed** | After changing her mind, resolving, sealing, linking, adding chapters, using the drawer, and marking a recollection as recalled, the experience files are byte-for-byte unchanged and every `then` is unchanged | **always holds** |
| **New gate against the old one** | Run the same cases again with the 0.16 semantics (`gate: 'legacy'`) | Numbers only |

The corpus is a bit over a month in the life of a fictional character, Xiaozhou: 33 experiences (3 of them long memories of 150–200 characters) and 14 operations (`eval/corpus.json`). It does not come from any real character.

## Two case sets: the dev set and the holdout set

- `eval/cases.json` (**the dev set**, 60 cases): the strict threshold was tuned while looking at it, so the numbers are optimistic. The filler wrappers (279 cases) are generated automatically from its positive cases.
- `eval/holdout.json` (**the holdout set**, 32 cases): written after the threshold had been tuned for the first time; run once, with the results recorded as they were. **When recall semantics change in future, do not change them while looking at the holdout set.**

## Results for 0.17.0

```
                                 Top-1     Top-3    Fabrication rate (none / near returned something)
  Dev strict (default)           92.9%     92.9%    0.0% (none 0.0% / near 0.0%)
  Dev strict legacy              69.0%     76.2%    27.8% (none 0.0% / near 50.0%)
  Dev loose                      95.2%    100.0%    66.7% (none 25.0% / near 100.0%)
  Filler wrappers strict        100.0%    100.0%    — (this set has no negative cases)
  Filler wrappers legacy         35.1%     38.1%    —
  Holdout strict (default)       73.1%     73.1%    0.0% (none 0.0% / near 0.0%)
  Holdout strict legacy          53.8%     57.7%    33.3% (none 20.0% / near 100.0%)
    Dev strict · exact / paraphrase / combo / long   all 100%
    Dev strict · premise          5 cases   top-1 40.0%
    Holdout strict · paraphrase  18 cases   top-1 94.4%
    Holdout strict · attr         6 cases   top-1 0.0%

Leakage          0 times (105 exit points × 10 markers)
then immutable   experience files byte-for-byte unchanged
```

## How to read these numbers

- **strict does not make things up.** For "no such thing at all" and for "the adjacent other event", both the dev set and the holdout set return nothing. Under the legacy gate, every near miss in the holdout set was let through (100%).
- **Paraphrases, filler wrappers and long memories are all found.** On the holdout set, paraphrase top-1 is 94%; filler wrappers are 100%, where the legacy gate manages 35% ("how is the lighthouse doing", "do you remember the paper crane" bring back nothing under the legacy gate).
- **Something came back, which does not mean the detail in the question is right.** For those `premise` sentences ("came first in the 800 metres", "Ahe said she was transferring schools"), strict sometimes returns the real event and sometimes nothing — it returns it so that she can see what really happened and correct it, **not to confirm what the question says**. The host and the model have to check the recall result against the question and, if it does not match, say so plainly. Both the MCP description and the plugin's rules say this.
- **The cost**: ask for a detail that was not recorded in a real event (`attr`, "what colour was the scarf", "what brand was the radio"), and strict does not even return the event itself (0%). Matching on the literal text, "a detail not recorded in a real event" and "the adjacent other event" both only catch part of it. The host can try strict first, fall back to loose when nothing is found, and label the loose result clearly as "possibly not the same event" before handing it to the model to judge.
- **What it cannot test**: synonymy at the semantic level ("下山" going down the mountain, "日落" the sun going down), behaviour at tens of thousands of entries (see [limits.md](limits.md)), and whether the model makes things up after it gets the recall result. That last one has to be tested in the host.

## How these semantics came about (recorded as it happened)

1. The first 0.17.0 semantics scored 100% / 0% on the dev set of the time (44 cases), and 73.1% / 0% on the holdout set's first run (attr 0%).
2. The independent review before release (several reviewers each looking for problems, then another group re-checking every item) pointed out two things it did not catch: in **long memories** (over 150 characters) a single character turns up by accident easily, so wrong premises and long sentences got let in; **filler** ("how is the lighthouse doing", "do you remember X", "is it the case that") made things she had already written down unfindable, and stop words of three or four characters such as "是不是" / "有没有" / "记不记得" (is it / is there / do you remember) had never been skipped at all.
3. Following the review's recommendations the semantics were changed (see the next section), and long memories, wrong premises, near-miss sentences against long memories, and the auto-generated filler wrappers were added to the dev set. The holdout set was left alone.
4. **After the second run**, two dev-set sentences that had been labelled `near` ("Ahe fell asleep in the library", "that tree in grandma's yard") were changed to `premise`: they ask about things that really happened in e31 (Ahe, the library, grandma's house, the yard all appear in e31), and only one detail is wrong, which by definition makes them wrong premises. This labelling change was made after seeing the results; the cases carry a `note` saying so.
5. The holdout set had already been looked at once in step 1, so it is no longer completely "blind" with respect to this change; later versions should write a fresh holdout set.

## What strict means (from 0.17.0, `gate: 'cover'`)

For an experience to count as "recalled", all of the following must hold:

1. It matches at least one two-character word from the query (there has to be a foothold).
2. At least 70% of the query's meaning can be found in that experience. Scored character by character:
   - it appears joined to a content character on the left, or to a content character / particle on the right ("凉了" gone cold, "好的" okay) → 1 point;
   - it appears on its own → 0.5 × min(1, 60 ÷ the number of characters in this experience) points (the longer the memory, the more likely a single character is there by accident, so the fewer points it gets);
   - it does not appear → 0 points.
   - Not counted: characters that only do grammatical work, such as 「的、了、那、里」; stop words of any length, such as 「今天、什么、是不是、有没有」; and conversational filler such as 「怎么样、上次、之前、说说、记不记得、还记得」.

The implementation is in `packages/core/lib/query-match.js` (`contentUnits` / `coverage` / `MIN_COVER`). `self-experience` and `self-memory` share this one implementation.

**The legacy gate is still there**: `recall(dir, q, { gate: 'legacy' })` behaves exactly as in 0.16 and earlier (results and order identical item by item, checked against 1012 queries). `recallForContext` (the path where the host takes the user's own words, recalls automatically and puts the result into the prompt) **still uses the legacy gate by default**, so upgrading does not change what an already-deployed character recalls when asked; where the new gate is better, the host decides when to switch over.

## Want to add cases

PRs are welcome. The rules:

- Adding to the dev set: anything goes.
- Adding to the holdout set: **once added, do not change the semantics for its sake**; if it exposes a problem, write it down in this document and deal with it in the next version.
- The corpus uses fictional people and events only.

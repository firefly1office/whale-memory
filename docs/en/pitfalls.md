# Read this before integrating: the easy pitfalls

> Translated from the Chinese original ([中文](../pitfalls.md)). If they disagree, the Chinese version is authoritative.

This is not a feature list; it says up front the places where using it will disappoint you. Every item is backed by evidence in the code or in the paper.

## 1. It does not do semantic retrieval

Recall is literal matching: Chinese is grouped by adjacent character pairs, English by whole-word substrings. No vectors, no thesaurus.

- “下山” (going down the mountain) and “日落” (sunset) will not hit each other.
- Ask about a detail that was never recorded in a real event (“what color was the scarf”) and strict mode returns empty — it cannot even recall the event itself.
- To cover synonymous wording you need the host to put a retrieval layer in front and hand it the ids; see `docs/composition.md`.

## 2. The threshold margin in strict mode is thin

`MIN_COVER = 0.7` was chosen on 33 fictional corpus entries. Raise it a little and true positives start dropping; lower it a little and false positives come back. It is not a “universal optimum”; change the corpus and it has to be re-measured.

## 3. Sealing is not deletion

Once sealed she no longer recalls it on her own, but the original text, the later notes, and the contents of the backup package are all still there. The only real deletion is a whole-store `purge`.

- The backup package is plaintext and contains the original text of sealed entries and of the drawer.
- Do not promise “delete a certain memory”; there is no such capability right now.
- “Discard” in the drawer is only a status; the original text is still in the file.

## 4. Single writer, no database

The experience file is not locked; it relies on the operating system's whole-line append. The event file has a file lock, but the overall design is single-process writing.

- Do not let two host processes write to the same directory at the same time.
- Every read is a full replay, with no index; tens of thousands of entries will slow down noticeably, and above a hundred thousand it is not suitable.
- The concurrent-write tests only cover local Windows/NTFS and are not a cross-platform guarantee.

## 5. The core layer only distinguishes “one-to-one / not one-to-one”

The session gates in `waking.js` and `unsaid.js` only check whether the conversation is one-to-one; **they do not check whose one-to-one it is**.

- “Only the owner can see it” must be guaranteed by the host's owner gate.
- If the host passes the wrong `chatKey` on integration, private-chat content may end up in a group chat.
- MCP clients are treated as trusted local processes: once connected they can read and write all of the memory.

## 6. The prompt overlay is the weakest link

The overlay is injected into every conversation. In the first deployment, the tools that write the overlay and revert it had no owner gate.

- The repository version of `revert` has been changed to accept only snapshot names that appear in `history.jsonl` (2026-11-17, with a regression test); the plugin version in the first deployment has not been upgraded yet.
- Do not use the overlay in multi-user scenarios; do not give write permission to anyone untrusted.
- Back up `prompt-overlay/` before changing the overlay.

## 7. The evaluation is small, and the questions are our own

- The corpus has 33 entries and a fictional character, 小舟 (“Little Boat”); the development set has 60 entries and the held-out set 32.
- Two labels in the held-out set were also changed after the results had been seen; this is stated in the paper.
- The 333 filler-wrapped items come from 37 underlying entries and are not independent samples.
- Do not take 92.9% / 73.1% as a “general accuracy rate”; they only show that on this corpus, strict mode is better than the old measure.

## 8. Version and release status

- Both the repository and npm are at **0.21.0** (tag `core-v0.21.0`). The paper corresponds to `v0.17.0` (commit `549e51c`); what came after it is additional modules (`changed` / `injection` / `fact-*` / `conversation-privacy`, etc.) and docs. The strict-mode matching measure has not changed (`MIN_COVER` is still 0.7).
- Before installing, still check `npm view whale-memory-core dist-tags` — caches and mirrors occasionally serve an old version.
- For the MCP entry point and the English docs, the repository is authoritative.

## 9. Known and unfixed

- The host's 16 tools have no owner gate, including the tools that write experiences; being induced into writing false memories is a real risk.
- The `recall` core library does not validate `limit`; passing a negative number returns “everything but the last entry”.
- The prompt overlay's write/revert tools had no owner gate in the first deployment.
- The first deployment in production did not enable the cover gate; its two recall paths still use the old measure.

## 10. Tried and it does not work: a literal-match gate for cross-room recall

We took the literal matching from item 1 and pointed it at a different question: “is this line asking about something that was said in another room?” It does not work. We stopped using it. It is written down here so the next person does not redo it.

The approach: take the current line as the query, search the history of other conversations, and accept a hit when ≥1 term matches and ≥1 of those terms carries content.

15 real samples (actual conversations, not constructed scenarios): **0** were “on point and useful”; 3 were “related but useless”; 11 were noise; 1 had no hit at all (not wrong, and not a point in its favour either).

Fixing three obvious bugs first — her own name does not count as content, QQ system notices like “nudged you” are not questions, and spurious pairs produced by shingling across a stop-word boundary (“你自己去” → “你自”, “己去”) do not count as hits — took firing from 14/15 down to 7/15. The remaining seven are all collisions on incidental wording:

| What she heard | The old line pulled in | The colliding word |
| --- | --- | --- |
| “@小鲸鱼 出来” | “图我这边还是加载不出来” | 出来 |
| “一点是多少” | “所以是多少钱啊” | 多少 |
| “你自己去找” | “你可以去找大通要” | 去找 |
| “一个会话用久了会变笨吗” | “不知不觉这个会话已经 2 个亿了” | 会话 |

The reason is structural: **the same primitive does not transfer to a different setting.** This measure is right for `self-experience` / `self-memory` / `detail-recall` — those look for work inside “what she herself has been through”, where the candidate set is her own memory and the prior is strong. Moved to “what other people said in other rooms”, the candidate set is far larger and the prior far weaker, so a single content-word hit turns from “barely recalls something” into “noise generator”. Adding stop words only treats the symptom: change the sample and a new set of colliding words appears.

Where the conclusion stops — do not widen it: this only shows that **literal matching cannot decide “is this asking about the past”**. It does not show that cross-room memory is unworkable. Whether to carry anything across, and how much, is still the host's product decision — see `docs/cross-room-memory.md`.

These are not “later” to-dos; they are boundaries you have to know before integrating. To fix them, see section 8 of the paper and `docs/threat-model.md`.
# Storage semantics: experiences are facts, changes are events

> Translated from the Chinese original ([中文](../storage-events.md)). If they disagree, the Chinese version is authoritative.

Current version: 0.11.x. None of the "later changes" rewrite the body of an experience; they append events, which are merged at read time.

## In one sentence

```
then is written once and never changed;
what happens afterwards (changing your mind, recalling, letting go) each goes to its own event file;
at read time they are merged into "what one experience looks like now".
```

## Division of labor between files

| Data | Nature | File | How it is written |
| --- | --- | --- | --- |
| Experience body (`then`) | fact, append-only | `self-experience.jsonl` | append one line; writes take no lock |
| Change of mind (`later`) | event, append-only | `later-events.jsonl` | append one line `{id, at, thought, reason?}`; goes through the file lock |
| Recall | event, append-only | `recall-events.jsonl` | append one line `{id, at, query, chatKey?}`; goes through the file lock |
| Unfinished things | event, append-only | `unfinished-events.jsonl` | append one line `{id, at, day, choice, note?}`; goes through the file lock |
| Seal / unseal | event, append-only | `seal-events.jsonl` | append one line `{id, at, day, action, note?}`; re-read inside the lock to decide, a repeated action is not written |
| Links made afterwards | event, append-only | `link-events.jsonl` | append one line `{from, to, at, day, reason}`; the same pair (direction ignored) is linked only once |
| Life chapters | event, append-only | `chapter-events.jsonl` | one line each for `open` / `rename` / `close`; renaming keeps the old name |
| What was never said | event, append-only | `unsaid-events.jsonl` | leaves one line with `status:open`; saying it / discarding it each appends one line; only read out in private chats via `listUnsaid` |
| Diary | fact, append-only | `autobiography.jsonl` | append one line |
| Settings | state, overwritable | `self-settings.json` | lock + temp file + rename |
| Prompt | state/history | `prompt-overlay/` | lock + atomic write, versions kept |

## Derivation rules

```
later          = the old inline later + the events for that id in later-events (sorted by at)
recalls        = the number of events for that id in recall-events
lastRecalledAt = the largest at among that id's events
unfinishedState = the last line for that id in unfinished-events; history keeps the full order
sealed         = the last line for that id in seal-events is seal (unseal, or nothing, does not count as sealed)
links          = each pair in link-events that involves that id (both ends present)
chapters       = among the chapters obtained by replaying chapter-events, those with from ≤ day ≤ to
refsInfo / citedBy = derived from then.refs in the experience line (since 0.12)
all of the above accept a cut-off moment until (going back to who she was that day): replay only events before that moment
```

- The old inline `later` / `recalls` / `lastRecalledAt` are still readable; when events exist, events win.
- Old ids from before 0.10.0: at read time an old id is claimed only when it uniquely corresponds to one experience; when several experiences share it, it is not attributed to any of them, and `read`'s `pending` lists them.
- Derived results can be rebuilt from the raw files at any time; no migration state is needed.

## Invariants

1. Once `then` is written, its bytes are not changed.
2. Counts (`recalls`) are not written back into the experience line.
3. Event files are append-only and never rewritten; deletion can only be whole-store deletion (see `purge` in [limits.md](limits.md)).
4. Read operations do not write to disk; `recall` is read-only by default, and recording a "recall" requires an explicit `mark: true` or `markRecalled`.
5. Submitting the same choice repeatedly does not write a second line; concurrent submissions are guaranteed to record it only once by "re-read → decide → append" inside the lock.
6. Experience appends take no lock, event appends go through the lock: do not let two host processes write the same directory at the same time.

## Migration

- Old inline `later` → `later-events.jsonl`: `tools/migrate-later-events.mjs`
- Old inline `recalls` → `recall-events.jsonl`: `tools/migrate-recall-events.mjs`

Both tools are dry-run by default; back up first, validate, and rollback is possible; a rollback can be run repeatedly.

## Why there is no compaction

Compaction produces a summary, and once a summary replaces the original text, "how she thought at the time" is no longer inspectable. This project chooses to keep the original text and leave abstraction to the host; the host may build an index on the side at write time, but an index is never a source (see [limits.md](limits.md)).

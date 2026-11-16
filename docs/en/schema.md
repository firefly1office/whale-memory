# Data format (schema v2)

> Translated from the Chinese original ([中文](../schema.md)). If they disagree, the Chinese version is authoritative.

[中文](../schema.md) · English

All data is **one JSON object per line** (JSONL), stored in:

```
<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/
  self-experience.jsonl   her experiences (then; later has moved to events)
  later-events.jsonl      change-of-mind events (since 0.6.0; append-only)
  recall-events.jsonl     recall events (since 0.5.0; append-only)
  autobiography.jsonl     her diary (by default used only in one-to-one chats)
  prompt-overlay/         her own prompt (versions are append-only)
  self-settings.json      her own settings
```

## One experience

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

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique; `exp_` prefix |
| `day` / `at` | string | Local date / ISO time |
| `author` / `source` | string | Who wrote it, where it came from (`own-time`, `own-decision`...) |
| `kind` | string | 读书 / 想事 / 决定 / 其它 (reading / thinking things over / decision / other) |
| `weight` | enum | `important` / `normal` / `minor`; decides how long the recollection is |
| `then` | object | **Fixed once written**; no code is allowed to rewrite it |
| `then.quote` | object\|null | Source-text anchor: the original sentence she read and where it came from |
| `later` | array | **Append-only**; each item is `{at, thought, reason?}` |
| `status` | string | Currently only `kept` |

## Rules

1. `then` is never overwritten. A change of mind goes into `later`; the old content stays exactly as it was.
2. When a file is damaged (has invalid JSON lines): **reads skip bad lines, rewrites fail with an error**. New experiences are written by appending; bad lines are kept as they are.
3. Lines must end with a real line break; writing `\n` as two characters is not allowed.
4. The diary is a separate file and is not loaded on read by default; the host decides when to open it.

## A change of mind is an event (since 0.6.0)

`reviseExperience()` no longer reads everything and no longer rewrites the experience file. Instead it appends to `later-events.jsonl`:

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-15T08:10:51.340Z","day":"2026-11-15","thought":"现在觉得，他是在护着朋友","reason":""}
```

- Since 0.12.0 it can carry `feeling`: how she feels **now, when she recalls it again**, for example `{"id":"exp_…","at":"…","thought":"现在觉得她在等船","reason":"","feeling":["释然"]}`. The feeling from then is still in `then.feeling` and is not rewritten. A later note without a feeling does not mean the feeling changed, and reading it back will not speak for her on that
- Merged at read time: `later` = the old inline array + events, sorted by `at`
- Orphan events (no experience with that id) are ignored at read time
- Migration: `node tools/migrate-later-events.mjs --data=<dir>` (dry-run by default; writes only with `--apply`; backs up first, verifies, can be rolled back)
- From here on the experience file is truly append-only: `addExperience` appends one line, and no code path rewrites it anymore

## Unfinished things are events (since 0.11.0)

"What later happened to this unfinished thing" is appended separately to `unfinished-events.jsonl`. It does not change `then.unfinished` and does not count as a later note:

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-16T02:30:00.000Z","day":"2026-11-16","choice":"shelved","note":""}
```

- `choice` has only three values: `done` (resolved), `shelved` (put down for now, not yet resolved), `reopen` (decided to keep thinking about it again)
- At read time, the **last** event for that id is the current state; `history` keeps the full order of choices, so reading it back shows "it was put down at some point"
- The waking block only counts unfinished items with no `done` / `shelved` as "you haven't finished yet"
- Repeating the same choice does not append a second line; `reopen` on something never closed is a no-op
- Old data does not have this file: behavior is unchanged, and `then.unfinished` still goes into the unfinished list
- Backups/exports must include this file

## Refs (sources) of a recollection (since 0.12.0)

An experience can state "which things it came from": `then.refs` is an array of experience ids. It belongs to `then` and is fixed once written.

```json
{"id":"exp_r","at":"…","kind":"回想","then":{"text":"等待的人不一定是在怕黑","refs":["exp_a","exp_b"],"…":"…"}}
```

- **Validated at write time**: every id must be an experience that has already been written. If one is not found, or an old id is ambiguous, the whole record is rejected and not a single byte is written. Old ids are resolved to the current id; duplicates are kept once; at most 8 entries
- Two things are derived at read time: `refsInfo` (a one-line summary of each source) and `citedBy` (which later experiences put this one in their refs)
- When an experience pointed to by refs cannot be read (for example, only some files were restored), `refsInfo` marks it `missing: true`, reading it back says "can't be found anymore", and the "refs complete" check in `doctor` reports it
- Recall does not follow refs: refs are only shown when reading back, and the host decides whether to go read those entries

## Looking back to that day: the as-of view (since 0.12.0)

`loadAll(dir, { asOf })`, `currentView(dir, id, { asOf })`, `recall(dir, q, { asOf })`; on the CLI, `read --as-of` / `recall --as-of`.

- `asOf` given as `2026-11-15`: cuts off at the last moment of that day in **local time**; a full ISO time also works
- Only experiences, later notes, resolve choices and recall events written at or before that moment are kept; everything after is invisible. Returned entries carry `viewAsOf`, and the second part of the read-back becomes 【那时（截至 …）】 ("then (as of ...)")
- No file is changed; when `recall` has `asOf`, it cannot also `mark` (looking through old days does not count as "recalling")
- Old records with no timestamp cannot be placed on the timeline and are not counted as part of "then" when cutting off; the same goes for inline `recalls` in the old format

## The forgetting she chooses: seal (since 0.13.0)

When she no longer wants to be actively reminded of something, one line is appended to `seal-events.jsonl`:

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-16T02:30:00.000Z","day":"2026-11-16","action":"seal","note":"不想再被提起"}
```

- `action` is only `seal` / `unseal`; if the last line for that id is `seal`, it counts as sealed. Repeating the same action does not append (decided by re-reading inside the lock)
- A sealed experience: `recall`, `memory` and the waking block do not give it; `read` does not list it by default (it outputs a `sealedHidden` count); only `read --sealed true` or naming it with `read --id` gives it, with a `sealed` marker
- When another recollection puts it in its refs, `refsInfo` / `citedBy` only give `{ id, day, sealed: true }`, and the read-back says "something you sealed", without revealing content
- **It is not deletion**: the experience file, later notes and choices are untouched, and it is in export packages too. The only way to truly erase it is `purge`, which deletes the whole store
- In the as-of view (`asOf`), seal events before that moment are counted as they are; **in addition, whatever she has sealed now is not brought up either** (since 0.17.0): something not yet sealed at that time is marked `sealed: { …, afterAsOf: true }`; recall, lists, the book and recaps do not give it; reading it by name still gives it and says "you later sealed this". Sealing means she does not want it brought up now, and looking back to that day is also bringing up old things

## Recap material (since 0.13.0)

`recap(dir, { days, asOf })` / CLI `recap --days 7`: counting back `days` calendar days including "today", it lists for this period

- what was written (`written`), what was thought over again (`revised`), how feelings changed (`feelingShifts`: then → later)
- what got a decision (`settled`: resolved / shelved), what was picked up again (`reopened`), what is still unfinished (`stillOpen`, no time limit, the 5 most recent)

It only lists facts; it does not call a model and does not draw conclusions; anything sealed is never listed. Every item carries its id, so when she wants to write a recollection she can directly `write --kind 回想 --refs <these ids>`. She does not have to write one.

## Links made afterwards (since 0.14.0)

She discovers only later that two things are related, and connects them herself: `link-events.jsonl`, one `{from, to, at, day, reason}` per line.

- `reason` is required: if you cannot say why, do not link. Both experiences must exist; an experience cannot link to itself; the same pair (regardless of direction) is linked only once, and repeat submissions are a noop
- At read time both ends have `links`; if the other end is sealed, only `{id, day, sealed: true}` is given, and the read-back does not show even the reason
- Difference from refs (`then.refs`): refs are the basis known when this entry was written, fixed once written; a link is a relationship made afterwards
- Recall does not follow links; the as-of view only counts links made before that moment

## Life chapters (since 0.14.0)

She gives a stretch of days a name: `chapter-events.jsonl`, with `open` (`{id, name, from, to?}`), `rename` (`{id, name}`) and `close` (`{id, to}`), one line each.

- Names are 1–30 characters; `from` / `to` are local dates like `2026-11-01`, and `to` is not earlier than `from`; no `to` means "still in this stretch of days"
- Experiences fall into chapters by `day`; chapters can overlap or nest; at read time they carry `chapters: [{id, name}]`
- Renaming does not erase old names: in `chapter list`, `names` holds every name ever given; the as-of view shows what she called it then, and chapters not yet opened then do not exist
- A repeated `open` with the same name and same start, a `rename` to the same name, and a `close` on the same day are all noops

## Her book (since 0.14.0)

`renderBook(dir, { asOf, includeSealed })` / CLI `book [--out file]`: a human-readable Markdown autobiography.

- Split into sections by chapter; each experience is printed only once, placed in the **most specific** chapter it falls into (the one that started latest), with larger chapters mentioned in the entry; entries outside chapters are grouped by month. Each section is in time order
- The body of each entry is exactly what was written that day; later notes follow in time order, with the feeling "when recalled again"; resolve choices, refs and links are listed as they are
- Sealed entries are not included by default; it only says "some were not included" and how many; only `--sealed true` includes them, marked as sealed
- `--as-of`: the book written up to that day, with chapters under the names used then. `--out` cannot point inside the memory directory

## The unsaid drawer (since 0.15.0)

Messages typed but not sent, questions she wanted to ask but did not, words she held back: `unsaid-events.jsonl`, append-only.

```json
{"id":"unsaid_…","at":"…","day":"2026-11-16","kind":"draft","text":"其实我今天有点难过","reason":"不想让他担心","status":"open"}
{"id":"unsaid_…","at":"…","day":"2026-11-17","status":"spoken"}
{"id":"unsaid_…","at":"…","day":"2026-11-18","status":"discarded"}
```

- `kind`: `draft` (typed but not sent), `question` (wanted to ask but did not), `held` (held back). `text` is at most 1000 characters, `reason` at most 200 characters
- `spoken` / `discarded` are both appended events; the original text is not deleted; after `discarded`, she herself cannot see it either
- **Never opened automatically**: `recall`, `memory`, the waking block, `read`, `recap` and `book` do not read this file. Only `listUnsaid` (CLI `unsaid list`) shows it to her
- Only available in recognizable one-to-one sessions (`private_*` / `private:*` / `local_*` / `local:*`); for group chats and unrecognized session keys, leaving, viewing and marking are all refused
- Leaving the same sentence again (same kind, same text) while it is still open is a noop; marking spoken / discarded again does not write a second line; something already discarded cannot be marked spoken
- The core library exports no function that returns raw lines (not even `readAll`): the text can only come out through `listUnsaid`
- Export, import and backup include it automatically; it disappears together with everything else when `purge` deletes the whole store

## Recall is an event (since 0.5.0)

"Recalled once" is no longer written into the experience line; instead it is appended to `recall-events.jsonl`:

```json
{"id":"exp_mwggkzwbwp10","at":"2026-11-15T07:20:00.000Z","query":"灯塔","chatKey":"private_100000000#p_x"}
```

- Derived from events at read time: `recalls` = the number of events for that id, `lastRecalledAt` = the largest `at`
- `recalls` / `lastRecalledAt` in old files are still readable; as soon as the id appears in the event file, the events take precedence
- Migration: `node tools/migrate-recall-events.mjs --data=<dir>` (dry-run by default; writes only with `--apply`; backs up first, verifies, can be rolled back)
- Appends are locked; concurrent appends from several processes do not lose lines

## Write limits (exceeding them is an error, not silent truncation)

| Field | Limit |
| --- | --- |
| `text` | 2000 characters |
| `scene` | 500 characters |
| `thought` | 1000 characters |
| `unfinished` | 300 characters |
| `feeling` | 8 items |
| `quote.text` | 500 characters |
| `kind` | 20 characters |
| `later[].thought` | 1000 characters |
| `later[].reason` | 200 characters |
| `later[].feeling` | 8 items, 20 characters each |
| `then.refs` | 8 entries, all of which must exist |

A blank `text` is rejected outright (`{ok:false, error:"text 不能是空的。"}`, i.e. "text cannot be empty."). When something is too long, an error is returned with the actual length, so she can decide for herself what to cut, or split it into two entries. A memory system must not quietly drop half of the original text.

## Recall semantics

Match scope: **what was written then** (`then.text` / `then.thought` / `then.feeling`), **the source-text anchor** (`then.quote.text` / `source`), and **what she only understood later** (`later[].thought` and `later[].feeling`). Returned entries carry `matchedIn`, saying which of the layers `then` / `quote` / `later` were hit. The host can use it to tell the model "this is something she only figured out later", so that a later judgment is not presented as something she knew from the start.

- With a query: sorted by relevance × importance, top N
- **Empty query: returns the most recent N** (newest first). This is not an error, and not "nothing matched"
- `mode: 'strict'` (default): long queries require ≥60% of bigrams to hit; better to recall nothing
- `mode: 'loose'`: one content-word hit is enough; suited to recall in everyday conversation
- `limit: 0`: returns nothing; negative or non-integer: error

## Which files a backup must include

One experience may be made up of seven places on disk, plus a drawer that belongs only to her. When backing up, do not copy only `self-experience.jsonl`:

```
self-experience.jsonl     then (plus inline later / recalls left over from before migration)
later-events.jsonl        thoughts appended later (since 0.12 may carry the later feeling)
recall-events.jsonl       how many times it was recalled
unfinished-events.jsonl   what later happened to unfinished things (since 0.11)
seal-events.jsonl         what she sealed / unsealed (since 0.13)
link-events.jsonl         links made afterwards (since 0.14)
chapter-events.jsonl      life chapters (since 0.14)
unsaid-events.jsonl       the unsaid drawer (since 0.15)
```

For one-command backup and restore drills, see [runbook.md](../runbook.md).

Refs (`then.refs`) are written in the experience line, not in a separate file.

They are merged into "one experience" only at read time. When a migration tool rolls back, it restores these files together as well.

## Version compatibility

- The current format is recognized by its structure; there is no `schema` field
- v1 flat records (`text` / `thought` directly at the top level) can still be read; all new writes are v2
- If a `schema` field is added in the future, old readers must be able to ignore it
- A PR that changes the format must state how to migrate, and must not delete old fields

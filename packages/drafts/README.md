# whale-drafts

Append-only drafts for an AI companion: she writes a page, and it is still there tomorrow —
with every earlier version intact, conflicts refused instead of silently overwritten,
and retries that do not create phantom versions.

Pure Node.js (>= 20), no dependencies, no network, no model calls.

## Install / use

```js
import { saveDraft, readDraft, listHistory } from 'whale-drafts'

saveDraft(dir, { scopeKey: 'private:owner', itemId: 'story-1', baseRevision: 0, text: '灯灭的时候，海刚好退了。' })
// { ok: true, revision: 1, at: ... }

saveDraft(dir, { scopeKey: 'private:owner', itemId: 'story-1', baseRevision: 0, text: '直接覆盖' })
// { ok: false, code: 'conflict', currentRevision: 1 }

readDraft(dir, { scopeKey: 'private:owner', itemId: 'story-1' })
// { ok: true, revision: 1, text: '灯灭的时候，海刚好退了。', at: ... }

listHistory(dir, { scopeKey: 'private:owner', itemId: 'story-1' })
// { ok: true, versions: [{ revision: 1, at, bytes }], nextBefore: null }
```

## Guarantees

- **Immutable revisions.** Every save appends one line; earlier versions stay byte-for-byte.
  Nothing rewrites her text (no scrubbing, no trimming).
- **Optimistic concurrency.** `baseRevision` must be the revision the caller actually read.
  Otherwise `conflict` with `currentRevision` — no guessing, no auto-merge.
- **Idempotent replay.** Same `operationId` + same text returns the original receipt
  (`replayed: true`) instead of adding a version. Same id with different text is
  `operation_conflict`.
- **As-of reads.** `readDraft(dir, { ..., asOf })` returns the last revision at or before that
  instant — "what did it look like then".
- **Honest failures.** A file that cannot be parsed returns `unreadable`, never an empty page:
  "she hasn't written yet" and "we lost it" must not look the same.
- **Bounded.** 16 KiB per revision, 2000 revisions per item. Hitting the cap returns
  `version_limit` and refuses the write instead of silently dropping history.

## Storage

```
<dir>/drafts/<sha256(scopeKey)[:32]>/<itemId>.jsonl    one JSON object per revision
<dir>/drafts/.../<itemId>.jsonl.lock                   directory lock (mkdir)
```

Writes go through a temp file + rename while holding the lock, so readers never see half a line.

## Errors

`invalid_input`, `conflict`, `operation_conflict`, `revision_missing`, `text_too_large`,
`version_limit`, `busy`, `unreadable`, `storage_error`.

## What it does not do

- No content judgement, no generation, no "she should write now" prompts — that is the caller's job.
- No forgetting or compaction: whether an old version is deleted is a decision for the host,
  not for this library.
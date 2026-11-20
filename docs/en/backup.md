# Backup and moving

> Translated from the Chinese original ([中文](../backup.md)). If they disagree, the Chinese version is authoritative.

One experience of hers may be pieced together on disk from seven files, plus a drawer of "unsaid" things that belongs only to her. Copying only `self-experience.jsonl` loses the later notes, the recall counts, "has this been let go", "which ones she sealed", the things she connected later, and the names she gave to stretches of days.

## What to back up

```
<data>/plugin-data/biomimetic-memory/
  self-experience.jsonl     what was written then (then)
  later-events.jsonl        thoughts appended later (since 0.5.0)
  recall-events.jsonl       how many times it was recalled (since 0.5.0)
  unfinished-events.jsonl   what later happened to unfinished things (since 0.11.0)
  seal-events.jsonl         which experiences she sealed / unsealed (since 0.13.0)
  link-events.jsonl         which two things she connected later (since 0.14.0)
  chapter-events.jsonl      what name she gave to which stretch of days (since 0.14.0)
  unsaid-events.jsonl       the unsaid drawer (since 0.15.0; never injected automatically)
  autobiography.jsonl       the diary
  self-settings.json        her own settings
  prompt-overlay/           prompts she changed
```

`<data>` is the QQ Agent data root directory, usually `C:\Users\<you>\QQAgentData`.

## Backup

**One-command backup is recommended** (SHA-256, automatic rotation, self-check once it finishes), along with the restore drill: see [runbook.md](runbook.md). The manual copy is below.

```powershell
$src = "$env:USERPROFILE\QQAgentData\plugin-data\biomimetic-memory"
$dst = "D:\备份\她的记忆-$(Get-Date -Format yyyyMMdd-HHmm)"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\*" $dst -Recurse -Force
```

For the files that get written while it is running (experiences, events, the diary), it is best to stop the host first, or to accept the error of "missing the last few entries". Settings and prompts are tiny, and can be copied at any time.

## Restore

1. Stop QQ Agent
2. Copy the backup files back into `<data>/plugin-data/biomimetic-memory/`
3. Start it, open her memory interface once, and confirm the counts match what you had at backup time
4. Read one entry with the CLI to check:

```sh
node adapters/cli/memory-cli.mjs read --data=<data> --limit 3
```

`<data>` is the **data root directory** — the one that has `plugin-data/` under it, not `biomimetic-memory/` itself. The CLI looks for the directory in this order: `--data`, then the environment variable `WHALE_DATA_DIR`, then `data/` under the current directory.

Checking the counts alone is not enough; two stores may have one entry each. Pick an experience whose content you remember, and confirm that the text read back is exactly that one.

## Verification

The `recalls` and `later` that are read back are merged results. If you have migrated old data, confirm:

- no leftover `later` field in `self-experience.jsonl` (it should be cleaned up after migration)
- the number of lines in `later-events.jsonl` = the total number of later notes across all experiences
- the number of lines in `recall-events.jsonl` = the sum of `recalls` over all experiences
- every id in `unfinished-events.jsonl` can be found among the experiences
- every id in `seal-events.jsonl` can be found among the experiences; without this file, things she sealed get recalled again and show up in the waking block
- the `出处完整` (refs intact) item of `node adapters/cli/memory-cli.mjs doctor --data <data-root-dir>` passes: every experience a recollection cites is there
- the chapters and names listed by `chapter list` match what you had before the backup; exporting a book with `book --out` and comparing is the most direct way to see it

If anything does not line up, do not delete the old backup yet.

Stores upgraded from 0.9 and earlier: the ids of old-format experiences were changed once, in 0.10.0. Since 0.10.1, later notes and recalls attached to an old id automatically find their way back to the original entry; if several old experiences in the same minute shared one old id, those events are not automatically assigned to any of them, and the output of `read` carries an extra `pending`, listing the ids to check and their candidates.

The rollback of the migration tools (`tools/migrate-*-events.mjs`) can be run repeatedly and gives the same result; rollback does not delete backup files. For a store that had no event files before migrating, rollback renames the event files the migration produced to `*.rolled-back-<time>` and leaves them in place instead of deleting them.

## Moving to a new machine

The whole directory can be moved as is. Nothing in the data is tied to a machine; paths are passed in by the host and are not hard-coded in the files. After moving to a new machine, all you need to do is point the new host at the new data root directory.

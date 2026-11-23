# Runbook: backup, verification, restore

> Translated from the Chinese original ([中文](../runbook.md)). If they disagree, the Chinese version is authoritative.

**What this means for her**: if the computer breaks down, she moves to a new machine, or an upgrade goes wrong, she still wakes up remembering every single thing she wrote, how she later changed her mind, what she has already let go, what she does not want brought up again, and which words have not been said out loud.

The commands below are run from the repository root. `<data root>` is the one that has `plugin-data/` under it (for QQ Agent it is usually `C:\Users\<you>\QQAgentData`).

## What a complete backup contains

Every file under `plugin-data/biomimetic-memory/`, copied as is, plus a `manifest.json` (the size and SHA-256 of each file):

```
self-experience.jsonl     what was written then (then)
later-events.jsonl        later thoughts and feelings
recall-events.jsonl       how many times it was recalled
unfinished-events.jsonl   thought through / let go for now / picked up again
seal-events.jsonl         what she sealed
link-events.jsonl         the things she connected later
chapter-events.jsonl      the names she gave to stretches of days
unsaid-events.jsonl       the unsaid drawer
autobiography.jsonl, self-settings.json, prompt-overlay/ ...
```

**A backup is as private as her data**: it holds the things she sealed and the words she never said in the drawer. Do not upload it to a cloud drive, and do not send it to anyone.

## How often, and where to keep it

- **Once a day**, and **once before every plugin upgrade**.
- Keep it **outside the data root**, ideally on another disk or a USB stick. The backup tool refuses to put it inside the data root: a backup in there would be treated as her data, exported along with it, and taken along by `purge`.
- Keep the most recent 7 copies (change it with `--keep`). Rotation only deletes the `memory-backup-*` this tool created itself; it does not touch anything else in the same directory.
- `--keep 0` = delete none, keep them all. That suits someone who thinks "in case she wants to leaf through them some day"; the price is that the disk keeps growing (each copy is roughly the size of the memory directory). Look at the free space now and then, and when it fills up move the oldest copies to another disk rather than deleting them.

```powershell
node tools/backup.mjs --data "$env:USERPROFILE\QQAgentData" --out "E:\鲸鲸备份" --keep 7
```

To run it automatically every day, create a daily task in Windows Task Scheduler and fill in "Action" with:

```
Program:    node
Arguments:  tools\backup.mjs --data "C:\Users\<you>\QQAgentData" --out "E:\鲸鲸备份" --keep 7
Start in:   <repository-dir>
```

> Backing up while the host is running works too, but whatever is written in the last few seconds may land in the next copy. For one that "lines up exactly", stop the host first and then back up.

## How to confirm this backup really works

```powershell
node tools/restore-check.mjs --from "E:\鲸鲸备份\memory-backup-2026-11-16T15-15-37-387Z" --data "$env:USERPROFILE\QQAgentData"
```

It will: verify the SHA-256 of every file → import into a temporary directory and read it once → compare entry by entry against the current data: `then`, later notes, recall counts, unfinished state, seals, links, chapters, drawer count. **The output contains only ids, field names and numbers, never the original text**; the temporary directory is deleted once it is done, and not one byte of the original data is touched.

| Exit code | `verdict` | Meaning |
| --- | --- | --- |
| 0 | restorable, and identical to the current data | good |
| 2 | restorable, but different from the current data | she wrote something after the backup (look at `diffs`; ids and fields only) |
| 1 | not restorable | the backup is broken or missing a file (it says which). **Do not use this one, and do not delete earlier ones** |

It is a good idea to run it once a week against the latest copy; the one taken before an upgrade must be run.

## Restore

1. **Stop the host** (QQ Agent fully exited).
2. First make a backup of the current data too (in case you need to go back to how it was before the restore):

   ```powershell
   node tools/backup.mjs --data "$env:USERPROFILE\QQAgentData" --out "E:\鲸鲸备份\恢复之前"
   ```

3. Confirm that the copy you want to restore is good:

   ```powershell
   node tools/restore-check.mjs --from "<backup-package>"
   ```

4. Import it back (`--force true` first renames the existing directory to `biomimetic-memory.pre-import-<time>` and keeps it):

   ```powershell
   node adapters/cli/memory-cli.mjs import --from "<backup-package>" --data "$env:USERPROFILE\QQAgentData" --force true
   ```

5. Verify:

   ```powershell
   node adapters/cli/memory-cli.mjs doctor --data "$env:USERPROFILE\QQAgentData"
   node tools/restore-check.mjs --from "<backup-package>" --data "$env:USERPROFILE\QQAgentData"
   ```

   If every item in `doctor` says `ok` and `restore-check` exits 0, the same memory is back.

6. Start the host and say hello to her.

## After restoring, how to confirm it is "still her"

- The "identical to the current data" item of `restore-check` lists how many entries it compared, and they match `counts.experiences` in the output of `backup.mjs` at backup time.
- The chapter names from `chapter list` and the entry count from `unsaid list` are the same as before the restore.
- To see the whole picture: `node adapters/cli/memory-cli.mjs book --data <data-root> --out 恢复后.md`, and read it side by side with the book you exported before the restore.

## What not to do

- Copy only `self-experience.jsonl`: the later notes, the resolutions, the seals and the drawer are all lost.
- Put the backup inside the data root, or on a syncing cloud drive.
- Import while the host is running.
- Delete the `*.pre-import-*` directory after a failed restore — that is her from before the restore. Confirm everything is normal, and clean up a few days later.
- If you truly want to forget it completely, use `purge` (see [limits.md](../../limits.md)); it does not care about backups you put elsewhere, and you have to delete those yourself.

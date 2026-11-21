# Limits and non-guarantees

> Translated from the Chinese original ([中文](../limits.md)). If they disagree, the Chinese version is authoritative.

This document states plainly: how big it can get, what it cannot do, and which of these are on purpose. We do not want to call it "enterprise-grade" in the README, and we do not want you to find out only after hitting a problem.

## Scale

Measured (Windows 11 x64, Node v24.21.0, 2026-11-16):

| Experiences | `loadAll` median | `recall` median |
| --- | --- | --- |
| 2,000 | 4.9 ms | 13.9 ms |
| 10,000 | 21.8 ms | 68.3 ms |

Command to reproduce (3 warm-up runs, median of 5; samples are a 30–50 character body + one thought, 1/4 with a source-text anchor):

```sh
node tools/bench-recall.mjs --n=10000
```

- Every recall **reads everything** and scans entry by entry. No index, no vectors, no sharding.
- One experience is about 0.5 KB; 10,000 are about 5 MB.
- **Event files only grow**: every recall adds a line to `recall-events.jsonl`, every change of mind adds a line to `later-events.jsonl`, every resolve: done / shelved / reopen adds a line to `unfinished-events.jsonl`, every seal or unseal adds a line to `seal-events.jsonl`, and every linked pair and every chapter opened / renamed / closed adds a line to `link-events.jsonl` / `chapter-events.jsonl` respectively (the last few are small). The table above only counts the experiences themselves; for long-term use, count these files too.
- At tens of thousands it starts to get noticeably slower; at hundreds of thousands, this implementation is no longer suitable.

**On purpose**: first guarantee "the original text cannot be changed" and "no record means saying there is none", then talk about throughput. To reach hundreds of thousands, the host should add its own index (see [composition.md](../archive/composition.md)) instead of stuffing vectors in here.

## Storage and encryption

- Plain-text JSONL. **No built-in encryption**; whether it is encrypted depends on the disk (BitLocker / FileVault / full-disk encryption).
- Any local process that can read this directory can read all memories. On multi-user machines, rely on OS account isolation.
- No multi-device sync, no cloud backup. To move, copy the whole directory or use `export`.

## Capability-level verification, not a file check

`doctor` does not just check "whether the directory exists". It actually runs through the whole flow in a temporary directory:

```
write → later note → resolve → recall
export → import → read back
parse event files line by line
waking allowlist: private chat allowed, group chat blocked
```

```sh
node adapters/cli/memory-cli.mjs doctor
```

Only `ok: true` shows that this code can really write and read on the current machine. Run it once before and once after an upgrade; on a new machine, run it first too.

**About indexes**: this project deliberately has no built-in index; the original text is the single source of truth. If the host needs an index (for example FTS or vectors), it should be **generated on the side at write time**, and it must be possible to rebuild it from the original text after the index is deleted. An index is never a source, only an acceleration. Any state where "the index has it but the original text does not" counts as a bug.

## The prompt overlay is persistent (the most unusual point)

What `prompt set` writes **takes effect on every turn** until it is changed back. So:

- Only allow trusted callers (the host itself, or a persona with explicit authorization) to change the prompt. Do not splice users' free text into it as is.
- Before writing, run `prompt get` to see the current version; after writing, keep a record with `prompt history`.
- If something is wrong, run `prompt revert --version <previous version>` right away.
- Once a prompt injection is written into the overlay, it does not go away when the session ends. This is the security boundary in this project that is easiest to overlook.

## Deletion

**Deleting the whole store is supported.** Commands:

```sh
node adapters/cli/memory-cli.mjs purge --data <data-root-dir>          # list only, do not delete
node adapters/cli/memory-cli.mjs purge --data <data-root-dir> --yes true  # really delete
```

It only handles these locations under the data root directory:

- `plugin-data/biomimetic-memory/` (experiences, diary, events, settings, prompt overlay)
- `plugin-data/biomimetic-memory.pre-import-*` (backups left by `import --force`)
- `backups/self-experience-pre-{later,recall}-events-*.jsonl*` (migration backups)

**Not handled**: the output directory of `export`. Export packages are wherever you put them; `purge` does not delete them for you, and you need to clean them up yourself.

- **Deleting a single entry is not supported.** `then` is deliberately immutable: if it could be changed, memories could be washed, and the "autobiography" would no longer hold.
- So the "right to be forgotten" and append-only are in real conflict. The current answer is: **to forget, delete the whole store, and delete the export directory along with it**. Forgetting a single entry requires the host to design its own tombstones or redaction; this project does not provide it.
- **The unsaid drawer** (since 0.15) is also plain text and also goes along with backups; "discard" only means she herself no longer sees it, and the original text is still in the file. To truly erase it, the only way is still `purge`.
- **Sealing is not deletion** (since 0.13): `seal --id` means she is no longer actively reminded of this thing. It is not recalled, does not go into the waking block, and its content is not revealed when another recollection cites it. But the original text and later notes are still on disk; `read --id` can still read it by name, and it is in export packages too. Sealing is her choice, not a privacy deletion for the user; to truly erase it, the only way is still `purge`.

## Concurrency

Actual behavior:

- `addExperience` **does not take a file lock**; it uses the operating system's append write (`a+`). For several processes writing at the same time not to lose lines, every write must append a whole line; it is not a transaction and cannot guarantee order.
- Appends to `later-events` / `recall-events` **go through a file lock** (mkdir mutual exclusion); the mkdir in the lock layer retries on Windows EPERM, **rename does not retry**.
- Writes to `self-settings` and `prompt` are "lock + temp file + rename".
- `export` / `import` **do not take a lock**: exporting while the host is still writing may give a snapshot where one file is new and another is old; importing while the host is still writing is not blocked by anything either.

Therefore: **stop the host before export, import or purge**, or accept that the snapshot may be off by a few seconds. Do not let two host processes write to the same directory at the same time.

## Recall language

- Tokenization and stop words are tuned for Chinese: Chinese is split into adjacent two-character pairs, and common function words do not take part in matching.
- English has only the most basic support: whole-word, lowercase matching with function-word filtering; no stemming, no synonyms.
- If you need real multilingual semantic recall, hand retrieval to the host (see [composition.md](../archive/composition.md)).

## MCP adapter

- An MCP client counts as a "trusted local process": a connected client can read and write all memories (except the drawer, unless `--owner true`). Do not connect it to anywhere other people can send messages to, unless the host verifies the caller first.
- Import, export, delete, prompt changes and settings changes are deliberately not provided; these are CLI-only.
- stdio transport only; no port is opened. For remote use, handle authentication on the host side yourself; this project does not provide an HTTP service.

## Non-guarantees

- No guarantee of automatic upgrade across versions. Format changes come with migration scripts, but back up before migrating; migrations can be rolled back, and rollback keeps the events.
- No guarantee that it is "always readable". Files damaged by hand-editing, deleted events, or two versions writing to the same directory at the same time may all make it unreadable.
- No guarantee that the persona "feels human". It only guarantees: what was written then has not been overwritten, later thoughts can be appended, and it does not make things up when no record is found.

## When not to use it

- You need semantic search, fuzzy matching, or millisecond recall across hundreds of thousands of entries
- You need multilingual recall beyond Chinese (English is only good enough)
- You need multi-person collaboration, tiered permissions, audit logs
- You need compliance-grade encryption and single-entry deletion (the GDPR kind)
- You need an out-of-the-box chat memory middleware

For these scenarios, use dedicated memory infrastructure; whale-memory only does the small "persona layer" piece. Not being enough is not a bug; it is a boundary.

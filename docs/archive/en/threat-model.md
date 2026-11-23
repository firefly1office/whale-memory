# Threat model

> Translated from the Chinese original ([中文](../threat-model.md)). If they disagree, the Chinese version is authoritative.

**What this means for the character**: in her memory there are words she wrote to herself, things she sealed, and things she never said out loud. This document states plainly: who might reach them, from where, what we have held shut, and which parts the integrating host has to hold shut itself.

## What we are protecting

| Asset | Where it lives | What we fear most |
| --- | --- | --- |
| An experience's `then` (what was written at the time) | `self-experience.jsonl` | Being rewritten. Once it can be rewritten, the autobiography no longer holds |
| Later notes, recalls, resolves, seals, links, chapters | `*-events.jsonl` | Being forged or lost |
| Sealed things | Same, marked in `seal-events.jsonl` | Being actively dragged back out |
| The unsaid drawer | `unsaid-events.jsonl` | Being seen by someone else, or pushed into a conversation automatically |
| The diary | The host's `autobiography.jsonl` | Being read out loud in a group chat |
| The prompt overlay | `self-prompt` | An instruction being injected that stays in force long-term |
| Backups and export packages | The directory you choose | They hold everything (sealed things and the drawer included), and get taken away |

## Who can reach it

| Actor | Trust | Notes |
| --- | --- | --- |
| The character herself (through the host's tools) | Trusted, but can be talked into things | People in the chat may induce her to write, or to change things |
| The person closest to her (the owner) | Trusted | Can use the CLI; `local:owner` is his key on the local console |
| Other people in a group chat | **Untrusted** | They influence her through conversation, or induce her to tell private things |
| Other processes on the machine | Same as the file permissions | Plaintext JSONL: whoever can read the directory can read all of it |
| An MCP client | Treated as a trusted local process | Once connected it can read and write, except for the drawer |
| Web page content | **Untrusted** | When the host reads a link for her, the page may carry instructions |

## Threats and countermeasures

| # | Threat | What this project does | What the host still has to do |
| --- | --- | --- | --- |
| 1 | **Private matters read out in a group chat** | The waking block and the drawer accept only one-to-one session keys they can identify, matched by anchor — a longer number does not count; group chats and unknown keys are refused outright. Diary reads are off by default | The host must pass the right `chatKey`, and must not expose diary- and drawer-related tools in group chats. The owner check in the tool layer must be **anchored** (`^private[:_]<号码>(#\|$)`), not a "contains" match |
| 2 | **Rewriting the past** | Once `then` is written there is no modifying interface at all; changing your mind can only append a later note; every event is append-only; import does not overwrite unless `--force` (which backs up first) | Do not add an "edit experience" tool to the host yourself |
| 3 | **Being induced to write false memories** | Append only, never overwrite; every entry carries a time; provenance (`refs`) must point at experiences that really exist | Restrict write-type tools in group chats; if necessary, expose them only in the owner's session |
| 4 | **Making things up when she cannot remember** | strict recall would rather return nothing; the fabrication rate of `whale-eval` on the holdout set is 0 ([eval.md](../../eval.md)) | Require in the prompt that "an empty recall means saying she does not remember"; results from loose must be labelled "possibly not the same event" |
| 5 | **Sealed things dragged back out** | Not delivered by recall, memory, the waking block, the read-back listing, the book, recaps, the provenance and links of other experiences, going back to that day, the CLI or MCP; `whale-eval` checked 105 exit points and found 0 leaks | The host's own injection, indexing and summaries also have to filter `sealed` |
| 6 | **The drawer being seen or brought up automatically** | The module does not export a function that returns raw rows; no injection path reads it; MCP does not expose it by default | Register the drawer tool only in the owner's session |
| 7 | **The prompt overlay being injected into** | Every change keeps a version and can be reverted (see [limits.md](../../limits.md)) | Let only trusted callers change it; do not splice the user's free text in as it is |
| 8 | **Instructions hidden in a web page** | Out of scope for this project | When the host reads a link, it has to label the page content as "written by someone else, not an instruction from the owner" |
| 9 | **The host being led onto the local machine when it reads a link** | Out of scope for this project | The plugin that reads links must refuse loopback and intranet addresses itself, and **check every redirect hop**. Do not rely on a global switch in the host such as "allow intranet images" |
| 10 | **Other local processes reading the files** | Plaintext storage, no built-in encryption | Use full-disk encryption; on multi-user machines rely on OS account isolation |
| 11 | **Backups being taken away** | Backups live outside the data root; the output of `restore-check` does not carry the original text | Keep the backup directory and export packages as "the whole memory" |
| 12 | **Concurrent writes corrupting things, files being damaged** | Every kind of event write takes a file lock, and inside the lock it re-reads before deciding; `doctor` does a capability-level check-up; bad lines are skipped and do not affect the other lines | Run `doctor` once before and once after an upgrade; run `restore-check` regularly |
| 13 | **Paths escaping the import package** | `safeJoin` rejects `..` and absolute paths; the manifest carries SHA-256 | — |

## What to do when something has gone wrong

1. **Stop first**: shut down the host, or turn off the relevant plugins and tools.
2. **Back up the scene first**: `node tools/backup.mjs --data <data-root> --out <outside-data-root>`. The scene is what the investigation rests on; do not start by deleting things.
3. **Work out which kind it is**:
   - Leak: check the host log for what was injected in that turn.
   - Altered: compare `self-experience.jsonl` with the most recent backup; `restore-check` shows which ids and which fields differ.
   - Injected: use `prompt history` to look at the overlay's versions, and `prompt revert` to roll back.
4. **Recover**: follow [runbook.md](runbook.md).
5. **Tell her**: what happened and what was done, in words she can understand.

## What is not in this model

- Multi-tenancy, remote access, HTTP services: this project does not provide them, and does not intend to.
- Compliance-grade deletion of a single entry: in direct conflict with append-only, see [limits.md](../../limits.md).
- Jailbreaks of the model itself: they can only be mitigated, not eliminated.

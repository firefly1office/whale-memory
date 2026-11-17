# Whale-memory · an autobiographical memory for an AI companion

[中文](README.md) · [English](README.en.md)

[![Public examples](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml/badge.svg)](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml)

![One experience, two views: what she wrote then stays; what she thinks later is appended](docs/assets/then-later.png)

> The picture shows **one experience as the host reads it**: on disk, `then` lives in `self-experience.jsonl`, later thoughts in `later-events.jsonl`, and they are merged at read time. Back up all of them (plus `recall-events.jsonl`).

Whale-memory is an autobiographical memory layer for AI characters: what she thought then, and how she changed her mind later. Zero dependencies, plain JSONL, embeddable in any host. 鲸鲸 (Jingjing), an AI character who lives in QQ, is its first user — the project started from her question: if she read a chapter yesterday and changed her mind today, can she still find the person she was yesterday?

She writes an experience for herself — the passage she read, how it felt, what she thought. Later, when something reminds her of it, she can find that page and add a new view. Every record has two layers: `then` (fixed at the moment of writing) and `later` (append-only). When something is worth remembering is decided by the character and the host, not by the library.

A record on disk is one JSON object per line:

```json
{
  "day": "2026-11-14",
  "then": {
    "text": "Read the scene at the clubroom door; felt bad for him",
    "scene": "11 pm, the room was quiet",
    "feeling": ["stifled", "a little bitter"],
    "thought": "If he doesn't say it now, there will be nothing left",
    "quote": { "text": "I'm happy too", "source": "Too Many Losing Heroines!, ch.3" }
  },
  "later": [
    { "at": "2026-11-15T09:12:00Z", "thought": "Now I think he was protecting a friend" }
  ],
  "weight": "important"
}
```

`then` never changes; `later` only grows. That is why an old view is never overwritten by a new one.

## See an experience change its mind

Node.js 20+ (CI runs 20 and 22). Run from the repository root; the demo uses a temporary directory, works offline, and needs no API key.

```sh
git clone https://github.com/firefly1office/whale-memory.git
cd whale-memory
node packages/core/demo.mjs
```

Output follows your system language (English unless your locale is Chinese); force it with `node packages/core/demo.mjs --lang en`. The CLI and the MCP server take the same `--lang en|zh` flag (or `WHALE_LANG`), and error messages are always English first.

In the "[after changing her mind]" section, look for the original thought and the later one. Both belong to the same experience. The demo prints the data directory at the end.

## Write your first experience

Run from the repository root. By default it writes to `./data/`. For real use, give each character its own `WHALE_DATA_DIR` and keep writes to one directory sequential.

```sh
node adapters/cli/memory-cli.mjs write --text "Read the lighthouse chapter today" --thought "Is the keeper afraid of the dark?"
node adapters/cli/memory-cli.mjs recall --query "lighthouse" --limit 1
```

The first command returns an `id`. Replace `RETURNED_ID` below with it, then read again to see both views.

```sh
node adapters/cli/memory-cli.mjs revise --id RETURNED_ID --thought "The ending made me think she wanted the boats to see the light"
node adapters/cli/memory-cli.mjs read --limit 1
```

## Choose how to integrate

| What you want | Where to start |
| --- | --- |
| Let DSH read and write experiences through commands | [Standalone DSH skill and install notes](examples/dsh-plugin/dsh-whale-memory/README.md) |
| Add tools to your own agent | [CLI adapter](adapters/README.md) — emits JSON; the host decides when to call it |
| Plug into an MCP client (Claude Desktop, Claude Code, Cursor…) | [MCP adapter](adapters/mcp/README.md): `npx -y -p whale-memory-core whale-memory-mcp --data <dir>` — stdio, local only, zero dependencies |
| Use it directly from JavaScript | [Self-layer core](packages/core/README.md) (`npm install whale-memory-core`) and [porting guide](docs/en/porting.md). Mind the `-core`: the unscoped `whale-memory` package on npm belongs to someone else and is unrelated |
| Wire up a character from scratch | [30-minute tutorial](docs/tutorial.md) (Chinese): write, recall, change your mind, wake up the next day, seal, her book, plug into a host |
| Inspect the data format | [Schema](docs/en/schema.md) and [fictional samples](examples/samples/) |
| See another host surface yesterday | [First day, still connected the next](examples/first-day/): two processes, no recall command |
| Look back at who she was that day | `read --id <id> --as-of 2026-11-15`: only notes and choices written up to that day are visible |
| Record how it feels now, and what a reflection is based on | `revise --feeling relieved` (the original feeling never changes); `write --refs id1,id2` (every cited experience must exist) |
| Vector/RAG for finding, this for telling | [Composing with a retrieval layer](docs/composition.md) (Chinese): retrieval returns ids; `then/later` holds the narrative |
| She no longer wants to be reminded of something | `seal --id`: never recalled or shown on waking, but still on disk; `unseal` brings it back |
| Material for writing a reflection | `recap --days 7`: what she wrote, revised, felt differently about, settled, or left open; facts only, with ids to cite |
| She realizes two things are related | `link --from A --to B --reason "..."`: she links them herself and says why; nothing is linked automatically |
| Name a period of her life | `chapter open --name "..." --from 2026-11-01`; renames keep the old names, and looking back shows what she called it then |
| Print her autobiography | `book --out her-book.md`: grouped by chapter; original entries verbatim, later notes after; sealed entries left out |
| Things she could not say | `unsaid leave --kind draft --text "..."`: drafts she did not send, questions she did not ask, things she held back; visible only via `unsaid list` in a one-on-one chat, never injected |
| One-step backup and restore drill | `node tools/backup.mjs --data <root> --out <dir>`, `node tools/restore-check.mjs --from <backup> --data <root>` ([runbook](docs/runbook.md), Chinese) |
| Backup and move machines | [Backup & migration](docs/backup.md) (Chinese): seven files plus her drawer, and how to verify after restore |
| How far it goes, what it won't do | [Limits & non-guarantees](docs/en/limits.md): measured scale, plaintext storage, deletion semantics |
| Read before integrating | [Known pitfalls](docs/pitfalls.md) (Chinese): lexical recall, single writer, sealing is not deletion, host must enforce the owner gate |
| Read the technical report | [whale-memory technical report](docs/paper/README.md) (Chinese PDF, 28 pages; not peer-reviewed) |
| Is it accurate, does it make things up, does it leak | [whale-eval](docs/eval.md) (Chinese): `npm run eval`; dev and held-out sets reported separately; leaks and rewrites must be zero |
| Who can reach her memory, and how we guard it | [Threat model](docs/threat-model.md) (Chinese) |
| When to hand a memory back | [Injection timing](docs/injection.md) (Chinese): seven rules, a minimal implementation, anti-patterns |
| Where these ideas come from | [What we borrowed, what we changed, what we refuse to do](docs/related-work.md) (Chinese) |
| Understand the design | [Architecture](docs/en/architecture.md): layers, evidence policy, recall and write constraints |
| Check evidence rules | [Evidence policy (runnable subset)](docs/evidence.md) (Chinese): as-of, supersession, absence |

> The full engine (vault storage, evidence policy, consolidator, injection budget — about 26k lines) is tightly coupled to one host deployment and is **not distributed with this repository**. The design is written up in [architecture.md](docs/architecture.md).

## Data and verification

Experiences live in `<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/`. Records in one directory are read by the calling process. If you expose this over group chats, the host must check who is calling and what that conversation is allowed to see — especially before enabling diary reads. The CLI is meant for trusted local processes.

`tools/` contains development and operations scripts; some connect to a running host, read conversations, or call a model — see [tools/README.md](tools/README.md) (Chinese) for which ones run standalone. The demo above is enough for a first look. These two checks use synthetic data:

```sh
node --test tests/public-cli.test.mjs
node tools/privacy-canary.mjs
```

MIT licensed — see [LICENSE](LICENSE). Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md); changes are in [CHANGELOG.md](CHANGELOG.md); privacy and safety in [SECURITY.md](SECURITY.md).
# Whale-memory · an autobiographical memory for an AI companion

[中文](README.md) · [English](README.en.md)

[![Public examples](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml/badge.svg)](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml)

![One experience, two views: what she wrote then stays; what she thinks later is appended](docs/assets/then-later.png)

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

In the "after changing my mind" section, look for the original thought and the later one. Both belong to the same experience. The demo prints the data directory at the end.

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
| Use it directly from JavaScript | [Self-layer core](packages/core/README.md) (`npm install whale-memory-core`) and [porting guide](docs/porting.md) |
| Inspect the data format | [Schema](docs/schema.md) and [fictional samples](examples/samples/) |
| See another host surface yesterday | [First day, still connected the next](examples/first-day/): two processes, no recall command |
| Understand the design | [Architecture](docs/architecture.md): layers, evidence policy, recall and write constraints |
| Check evidence rules | [Evidence policy (runnable subset)](docs/evidence.md): as-of, supersession, absence |

> The full engine (vault storage, evidence policy, consolidator, injection budget — about 26k lines) is tightly coupled to one host deployment and is **not distributed with this repository**. The design is written up in [architecture.md](docs/architecture.md).

## Data and verification

Experiences live in `<WHALE_DATA_DIR>/plugin-data/biomimetic-memory/`. Records in one directory are read by the calling process. If you expose this over group chats, the host must check who is calling and what that conversation is allowed to see — especially before enabling diary reads. The CLI is meant for trusted local processes.

`tools/` contains development and operations scripts; some connect to a running host, read conversations, or call a model. The demo above is enough for a first look. These two checks use synthetic data:

```sh
node --test tests/public-cli.test.mjs
node tools/privacy-canary.mjs
```

MIT licensed — see [LICENSE](LICENSE). Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md); changes are in [CHANGELOG.md](CHANGELOG.md); privacy and safety in [SECURITY.md](SECURITY.md).
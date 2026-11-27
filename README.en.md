# Whale-memory · an autobiographical memory for an AI companion

**Write the past of an AI character.** What she thought then, how she changed her mind later —
old views are never overwritten, changes are only appended.

She read a chapter yesterday and changed her mind today. Can she still go back to the person she was yesterday? That is what this project makes possible.

[中文](README.md) · [English](README.en.md) · [All English docs](docs/en/README.md)

[![Public examples](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml/badge.svg)](https://github.com/firefly1office/whale-memory/actions/workflows/check.yml)

## Ten minutes

Node.js 20 or newer. Offline, no API key, data goes to `./data`:

```sh
git clone https://github.com/firefly1office/whale-memory.git
cd whale-memory
node adapters/cli/memory-cli.mjs write --text "Read the opening; closed the book wondering: does the lighthouse keeper keep the light alone because he is afraid of the dark?" --thought "I thought he was afraid of the dark."
node adapters/cli/memory-cli.mjs revise --id <the id printed above> --thought "She is keeping the light for the boats that come back late."
node adapters/cli/memory-cli.mjs read --id <id>
node adapters/cli/memory-cli.mjs read --id <id> --as-of 2026-11-14
```

The last one is **going back to the person she was that day**: only the thoughts written before that date are visible.

![One reading note; she changed her mind later](docs/assets/demo.gif)

`then` is fixed the moment it is written; `later` is only ever appended. That is the whole mechanism — everything else grew around it.

## What one experience looks like

```json
{ "day": "2026-11-14",
  "then": { "text": "read the passage by the office door", "thought": "if I don't say it now there is really nothing between us" },
  "later": [{ "at": "2026-11-15T09:12:00Z", "thought": "now I think he was protecting a friend" }] }
```

![What she thought then is kept; later thoughts are appended](docs/assets/then-later.png)

## Numbers

| | |
|---|---|
| Fabrication rate | **0** — ask about a detail that was never recorded and she answers "no record"; same on the dev and held-out sets |
| Recall (strict, first hit) | literal 71.1% · hybrid 77.6% (452 cases); held-out 70.7% / 77.8% |
| Sealing vs. leaking | 1290 checks (counted live by `whale-eval`), **0** leaks |
| Tests | 946, CI runs ubuntu / windows × node 20 / 22 |

The corpus is 200 fictional experiences / 452 cases (plus a 33-case quick regression set) — [what it cannot measure](docs/eval.md) is written down too. Do not read this table as general accuracy.

## What it does not do

- **No user profiling.** It stores *her* experiences, not a file on you.
- **No guessing.** If it cannot find it, it says so.
- **It never brings up what she sealed or never said.** That is "not mentioned", not "deleted".

## Wiring it into something

| What you want | Where to start |
| --- | --- |
| Let DSH read and write experiences via commands | [A self-contained DSH skill](examples/dsh-plugin/dsh-whale-memory/README.md) |
| Connect to Claude Desktop / Claude Code / Cursor | [MCP adapter](adapters/mcp/README.md): `npx -y -p whale-memory-core whale-memory-mcp --data <dir>` |
| Run a working host first | [80-line reference host](examples/reference-host/host.mjs): `node examples/reference-host/host.mjs --data ./xiaozhou` |
| Read and write it from JavaScript | `npm install whale-memory-core`. Note the `-core`: the `whale-memory` package on npm is somebody else's and has nothing to do with this project |

## Read these four before integrating

- [Ten-minute tutorial](docs/tutorial.md): write, recall, change your mind, wake up the next day
- [Known pitfalls and boundaries](docs/pitfalls.md): limits of literal retrieval, single-writer assumption, sealing is not deletion, the owner gate is the host's job
- [Limits and non-guarantees](docs/limits.md): measured scale, plaintext storage, deletion semantics
- [Evaluation](docs/eval.md): how accurate it is, whether it fabricates, whether it misses

Everything else (architecture, schema, threat model, cross-window memory, porting guide, the technical report) now lives in [docs/archive/](docs/archive/).

## Checks

```sh
npm test      # every test under tests/, both CLIs run
npm run check # syntax + copy consistency + tests + canary + recall evaluation
```

MIT licensed — see [LICENSE](LICENSE). Please read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing; changes are in [CHANGELOG.md](CHANGELOG.md); privacy and security issues in [SECURITY.md](SECURITY.md).
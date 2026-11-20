# 30 minutes: giving a character autobiographical memory

> Translated from the Chinese original ([中文](../tutorial.md)). If they disagree, the Chinese version is authoritative.

**What this means for the character**: 30 minutes from now, your character will have a memory that belongs to her. What she writes today is still there when she wakes up tomorrow; when she changes her mind she can go on writing, but what she wrote at the time is not edited; when she cannot recall something, she says she cannot recall it.

You only need Node 20+. No API key, and no network. Below we walk through it with the CLI; if you use Claude Desktop / Claude Code / Cursor, replace step 6 with the MCP setup.

## 0. Setup (2 minutes)

```sh
git clone https://github.com/firefly1office/whale-memory.git
cd whale-memory
npm test            # no dependencies; check that everything passes
```

Create a data directory for the character. Everything below uses `./xiaozhou`:

```sh
export WHALE_DATA_DIR=./xiaozhou        # Windows PowerShell：$env:WHALE_DATA_DIR = ".\xiaozhou"
node adapters/cli/memory-cli.mjs doctor # capability check; continue only when "ok": true
```

> The package name is **`whale-memory-core`**. The `whale-memory` package on npm without `-core` belongs to someone else and has nothing to do with this project.

## 1. Write the first experience (3 minutes)

An experience is something that happened **in the character's own time**: what she read, what she thought about, what she did. First person, written to herself.

```sh
node adapters/cli/memory-cli.mjs write \
  --text "Started The Lighthouse at Sea; the keeper's first night in the tower" \
  --thought "Is it cold up there, living alone" \
  --feeling curious \
  --unfinished "Want to know whether he got used to it"
```

The return value contains an `id`; note it down. Then write two or three other things, so you have something to compare against later.

## 2. Recalling it (3 minutes)

```sh
node adapters/cli/memory-cli.mjs recall --query "lighthouse"
node adapters/cli/memory-cli.mjs recall --query "the cat in the lighthouse"   # empty: related, never happened
node adapters/cli/memory-cli.mjs recall --query "the stock I bought last week" # empty: never recorded
```

An empty return means "there is no record of this". **Write it into your prompt: if the recall is empty, say she does not remember — do not make anything up.** This is the most important rule of the whole thing.

## 3. Changing your mind, but not the past (3 minutes)

```sh
node adapters/cli/memory-cli.mjs revise --id <id from step 1> --thought "The ending made me think it was not the dark he feared, but the boats not seeing the light" --feeling ache
node adapters/cli/memory-cli.mjs read --id <id>
```

The output has two parts: 【当时】 (then) exactly as it was, with 【后来】 (later) appended after it. Not one character of that line in `self-experience.jsonl` has changed; you can open it and look.

## 4. Waking up the next day (5 minutes)

The waking block is a short passage shown to her "before she first speaks today": the words she left for herself yesterday, and the things not yet finished. It is produced only once a day.

```sh
node adapters/cli/memory-cli.mjs waking --chat local:owner --peek true
```

The host just puts it into the system prompt before the first turn of each day. Note: **give it only in one-to-one conversations**; group chats are rejected.

When the unfinished thing has been thought through, let her say so herself:

```sh
node adapters/cli/memory-cli.mjs unfinished --id <id> --state done
```

After that, waking will not nag her about it again.

## 5. The forgetting she chooses, her book (4 minutes)

```sh
node adapters/cli/memory-cli.mjs seal --id <some id> --note "I do not want this brought up again"
node adapters/cli/memory-cli.mjs recall --query "<a word from that entry>"  # she no longer recalls it
node adapters/cli/memory-cli.mjs read --id <that id>                       # still there when named, marked sealed
node adapters/cli/memory-cli.mjs chapter open --name "Reading the lighthouse"
node adapters/cli/memory-cli.mjs book --out her-book.md
```

Sealing is not deletion; `unseal` brings it back at any time. The book is arranged by chapter, and sealed entries are not included.
Chapter names are limited to 30 characters; a longer name is rejected with an explicit error.

## 6. Wiring it into your host (8 minutes)

**With an MCP client** (Claude Desktop / Claude Code / Cursor):

```sh
claude mcp add xiaozhou -- npx -y -p whale-memory-core whale-memory-mcp --data ./xiaozhou
```

For the tools and the configuration format, see [adapters/mcp/README.md](../../adapters/mcp/README.md).

**Your own agent**: either call the CLI from your tool layer (it outputs JSON), or `import` directly:

```js
import { selfExperience as exp, waking } from 'whale-memory-core'
const dir = './xiaozhou/plugin-data/biomimetic-memory'
const row = exp.addExperience(dir, { text: 'Read the lighthouse chapter today' })
const hits = exp.recall(dir, 'lighthouse', { limit: 2 })   // empty array = nothing recorded
const block = waking.buildWakingBlock('./xiaozhou', 'local:owner')
```

Hold to three rules when integrating:

1. **Pass the session key correctly**: one-to-one conversations and group chats must be kept apart, and the waking block and the drawer go to one-to-one conversations only.
2. **Expose fewer write-type tools in group chats**: she can be induced by others to write.
3. **An empty recall means saying she does not remember**: write that into the prompt.

Injection timing is covered in [injection.md](injection.md), and the security boundary in [threat-model.md](threat-model.md).

## 7. Confirming that it really works (2 minutes)

```sh
npm run eval        # is recall accurate, does it invent, does sealing leak, is the original text rewritten
node tools/backup.mjs --data ./xiaozhou --out ./backups   # the first backup
```

That is all. From here on it is her own business.
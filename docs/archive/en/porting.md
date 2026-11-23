# Porting guide: putting "her memory" into another host

> Translated from the Chinese original ([中文](../porting.md)). If they disagree, the Chinese version is authoritative.

This is for people who are not running QQ Agent: DSH, a home-grown agent, another framework.
Short version: **the full engine is not distributed with this repository, but the core library and the design are yours to use.**

## 1. What is in the repository and what is not

In the repository (`packages/core`, generic, safe to depend on; on npm as `whale-memory-core`):

| Module | What it does |
|---|---|
| `self-experience.js` | Experiences in two layers (then / later), weight, the two-part recollection view, recall counts, seal, links, as-of views |
| `self-memory.js` | One reader and renderer over her own experiences plus her diary |
| `waking.js` | The waking block: `buildWakingBlock` computes it read-only, `consumeWaking` marks it as shown |
| `self-prompt.js` | Prompt overlay: versions are append-only and can be reverted |
| `self-settings.js` | Her own settings (soft limits belong to her) |
| `book.js`, `recap.js`, `chapter-events.js`, `unsaid.js`, `archive.js` | Her book, recaps, life chapters, the unsaid drawer, export / import |

Not in the repository (part of the author's own QQ Agent deployment, tightly coupled to that host):

| Module | What it does |
|---|---|
| vault (index / events / cards) | Plain-file storage and indexing, part of a 26k-line engine |
| `evidence-policy.js` | Evidence rules: as-of, superseded, missing successor, never return future records |
| consolidator | Merging and de-duplicating memories |
| injection-budget | Budget for what goes into the context window |
| host entry points | The concrete `registerTool` / `promptSections` / `storage` |

Their design is described in [architecture.md](architecture.md). To plug into your own host, implement the thin layer described below.

## 2. What the host has to provide (the minimum contract)

```js
// 1) Storage: one directory; the memory lives under plugin-data/biomimetic-memory/
const dataDir = '/path/to/data'

// 2) Tool registration: functions the model can call
registerTool({ id, name, description, parameters, execute(ctx, args) })

// 3) Prompt assembly: add blocks to the system prompt every turn
buildPrompt(ctx) -> string

// 4) Scheduling: once a day "her own time", a daily backup, a weekly summary
schedule(cron, fn)

// 5) Model calls (optional): distilling self-descriptions, preference judgements
llm(messages) -> string
```

How the pieces map:

| QQ Agent | Your host |
|---|---|
| `api.registerTool` | your tool table |
| `api.storage` | any key-value store (this project just uses files) |
| `promptSections` / before-context injection | your system-prompt assembly |
| `api.log` / `api.warn` | your logger |
| `ctx.chatKey` | the conversation id (**required**; privacy isolation depends on it) |

If your host speaks MCP (Claude Desktop, Claude Code, Cursor, …) you can skip most of this: `npx -y -p whale-memory-core whale-memory-mcp --data <dir>` exposes the memory as tools. See [adapters/mcp/README.md](../../../adapters/mcp/README.md).

## 3. The smallest useful setup (no QQ needed)

```sh
npm install whale-memory-core
```

> The package name ends in `-core`. The unscoped `whale-memory` package on npm belongs to someone else.

```js
import { selfExperience as exp } from 'whale-memory-core'

const dir = './data/plugin-data/biomimetic-memory'

// She writes down an experience
const e = exp.addExperience(dir, {
  text: 'Read the barbecue scene and laughed a little',
  scene: 'A bit after eleven at night, the room very quiet',
  feeling: ['relaxed', 'a little envious'],
  thought: 'Good things like that only happen in books',
  quote: { text: 'Then let me make you fall for me again, for a hundred years', source: 'the novel she was reading' },
  weight: 'important'
})

// The next day she remembers it
const hits = exp.recall(dir, 'barbecue scene', { limit: 1 })
console.log(hits.length ? exp.renderTwoPart(hits[0], { lang: 'en' }) : 'No record of that.')

// She changes her mind (what she wrote "then" is never changed)
exp.reviseExperience(dir, { id: e.id, thought: 'Now I think he was protecting his friend' })
```

`renderTwoPart` prints Chinese labels by default (the original character speaks Chinese); pass `{ lang: 'en' }` for English labels. Recall of English text matches whole words, so queries should share words with what was written.

A complete runnable example is `packages/core/demo.mjs` (no host needed; `node demo.mjs`). For a step-by-step walkthrough see the [30-minute tutorial](../../tutorial.md) (Chinese).

## 4. Privacy rules (do not skip this)

These are not optional optimisations; they decide whether this is safe to give to anyone:

1. **Every conversation carries a chatKey**, and every read is filtered by it.
2. **Her own experiences** may cross conversations; **other people's private matters** never do.
3. **The diary is only for one-to-one chats** (this project only allows the owner's private chat); never inject it into group chats.
4. The waking block is likewise injected only in one-to-one chats, so yesterday's private words never reach a group.
5. Cross-conversation recall should write an audit log (which record, from where to where), so problems can be traced.
6. **An empty recall means there is no record.** Tell the model to say it does not remember. A non-empty recall only means she wrote about something related; the details in the question still have to be checked against the record. See [eval.md](../../eval.md).

## 5. Plugging into DSH (an outline)

A DSH skill is `SKILL.md` plus scripts; it does not need QQ Agent's plugin API:

1. Put `packages/core/lib/*` into your skill directory.
2. Write a skill script that exposes, through DSH's tool registration:
   - `self_experience_write` / `read` / `revise`
   - `self_prompt_read` / `set` / `history`
   - `self_settings_read` / `set`
3. In every turn's system prompt, call the equivalents of `renderTwoPart` / `self-prompt.render` / `self-memory.renderBlock`.
4. Use DSH's scheduled tasks for "her own time" and the daily backup.

A ready-made DSH example lives in `examples/dsh-plugin/`.

## 6. Things not to copy blindly

- QQ numbers, paths, OneBot configuration: re-check them for your host.
- Scheduled tasks (`schtasks`): on Linux / macOS use cron or a systemd timer.
- Anything that needs QQ conversation keys (`private_*` / `group_*`): that belongs in the host layer, not in the core library.

## 7. Acceptance checklist

After porting, verify at least:

```
[ ] Write an experience → read it back; the "then" fields are complete
[ ] Change your mind → one more "later" entry; "then" is unchanged
[ ] The next day (same conversation) the waking block shows yesterday's experience
[ ] Group chat / another conversation → the diary cannot be read
[ ] Fake-memory probe: ask about 5 things that never happened; all answers are "I don't remember"
[ ] Privacy canary: a code word is findable in the owner's private chat and not findable in a group chat
[ ] npm run eval: leaks 0, "then" byte-identical
```

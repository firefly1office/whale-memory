# Evidence policy (open-source subset)

> Translated from the Chinese original ([中文](../evidence.md)). If they disagree, the Chinese version is authoritative.

[中文](evidence.md) · English

`packages/core/lib/evidence-policy.js` is a **testable subset** of evidence-policy in the full engine: it only judges, it does not store. It answers three questions — **as-of** (what was known at that moment), **superseded** (what the old value was, and what replaced it), and **absence of successor** (whether there is any newer record after it).

## Why it is broken out on its own

`architecture.md` described these three things, but the public repository originally had not one line of code for them. With only a document, an outside reader has no way to judge whether "evidence first" is a design or a slogan. This subset writes the judgement as pure functions; with a fixture it runs.

It is not the full vault: it stores no data, builds no index, and does not touch sessions. `fact` is a generic structure, and it is a different layer from `then/later`:

| | Experience (then/later) | Fact (fact) |
| --- | --- | --- |
| Who wrote it | She herself | The host extracts it from records |
| Shape | A piece of experience + the view at the time | `{subject, slot, value, at}` |
| Use | Persona continuity | Answering "what did she think then / where did he go" |
| Overwriting | Never overwritten | Can be superseded via `supersedes` |

## Usage

```js
import { query, hasSuccessor, render } from 'whale-memory-core/evidence-policy'

const verdict = query(facts, { subject: 'her', slot: 'mood', at: '2026-11-11T00:00:00+08:00' })
// { status: 'known', value: '闷', fact, evidence: [...], reason: ... }
// or { status: 'unknown', reason: '截至该时间没有记录', evidence: [] }

render(verdict) // "闷 · 2026-11-10（日记）" or "没有记录：截至该时间没有记录"
```

## Four rules

1. **as-of only accepts records that already held at that moment**: a supersession that only happens in the future does not count.
2. **The old value does not disappear**: `evidence` keeps the supersession chain, and `reason` states it plainly — "有后续记录，旧值被取代" ("there is a later record; the old value was superseded").
3. **When there is nothing, say plainly there is nothing**: it does not return "possible" or "probably"; `status` is only `known` / `unknown`.
4. **Contradictions at the same moment are stated as impossible to tell**: for the same `slot`, the same time, different values and no explicit supersession, it returns `unknown` and puts both in `evidence` — it does not pick one for her by id order.

## Tests

`tests/evidence-policy.test.mjs` covers: before and after the as-of point, the supersession chain, no record, future records not counting, absence of successor, and bad time input.

## Wiring it onto your own data

1. Extract `{subject, slot, value, at, source}` from `then.quote` / `then.state` / the diary
2. When she changes her mind, the new fact carries `supersedes: <old id>`
3. Pass `at` when querying (usually "now", or some point in the conversation)
4. Give the result of `render()` to the model; do not assemble your own "it should be"

## A ready-made bridge: extracting facts from her experiences

`evidence-from-experience.js` extracts only the two things that have a source; it does not infer:

```js
import * as bridge from 'whale-memory-core/evidence-from-experience'

const facts = bridge.factsFromExperiences(experiences)
// mood snapshot → { slot: 'mood', value: '闷', at, source: 'then.state' }
// source-text anchor → { slot: 'quote:《灯塔》第2章', value: '灯还亮着', at, source: 'then.quote' }

bridge.ask(experiences, { slot: 'mood', at: '2026-11-11T00:00:00+08:00' })
// known / unknown, no guessing
```

A mood that was not recorded, a thought with no source-text anchor — neither turns into a fact; the bridge only carries across what already exists.

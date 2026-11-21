# Fact timeline (timeline)

> Translated from the Chinese original ([中文](../timeline.md)). If they disagree, the Chinese version is authoritative.

When the same thing has been said several times, the memory ends up with several "versions". This contract answers three different questions and does not stuff them into one field:

| Axis | What it answers | Fields |
| --- | --- | --- |
| Value axis (world time) | When, in the world, this thing was true | `validFrom` / `validUntil`, interval `[from, until)`, `until=null` means still true |
| Knowledge axis (record time) | When she learned it, and when she stopped thinking so | `factVersionAt` (start) / `invalidatedAt` (end) |
| Order axis (version) | Who comes after whom in the same slot | `version` (position in the chain, consecutive from 1) |

Why split them: if a single `validUntil` carries all three meanings at once, the reader can never tell "the fact expired" from "she changed her view".

**Why the order axis does not use timestamps**: clocks cannot be trusted (seconds and milliseconds mixed, several records in the same second, backfilled old events), while append order can always be trusted. `version` is exactly the ordering device prepared for "do not trust the clock".

## Usage

```js
import { applySuccession, validateLineage, planChainVersions } from 'whale-memory-core/timeline'

// A successor replaces a predecessor: what each side gets filled in
applySuccession(before, after, { reason: 'correction' })
// before.invalidatedAt = after.factVersionAt
// after.version = before.version + 1 (a chain head counts as 1)

// Validate one chain
const issues = validateLineage(chainRows)   // [] means it passes

// Migration: number the existing chains (pointers first; if that fails, fall back to time order and flag it)
const plan = planChainVersions(chainRows)
// plan.orderBy === 'pointer' | 'time'
// plan.patches is the field each record should get filled in with; plan.issues is why an order could not be worked out
```

## Invariants

- **I1** Within one `lineageId`, `version` is unique, consecutive from 1, with no gaps
- **I2** The `invalidatedAt` of a superseded record equals the successor's `factVersionAt`
- **I3** The successor's `revisionOf` points to the predecessor, and the predecessor's `supersededById` points to the successor
- **I4** `supersedeReason` may only be `update | correction | expiry | retraction | dedupe | unknown`
- **I5** When pointers form a cycle or the chain is broken, `planChainVersions` reports it instead of silently ordering things wrong

## What it does not do

- **Does not write the value axis**: `validFrom` / `validUntil` must come from evidence or a human decision; it cannot invent a validity period for a record just because a later record was seen
- Does not merge facts, does not delete records, does not call a model
- Does not assume a monotonic clock: it orders only by pointer or by an explicit sort

## Tests

`tests/timeline-contract.test.mjs`, 16 items: sequence numbers, supersession patches, chain-head numbering, each branch of validation, migration planning, cycles, empty chains.

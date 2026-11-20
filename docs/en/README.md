# Documentation (English)

All user-facing documents now have an English version. Where an English and a Chinese
version disagree, the Chinese version is authoritative — each English file links back to
its source.

| Document | What it answers |
|---|---|
| [architecture](architecture.md) | Layers, evidence policy, recall/write constraints; what ships and what does not |
| [backup](backup.md) | The seven files plus her drawer, and how to verify after restore |
| [composition](composition.md) | Using it with a vector/RAG retrieval layer |
| [cross-room-memory](cross-room-memory.md) | Whose words may travel between rooms, and why redaction happens before the prompt |
| [eval](eval.md) | How accuracy is measured, dev vs held-out, what it cannot measure |
| [evidence](evidence.md) | Evidence status: as-of, superseded, missing successor |
| [injection](injection.md) | Seven rules for when to hand a memory back, a minimal implementation, anti-patterns |
| [limits](limits.md) | Measured scale, plaintext storage, what "delete" means |
| [metrics](metrics.md) | What is measured, on what basis, and how to run it yourself |
| [pitfalls](pitfalls.md) | Things that will disappoint you, stated up front |
| [porting](porting.md) | Putting this memory into another host |
| [related-work](related-work.md) | What we borrowed, what we changed, what we deliberately did not do |
| [runbook](runbook.md) | Operations: backup, restore drill, what to do when something breaks |
| [schema](schema.md) | Every field of an experience, events, and the timeline |
| [storage-events](storage-events.md) | Experiences are facts; recall and changes of mind are events |
| [threat-model](threat-model.md) | Who can reach her memory, and how it is guarded |
| [timeline](timeline.md) | Fact timeline: value axis, knowledge axis, ordering |
| [tutorial](tutorial.md) | Write, recall, change your mind, wake up, seal, her book, wire into a host |

The technical report ([docs/paper/README.md](../paper/README.md)) is a Chinese PDF; the numbers
and known issues it reports are also stated in [eval](eval.md) and [pitfalls](pitfalls.md).

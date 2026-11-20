# Metrics: measuring "is she growing"

> Translated from the Chinese original ([中文](../metrics.md)). If they disagree, the Chinese version is authoritative.

[中文](metrics.md) · English

This project **does not take recall accuracy as its goal**. How high the recall rate is depends on how the question is asked, and "has she changed" is what this project really cares about.

`tools/metrics.mjs` only reads the data directory, and computes the numbers below:

```sh
node tools/metrics.mjs --data=/path/to/data
node tools/metrics.mjs --data=/path/to/data --json
```

## What each metric is asking

| Metric | Formula | What it is asking | What "better" means |
| --- | --- | --- | --- |
| Share with later notes | experiences with a `later` / total experiences | how many experiences she came back and added a sentence to | only says a later note exists, not that she "changed her view" |
| Share recalled | experiences with `recalls > 0` / total experiences | whether what she wrote was ever fetched back by the host | only says it was fetched back, not that it was useful |
| Total recalls | the sum of all `recalls` | the intensity of retrieval | — (reference only; not worth chasing high) |
| Unfinished | `then.unfinished` non-empty | whether she left a thread of "I want to keep thinking about this" | there is continuity |
| With a source-text anchor | `then.quote.text` non-empty | whether there is original text behind a thought that can be checked | it can be evidenced, not just an impression |
| Diary / experience ratio | number of diary entries / number of experiences | the ratio of what she writes privately to what she writes in "her own time" | the ratio itself is neither good nor bad; if it skews, ask why |
| Prompt versions | number of overlay versions | how often she changes herself | changing too often means she has not thought it through; not changing for a long time may mean there is no permission |
| Damaged lines | number of JSONL lines that fail to parse | data integrity | must be 0 |

## Why there is no "recall accuracy"

- Recall is a **means**: what she is looking for is "what I thought at the time", not a "retrieval hit rate"
- Measuring recall with a fixed set of questions and answers would push optimization toward "pleasing the test cases"
- What really needs guarding against is **fabrication**: if there is no record, say there is none. That is covered by the empty-query cases in `tools/eval-recall.mjs`, not by accuracy

## How to read these numbers

- Change-of-mind rate at 0 for a long time: she only writes and never looks back. Either recall is not wired up, or what she writes has nothing to do with her
- Recall rate very high but change-of-mind rate very low: recall keeps going over the same batch of old things and produces no new view
- Low share with a source-text anchor: thoughts have no source, and after enough time it is impossible to tell a memory from an impression
- Prompt versions spiking: she is changing herself frequently, and the prompts may be fighting each other

Metrics are not KPIs. They answer only one question: **do these records actually make her more like a continuous person?**

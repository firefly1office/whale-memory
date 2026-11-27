# 真向量接入（`ranker: 'embed'`）

> 2026-11-27（阶段 5 · S5；N1 补强适配器）。状态：**通路通了、适配器补齐了，真模型仍没接上**——
> 本机没有 Ollama，评测里的 embed 仍是桩。这一页写清楚：怎么接、桩和真向量怎么区分、哪些数字不能当结论。

## 一、这一版到底有什么

1. **注入通路**：`recall(dir, query, { ranker: 'embed', embed, embedKind })`。
   `embed` 是 `text → Float64Array` 的**同步**函数；`embedKind` 是标签（模型名）。
2. **命中自报家门**：每条命中带 `embedKind`。不注入时是 `stub:char-ngram-hash`——
   看见这个标签就知道"这不是语义效果，是换了一种相似度"。
3. **本地 Ollama 适配器**：`tools/ollama-embed.mjs`（零依赖，Node 内置 fetch）。
   - `probe`：看 Ollama 在不在、模型有没有，并**真的问一条向量量出 dim**——返回
     `{ available, model, dim }`；拿不到就是 `dim:null` + `reason`，不编维度；
   - `warm`：把文本批量喂给 Ollama，向量落进磁盘缓存（`<cache>.jsonl`，一行一条，原子替换）；
     同文本只请求一次，落盘前做维度/归一化校验；
   - `embed(texts, { file, model, dim })`：**带内容哈希缓存的批量取向量**——键 = `sha256(模型名 + '\n' + 文本)`
     前 32 位；缓存里已有的不请求，同一次调用里重复的文本只请求一次；
   - `makeCachedEmbedder({file, model, dim})`：返回**同步**的 `embed`，只查缓存；缺了抛
     `EMBED_CACHE_MISS`——**不偷偷退回桩**（那会让"真语义"这句话变成假的）。
   - **维度/归一化校验 fail closed**：回来的向量长度对不上（或同批长短不一）、含 NaN/Infinity、零向量没法归一化，
     一律抛 `EMBED_DIM_MISMATCH` / `EMBED_BAD_VECTOR`，**一个字节都不写缓存**。cosine 遇到长短不一
     会静默返回 0、把候选排到后面——那比报错还坏，所以这里宁可红。
4. **评测接线**：`node tools/eval-v2.mjs --ranker=embed --embed-cache=<file>`（用预热好的缓存）或
   `--ranker=embed --embed-live`（现场 probe 本机 Ollama）。报告开头会明写
   `embed 后端：真向量（bge-m3，dim=1024，缓存 N 条）` 或
   `桩（stub:char-ngram-hash）——未接入真模型，embed 那一行不能当语义效果看`。
   缓存不全时直接退出 3（缺多少条写 stderr），不静默退回桩。

为什么拆成"异步预热 + 同步查询"：`recall` 是同步 API（宿主不用改一行），HTTP 是异步的；
core 也不该在默认路径上联网。所以预热是工具，查询是纯查表。

## 二、怎么接上真模型（有 Ollama 的机器）

```bash
ollama pull bge-m3
node tools/ollama-embed.mjs probe                                  # 应该输出 available:true / dim:1024
node tools/ollama-embed.mjs warm --from-eval-v2 --cache=dev/embed-cache.jsonl
node tools/eval-v2.mjs --ranker=embed --embed-cache=dev/embed-cache.jsonl
```

懒人版（不落缓存，现场 probe + 预热 + 跑一遍）：

```bash
node tools/eval-v2.mjs --ranker=embed --embed-live
```

`--from-eval-v2` 会拿评测语料的 200 条正文 + 用例里的全部查询 + 「上下文 + 追问」的组合去预热（同一个文本只取一次，
内容哈希去重）。预热时如果服务回的维度和你钉的 `--dim` 不一致，直接失败、不留半份缓存。

## 三、这一轮的实际结果（本机，无 Ollama）

- `node tools/ollama-embed.mjs probe` → `available:false`、`dim:null`（连不上 127.0.0.1:11434），
  结论行：**未接入真模型（Ollama 不可用）——评测里的 embed 仍是桩**；
- `node tools/eval-v2.mjs --ranker=embed` 照旧跑桩：**不是**语义效果。三组数（literal / hybrid / embed）
  见 CHANGELOG 里 0.27.0 的记录；这一版没有让这三个数字变好，只是把它们标清楚了；
- `node tools/eval-v2.mjs --ranker=embed --embed-live` 在本机照实打桩并在 stderr 写明原因，退出码仍 0
  （评测本身跑得完，报告里 `embed.reason` 带着"环境不具备"）；
- **假模型下适配器行为正确**：`tests/embed-adapter.test.mjs` 7 条全绿（probe 带维度 / 内容哈希缓存 /
  维度不符 fail closed / NaN 与零向量 fail closed / 归一化 / CLI 探活 / 评测三条路）。证明的是适配器，
  **不是 bge-m3 的中文效果**；
- 真模型的三组数**没有**：环境不具备。有 Ollama 的机器按第二节跑一遍即可，命令是现成的。

## 四、桩怎么区分（不许混淆）

| 位置 | 桩 | 真向量 |
| --- | --- | --- |
| 命中字段 `embedKind` | `stub:char-ngram-hash` | `ollama:bge-m3` |
| 评测报告首行 | `桩（stub:char-ngram-hash）——未接入真模型` | `真向量（bge-m3，dim=1024，缓存 N 条）` |
| `--json` 的 `out.embed` | `{connected:false, kind:'stub:char-ngram-hash', note:'桩：未接入真模型…'}` | `{connected:true, kind:'ollama:bge-m3', dim:1024, cacheSize:N}` |

## 五、缓存与失败口径

- 缓存键 = `sha256(模型名 + '\n' + 文本)` 前 32 位（**内容哈希**：同文本同模型永远同一个键）；值 = 向量（保留 6 位小数）；
- 缓存文件坏了：坏行计数、好行照用（缓存不是真相来源，重新预热即可）。坏行的判法包括 JSON 坏、
  `dim` 字段与 `vec.length` 不符、向量含 NaN——坏向量不许进排序；
- **维度校验 fail closed**：单条回来的长度和期望不符、同一批里长短不一、缓存自身维度混了，都抛
  `EMBED_DIM_MISMATCH`，并且不写缓存；拿不到 Ollama 时 `probe` 返回 `available:false` + 原因，
  `warm` 抛 `EMBED_UNAVAILABLE` 且**不建缓存文件**；
- **归一化校验**：向量必须有限、范数 > 0；出去的一律是单位长度（老缓存里没归一化的在读取时归一化）；
  NaN / Infinity / 零向量抛 `EMBED_BAD_VECTOR`；
- 评测里如果给了 `--embed-cache` 但缓存不全，**直接退出 3** 并说缺多少条——宁可红，不静默用桩；
- 缓存是**明文**的：向量本身能反推出一些语义方向，和记忆正文放一起。别把它放到别人能读的地方。

## 六、默认关怎么证明

1. 不传 `ranker` 时字面检索一个字节没改（原有 769 条用例全过，含 `tests/embed-recall.test.mjs` 的
   "默认关时与 0.26.3 逐字相同"）；
2. `embed` 只在 `ranker: 'embed'` 分支里被调用；不注入就是 `hashEmbed`，**不联网**（core 里没有 fetch/http）；
3. `tools/ollama-embed.mjs` 只有被 CLI 或评测显式引用时才跑；宿主不接就没有任何请求。

## 七、没验什么

- **没有真 Ollama**：HTTP 通路只用本地假服务（127.0.0.1 随机端口）验过形状、顺序、缓存复用与失败口径；
  bge-m3 的真实维度、真实相似度、真实中文效果**一条都没验**；
- 没有真模型的三组数（见第三节）；
- 缓存没有并发写保护（多个进程同时 `warm` 可能互相覆盖；最后写入者赢）；
- 没有把向量接进写路径（每次召回都要现查缓存；记录正文变了要重新预热，键含文本所以不会错配）；
- 没有做向量存储/索引（几万条时每次召回都要把所有文本查一遍缓存，`Map` 查表还行，但内存里存全量向量不划算）；
- Ollama 的不同版本接口差异（`/api/embeddings` 老接口 vs `/api/embed` 新接口）只用了老接口；
- 非 Windows / 非 Node 24 未跑。
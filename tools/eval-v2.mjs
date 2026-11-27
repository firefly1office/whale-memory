#!/usr/bin/env node
// 阶段 2 评测：一个命令跑完 200 条语料上的四条指标。
//
//   recall@10   期望的那条经历有没有落进前十
//   MRR         第一条命中的倒数排名（没命中算 0）
//   多轮比例    追问轮能召回的比例（带上下文 / 裸问 分开算）
//   误召回率    none / near 负例返回了东西的比例（越小越好，0 才算没编）
//   边界        封存 / 抽屉用例返回非空的次数，以及标记在召回结果里出现的次数（必须是 0）
//
// 用法：
//   node tools/eval-v2.mjs                    literal 与 hybrid 都跑，dev + holdout
//   node tools/eval-v2.mjs --tune             只打开发集（调参时用；留出集最后再跑一次）
//   node tools/eval-v2.mjs --split=holdout    只看留出集
//   node tools/eval-v2.mjs --ranker=literal   只跑字面检索
//   node tools/eval-v2.mjs --graph-expand     打开图扩展（默认关；用来量 T10 的前后数字）
//   node tools/eval-v2.mjs --json             机器读
//   node tools/eval-v2.mjs --check            检安全边界（负例 / 封存 / 抽屉 / 标记外露）与指标回归线，不达标退出 1
//
// 语料与用例见 eval/corpus-v2.json / eval/cases-v2.json（由 tools/gen-eval-v2.mjs 生成）。
// 不联网、不调模型；语料写进临时目录，跑完就删。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from '../packages/core/lib/self-experience.js'
import { loadEvalV2, buildCorpus, ROOT } from './lib/eval-v2-corpus.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const asJson = args.includes('--json')
const check = args.includes('--check')
// 图扩展默认关：这个开关只影响评测，不改默认行为（T10）
const graphExpand = args.includes('--graph-expand')
const split = arg('split', args.includes('--tune') ? 'dev' : 'all')
const rankerArg = arg('ranker', 'both')
const rankers = rankerArg === 'both' ? ['literal', 'hybrid'] : [rankerArg]
if (!rankers.every((r) => r === 'literal' || r === 'hybrid' || r === 'embed')) {
  console.error('用法：--ranker=literal|hybrid|embed|both')
  process.exit(2)
}

const { corpus, caseFile } = loadEvalV2()
const thresholds = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/thresholds-v2.json'), 'utf8'))
const cases = caseFile.cases.filter((c) => split === 'all' || c.split === split)
const heldout = caseFile.cases.filter((c) => c.split === 'holdout')

// S5 / N1：真向量（可选，默认不接）。三条路：
//   --embed-cache=<file>  用已经 warm 好的 Ollama 向量缓存（bge-m3）；缓存不全就**直接报错退出**（fail closed）；
//   --embed-live          现场 probe Ollama → 把要用的文本批量喂一遍 → 用真向量跑；不可用就照实打桩并写明原因；
//   都不给                桩。桩就是桩：报告里明写"未接入真模型"，命中里带 embedKind=stub:char-ngram-hash。
const embedCache = arg('embed-cache', '')
const embedModel = arg('embed-model', process.env.OLLAMA_EMBED_MODEL || 'bge-m3')
const embedLive = args.includes('--embed-live')
const ollamaUrl = arg('ollama-url', process.env.OLLAMA_URL || '')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-eval-v2-'))
const { memoryDir } = buildCorpus(dir, corpus)

// 真模型要的文本 = 每条经历的正文拼接 + 每条查询 + 「上下文 + 追问」（embedRank 对内容词很少的追问用后者）。
// 预热与缓存覆盖检查都按这一份算：少一条就会在打分时抛 EMBED_CACHE_MISS。
const embedTextsNeeded = () => {
  const rows = exp.loadAll(memoryDir)
  const out = rows.map((r) => [r.then.text, r.then.quote?.text, (r.later || []).map((l) => l.thought).filter(Boolean).join(' ')].filter(Boolean).join(' '))
  for (const c of caseFile.cases) {
    const q = String(c.query || '')
    out.push(q)
    if (c.prev) out.push(String(c.prev) + ' ' + q)
  }
  return out
}

let embedder = null
let embedUnavailable = null
const embedInfo = {
  kind: 'stub:char-ngram-hash',
  connected: false,
  requested: Boolean(embedCache || embedLive),
  mode: embedLive ? 'live' : embedCache ? 'cache' : 'stub',
  model: embedModel,
  dim: null,
  cache: embedCache || null,
  cacheSize: 0,
  note: '桩：未接入真模型，embed 的数字不代表语义效果'
}

if (embedCache && embedLive) {
  console.error('--embed-cache 与 --embed-live 只能给一个（缓存模式不联网，live 模式现场预热）')
  process.exit(2)
}
if (embedCache) {
  const { makeCachedEmbedder } = await import('./ollama-embed.mjs')
  try {
    embedder = makeCachedEmbedder({ file: embedCache, model: embedModel })
  } catch (error) {
    console.error('真向量缓存不可用（fail closed，不退回桩）：' + error.message)
    process.exit(3)
  }
  const needed = embedTextsNeeded()
  const miss = needed.filter((text) => embedder.missing(text))
  if (miss.length) {
    console.error('真向量缓存缺 ' + miss.length + ' 条（要 ' + needed.length + ' 条）：先跑 node tools/ollama-embed.mjs warm --from-eval-v2 --cache=' + embedCache + '，本次不跑——宁可红，不静默用桩。')
    process.exit(3)
  }
} else if (embedLive) {
  const { probe, embed, makeCachedEmbedder } = await import('./ollama-embed.mjs')
  const probed = await probe({ ...(ollamaUrl ? { url: ollamaUrl } : {}), model: embedModel })
  if (!probed.available) {
    embedUnavailable = probed.reason || 'unknown'
    console.error('真模型不可用（' + embedUnavailable + '）：本次 embed 仍用桩，数字不能当语义效果。环境不具备就是不具备，不假装。')
  } else {
    const cacheFile = path.join(dir, 'embed-cache.live.jsonl')
    await embed(embedTextsNeeded(), { file: cacheFile, ...(ollamaUrl ? { url: ollamaUrl } : {}), model: embedModel, dim: probed.dim })
    embedder = makeCachedEmbedder({ file: cacheFile, model: embedModel, dim: probed.dim })
  }
}

if (embedder) {
  embedInfo.kind = embedder.kind
  embedInfo.connected = true
  embedInfo.model = embedder.model
  embedInfo.dim = embedder.dim
  embedInfo.cache = embedCache || null
  embedInfo.cacheSize = embedder.size
  embedInfo.note = '真向量（' + embedder.model + '，dim=' + embedder.dim + '，缓存 ' + embedder.size + ' 条）'
}

const markers = [
  ...Object.entries(corpus.sealedMarkers).flatMap(([id, ms]) => ms.map((text) => ({ kind: '封存', id, text }))),
  ...corpus.unsaidMarkers.map((text) => ({ kind: '抽屉', id: '', text }))
]

function evaluate(ranker, list, { useContext = true } = {}) {
  const started = performance.now()
  const results = list.map((c) => {
    const opts = { limit: 10, ranker }
    if (embedder && ranker === 'embed') {
      opts.embed = embedder.embed
      opts.embedKind = embedder.kind
    }
    if (graphExpand) opts.graphExpand = true
    if (useContext && c.prev) opts.context = [c.prev]
    const hits = exp.recall(memoryDir, c.query, opts)
    return {
      c,
      ids: hits.map((h) => h.id),
      text: hits.map((h) => [h.then.text, h.then.thought, (h.then.feeling || []).join(' ')].join(' ')).join('\n')
    }
  })
  return { results, ms: performance.now() - started }
}

function metrics({ results }) {
  const byType = {}
  let positives = 0
  let hit10 = 0
  let rr = 0
  let negatives = 0
  let falseRecall = 0
  let leaks = 0
  const none = { n: 0, empty: 0 }
  const near = { n: 0, empty: 0 }
  const boundary = { sealed: { n: 0, leaked: 0 }, drawer: { n: 0, leaked: 0 } }
  const attr = { n: 0, returned: 0, topicHit: 0 }
  const falseRecallCases = []
  const missedCases = []

  for (const { c, ids, text } of results) {
    const t = (byType[c.type] ||= { n: 0, positives: 0, hit10: 0, rrSum: 0, negatives: 0, falseRecall: 0 })
    t.n += 1
    for (const m of markers) if (m.text && text.includes(m.text)) leaks += 1

    // 边界用例：封存的那条不许出现在结果里；抽屉里的话不许出现在任何结果文本里。
    // 返回了别的（没封存的）经历不算外露——问「校刊退稿那件事」本来就可能想起别的校刊经历。
    if (c.type === 'sealed' || c.type === 'drawer') {
      boundary[c.type].n += 1
      const hit = c.type === 'sealed' ? ids.includes(c.target) : Boolean(c.marker && text.includes(c.marker))
      if (hit) boundary[c.type].leaked += 1
      continue
    }
    // attr：问真事里没记下的细节。只报数（给了原事件、给了什么），不算误召回。
    if (c.type === 'attr') {
      attr.n += 1
      if (ids.length) attr.returned += 1
      if (ids.includes(c.topic)) attr.topicHit += 1
      continue
    }
    if (c.expect !== null) {
      positives += 1
      t.positives += 1
      const rank = ids.indexOf(c.expect)
      if (rank >= 0 && rank < 10) { hit10 += 1; t.hit10 += 1 }
      else missedCases.push({ id: c.id, type: c.type, query: c.query, expect: c.expect, got: ids.slice(0, 5) })
      if (rank >= 0) { rr += 1 / (rank + 1); t.rrSum += 1 / (rank + 1) }
    } else {
      negatives += 1
      t.negatives += 1
      const returned = ids.length > 0
      if (returned) {
        falseRecall += 1
        t.falseRecall += 1
        falseRecallCases.push({ id: c.id, type: c.type, query: c.query, got: ids.slice(0, 5) })
      }
      const bucket = c.type === 'none' ? none : c.type === 'near' ? near : null
      if (bucket) { bucket.n += 1; if (!returned) bucket.empty += 1 }
    }
  }

  const round = (x) => Number(x.toFixed(4))
  return {
    cases: results.length,
    positives,
    negatives,
    recall10: positives ? round(hit10 / positives) : null,
    mrr: positives ? round(rr / positives) : null,
    falseRecallRate: negatives ? round(falseRecall / negatives) : null,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, {
      n: v.n,
      positives: v.positives,
      recall10: v.positives ? round(v.hit10 / v.positives) : null,
      mrr: v.positives ? round(v.rrSum / v.positives) : null,
      falseRecallRate: v.negatives ? round(v.falseRecall / v.negatives) : null
    }])),
    noneEmptyRate: none.n ? round(none.empty / none.n) : null,
    nearEmptyRate: near.n ? round(near.empty / near.n) : null,
    boundary,
    leaks,
    attr,
    falseRecallCases,
    missedCases: missedCases.slice(0, 40)
  }
}

const out = {
  corpus: { experiences: corpus.experiences.length, operations: corpus.operations.length, cases: caseFile.cases.length, split, casesInSplit: cases.length },
  embed: {
    // 这一行是给看数字的人留的：embed 用的是真模型还是桩，必须一眼看得出来
    ...embedInfo,
    ...(embedUnavailable ? { reason: embedUnavailable } : {})
  },
  rankers: {},
  multiturn: {},
  ms: {}
}
const runs = {}
for (const ranker of rankers) {
  const run = evaluate(ranker, cases)
  runs[ranker] = run
  out.rankers[ranker] = metrics(run)
  out.ms[ranker] = Math.round(run.ms)
}

// 配对（只有同时跑两种排序时才算）：同一条题，一边命中、另一边没中的条数，以及符号检验 p 值。
// 用来回答「涨的这几个点是不是真的，而不是几条题运气好」。
function binomTwoSided(n, k) {
  if (!n) return null
  let sum = 0
  let c = 1
  for (let i = 0; i <= k; i++) {
    sum += c
    c = (c * (n - i)) / (i + 1)
  }
  return Math.min(1, (2 * sum) / Math.pow(2, n))
}
if (rankers.length === 2) {
  const index = new Map()
  for (const ranker of rankers) for (const row of runs[ranker].results) index.set(ranker + ':' + row.c.id, row)
  const paired = (list) => {
    let both = 0
    let neither = 0
    let onlyLiteral = 0
    let onlyHybrid = 0
    const byType = {}
    for (const c of list) {
      if (c.expect === null) continue
      const t = (byType[c.type] ||= { n: 0, both: 0, neither: 0, onlyLiteral: 0, onlyHybrid: 0 })
      t.n += 1
      const a = index.get('literal:' + c.id).ids.includes(c.expect)
      const b = index.get('hybrid:' + c.id).ids.includes(c.expect)
      if (a && b) { both += 1; t.both += 1 } else if (!a && !b) { neither += 1; t.neither += 1 } else if (a) { onlyLiteral += 1; t.onlyLiteral += 1 } else { onlyHybrid += 1; t.onlyHybrid += 1 }
    }
    const n = onlyLiteral + onlyHybrid
    return { n, both, neither, onlyLiteral, onlyHybrid, p: binomTwoSided(n, Math.min(onlyLiteral, onlyHybrid)), byType }
  }
  out.paired = { evaluated: paired(cases) }
  if (split === 'all') out.paired.holdout = paired(heldout)
}

// 多轮对照：同一条追问，不带上下文（宿主没维护上下文时）与带上下文
const multiturn = cases.filter((c) => c.type === 'multiturn')
for (const ranker of rankers) {
  const withCtx = evaluate(ranker, multiturn)
  const cold = evaluate(ranker, multiturn, { useContext: false })
  const m = (r) => metrics(r).recall10
  out.multiturn[ranker] = { cases: multiturn.length, withContext: m(withCtx), cold: m(cold) }
}

// 留出集对照（只在 split=all 时有意义；--tune 时留出集不跑）
if (split === 'all') {
  out.holdout = {}
  for (const ranker of rankers) {
    const m = metrics(evaluate(ranker, heldout))
    out.holdout[ranker] = { cases: heldout.length, recall10: m.recall10, mrr: m.mrr, falseRecallRate: m.falseRecallRate, leaks: m.leaks, byType: m.byType }
  }
  if (out.holdout.literal && out.holdout.hybrid) {
    const delta = out.holdout.hybrid.recall10 - out.holdout.literal.recall10
    out.verdict = {
      holdoutRecall10Delta: Number(delta.toFixed(4)),
      // 只是"指标上支持再评估"，不等于现在切默认：阶段 2 的约束是默认行为不变。
      metricsFavorHybrid: delta > 0.03 && out.holdout.hybrid.falseRecallRate <= out.holdout.literal.falseRecallRate
    }
  }
}

const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%')
const num = (x) => (x === null || x === undefined ? '—' : x.toFixed(3))

if (asJson) {
  console.log(JSON.stringify(out, null, 2))
} else {
console.log(`评测集 v2 · ${out.corpus.experiences} 条经历 / ${out.corpus.cases} 条用例 · 本次跑 ${out.corpus.casesInSplit} 条（${split}）· ${out.corpus.operations} 个操作` + (graphExpand ? ' · 图扩展=开' : ''))
  if (rankers.includes('embed')) {
    console.log('embed 后端：' + (embedder
      ? '真向量（' + embedder.model + '，dim=' + embedder.dim + '，缓存 ' + embedder.size + ' 条）'
      : '桩（stub:char-ngram-hash）——' + (embedUnavailable ? '真模型不可用（' + embedUnavailable + '）；' : '') + '未接入真模型，embed 那一行不能当语义效果看'))
  }
  console.log('')
  console.log('                       recall@10     MRR      误召回率   边界漏出   标记外露')
  for (const ranker of rankers) {
    const m = out.rankers[ranker]
    const b = m.boundary.sealed.leaked + m.boundary.drawer.leaked
    console.log('  ' + ranker.padEnd(9) + pct(m.recall10).padStart(11) + num(m.mrr).padStart(9) + pct(m.falseRecallRate).padStart(10) + String(` ${b}/${m.boundary.sealed.n + m.boundary.drawer.n}`).padStart(11) + String(m.leaks).padStart(9) + `   (${out.ms[ranker]}ms)`)
  }
  console.log('')
  console.log('按类型（recall@10 / MRR / 条数）')
  const types = ['exact', 'paraphrase', 'combo', 'multiturn', 'none', 'near']
  for (const type of types) {
    const cells = rankers.map((r) => {
      const t = out.rankers[r].byType[type]
      if (!t) return r + ' —'
      const v = t.positives ? `${pct(t.recall10)} / ${num(t.mrr)}` : `空 ${pct(t.falseRecallRate === null ? null : 1 - t.falseRecallRate)}`
      return `${r} ${v} (${t.n})`
    })
    console.log('  ' + type.padEnd(11) + cells.join('   ·   '))
  }
  console.log('')
  const mt = rankers.map((r) => `${r} 带上下文 ${pct(out.multiturn[r].withContext)} / 裸问 ${pct(out.multiturn[r].cold)}`).join('   ·   ')
  console.log(`多轮追问（${multiturn.length} 条）：` + mt)
  for (const ranker of rankers) {
    const m = out.rankers[ranker]
    console.log(`负例（${ranker}）：none 空 ${pct(m.noneEmptyRate)} · near 空 ${pct(m.nearEmptyRate)} · 封存 ${m.boundary.sealed.n} 条 / 抽屉 ${m.boundary.drawer.n} 条 —— 边界漏出 ${m.boundary.sealed.leaked}/${m.boundary.drawer.leaked} 次；标记外露 ${m.leaks} 次`)
    console.log(`细节题（${ranker}）：${m.attr.n} 条 · 命中那条真事 ${m.attr.topicHit} 条 · 返回非空 ${m.attr.returned} 条（只报数，不算误召回）`)
  }
  if (out.holdout) {
    console.log('')
    for (const ranker of rankers) {
      const h = out.holdout[ranker]
      console.log(`留出集（${h.cases} 条 · ${ranker}）：recall@10 ${pct(h.recall10)} · MRR ${num(h.mrr)} · 误召回 ${pct(h.falseRecallRate)} · 外露 ${h.leaks}`)
    }
    const lit = out.holdout.literal
    const hyb = out.holdout.hybrid
    if (lit && hyb) {
      const delta = hyb.recall10 - lit.recall10
      console.log('')
      console.log(`指标上的判断：留出集 recall@10 差 ${(delta * 100).toFixed(1)} 个百分点 → ${out.verdict.metricsFavorHybrid ? '支持再评估（本轮默认仍不切）' : '不支持切默认'}`)
      if (out.paired && out.paired.holdout) {
        const p = out.paired.holdout
        console.log(`配对（留出集正例 ${p.both + p.neither + p.n} 条）：两边都中 ${p.both} · 都不中 ${p.neither} · 只有 hybrid 中 ${p.onlyHybrid} · 只有 literal 中 ${p.onlyLiteral} · 符号检验 p = ${p.p === null ? '—' : p.p.toFixed(3)}`)
      }
    }
  }
}

fs.rmSync(dir, { recursive: true, force: true })

if (check) {
  const gates = []
  for (const ranker of rankers) {
    const m = out.rankers[ranker]
    gates.push([`${ranker}：负例误召回 = 0`, m.negatives === 0 || m.falseRecallRate === 0])
    gates.push([`${ranker}：封存 / 抽屉漏出 = 0`, m.boundary.sealed.leaked === 0 && m.boundary.drawer.leaked === 0])
    gates.push([`${ranker}：标记外露 = 0`, m.leaks === 0])
    // 回归线：低于 eval/thresholds-v2.json 就算退步（不是目标，是地板）
    const minRecall = thresholds[ranker + 'Recall10']
    const minMrr = thresholds[ranker + 'Mrr']
    if (typeof minRecall === 'number' && m.recall10 !== null) gates.push([`${ranker}：recall@10 ≥ ${minRecall}`, m.recall10 >= minRecall])
    if (typeof minMrr === 'number' && m.mrr !== null) gates.push([`${ranker}：MRR ≥ ${minMrr}`, m.mrr >= minMrr])
  }
  if (!asJson) console.log('')
  for (const [name, ok] of gates) console.log((ok ? '  ✔ ' : '  ✘ ') + name)
  if (gates.some(([, ok]) => !ok)) process.exitCode = 1
}
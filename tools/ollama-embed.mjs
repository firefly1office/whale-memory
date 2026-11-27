#!/usr/bin/env node
// 本地 Ollama 向量适配器（阶段 5 · S5；N1 补强：probe 明确给维度、embed 带内容哈希缓存、维度/归一化校验 fail closed）。
//
// 为什么拆成"预热（异步）+ 查询（同步）"：
//   recall 是**同步** API（宿主不用改一行），HTTP 是异步的；core 也不该在默认路径上联网。
//   所以：先把要用的文本批量喂给 Ollama、向量落进缓存文件；然后 makeCachedEmbedder() 返回一个
//   `text → Float64Array` 的同步函数，只查缓存。缓存里没有就抛 `EMBED_CACHE_MISS`——
//   **不偷偷退回桩**：那会让"真语义"这句话变成假的。
//
// N1 补的三件：
//   1. probe() 明确返回 { available, model, dim }——dim 是**真的问模型要一条向量量出来的**，
//      不是猜的（拿不到就是 dim:null，绝不编一个维度）；
//   2. embed(texts) 是带**内容哈希缓存**的批量取向量：键 = sha256(模型名 + '\n' + 文本) 前 32 位，
//      同一次调用里重复的文本只请求一次，磁盘缓存里已有的不请求；
//   3. **维度与归一化校验 fail closed**：回来的向量长度对不上（或同一批里长短不一）、含 NaN/Infinity、
//      或者零向量没法归一化——一律抛错、一个字节都不写缓存。宁可红，也不把错维度的向量塞进排序
//      （cosine 遇到长短不一会返回 0，静默把候选排到后面，那比报错还坏）。
//
// 拿不到 Ollama（没装 / 没开 / 没 pull 模型）时：probe() 返回 { available:false, dim:null, reason }，
// 预热抛 `EMBED_UNAVAILABLE`；评测那边据此打印"未接入真模型"，继续用桩并把 embedKind 写成桩。
//
// 零依赖：只用 node 内置的 globalThis.fetch（Node 18+）、node:fs、node:crypto。
//
// 用法（CLI）：
//   node tools/ollama-embed.mjs probe                          # 看 Ollama 在不在、模型有没有、维度是多少
//   node tools/ollama-embed.mjs warm --texts=<file.json> --cache=<cache.jsonl> [--model=bge-m3] [--dim=1024]
//   node tools/ollama-embed.mjs warm --from-eval-v2 --cache=<cache.jsonl>   # 用评测语料 + 用例里的查询预热
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const DEFAULT_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
export const DEFAULT_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3'
export const CACHE_VERSION = 1
// 量维度用的一句固定短文本：只是为了问模型要一条向量，不参与任何检索
export const PROBE_TEXT = 'whale-memory embedding dim probe'

const coded = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra)
const keyOf = (model, text) => crypto.createHash('sha256').update(String(model) + '\n' + String(text || ''), 'utf8').digest('hex').slice(0, 32)
const round = (x) => Math.round(Number(x) * 1e6) / 1e6

const finiteVec = (vec) => {
  for (let i = 0; i < vec.length; i += 1) if (!Number.isFinite(vec[i])) return false
  return true
}

/**
 * 归一化校验（N1）：向量必须是有限数、长度 > 0、范数 > 0。返回**单位长度**的副本。
 * 不合格直接抛 EMBED_BAD_VECTOR——不把 NaN / 零向量喂进 cosine。
 */
export function normalizeVector(vec, { text = '', model = DEFAULT_MODEL } = {}) {
  if (!vec || !vec.length) throw coded('向量是空的（模型 ' + model + '）。（embedding empty vector）', 'EMBED_BAD_VECTOR', { text })
  let norm = 0
  for (let i = 0; i < vec.length; i += 1) {
    const v = Number(vec[i])
    if (!Number.isFinite(v)) throw coded('向量里出现 NaN / Infinity（模型 ' + model + '，第 ' + i + ' 维）。（embedding not finite）', 'EMBED_BAD_VECTOR', { text, index: i })
    norm += v * v
  }
  norm = Math.sqrt(norm)
  if (!(norm > 0)) throw coded('向量是零向量，没法归一化（模型 ' + model + '）。（embedding zero vector）', 'EMBED_BAD_VECTOR', { text })
  // 已经在单位球面上（含 6 位小数取整带来的微小偏差）就原样返回，别每读一次都抖一下
  if (Math.abs(norm - 1) <= 1e-6) return Float64Array.from(vec, Number)
  return Float64Array.from(vec, (v) => Number(v) / norm)
}

/** 探一下 Ollama 在不在、有没有这个模型。不抛错：拿不到就是 available:false + reason。 */
export async function probeOllama({ url = DEFAULT_URL, model = DEFAULT_MODEL, timeoutMs = 3000 } = {}) {
  try {
    const res = await fetch(String(url).replace(/\/+$/, '') + '/api/tags', { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { available: false, url, model, reason: 'HTTP ' + res.status, models: [] }
    const body = await res.json()
    const models = Array.isArray(body?.models) ? body.models.map((m) => String(m?.name || m?.model || '')).filter(Boolean) : []
    const hasModel = models.some((name) => name === model || name.startsWith(model + ':'))
    return { available: true, url, model, hasModel, models }
  } catch (error) {
    return { available: false, url, model, reason: String((error && (error.code || error.message)) || error), models: [] }
  }
}

/** 一次调一条文本（/api/embeddings 是 Ollama 的老接口，bge-m3 兼容；返回 number[]）。 */
async function embedOne({ text, url, model, timeoutMs }) {
  let res
  try {
    res = await fetch(String(url).replace(/\/+$/, '') + '/api/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: String(text || '') }),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw coded('连不上 Ollama（' + url + '）：' + String((error && (error.code || error.message)) || error) + '。（ollama unavailable）', 'EMBED_UNAVAILABLE', { cause: error })
  }
  if (!res.ok) throw coded('Ollama 向量接口回 HTTP ' + res.status + '：先把模型 pull 下来（ollama pull ' + model + '）。（ollama http error）', 'EMBED_UNAVAILABLE', { status: res.status })
  const body = await res.json()
  const vec = body && (body.embedding || (Array.isArray(body.embeddings) ? body.embeddings[0] : null))
  if (!Array.isArray(vec) || !vec.length) throw coded('Ollama 没返回向量（模型名对不对？' + model + '）。（ollama empty embedding）', 'EMBED_BAD_RESPONSE')
  return Float64Array.from(vec, Number)
}

/** 批量取向量（顺序与 texts 一致）。任何一条失败就整次失败——不写半份缓存。 */
export async function embedTextsOllama({ texts = [], url = DEFAULT_URL, model = DEFAULT_MODEL, timeoutMs = 60000 } = {}) {
  const out = []
  for (const text of texts) out.push(await embedOne({ text, url, model, timeoutMs }))
  return out
}

/**
 * 探活 + **量维度**（N1）。返回 { available, model, dim, url, hasModel, models, reason? }。
 * available 的语义是"现在真的能拿到向量"：服务在、模型在、而且量 dim 的那次调用成功。
 * 拿不到就是 dim:null + reason；这里不抛错（探活不该把调用方带崩）。
 */
export async function probe({ url = DEFAULT_URL, model = DEFAULT_MODEL, timeoutMs = 5000, probeText = PROBE_TEXT } = {}) {
  const base = await probeOllama({ url, model, timeoutMs: Math.min(timeoutMs, 3000) })
  if (!base.available) return { available: false, model, dim: null, url, hasModel: false, models: [], reason: base.reason }
  if (!base.hasModel) return { available: false, model, dim: null, url, hasModel: false, models: base.models, reason: 'model-missing: ' + model + '（先 ollama pull ' + model + '）' }
  try {
    const vec = await embedOne({ text: probeText, url, model, timeoutMs })
    return { available: true, model, dim: vec.length, url, hasModel: true, models: base.models }
  } catch (error) {
    return { available: false, model, dim: null, url, hasModel: true, models: base.models, reason: String((error && (error.code ? error.code + ': ' : '') + (error.message || error)) || error) }
  }
}

/** 读缓存文件 → Map<key, Float64Array>。文件不存在 = 空。坏行（JSON 坏、维度不自洽、含 NaN）记在 bad 里。 */
export function readCache(file) {
  const map = new Map()
  let bad = 0
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (error) {
    if (error && error.code === 'ENOENT') return { map, bad: 0, models: [] }
    throw error
  }
  const models = new Set()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (!row || row.v !== CACHE_VERSION || typeof row.key !== 'string' || !Array.isArray(row.vec) || !row.vec.length) { bad += 1; continue }
      // 维度自洽 + 有限数：缓存不是真相来源，坏行丢掉重新预热即可；但**不许**把坏向量拿去打分
      if (Number.isFinite(Number(row.dim)) && Number(row.dim) !== row.vec.length) { bad += 1; continue }
      const vec = Float64Array.from(row.vec, Number)
      if (!finiteVec(vec)) { bad += 1; continue }
      map.set(row.key, vec)
      if (row.model) models.add(String(row.model))
    } catch { bad += 1 }
  }
  return { map, bad, models: [...models] }
}

/** 写缓存（合并：已有 key 不重复写；整文件原子替换，写一半不会留下坏缓存）。 */
export function writeCache(file, entries, { model = DEFAULT_MODEL } = {}) {
  const { map } = readCache(file)
  let added = 0
  for (const [key, vec] of entries) {
    if (map.has(key)) continue
    map.set(key, vec)
    added += 1
  }
  if (added) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const lines = [...map.entries()].map(([key, vec]) => JSON.stringify({ v: CACHE_VERSION, model, key, dim: vec.length, vec: Array.from(vec, round) }))
    const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomUUID()
    fs.writeFileSync(tmp, lines.join('\n') + '\n', 'utf8')
    fs.renameSync(tmp, file)
  }
  return { added, total: map.size }
}

/**
 * 批量取向量，**带内容哈希缓存**（N1）：
 *   - 键 = sha256(model + '\n' + text)，同一次调用里同样的文本只请求一次；磁盘缓存里已有的不请求；
 *   - 所有向量先过 normalizeVector（有限 + 单位长度），再校验维度：
 *       · 传了 dim 就以 dim 为准；
 *       · 没传就跟缓存里已有的维度对齐；缓存空就跟第一条回来的向量对齐；
 *       · 同一批里长短不一 → EMBED_DIM_MISMATCH。
 *   - 校验全部通过之后才写缓存（一条不合格就一条都不写）。
 * @returns {{vectors:Float64Array[], dim:number|null, hits:number, misses:number, added:number, model:string, kind:string, cache:string|null, total:number}}
 */
export async function embed(texts = [], { file = '', url = DEFAULT_URL, model = DEFAULT_MODEL, dim = null, timeoutMs = 60000 } = {}) {
  const list = Array.isArray(texts) ? texts.map((t) => String(t ?? '')) : []
  const disk = file ? readCache(file) : { map: new Map(), bad: 0, models: [] }
  const keys = list.map((text) => keyOf(model, text))
  const got = new Map() // key -> 已校验、已归一化的向量
  const missing = new Map() // key -> text（同一段文本只排一次队）
  let hits = 0
  for (let i = 0; i < list.length; i += 1) {
    const key = keys[i]
    if (got.has(key)) { hits += 1; continue }
    const cached = disk.map.get(key)
    if (cached) { got.set(key, normalizeVector(cached, { text: list[i], model })); hits += 1; continue }
    if (!missing.has(key)) missing.set(key, list[i])
  }

  let effectiveDim = Number.isFinite(Number(dim)) && Number(dim) > 0 ? Math.floor(Number(dim)) : null
  const cachedDims = new Set([...got.values()].map((vec) => vec.length))
  if (cachedDims.size > 1) {
    throw coded('缓存里向量维度不一致（' + [...cachedDims].join(' / ') + '）：先删掉缓存重新 warm。（embedding cache dim mismatch）', 'EMBED_DIM_MISMATCH', { dims: [...cachedDims] })
  }
  if (effectiveDim === null && cachedDims.size === 1) effectiveDim = [...cachedDims][0]
  if (effectiveDim !== null && cachedDims.size === 1 && [...cachedDims][0] !== effectiveDim) {
    throw coded('缓存里的向量维度是 ' + [...cachedDims][0] + '，但期望 ' + effectiveDim + '：先删掉缓存重新 warm。（embedding dim mismatch）', 'EMBED_DIM_MISMATCH', { expected: effectiveDim, got: [...cachedDims][0] })
  }

  const fetched = new Map()
  if (missing.size) {
    const keysToFetch = [...missing.keys()]
    const vecs = await embedTextsOllama({ texts: keysToFetch.map((key) => missing.get(key)), url, model, timeoutMs })
    for (let i = 0; i < keysToFetch.length; i += 1) {
      const vec = vecs[i]
      const text = missing.get(keysToFetch[i])
      if (effectiveDim === null) effectiveDim = vec.length
      if (vec.length !== effectiveDim) {
        throw coded('向量维度不符：期望 ' + effectiveDim + ' 维，模型回了 ' + vec.length + ' 维（模型 ' + model + '）。fail closed：不写缓存、不排序。（embedding dim mismatch）', 'EMBED_DIM_MISMATCH', { expected: effectiveDim, got: vec.length, text })
      }
      fetched.set(keysToFetch[i], normalizeVector(vec, { text, model }))
    }
  }

  const added = file && fetched.size ? writeCache(file, fetched, { model }).added : 0
  const vectors = list.map((text, i) => {
    const key = keys[i]
    const vec = fetched.get(key) || got.get(key)
    if (!vec) throw coded('向量缺失（不该发生）：' + text.slice(0, 20), 'EMBED_BAD_VECTOR', { text })
    return vec
  })
  return {
    vectors,
    dim: effectiveDim,
    hits,
    misses: missing.size,
    added,
    model,
    kind: 'ollama:' + model,
    cache: file || null,
    total: file ? readCache(file).map.size : got.size + fetched.size
  }
}

/**
 * 预热：把 texts 里缓存没有的那部分喂给 Ollama，结果并进缓存文件。
 * 走 embed()：内容哈希去重 + 维度/归一化校验（不合格不落盘）。
 * @returns {{ requested:number, cached:number, written:number, total:number, model:string, dim:number|null }}
 */
export async function warmEmbedCache({ texts = [], file, url = DEFAULT_URL, model = DEFAULT_MODEL, timeoutMs = 60000, dim = null } = {}) {
  if (!file) throw coded('要一个缓存文件路径（--cache=<file>）。（missing cache file）', 'EMBED_NO_CACHE_FILE')
  const probeInfo = await probeOllama({ url, model, timeoutMs: Math.min(timeoutMs, 5000) })
  if (!probeInfo.available) throw coded('没有可用的 Ollama（' + url + '：' + probeInfo.reason + '），不预热，也不假装接上了。（ollama unavailable）', 'EMBED_UNAVAILABLE', { probe: probeInfo })
  const res = await embed(texts.map(String), { file, url, model, dim, timeoutMs })
  return { requested: texts.length, cached: res.hits, written: res.added, total: res.total, model, dim: res.dim }
}

/**
 * 同步向量函数（只查缓存）。缓存缺失抛 EMBED_CACHE_MISS——不退回桩。
 * 构造时校验：维度自洽（给了 dim 就以 dim 为准，不一致直接抛 EMBED_DIM_MISMATCH）、向量有限。
 * 返回的向量是单位长度（老缓存里没归一化的也在这里归一化，保证 cosine 口径一致）。
 * @returns {{ embed:(text:string)=>Float64Array, kind:string, model:string, dim:number|null, size:number, missing:(text:string)=>boolean }}
 */
export function makeCachedEmbedder({ file, model = DEFAULT_MODEL, dim = null } = {}) {
  if (!file) throw coded('要一个缓存文件路径。（missing cache file）', 'EMBED_NO_CACHE_FILE')
  const { map, bad } = readCache(file)
  let expected = Number.isFinite(Number(dim)) && Number(dim) > 0 ? Math.floor(Number(dim)) : null
  for (const [key, vec] of map) {
    if (expected === null) expected = vec.length
    else if (vec.length !== expected) {
      throw coded('缓存里向量维度不一致：期望 ' + expected + ' 维，有一条是 ' + vec.length + ' 维（key ' + key + '）。先删掉缓存重新 warm。（embedding cache dim mismatch）', 'EMBED_DIM_MISMATCH', { expected, got: vec.length, key })
    }
  }
  const embedOneCached = (text) => {
    const key = keyOf(model, text)
    const vec = map.get(key)
    if (!vec) {
      throw coded('缓存里没有这段文本的向量（模型 ' + model + '）：先跑 node tools/ollama-embed.mjs warm 预热，不要退回桩。（embedding cache miss）', 'EMBED_CACHE_MISS', { key })
    }
    return normalizeVector(vec, { text, model })
  }
  return { embed: embedOneCached, kind: 'ollama:' + model, model, dim: expected, size: map.size, bad, missing: (text) => !map.has(keyOf(model, text)) }
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const args = process.argv.slice(2)
  const cmd = args.find((a) => !a.startsWith('--')) || 'probe'
  const arg = (name, fallback) => {
    const hit = args.find((a) => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : fallback
  }
  const url = arg('url', DEFAULT_URL)
  const model = arg('model', DEFAULT_MODEL)
  const cache = arg('cache', '')
  const dimArg = Number(arg('dim', '') || '0') || null
  const fail = (error) => { console.error('失败：' + (error && error.message ? error.message : error)); process.exit(2) }
  try {
    if (cmd === 'probe') {
      const info = await probe({ url, model })
      console.log(JSON.stringify(info, null, 2))
      if (!info.available) {
        if (info.hasModel) console.log('结论：未接入真模型（Ollama 在，但拿不到向量）——评测里的 embed 仍是桩：' + info.reason)
        else if (info.models && info.models.length) console.log('结论：未接入真模型：Ollama 在，但没有 ' + model + '；先 ollama pull ' + model + '。')
        else console.log('结论：未接入真模型（Ollama 不可用）：' + info.reason)
      } else console.log('结论：可以预热真向量（model=' + model + '，dim=' + info.dim + '）。')
      process.exit(info.available ? 0 : 1)
    }
    if (cmd === 'warm') {
      if (!cache) fail(coded('warm 需要 --cache=<file>', 'EMBED_NO_CACHE_FILE'))
      let texts = []
      const textsFile = arg('texts', '')
      if (args.includes('--from-eval-v2')) {
        const { loadEvalV2, buildCorpus } = await import('./lib/eval-v2-corpus.mjs')
        const os = await import('node:os')
        const { corpus, caseFile } = loadEvalV2()
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-embed-warm-'))
        const { memoryDir } = buildCorpus(dir, corpus)
        const { loadAll } = await import('../packages/core/lib/self-experience.js')
        const rows = loadAll(memoryDir)
        texts = [
          ...rows.map((r) => [r.then.text, r.then.quote?.text, (r.later || []).map((l) => l.thought).join(' ')].filter(Boolean).join(' ')),
          // 查询本身 + 「上下文 + 追问」的组合：embedRank 对内容词很少的追问会用 gateText = context + ' ' + query
          ...caseFile.cases.flatMap((c) => {
            const q = String(c.query || '')
            return [q, c.prev ? String(c.prev) + ' ' + q : null].filter(Boolean)
          })
        ]
      } else if (textsFile) {
        texts = JSON.parse(fs.readFileSync(textsFile, 'utf8'))
        if (!Array.isArray(texts)) fail(coded('--texts 文件要是 JSON 数组', 'EMBED_BAD_TEXT_FILE'))
      } else {
        fail(coded('warm 需要 --texts=<file.json> 或 --from-eval-v2', 'EMBED_NO_TEXTS'))
      }
      const out = await warmEmbedCache({ texts: texts.map(String), file: cache, url, model, dim: dimArg })
      console.log(JSON.stringify(out))
      process.exit(0)
    }
    fail(coded('不认识的子命令：' + cmd + '（支持 probe / warm）', 'EMBED_BAD_COMMAND'))
  } catch (error) {
    fail(error)
  }
}
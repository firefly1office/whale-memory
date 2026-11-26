#!/usr/bin/env node
// 本地 Ollama 向量适配器（阶段 5 · S5）：bge-m3 的 HTTP 调用 + 磁盘向量缓存 + 同步查缓存。
//
// 为什么拆成"预热（异步）+ 查询（同步）"：
//   recall 是**同步** API（宿主不用改一行），HTTP 是异步的；core 也不该在默认路径上联网。
//   所以：先把要用的文本批量喂给 Ollama、向量落进缓存文件；然后 makeCachedEmbedder() 返回一个
//   `text → Float64Array` 的同步函数，只查缓存。缓存里没有就抛 `EMBED_CACHE_MISS`——
//   **不偷偷退回桩**：那会让"真语义"这句话变成假的。
//
// 拿不到 Ollama（没装 / 没开 / 没 pull 模型）时：probeOllama() 返回 { available:false, reason }，
// 预热抛 `EMBED_UNAVAILABLE`；评测那边据此打印"未接入真模型"，继续用桩并把 embedKind 写成桩。
//
// 零依赖：只用 node 内置的 globalThis.fetch（Node 18+）、node:fs、node:crypto。
//
// 用法（CLI）：
//   node tools/ollama-embed.mjs probe                          # 看 Ollama 在不在、模型有没有
//   node tools/ollama-embed.mjs warm --texts=<file.json> --cache=<cache.jsonl> [--model=bge-m3]
//   node tools/ollama-embed.mjs warm --from-eval-v2 --cache=<cache.jsonl>   # 用评测语料 + 用例里的查询预热
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const DEFAULT_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
export const DEFAULT_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3'
export const CACHE_VERSION = 1

const coded = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra)
const keyOf = (model, text) => crypto.createHash('sha256').update(String(model) + '\n' + String(text || ''), 'utf8').digest('hex').slice(0, 32)
const round = (x) => Math.round(Number(x) * 1e6) / 1e6

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

/** 读缓存文件 → Map<key, Float64Array>。文件不存在 = 空。坏行记在 bad 里（读缓存不算致命）。 */
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
      map.set(row.key, Float64Array.from(row.vec, Number))
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
 * 预热：把 texts 里缓存没有的那部分喂给 Ollama，结果并进缓存文件。
 * @returns {{ requested:number, cached:number, written:number, total:number, model:string }}
 */
export async function warmEmbedCache({ texts = [], file, url = DEFAULT_URL, model = DEFAULT_MODEL, timeoutMs = 60000 } = {}) {
  if (!file) throw coded('要一个缓存文件路径（--cache=<file>）。（missing cache file）', 'EMBED_NO_CACHE_FILE')
  const probe = await probeOllama({ url, model, timeoutMs: Math.min(timeoutMs, 5000) })
  if (!probe.available) throw coded('没有可用的 Ollama（' + url + '：' + probe.reason + '），不预热，也不假装接上了。（ollama unavailable）', 'EMBED_UNAVAILABLE', { probe })
  const { map } = readCache(file)
  const todo = []
  const seen = new Set()
  for (const text of texts) {
    const key = keyOf(model, text)
    if (map.has(key) || seen.has(key)) continue
    seen.add(key)
    todo.push([key, text])
  }
  const vecs = todo.length ? await embedTextsOllama({ texts: todo.map(([, text]) => text), url, model, timeoutMs }) : []
  const { added, total } = writeCache(file, todo.map(([key], i) => [key, vecs[i]]), { model })
  return { requested: texts.length, cached: texts.length - todo.length, written: added, total, model }
}

/**
 * 同步向量函数（只查缓存）。缓存缺失抛 EMBED_CACHE_MISS——不退回桩。
 * @returns {{ embed:(text:string)=>Float64Array, kind:string, model:string, size:number, missing:(text:string)=>boolean }}
 */
export function makeCachedEmbedder({ file, model = DEFAULT_MODEL } = {}) {
  if (!file) throw coded('要一个缓存文件路径。（missing cache file）', 'EMBED_NO_CACHE_FILE')
  const { map, bad } = readCache(file)
  const embed = (text) => {
    const key = keyOf(model, text)
    const vec = map.get(key)
    if (!vec) {
      throw coded('缓存里没有这段文本的向量（模型 ' + model + '）：先跑 node tools/ollama-embed.mjs warm 预热，不要退回桩。（embedding cache miss）', 'EMBED_CACHE_MISS', { key })
    }
    return vec
  }
  return { embed, kind: 'ollama:' + model, model, size: map.size, bad, missing: (text) => !map.has(keyOf(model, text)) }
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
  const fail = (error) => { console.error('失败：' + (error && error.message ? error.message : error)); process.exit(2) }
  try {
    if (cmd === 'probe') {
      const probe = await probeOllama({ url, model })
      console.log(JSON.stringify(probe, null, 2))
      if (!probe.available) console.log('结论：未接入真模型（Ollama 不可用）——评测里的 embed 仍是桩。')
      else if (!probe.hasModel) console.log('结论：Ollama 在，但没有 ' + model + '；先 ollama pull ' + model + '。')
      else console.log('结论：可以预热真向量（model=' + model + '）。')
      process.exit(probe.available && probe.hasModel ? 0 : 1)
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
          ...caseFile.cases.map((c) => String(c.query || '')).filter(Boolean)
        ]
      } else if (textsFile) {
        texts = JSON.parse(fs.readFileSync(textsFile, 'utf8'))
        if (!Array.isArray(texts)) fail(coded('--texts 文件要是 JSON 数组', 'EMBED_BAD_TEXT_FILE'))
      } else {
        fail(coded('warm 需要 --texts=<file.json> 或 --from-eval-v2', 'EMBED_NO_TEXTS'))
      }
      const out = await warmEmbedCache({ texts: texts.map(String), file: cache, url, model })
      console.log(JSON.stringify(out))
      process.exit(0)
    }
    fail(coded('不认识的子命令：' + cmd + '（支持 probe / warm）', 'EMBED_BAD_COMMAND'))
  } catch (error) {
    fail(error)
  }
}
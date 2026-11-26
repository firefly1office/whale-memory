// 语义检索（实验）：向量排序，门禁仍用防编造那套覆盖率。
//
// 三条边界：
//   1. 默认不启用。只有 recall({ ranker: 'embed' }) 才走这里；不传 ranker 的字面检索一个字节没改。
//   2. **这一版没有真模型**：本机没有 Ollama，所以向量来自确定性的字符 n-gram 哈希（桩）。
//      它的作用是证明通路（门禁 → 向量打分 → 排序）和给评测跑三组数；
//      **桩的分数不能当语义效果的证据**——同样的文本永远同样的向量，它只是换了一种相似度。
//   3. 有 Ollama 时由调用方注入 embed 函数（见 tools/eval-embed.mjs）；core 不联网、不加依赖。
import { contentUnits, coverage } from './query-match.js'
import { tokensOf, variantsOf } from './hybrid-recall.js'

export const EMBED_MIN_COVER = 0.65
export const EMBED_DIMS = 256
export const EMBED_KIND = 'stub:char-ngram-hash'

// 确定性桩：字符 2–3 字 n-gram → 带符号的桶。同样的输入永远同样的向量。
export function hashEmbed(text, dims = EMBED_DIMS) {
  const vec = new Float64Array(dims)
  const chars = Array.from(String(text || '').toLowerCase().replace(/\s+/g, ''))
  for (let i = 0; i < chars.length - 1; i += 1) {
    for (const n of [2, 3]) {
      if (i + n > chars.length) continue
      const gram = chars.slice(i, i + n).join('')
      let h = 2166136261
      for (const ch of gram) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) }
      const bucket = Math.abs(h) % dims
      vec[bucket] += (h & 1) ? 1 : -1
    }
  }
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dims; i += 1) vec[i] /= norm
  return vec
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i]
  return dot
}

/**
 * 对一个已经筛好的 rows 做向量排序。门禁和 hybrid 同口径：覆盖率不够就不放行。
 * @param {object} options
 * @param {Array} options.rows 已处理完封存 / asOf / backend 的记录
 * @param {string} options.query
 * @param {string} [options.context] 上一轮查询，只影响排序
 * @param {number} [options.limit]
 * @param {number} [options.minCover]
 * @param {(text: string) => Float64Array} [options.embed] 向量函数；默认桩
 * @param {Map<string, Float64Array>} [options.vectorCache] 可复用的行向量缓存（key = id + '\n' + 文本）
 */
export function embedRank({ rows = [], query = '', context = '', limit = 3, minCover = EMBED_MIN_COVER, embed = hashEmbed, vectorCache = null } = {}) {
  const q = String(query || '')
  if (!q.trim()) return []
  const ctx = String(context || '')
  const texts = rows.map((row) => {
    const then = row?.then || {}
    return [then.text, then.quote?.text, Array.isArray(row?.later) ? row.later.map((x) => x.thought).filter(Boolean).join(' ') : '']
      .filter(Boolean).join(' ')
  })

  const ownUnits = contentUnits(q)
  const gateCover = ownUnits.length <= 3 ? Math.max(minCover, 0.7) : minCover
  const gateText = ownUnits.length <= 1 && ctx ? ctx + ' ' + q : q
  const gateVariants = variantsOf(gateText)
  const queryVec = embed(gateText)

  const picked = []
  for (let i = 0; i < rows.length; i += 1) {
    let best = { cover: 0, hits: 0 }
    for (const variant of gateVariants) {
      const cover = coverage(contentUnits(variant), texts[i])
      if (cover > best.cover) best = { cover, hits: 1 }
    }
    if (!best.hits || best.cover < gateCover) continue
    const key = `${rows[i].id}\n${texts[i]}`
    let vec = vectorCache?.get(key)
    if (!vec) { vec = embed(texts[i]); vectorCache?.set(key, vec) }
    const score = cosine(queryVec, vec)
    picked.push({ row: rows[i], score, cover: best.cover })
  }

  picked.sort((a, b) => b.score - a.score || String(b.row.at).localeCompare(String(a.row.at)))
  return picked.slice(0, limit).map((p) => ({
    ...p.row,
    embedScore: Number(p.score.toFixed(6)),
    embedCover: Number(p.cover.toFixed(6))
  }))
}

export const _internal = { tokensOf }
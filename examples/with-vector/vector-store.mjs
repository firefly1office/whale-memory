// 一个玩具向量库：只为演示「召回归宿主」这件事，不追求效果
// 真接的时候换成 sqlite-vec / pgvector / Chroma / 任何搜索服务都行
const DIM = 64

export function embed(text) {
  const vec = new Float64Array(DIM)
  const clean = String(text || '').replace(/[\s\p{P}\p{S}]+/gu, '')
  for (let i = 0; i + 2 <= clean.length; i++) {
    const g = clean.slice(i, i + 2)
    let h = 2166136261
    for (const ch of g) h = (h ^ ch.codePointAt(0)) * 16777619
    const idx = Math.abs(h) % DIM
    vec[idx] += (h & 1) ? 1 : -1
  }
  return vec
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < DIM; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export function createStore() {
  const items = []
  return {
    add(id, text) { items.push({ id, vec: embed(text), text }) },
    search(query, { topK = 2, minScore = 0.1 } = {}) {
      const q = embed(query)
      return items
        .map((it) => ({ id: it.id, score: cosine(q, it.vec) }))
        .filter((x) => x.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
    },
    size() { return items.length }
  }
}
// 查询匹配：self-experience 与 self-memory 共用同一套口径，防编造的门槛只在这里定义
// 中文等按相邻两字切；拉丁字母按整词切（不切成字母对，否则 "the" 会命中一切）；统一小写

// 高频但不携带信息的词：不参与重叠计算，避免「今天/什么/我的」把不相关的东西拉进来
const STOP = new Set([
  '什么', '怎么', '这个', '那个', '我的', '你的', '他的', '她的', '我们', '他们', '她们', '自己',
  '昨天', '今天', '明天', '后天', '前天', '现在', '刚刚', '后来', '以前', '以后', '时候',
  '是不是', '有没有', '一点', '一些', '东西', '事情', '觉得', '知道', '记得', '忘了',
  '可能', '应该', '还是', '就是', '但是', '因为', '所以', '如果', '然后', '已经',
  '没有', '不是', '可以', '一个', '这样', '那样', '真的', '其实', '比较', '非常', '特别',
  '一直', '总是', '大概', '也许', '当然', '而是', '并且', '或者', '不过', '虽然', '只是',
  '还有', '以及', '关于', '对于', '买了', '了什', '说了', '去了', '来了', '看到', '做了',
  'the', 'and', 'for', 'with', 'what', 'did', 'was', 'were', 'you', 'your', 'she', 'her', 'his',
  'him', 'they', 'them', 'this', 'that', 'there', 'then', 'from', 'about', 'have', 'has', 'had',
  'yesterday', 'today', 'tomorrow', 'just', 'some', 'any', 'how', 'why', 'when', 'who', 'are', 'not'
])

export function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

// 查询 → 待匹配的词：拉丁字母连写成词，其余（汉字、数字等）按相邻两字切
export function queryTerms(q) {
  const lower = String(q || '').toLowerCase()
  const cleaned = normalizeText(lower)
  const terms = new Set()
  for (const w of lower.match(/[a-z]+/g) || []) {
    if (w.length >= 2 && !STOP.has(w)) terms.add(w)
  }
  for (const run of lower.replace(/[a-z]+/g, ' ').split(/[\s\p{P}\p{S}]+/u)) {
    for (let i = 0; i + 2 <= run.length; i++) {
      const g = run.slice(i, i + 2)
      if (!STOP.has(g)) terms.add(g)
    }
  }
  return { cleaned, terms }
}

// mode='strict'：长查询（≥8 字）要求 ≥minRatio 的词命中，宁可不召回也不硬凑
// mode='loose'：只要求 minOverlap 个词命中
export function requiredOverlap({ cleaned, terms }, { mode = 'strict', minOverlap = 1, minRatio = 0.6 } = {}) {
  return (mode !== 'loose' && cleaned.length >= 8)
    ? Math.max(minOverlap, Math.ceil(terms.size * minRatio))
    : minOverlap
}

// 文本里命中了哪些词（文本先做同样的归一化）
export function matchedTerms(terms, text) {
  const t = normalizeText(text)
  const out = new Set()
  if (!t) return out
  for (const g of terms) if (t.includes(g)) out.add(g)
  return out
}

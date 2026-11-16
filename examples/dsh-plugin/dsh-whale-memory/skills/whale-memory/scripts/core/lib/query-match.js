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

// 只起语法作用的单字：算「查询里有多少意思被这段记忆接住了」时不计入
const STOP_CHARS = new Set([...'的了吗呢吧啊呀么着过在里那这个些次段事就也都还又很把被给跟和与及或是有我你他她它们嘛啦哦呃'])
// 聊天里的垫话：只是在问"那件事"，本身不带内容。只在算覆盖率时跳过，不改 STOP（旧口径和 loose 不受影响）
const FILLER = new Set([
  '怎么样', '怎样', '上次', '之前', '最近', '说说', '讲讲', '聊聊', '说过', '提过', '讲过', '记不记得', '还记得',
  '跟我', '说的', '讲的', '提到', '那件', '那次', '那段', '那天', '那个时候',
  'remember', 'recall', 'tell', 'me', 'do', 'does', 'know', 'talk', 'about'
])
// 停用词里只有这些（时间、代词、虚词）整个跳过；「买了 / 说了 / 去了」这类带动作的，动作那个字要算
const SKIP_WORDS = new Set([...[...STOP].filter((w) => !['买了', '说了', '去了', '来了', '做了', '看到', '了什'].includes(w)), ...FILLER])
// 任意长度的停用词都要能跳过（以前只看两字，「是不是」「有没有」「记不记得」从来没跳过）
const SKIP_LENS = [...new Set([...SKIP_WORDS].filter((w) => !/[a-z]/.test(w)).map((w) => w.length))].sort((a, b) => b - a)
// 单独出现的字在长记忆里很容易碰巧有：记忆越长，单字给的分越少
const ISOLATED_LEN = 60
// 可以跟在内容字右边、算作"连着"的助词和语气词
const SUFFIX = new Set([...'了的吗呢吧啊呀么着过'])

// 查询里要被接住的单位：拉丁字母按整词；其余按单字，并记下它左右两个两字组（用来判断是不是连着出现）
export function contentUnits(q) {
  const lower = String(q || '').toLowerCase()
  const units = []
  for (const w of lower.match(/[a-z]+/g) || []) if (w.length >= 2 && !STOP.has(w) && !FILLER.has(w)) units.push({ u: w, pairs: [] })
  for (const run of lower.replace(/[a-z]+/g, ' ').split(/[\s\p{P}\p{S}]+/u)) {
    const skip = new Set()
    for (let i = 0; i < run.length; i++) for (const L of SKIP_LENS) if (i + L <= run.length && SKIP_WORDS.has(run.slice(i, i + L))) for (let k = i; k < i + L; k++) skip.add(k)
    const content = (i) => i >= 0 && i < run.length && !skip.has(i) && !STOP_CHARS.has(run[i])
    for (let i = 0; i < run.length; i++) {
      if (!content(i)) continue
      // 两字组：左边只认内容字（「他想」的"他"不算，长记忆里随便一个"他想"都能接住）；
      // 右边还认紧跟着的语气、助词（「凉了」「好的」：形容词、动词后面常跟它们）
      const right = content(i + 1) || (i + 1 < run.length && SUFFIX.has(run[i + 1]))
      units.push({ u: run[i], pairs: [content(i - 1) ? run.slice(i - 1, i + 1) : '', right ? run.slice(i, i + 2) : ''].filter(Boolean) })
    }
  }
  return units
}

// 覆盖率：查询里的意思有几成在这段记忆里找得到（0~1）
//   和左右任一个内容字连着出现在记忆里 → 1 分；只是单独出现 → 0.5 × min(1, 60 / 记忆长度) 分；没有 → 0
// 「灯塔里的猫」：灯塔连着在，猫不在 → 2/3，不算想起来；「守灯人修透镜那段」→ 5.5/6
export function coverage(units, text) {
  if (!units.length) return 0
  const t = normalizeText(text)
  let got = 0
  for (const x of units) {
    if (!x.pairs.length) { if (t.includes(x.u)) got += 1; continue }
    if (x.pairs.some((p) => t.includes(p))) got += 1
    else if (t.includes(x.u)) got += 0.5 * Math.min(1, ISOLATED_LEN / Math.max(1, t.length))
  }
  return got / units.length
}

// strict 的门槛：至少对上一个两字词（有个落脚点），并且查询的意思至少有这么多被接住
export const MIN_COVER = 0.7

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

// 混合检索（阶段 2）：BM25（字符 2–3 字 n-gram）+ 一张小同义词表。
//
// 只在 recall({ ranker: 'hybrid' }) 时用；不传 ranker 的字面检索一个字节都没改（默认还是 literal）。
// 零第三方依赖、不调外部 API。
//
// 三条设计取舍（结果见 docs/eval-v2-zh.md）：
//   1. 门禁仍用 query-match.js 的 contentUnits / coverage（防编造那套口径），只是把查询先做
//      同义替换再算覆盖率；所以「灯塔里的猫」这种沾边句不会被放进来 —— 猫不在，覆盖率就上不去。
//   2. BM25 只影响排序，不影响放行。宁可少召回，也不为了分数高就把没根据的东西递回去。
//   3. context（上一轮查询）只影响排序；只有追问句本身几乎没有内容词时，才用它补足门禁
//      —— 纯代词/省略式追问单看自己没法判断在问什么，这是宿主把上下文递进来的那部分责任。
import { contentUnits, coverage, matchedTerms, queryTerms } from './query-match.js'

// 小同义词表：只收「换个说法还是同一件事」的日常词，不做实体消歧。
// 每对 [a, b] 两种方向都试（查询里出现哪一边，就把哪一边换成另一边再算一遍覆盖率）。
// 表小是故意的：同义词放得越宽，误召回的来源就越多；这一版先证明机制，不追求覆盖所有说法。
export const SYNONYMS = [
  ['外婆', '姥姥'], ['外公', '姥爷'],
  ['吵架', '拌嘴'], ['道歉', '认错'],
  ['失眠', '睡不着'], ['日落', '太阳下山'],
  ['买花', '花店'], ['照片', '相片'], ['拍照', '照相'],
  ['明信片', '卡片'], ['收音机', '电台'],
  ['话剧', '戏剧'], ['志愿者', '义工'],
  ['宿舍', '寝室'], ['食堂', '饭堂'],
  ['家教', '补课'], ['工资', '薪水'],
  ['考试周', '期末'], ['关门', '闭馆'], ['误点', '晚点'],
  ['河道', '河流'], ['变迁', '改道'],
  ['罚钱', '罚款'], ['课表', '课程表'], ['招人', '招新'],
  ['对联', '春联'], ['鞭炮', '烟花'], ['讲价', '砍价'],
  ['小鸟', '麻雀'], ['窗沿', '窗台'], ['铁盒', '铁皮盒'],
  ['新芽', '新叶'], ['冬衣', '冬天的衣服'], ['演出结束', '谢幕'],
  ['落选', '没进'], ['橘子', '桔子'], ['粥', '稀饭'],
  ['丢', '不见了'], ['小书', '小册子'], ['旧票', '门票']
]

// 一条查询最多派生出几个变体：表大了以后别让它组合爆炸
const MAX_VARIANTS = 8
// 混合检索的覆盖率门槛（字面检索是 0.7）。0.65 仍然拦得住「灯塔里的猫」（0.57）和
// 「明信片的邮资」（0.6）这类沾边句。这个数是看开发集定的；留出集只在最后跑一次（见 docs/eval-v2-zh.md）。
export const HYBRID_MIN_COVER = 0.65
const K1 = 1.2
const B = 0.75
// 上一轮查询在排序里的分量（只影响排序，不影响放行）
const CONTEXT_WEIGHT = 0.35
// 重要度只做轻微加权：字面检索是 3 倍乘，BM25 分数量纲不同，照搬会把排序压扁
const WEIGHT_FACTOR = { important: 1.5, normal: 1, minor: 0.75 }

// 只起语法作用的单字：只由它们组成的 n-gram 不进索引（和 query-match 的口径一致，但这里只是省空间）
const FUNCTION_CHARS = new Set([...'的了吗呢吧啊呀么着过是在里那这个些次段事就也都还又很把被给跟和与及或是有我你他她它们嘛啦哦呃'])
const GRAM_STOP = new Set([
  '什么', '怎么', '这个', '那个', '我的', '你的', '我们', '他们', '她们', '自己',
  '今天', '昨天', '明天', '后天', '现在', '刚刚', '后来', '以前', '以后', '时候',
  '是不是', '有没有', '一点', '一些', '东西', '事情', '觉得', '知道', '记得',
  '可能', '应该', '还是', '就是', '但是', '因为', '所以', '如果', '然后', '已经',
  '没有', '不是', '可以', '一个', '这样', '那样', '真的', '其实', '比较', '非常',
  '一直', '总是', '大概', '也许', '当然', '不过', '虽然', '只是', '还有', '以及'
])
const STOP_EN = new Set([
  'the', 'and', 'for', 'with', 'what', 'did', 'was', 'were', 'you', 'your', 'she', 'her',
  'his', 'him', 'they', 'them', 'this', 'that', 'there', 'then', 'from', 'about', 'have',
  'has', 'had', 'yesterday', 'today', 'tomorrow', 'just', 'some', 'any', 'how', 'why',
  'when', 'who', 'are', 'not'
])

// 索引用的词：拉丁整词 + 中文 2–3 字滑窗；全由虚词组成的 n-gram 丢掉
export function tokensOf(text) {
  const s = String(text || '').toLowerCase()
  const out = []
  for (const w of s.match(/[a-z]{2,}/g) || []) if (!STOP_EN.has(w)) out.push(w)
  for (const run of s.replace(/[a-z]+/g, ' ').split(/[\s\p{P}\p{S}]+/u)) {
    const chars = [...run]
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const g = chars.slice(i, i + n).join('')
        if (GRAM_STOP.has(g)) continue
        if ([...g].every((c) => FUNCTION_CHARS.has(c))) continue
        out.push(g)
      }
    }
  }
  return out
}

// 查询 → 同义替换的变体（原句永远在第一个）
export function variantsOf(query) {
  const q = String(query || '')
  const out = [q]
  for (const [a, b] of SYNONYMS) {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!from || !q.includes(from)) continue
      const v = q.split(from).join(to)
      if (v !== q && !out.includes(v)) out.push(v)
      if (out.length >= MAX_VARIANTS) return out
    }
  }
  return out
}

// 倒排索引：每条文本的 tf、长度、df、平均长度
export function buildIndex(texts) {
  const docs = texts.map((text) => {
    const tf = new Map()
    for (const token of tokensOf(text)) tf.set(token, (tf.get(token) || 0) + 1)
    let len = 0
    for (const n of tf.values()) len += n
    return { tf, len }
  })
  const df = new Map()
  let total = 0
  for (const d of docs) {
    total += d.len
    for (const token of d.tf.keys()) df.set(token, (df.get(token) || 0) + 1)
  }
  return { docs, df, n: docs.length, avgdl: total / Math.max(1, docs.length) }
}

export function idfOf(index, token) {
  const df = index.df.get(token) || 0
  return Math.log(1 + (index.n - df + 0.5) / (df + 0.5))
}

// BM25：查询词里的重复只算一次（qtf 忽略），文档内外都按字符 n-gram 计
export function bm25Scores(index, tokens) {
  const scores = new Array(index.docs.length).fill(0)
  const seen = new Set(tokens)
  for (const token of seen) {
    if (!index.df.has(token)) continue
    const idf = idfOf(index, token)
    for (let i = 0; i < index.docs.length; i++) {
      const tf = index.docs[i].tf.get(token)
      if (!tf) continue
      const dl = index.docs[i].len
      scores[i] += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * dl) / index.avgdl)))
    }
  }
  return scores
}

// 一条经历的可检索文本，按字段拆开（用来标 matchedIn / matchedLater）
function partsOf(row) {
  const t = (row && row.then) || {}
  return {
    then: [t.text, t.thought, (t.feeling || []).join(' ')].filter(Boolean).join(' '),
    quote: t.quote ? [t.quote.text, t.quote.source].filter(Boolean).join(' ') : '',
    later: (row.later || []).map((l) => [l.thought, Array.isArray(l.feeling) ? l.feeling.join(' ') : ''].filter(Boolean).join(' ')).join(' ')
  }
}

function markMatched(row, variants) {
  const parts = partsOf(row)
  const matchedIn = []
  const terms = [...new Set(variants.flatMap((v) => [...queryTerms(v).terms]))]
  for (const [label, text] of [['then', parts.then], ['quote', parts.quote], ['later', parts.later]]) {
    if (text && matchedTerms(new Set(terms), text).size) matchedIn.push(label)
  }
  const matchedLater = (row.later || []).filter((l) => {
    const text = [l.thought, Array.isArray(l.feeling) ? l.feeling.join(' ') : ''].filter(Boolean).join(' ')
    return text && matchedTerms(new Set(terms), text).size
  })
  return { matchedIn, matchedLater }
}

// 对一个已经筛好的 rows（封存 / asOf / backend 都由 recall 处理完）做混合排序
export function hybridRank({ rows, query, context = '', limit = 3, minCover = HYBRID_MIN_COVER } = {}) {
  const q = String(query || '')
  const ctx = String(context || '')
  const texts = rows.map((row) => {
    const p = partsOf(row)
    return [p.then, p.quote, p.later].filter(Boolean).join(' ')
  })
  const index = buildIndex(texts)

  // 门禁：查询本身内容词太少（纯代词 / 省略式追问）时，用「上下文 + 追问」补足；
  // 否则只按这一轮问的话算覆盖率 —— 上下文不替它放行。
  const ownUnits = contentUnits(q)
  // 内容单元 ≤3 的问句按字面检索的门槛（0.7）：三个词里对上两个是 0.667，
  // 0.65 会放行「桂花糕」「灯塔猫」「去北京」这类少了关键字的句子（独立复审抓到的）。
  const gateCover = ownUnits.length <= 3 ? Math.max(minCover, 0.7) : minCover
  const gateText = ownUnits.length <= 1 && ctx ? ctx + ' ' + q : q
  const gateVariants = variantsOf(gateText)
  const rankTokens = [...tokensOf(gateVariants.join(' ')), ...tokensOf(ctx)]
  const bm = bm25Scores(index, rankTokens)
  let maxBm = 1e-9
  for (const score of bm) if (score > maxBm) maxBm = score

  const picked = []
  for (let i = 0; i < rows.length; i++) {
    let best = { cover: 0, hits: 0, variant: gateText }
    for (const variant of gateVariants) {
      const units = contentUnits(variant)
      const cover = coverage(units, texts[i])
      const hits = matchedTerms(queryTerms(variant).terms, texts[i]).size
      if (cover > best.cover || (cover === best.cover && hits > best.hits)) best = { cover, hits, variant }
    }
    if (best.hits < 1 || best.cover < gateCover) continue
    const score = (0.75 * (bm[i] / maxBm) + 0.25 * best.cover) * (WEIGHT_FACTOR[rows[i].weight] || 1)
    picked.push({ row: rows[i], score, cover: best.cover, variant: best.variant })
  }

  picked.sort((a, b) => b.score - a.score || String(b.row.at).localeCompare(String(a.row.at)))
  return picked.slice(0, limit).map((p) => {
    const matched = markMatched(p.row, [p.variant])
    return { ...p.row, ...matched, hybridScore: Number(p.score.toFixed(6)), hybridCover: Number(p.cover.toFixed(6)) }
  })
}
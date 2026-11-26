// 图扩展召回（T10）：基础命中之后再补一跳邻居，只填空位、不改已有顺序
//
// 借自 Lysmor 的图扩展（AGPL-3.0）：只学设计，未复制代码；来源见 docs/attribution-zh.md，
// 口径与前后数字见 docs/graph-expand-zh.md。
//
// 三条口径：
// 1. 邻接只用她已经写下的结构：`then.refs`（写下时的依据，两个方向都算）、
//    `link-events`（后来亲手连的联想，无向）、`chapter-events`（同一段日子里的记录互为一跳）。
//    不按文本相似度自动连——那不是她连的，是算法猜的。
// 2. 只做 1 跳。2 跳开始就是"朋友的朋友"：几百条记忆里绕两步几乎人人相连，
//    那就不是"想起"，而是把半个库倒回给她。
// 3. 纯函数：输入是 loadAll 读出来的 rows（封存、asOf、backend 都由调用方先处理完），
//    这里不读盘、不写盘。越权的东西（封存的、找不到的）一律不连。
//    所以本文件不 import self-experience：那会绕成环，也会让"纯函数"变成"顺手读个盘"。

// 三种邻接来源。强弱顺序就是排 via.kind 的顺序：写出处 > 后来连的 > 同一段日子
export const KINDS = ['refs', 'link', 'chapter']
const KIND_PRIORITY = { refs: 0, link: 1, chapter: 2 }
// via.seeds 只带回最多这几条种子（种子本身已经有排名，多了只是噪声）
const MAX_VIA_SEEDS = 5

// 从已经读好的 rows 建邻接表。rows 的形状就是 loadAll 的返回值：
// - refsInfo：这条引用过谁（由 then.refs 派生）；反过来，被引用的一方通过别人的 refsInfo 连回来
// - links：事后联想，两头都能看到（loadAll 已经双向给过；这里再做一次无向化，不依赖上游）
// - chapters：她起过名字的那段日子；同一章节的成员互为一跳（大章节不两两连边，查邻居时现展开）
//
// 封存 / 重复 id / 找不到的引用不参与：邻接表里只留"看得见且确实存在"的两头。
export function buildAdjacency(rows = [], { includeSealed = false } = {}) {
  const byId = new Map()
  for (const row of rows) {
    if (!row || !row.id) continue
    if (row.duplicateOf) continue
    if (!includeSealed && row.sealed) continue
    if (!byId.has(row.id)) byId.set(row.id, row)
  }

  const edges = new Map() // id → Map(邻居 id → Set(kind))
  const link = (a, b, kind) => {
    if (!a || !b || a === b) return
    if (!byId.has(a) || !byId.has(b)) return
    let near = edges.get(a)
    if (!near) { near = new Map(); edges.set(a, near) }
    let kinds = near.get(b)
    if (!kinds) { kinds = new Set(); near.set(b, kinds) }
    kinds.add(kind)
  }
  for (const row of byId.values()) {
    for (const p of Array.isArray(row.refsInfo) ? row.refsInfo : []) {
      if (!p || !p.id || p.missing) continue
      // 引用另一头封存了：默认不连（连带会把那件事提起来）；只有调用方明确要翻封存的才连
      if (p.sealed && !includeSealed) continue
      link(row.id, p.id, 'refs')
      link(p.id, row.id, 'refs')
    }
    for (const l of Array.isArray(row.links) ? row.links : []) {
      if (!l || !l.id) continue
      if (l.sealed && !includeSealed) continue
      link(row.id, l.id, 'link')
      link(l.id, row.id, 'link')
    }
  }

  // 章节：成员表 + 每条记录落在哪几段日子里。章节可重叠，一条记录可以属于多段
  const chapters = new Map()
  const rowChapters = new Map()
  for (const row of byId.values()) {
    const mine = []
    for (const c of Array.isArray(row.chapters) ? row.chapters : []) {
      if (!c || !c.id) continue
      mine.push(c.id)
      const members = chapters.get(c.id)
      if (members) members.push(row.id)
      else chapters.set(c.id, [row.id])
    }
    if (mine.length) rowChapters.set(row.id, mine)
  }
  return { byId, edges, chapters, rowChapters }
}

// 一跳邻居：seed → { id, kind }[]。同一对可能既是出处又是联想，kinds 会给全
export function neighboursOf(graph, id) {
  const out = []
  const near = graph && graph.edges ? graph.edges.get(id) : null
  if (near) for (const [other, kinds] of near) for (const kind of kinds) out.push({ id: other, kind })
  for (const chapterId of (graph && graph.rowChapters ? graph.rowChapters.get(id) : null) || []) {
    for (const other of graph.chapters.get(chapterId) || []) out.push({ id: other, kind: 'chapter' })
  }
  return out
}

// 补位：只在基础命中还没占满 limit 时才扩展，按
//   ① 命中了几条种子（越多越可信，两个线索指到同一条 > 一个线索）
//   ② 最好那条种子的排名（第 1 名指的比第 9 名指的更相关）
//   ③ 时间（新的先补，和字面检索的并列口径一致）
// 排序取前 limit - hits.length 条。已经在基础命中里的不补（不许插队，也不许重复）。
// 返回的每条都带 via：{ seeds, seedCount, kind }，说明"因为想起哪几条才想到它"。
export function expandHits({ rows = [], hits = [], limit = 0, includeSealed = false } = {}) {
  const base = Array.isArray(hits) ? hits.filter((h) => h && h.id) : []
  const size = Number(limit)
  if (!base.length) return []
  if (!Number.isFinite(size) || size <= base.length) return []
  if (!Array.isArray(rows) || !rows.length) return []

  const graph = buildAdjacency(rows, { includeSealed })
  const taken = new Set(base.map((h) => h.id))
  const candidates = new Map()
  const remember = (id, seedIndex, kind) => {
    if (!id || taken.has(id)) return
    const row = graph.byId.get(id)
    if (!row) return // 找不到的、封存的、重复的：邻接表里本来就没有
    let c = candidates.get(id)
    if (!c) {
      c = { id, row, seedCount: 0, bestRank: Number.POSITIVE_INFINITY, kind, seeds: [] }
      candidates.set(id, c)
    }
    const seedId = base[seedIndex].id
    if (!c.seeds.includes(seedId)) {
      c.seedCount += 1
      c.seeds.push(seedId)
    }
    if (seedIndex < c.bestRank) c.bestRank = seedIndex
    if (KIND_PRIORITY[kind] < KIND_PRIORITY[c.kind]) c.kind = kind
  }

  base.forEach((seed, index) => {
    for (const near of neighboursOf(graph, seed.id)) remember(near.id, index, near.kind)
  })

  return [...candidates.values()]
    .sort((a, b) => b.seedCount - a.seedCount
      || a.bestRank - b.bestRank
      || String(b.row.at || '').localeCompare(String(a.row.at || ''))
      || String(a.id).localeCompare(String(b.id)))
    .slice(0, size - base.length)
    .map((c) => ({ ...c.row, via: { seeds: c.seeds.slice(0, MAX_VIA_SEEDS), seedCount: c.seedCount, kind: c.kind } }))
}

// 给类型与文档引用的别名（运行时没有额外含义）
export const internals = { KIND_PRIORITY, MAX_VIA_SEEDS }
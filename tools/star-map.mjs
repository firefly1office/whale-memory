#!/usr/bin/env node
// 记忆星图：把记忆目录画成一张看得见的关系图（自包含 HTML + 内联 SVG，零依赖、不联网）
//
// 借自：xingxi 的「把整理好的记忆档案连成一张看得见的星图」（Yuuyuko-uu/dsh-xingxi，自定义许可）
// 与 Lysmor 的记忆星图（AGPL-3.0）。只学设计，没有复制代码；见 docs/attribution-zh.md。
//
// 这是**只读的展示路径**（契约 §3.6「展示型导出必须尊重封存」）：
// - 不写记忆目录、不追加任何事件；出图失败时也不留半张图；
// - 封存了的经历整条不进图：正文、想法、没弄完的事、日子、以及指向它的连线都不出现，
//   只在页眉报一个件数——和 book() 的口径一致（「有 N 件她封存了的事没有收进来」）；
// - 没说出口的抽屉（unsaid-events.jsonl，契约里的旧名 unsaid.jsonl）**根本不读**：
//   它只在 listUnsaid 里打开，展示型导出去读一眼都算越界。所以本文件刻意不 import unsaid。
//
// 坏行一律报错，不当成空：少画几颗星、少画一条连线，再用一句"这就是全部"糊过去，
// 比报错更伤人。经历与封存日志交给 loadAll 的展示口径（fail closed），
// 想起 / 联想 / 章节这三本事件账在这里另外查一遍——星星大小和连线就靠它们。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAll } from '../packages/core/lib/self-experience.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'
import * as sealEvents from '../packages/core/lib/seal-events.js'
import * as linkEvents from '../packages/core/lib/link-events.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'

// 数据根目录 → 记忆目录。tools/ 下几个脚本都按这个约定找库（见 metrics.mjs）
const MEM_SUBDIR = ['plugin-data', 'biomimetic-memory']
const DEFAULT_SIZE = { width: 1440, height: 900 }
const PADDING = 74
// 图面标签的字数上限：全文在 <title>（悬停）和页面底部的列表里，图上只留一眼能认出的部分
const LABEL_CHARS = 12
// 事件账：星星大小与连线都靠它们。名字从各自模块的 eventsFile 推导，不在这里另抄一份
const EVENT_LOGS = [recallEvents, sealEvents, linkEvents, chapterEvents]

// 三种重要度的颜色：重要的暖一点，次要的暗一点
const COLORS = { important: '#ffd28a', normal: '#cfe6ff', minor: '#8fa8c4' }

// ------------------------------------------------------------------ 路径

function badDir(dir, cause) {
  const error = new Error('记忆目录读不出来：' + dir + '（' + String(cause && cause.message ? cause.message : cause) + '）。目录不存在和"一条记忆都没有"是两件事，不能混着当空图。')
  error.code = 'STARMAP_DIR_UNREADABLE'
  error.cause = cause
  return error
}

// 收两种输入：记忆目录本身（self-experience.jsonl 所在处），或它的数据根目录（<data>/plugin-data/biomimetic-memory）。
// 目录不存在直接报错：空目录能画"一条都没有"，打错路径不该画成同一张图。
export function resolveMemoryDir(dir) {
  const raw = String(dir || '').trim()
  if (!raw) throw new Error('需要记忆目录（--data=<dir>）：指向 self-experience.jsonl 所在的目录，或它的数据根目录。')
  const abs = path.resolve(raw)
  let st
  try { st = fs.statSync(abs) } catch (error) { throw badDir(abs, error) }
  if (!st.isDirectory()) throw badDir(abs, new Error('这不是目录'))
  const nested = path.join(abs, ...MEM_SUBDIR)
  try {
    if (fs.statSync(nested).isDirectory()) return nested
  } catch { }
  return abs
}

// ------------------------------------------------------------------ 事件日志的坏行

// 想起 / 封存 / 联想 / 章节：读出来看坏行数。只有"还没有这个文件"能当空；
// 权限、是目录、坏盘由各模块的 readAll 抛出来（不当 0 行）。
function assertEventsClean(memDir) {
  const broken = []
  for (const log of EVENT_LOGS) {
    const name = path.basename(log.eventsFile(memDir))
    const { bad } = log.readAll(memDir)
    if (bad) broken.push(name + ' ' + bad + ' 行')
  }
  if (!broken.length) return
  const error = new Error('事件日志有坏行（' + broken.join('；') + '）：连线和星星大小都按这些事件画，坏一行就少一条线、少算一次想起，不能当成空。先修好再导出。')
  error.code = 'STARMAP_EVENT_CORRUPT'
  error.bad = broken
  throw error
}

// ------------------------------------------------------------------ 图的数据

// 聚类：她起过名字的章节优先（和 book 一样取"开始得最晚"的那段，即最具体的），
// 没落进任何章节的按月份。聚类只影响摆位，不改任何一条经历的去留。
function clusterOf(row) {
  const list = Array.isArray(row.chapters) ? row.chapters : []
  const chapter = list.length ? list[list.length - 1] : null
  const day = String(row.day || '')
  const month = day.slice(0, 7)
  if (chapter) return { key: 'ch:' + chapter.id, label: String(chapter.name || '') || '没有名字的一段', day }
  if (!month) return { key: 'none', label: '没有日期', day }
  return { key: 'm:' + month, label: month.slice(0, 4) + ' 年 ' + month.slice(5, 7) + ' 月', day }
}

// 一条经历 → 一颗星。这里只留画图要用的字段：正文之外的原始行一律不往 HTML 里带
function nodeOf(row) {
  const c = clusterOf(row)
  return {
    id: String(row.id),
    day: String(row.day || ''),
    kind: String(row.kind || '其它'),
    weight: row.weight === 'important' || row.weight === 'minor' ? row.weight : 'normal',
    text: String((row.then && row.then.text) || ''),
    thought: String((row.then && row.then.thought) || ''),
    unfinished: String((row.then && row.then.unfinished) || ''),
    laterCount: Array.isArray(row.later) ? row.later.length : 0,
    recalls: Math.max(0, Number(row.recalls) || 0),
    clusterKey: c.key,
    clusterLabel: c.label,
    edges: 0
  }
}

// 边界：refs（写下时就知道的出处）与 link（后来亲手连的联想）都只连看得见的两头。
// 另一头封存了就连线一起省掉——理由里常写着那件事是什么，露一句等于把它又提起来。
// 同一条经历对只画一条边（两头都算过了），refs 与 link 撞在一起时标成 both。
export function buildGraph(rows) {
  const nodes = []
  const byId = new Map()
  let sealedHidden = 0
  let duplicates = 0
  for (const row of rows) {
    if (row.sealed) { sealedHidden += 1; continue }
    if (row.duplicateOf) { duplicates += 1; continue }
    const node = nodeOf(row)
    nodes.push(node)
    if (!byId.has(node.id)) byId.set(node.id, node)
  }

  const pairs = new Map()
  let missingRefs = 0
  let sealedEnds = 0
  const addEdge = (a, b, kind) => {
    if (!a || !b || a === b) return
    const key = a < b ? a + '\u0000' + b : b + '\u0000' + a
    const hit = pairs.get(key)
    if (hit) { hit.kinds.add(kind); return }
    pairs.set(key, { a, b, kinds: new Set([kind]) })
  }
  for (const row of rows) {
    const from = byId.get(String(row.id))
    if (!from) continue // 封存的行、重复行：不从它拉线
    for (const p of Array.isArray(row.refsInfo) ? row.refsInfo : []) {
      if (p.missing) { missingRefs += 1; continue }
      if (p.sealed) { sealedEnds += 1; continue }
      const to = byId.get(String(p.id))
      if (to) addEdge(from.id, to.id, 'refs')
    }
    for (const l of Array.isArray(row.links) ? row.links : []) {
      if (l.sealed) { sealedEnds += 1; continue }
      const to = byId.get(String(l.id))
      if (to) addEdge(from.id, to.id, 'link')
    }
  }

  const edges = []
  for (const p of pairs.values()) {
    const kinds = [...p.kinds]
    const kind = kinds.length > 1 ? 'both' : kinds[0]
    edges.push({ a: p.a, b: p.b, kind })
    const na = byId.get(p.a)
    const nb = byId.get(p.b)
    if (na) na.edges += 1
    if (nb) nb.edges += 1
  }
  edges.sort((x, y) => (x.a + '\u0000' + x.b).localeCompare(y.a + '\u0000' + y.b))

  const clusters = new Map()
  for (const n of nodes) {
    const hit = clusters.get(n.clusterKey)
    if (hit) hit.items.push(n)
    else clusters.set(n.clusterKey, { key: n.clusterKey, label: n.clusterLabel, items: [n] })
  }
  const list = [...clusters.values()]
  for (const c of list) c.items.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
  // 聚簇顺序按最早的那天：星图的阅读顺序就是时间顺序
  const firstDay = (c) => (c.items[0] && c.items[0].day) || ''
  list.sort((a, b) => firstDay(a).localeCompare(firstDay(b)) || a.key.localeCompare(b.key))
  return { nodes, byId, edges, clusters: list, sealedHidden, duplicates, missingRefs, sealedEnds }
}

// ------------------------------------------------------------------ 摆位

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// 确定性伪随机：同一个键每次都得到同一串数。星图是给人看的快照，
// 不能因为刷新一次就换一张脸——所以不用 Math.random。
function fnv1a(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 星星大小 = 想起次数：0 次也有一个看得见的小点，想起来越多次越亮越大
function radiusOf(node) {
  const r = 3.2 + Math.sqrt(node.recalls) * 2.3 + (node.weight === 'important' ? 1.6 : 0)
  return clamp(r, 3.2, 22)
}

// 整体缩放 + 居中：把摊开的聚簇连同它的圆一起放进画布正中。
// "推开"只负责别重叠，缩放放在这里一次算完，不会把刚推开的间距又揉回去。
function fitToCanvas(clusters, { width, height, cx0, cy0 }) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of clusters) {
    minX = Math.min(minX, c.cx - c.cr)
    minY = Math.min(minY, c.cy - c.cr)
    maxX = Math.max(maxX, c.cx + c.cr)
    maxY = Math.max(maxY, c.cy + c.cr)
  }
  const availW = Math.max(1, width - 2 * PADDING)
  const availH = Math.max(1, height - 2 * PADDING)
  // 空得太多就放大填满（最多 1.3 倍）：星星之间的间距一起放大，字不跟着变大，反而更好读
  let scale = Math.min(1.3, availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY))
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  for (const c of clusters) {
    c.cx = cx0 + (c.cx - midX) * scale
    c.cy = cy0 + (c.cy - midY) * scale
    c.cr *= scale
  }
}

// 摆法：聚簇先按面积收进画布，再用"互相推开"摊开（固定轮数、不随机），最后整体缩放居中；
// 星星在聚簇里按黄金角螺旋由内向外铺开（越靠外越晚）。
// 为什么不是环：聚簇大小差得多（7 条 vs 71 条），环上相邻两簇会叠成一团；
// 推开法只用加减乘除，同一个键每次落点相同，画出来不会因为刷新换一张脸。
export function layoutGraph(model, { width, height }) {
  const n = model.clusters.length
  if (!n) return model
  const cx0 = width / 2
  const cy0 = height / 2
  const gap = 40
  for (const c of model.clusters) c.cr = 20 + 13 * Math.sqrt(c.items.length)

  // 总面积先收进画布：宁可疏一点，也别让几段日子叠在一起分不清边界
  const availW = width - 2 * PADDING
  const availH = height - 2 * PADDING
  const area = model.clusters.reduce((s, c) => s + Math.PI * c.cr * c.cr, 0)
  const maxArea = Math.max(1, availW * availH * 0.5)
  if (area > maxArea) {
    const k = Math.sqrt(maxArea / area)
    for (const c of model.clusters) c.cr *= k
  }

  if (n === 1) {
    model.clusters[0].cx = cx0
    model.clusters[0].cy = cy0
  } else {
    // 初始位置：大的往中间放、按黄金角螺旋铺开；之后互相推开
    const bySize = [...model.clusters].sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
    const maxCr = Math.max(...bySize.map((c) => c.cr))
    const rx = Math.max(60, width / 2 - PADDING - maxCr)
    const ry = Math.max(60, height / 2 - PADDING - maxCr)
    bySize.forEach((c, k) => {
      const t = Math.sqrt(k / Math.max(1, n - 1))
      const a = k * 2.39996323
      c.cx = cx0 + Math.cos(a) * rx * t
      c.cy = cy0 + Math.sin(a) * ry * t
    })
    // 推开：每一轮把重叠的两簇各推开一半，最多 400 轮；推不动（<0.2px）就停。
    // 不回中——回中会把刚推开的距离又吃掉（上一版就是这么叠回去的）；居中留给最后整体平移。
    const keepInside = (c) => {
      const padX = Math.min(PADDING + c.cr * 0.9, width / 2)
      const padY = Math.min(PADDING + c.cr * 0.9, height / 2)
      const loX = padX
      const hiX = width - padX
      const loY = padY
      const hiY = height - padY
      c.cx = loX <= hiX ? clamp(c.cx, loX, hiX) : cx0
      c.cy = loY <= hiY ? clamp(c.cy, loY, hiY) : cy0
    }
    for (let iter = 0; iter < 400; iter++) {
      let moved = 0
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = model.clusters[i]
          const b = model.clusters[j]
          const dx = b.cx - a.cx
          const dy = b.cy - a.cy
          const dist = Math.hypot(dx, dy) || 0.01
          const need = a.cr + b.cr + gap
          if (dist >= need) continue
          const push = (need - dist) * 0.5
          const ux = dx / dist
          const uy = dy / dist
          a.cx -= ux * push
          a.cy -= uy * push
          b.cx += ux * push
          b.cy += uy * push
          if (push > moved) moved = push
        }
      }
      for (const c of model.clusters) keepInside(c)
      if (moved < 0.2) break
    }
    fitToCanvas(model.clusters, { width, height, cx0, cy0 })
  }

  for (let k = 0; k < n; k++) {
    const c = model.clusters[k]
    const count = c.items.length
    const rnd = prng(fnv1a('cluster|' + c.key))
    for (let i = 0; i < count; i++) {
      const item = c.items[i]
      const a = i * 2.39996323 // 黄金角：相邻的点不会挤成一条线
      const rad = c.cr * Math.sqrt((i + 0.5) / count)
      const jitter = clamp(c.cr / Math.max(4, Math.sqrt(count)) * 0.18, 0, 4)
      item.x = c.cx + Math.cos(a) * rad + (rnd() - 0.5) * jitter
      item.y = c.cy + Math.sin(a) * rad * 0.78 + (rnd() - 0.5) * jitter
      item.r = radiusOf(item)
    }
  }

  const nodeById = new Map(model.nodes.map((x) => [x.id, x]))
  for (const e of model.edges) {
    const a = nodeById.get(e.a)
    const b = nodeById.get(e.b)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy) || 1
    const bend = Math.min(46, dist * 0.14) * (fnv1a(e.a + '\u0000' + e.b) % 2 ? 1 : -1)
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    e.d = 'M' + num(a.x) + ' ' + num(a.y) + ' Q' + num(mx - (dy / dist) * bend) + ' ' + num(my + (dx / dist) * bend) + ' ' + num(b.x) + ' ' + num(b.y)
  }
  return model
}

// ------------------------------------------------------------------ 渲染

const num = (v) => String(Math.round(Number(v) * 10) / 10)

// 同一个字符一个字符换：地图上只留一小截，全文在悬停提示与列表里
function shortText(text, max = LABEL_CHARS) {
  const chars = [...String(text || '')]
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('')
}

// 正文进 HTML 一律转义：正文里可以有 < > & " '（她写什么都可能）
const esc = (text) => String(text === null || text === undefined ? '' : text)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function pickLabels(nodes) {
  if (nodes.length <= 40) return new Set(nodes.map((x) => x.id))
  // 星多的时候只标每个聚簇里被想起最多的三颗，不然整张图糊成一片字
  const out = new Set()
  const byCluster = new Map()
  for (const n of nodes) {
    const list = byCluster.get(n.clusterKey)
    if (list) list.push(n)
    else byCluster.set(n.clusterKey, [n])
  }
  for (const list of byCluster.values()) {
    list.sort((a, b) => b.recalls - a.recalls || a.day.localeCompare(b.day) || a.id.localeCompare(b.id))
    for (const n of list.slice(0, 3)) out.add(n.id)
  }
  return out
}

function tooltipOf(node) {
  const lines = []
  lines.push((node.day || '没有日期') + (node.kind && node.kind !== '其它' ? ' · ' + node.kind : ''))
  if (node.text) lines.push(node.text)
  if (node.thought) lines.push('当时想：' + node.thought)
  if (node.unfinished) lines.push('还没完的：' + node.unfinished)
  const meta = []
  if (node.recalls) meta.push('被想起 ' + node.recalls + ' 次')
  else meta.push('还没被想起过')
  if (node.laterCount) meta.push(node.laterCount + ' 条后记')
  if (node.edges) meta.push(node.edges + ' 条连线')
  lines.push('（' + meta.join(' · ') + '）')
  return lines.join('\n')
}

function svgContent(model, { width, height }) {
  const { clusters, edges, nodes } = model
  const out = []
  // 不写 xmlns：这段 SVG 内联在 HTML 里（HTML5 不需要它），而"生成物里没有任何 http 地址"
  // 这条要能被逐字节验证——一个 xmlns 就会在那里留下一串 http://。
  out.push('<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="记忆星图：' + nodes.length + ' 颗星，' + edges.length + ' 条连线">')
  out.push('<rect width="' + width + '" height="' + height + '" fill="#04060d"/>')

  // 背景星尘：固定种子，只是底色，不表示任何数据
  const rnd = prng(fnv1a('star-map-background'))
  for (let i = 0; i < 150; i++) {
    out.push('<circle cx="' + num(rnd() * width) + '" cy="' + num(rnd() * height) + '" r="' + num(0.35 + rnd() * 0.8) + '" fill="#cfe0ff" opacity="' + num(0.08 + rnd() * 0.3) + '"/>')
  }

  if (!nodes.length) {
    out.push('<text x="' + num(width / 2) + '" y="' + num(height / 2) + '" text-anchor="middle" fill="#8ea6c4" font-size="18">' + (model.sealedHidden ? '她封存了的事不画在图上，这里没有别的了。' : '还没有可以画进星图的经历。') + '</text>')
    out.push('</svg>')
    return out.join('\n')
  }

  for (const c of clusters) {
    out.push('<circle cx="' + num(c.cx) + '" cy="' + num(c.cy) + '" r="' + num(c.cr) + '" fill="#7fa6e0" fill-opacity="0.03" stroke="#6f8fbf" stroke-opacity="0.18" stroke-dasharray="4 7"/>')
    const ly = clamp(c.cy - c.cr - 16, 26, height - 12)
    out.push('<text x="' + num(c.cx) + '" y="' + num(ly) + '" text-anchor="middle" fill="#9fb6d6" font-size="14" letter-spacing="2">' + esc(c.label) + '</text>')
  }

  const stroke = { refs: '#66c7f0', link: '#b79bff', both: '#8fd0ff' }
  const opacity = { refs: 0.34, link: 0.36, both: 0.42 }
  for (const e of edges) {
    if (!e.d) continue
    const dash = e.kind === 'link' ? ' stroke-dasharray="5 5"' : ''
    out.push('<path d="' + e.d + '" fill="none" stroke="' + stroke[e.kind] + '" stroke-opacity="' + opacity[e.kind] + '" stroke-width="1.1"' + dash + '/>')
  }

  const labels = pickLabels(nodes)
  const clusterByKey = new Map(clusters.map((c) => [c.key, c]))
  for (const n of nodes) {
    const color = COLORS[n.weight]
    out.push('<circle cx="' + num(n.x) + '" cy="' + num(n.y) + '" r="' + num(n.r * 2.4) + '" fill="' + color + '" opacity="0.1"/>')
    if (n.recalls) out.push('<circle cx="' + num(n.x) + '" cy="' + num(n.y) + '" r="' + num(n.r + 2.6) + '" fill="none" stroke="' + color + '" stroke-opacity="0.4" stroke-width="0.9"/>')
    out.push('<circle cx="' + num(n.x) + '" cy="' + num(n.y) + '" r="' + num(n.r) + '" fill="' + color + '"><title>' + esc(tooltipOf(n)) + '</title></circle>')
    out.push('<circle cx="' + num(n.x) + '" cy="' + num(n.y) + '" r="' + num(n.r * 0.42) + '" fill="#ffffff" opacity="0.85"/>')
    if (labels.has(n.id)) {
      // 标签放在"离聚簇中心更远的那一侧"：上半圈的字往上走、下半圈往下走，字就不会压成一排
      const c = clusterByKey.get(n.clusterKey)
      const above = Boolean(c) && n.y < c.cy
      const ty = above ? n.y - n.r - 7 : n.y + n.r + 13
      // 文字压在连线上也要读得出来：先描一圈底色，再填字（paint-order）
      out.push('<text x="' + num(n.x) + '" y="' + num(ty) + '" text-anchor="middle" font-size="12" fill="#cfe0f5" stroke="#04060d" stroke-width="3" paint-order="stroke" stroke-linejoin="round">' + esc(shortText(n.text)) + '</text>')
    }
  }
  out.push('</svg>')
  return out.join('\n')
}

function legendHtml() {
  return [
    '<ul class="legend">',
    '<li><i class="dot" style="background:' + COLORS.important + '"></i>重要</li>',
    '<li><i class="dot" style="background:' + COLORS.normal + '"></i>普通</li>',
    '<li><i class="dot" style="background:' + COLORS.minor + '"></i>次要</li>',
    '<li><i class="bar" style="border-color:#66c7f0"></i>出处（refs）</li>',
    '<li><i class="bar dashed" style="border-color:#b79bff"></i>后来连的（link）</li>',
    '<li><i class="dot" style="background:transparent;border:1px solid #cfe6ff"></i>圈越大 = 被想起越多次</li>',
    '</ul>'
  ].join('')
}

function listHtml(model) {
  const out = ['<section class="list"><details><summary>逐条列出（' + model.nodes.length + ' 条）</summary>']
  for (const c of model.clusters) {
    out.push('<div class="cluster"><h3>' + esc(c.label) + ' <span>' + c.items.length + ' 条</span></h3><ol>')
    for (const n of c.items) {
      const bits = ['<li><span class="d">' + esc(n.day || '没有日期') + '</span><span class="k">' + esc(n.kind) + '</span><span class="t">' + esc(n.text) + '</span>']
      if (n.recalls) bits.push('<span class="r">×' + n.recalls + '</span>')
      if (n.edges) bits.push('<span class="r e">↔' + n.edges + '</span>')
      if (n.laterCount) bits.push('<span class="r l">+' + n.laterCount + ' 后记</span>')
      bits.push('</li>')
      out.push(bits.join(''))
    }
    out.push('</ol></div>')
  }
  out.push('</details></section>')
  return out.join('\n')
}

const CSS = [
  ':root{color-scheme:dark}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:#04060d;color:#dce7f7;font:14px/1.7 "Noto Sans SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif}',
  'header{max-width:1680px;margin:0 auto;padding:28px 32px 6px}',
  'h1{margin:0 0 6px;font-size:22px;font-weight:600;letter-spacing:.08em}',
  '.meta{margin:0;color:#8ea6c4;font-size:13px}',
  '.legend{display:flex;flex-wrap:wrap;gap:18px;margin:14px 0 0;padding:0;list-style:none;color:#9fb6d6;font-size:12.5px}',
  '.legend li{display:flex;align-items:center;gap:6px}',
  '.dot{width:10px;height:10px;border-radius:50%;display:inline-block}',
  '.bar{width:22px;height:0;border-top:2px solid;display:inline-block}',
  '.bar.dashed{border-top-style:dashed}',
  'figure{margin:8px 0 0;padding:0}',
  'svg{display:block;width:100%;height:auto}',
  'section.list{max-width:1680px;margin:0 auto;padding:10px 32px 0}',
  'details{background:#0a1120;border:1px solid #17233a;border-radius:10px;padding:12px 16px}',
  'summary{cursor:pointer;color:#b9cde8}',
  '.cluster h3{margin:16px 0 4px;font-size:13.5px;font-weight:600;color:#9fb6d6;letter-spacing:.06em}',
  '.cluster h3 span{font-weight:400;color:#6f86a4}',
  'ol{margin:6px 0 0;padding-left:22px}',
  'li{margin:4px 0;color:#c6d5ea}',
  '.d{color:#7f96b4;font-variant-numeric:tabular-nums;margin-right:6px}',
  '.k{color:#8fb4de;margin-right:6px}',
  '.r{color:#ffd28a;margin-left:8px;font-size:12.5px;font-variant-numeric:tabular-nums}',
  '.r.e{color:#b79bff}',
  '.r.l{color:#8ea6c4}',
  'footer{max-width:1680px;margin:0 auto;padding:16px 32px 40px;color:#6f86a4;font-size:12px}'
].join('\n')

function statsLine(stats) {
  const bits = [
    stats.experiences + ' 条经历',
    '画进来 ' + stats.visible + ' 颗星',
    stats.clusterCount + ' 段日子',
    stats.edges.total + ' 条连线',
    stats.recallsTotal ? '被想起 ' + stats.recallsTotal + ' 次' : ''
  ].filter(Boolean)
  if (stats.sealedHidden) bits.push('另外 ' + stats.sealedHidden + ' 件她封存了的事没有画进来')
  return bits.join(' · ')
}

function renderHtml(model, { width, height, title, now, stats }) {
  const when = new Date(now)
  const whenText = Number.isNaN(when.getTime()) ? '' : when.toLocaleString('zh-CN', { hour12: false })
  const out = []
  out.push('<!doctype html>')
  out.push('<html lang="zh-CN">')
  out.push('<head>')
  out.push('<meta charset="utf-8">')
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1">')
  out.push('<meta name="generator" content="whale-memory tools/star-map.mjs">')
  out.push('<title>' + esc(title) + '</title>')
  out.push('<style>\n' + CSS + '\n</style>')
  out.push('</head>')
  out.push('<body>')
  out.push('<header>')
  out.push('<h1>' + esc(title) + '</h1>')
  out.push('<p class="meta">' + esc(statsLine(stats)) + '</p>')
  out.push('<p class="meta">' + (whenText ? '导出于 ' + esc(whenText) + ' · ' : '') + '只读快照 · 不联网、不引外部资源</p>')
  if (stats.visible) out.push(legendHtml())
  out.push('</header>')
  out.push('<figure>')
  out.push(svgContent(model, { width, height }))
  out.push('</figure>')
  if (stats.visible) out.push(listHtml(model))
  out.push('<footer>每颗星是一条经历，圆的大小是她被想起过多少次；连线来自写下时的出处（refs）和她后来亲手连的联想（link）。' +
    (stats.sealedHidden ? '封存的经历整条不在图上，指向它们的连线也不画。' : '') +
    '这不是聊天记录，也不是召回结果——只是把已经写下的东西按日子摊开看一眼。</footer>')
  out.push('</body>')
  out.push('</html>')
  return out.join('\n') + '\n'
}

// ------------------------------------------------------------------ 对外

function dimension(name, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 320 || n > 8000) throw new Error(name + ' 要在 320 到 8000 之间（收到：' + String(value) + '）。')
  return Math.round(n)
}

function sumBy(list, pick) {
  let sum = 0
  for (const x of list) sum += pick(x)
  return sum
}

// 出图：返回 { html, stats }。不写盘；stats 里的路径只给调用方看，不写进 HTML（导出物里不出现本机路径）
export function generateStarMap(memDir, { now = new Date(), width, height, title = '记忆星图' } = {}) {
  const w = dimension('width', width, DEFAULT_SIZE.width)
  const h = dimension('height', height, DEFAULT_SIZE.height)
  const dir = resolveMemoryDir(memDir)
  assertEventsClean(dir)
  // 展示口径：经历坏行、封存日志坏行都在这里抛（EXPERIENCE_CORRUPT / SEAL_EVENTS_CORRUPT），
  // 不传 allowCorrupt —— 那张"看起来完整"的图比报错更会骗人。
  const rows = loadAll(dir)
  const model = buildGraph(rows)
  layoutGraph(model, { width: w, height: h })
  const sizes = model.nodes.map((x) => x.r)
  const stats = {
    memoryDir: dir,
    experiences: rows.length,
    visible: model.nodes.length,
    sealedHidden: model.sealedHidden,
    duplicates: model.duplicates,
    clusterCount: model.clusters.length,
    clusters: model.clusters.map((c) => ({ label: c.label, count: c.items.length })),
    edges: {
      total: model.edges.length,
      refs: model.edges.filter((e) => e.kind === 'refs').length,
      link: model.edges.filter((e) => e.kind === 'link').length,
      both: model.edges.filter((e) => e.kind === 'both').length
    },
    missingRefs: model.missingRefs,
    sealedEnds: model.sealedEnds,
    recallsTotal: sumBy(model.nodes, (n) => n.recalls),
    maxRecalls: model.nodes.length ? Math.max(...model.nodes.map((n) => n.recalls)) : 0,
    nodeSize: sizes.length ? { min: Math.min(...sizes), max: Math.max(...sizes) } : { min: 0, max: 0 },
    nodes: model.nodes.map((n) => ({ id: n.id, day: n.day, recalls: n.recalls, size: n.r })),
    width: w,
    height: h,
    generatedAt: new Date(now).toISOString()
  }
  const html = renderHtml(model, { width: w, height: h, title: String(title || '记忆星图'), now, stats })
  return { html, stats }
}

// 出图并落盘：先在图内存里生成完，再写临时文件改名。数据坏了不会留下半张图，
// 写到一半失败也不会把上一次成功的文件弄成半截。
export function writeStarMap(memDir, outFile, opts = {}) {
  const raw = String(outFile || '').trim()
  if (!raw) throw new Error('需要输出文件（--out=<file.html>）：不传就只生成、不落盘。')
  const out = path.resolve(raw)
  const { html, stats } = generateStarMap(memDir, opts)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const tmp = out + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  try {
    fs.writeFileSync(tmp, html, 'utf8')
    fs.renameSync(tmp, out)
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }) } catch { }
    throw error
  }
  return { path: out, bytes: Buffer.byteLength(html), stats }
}

// ------------------------------------------------------------------ 命令行

const HELP = [
  '用法：node tools/star-map.mjs --data=<记忆目录> [--out=<file.html>] [选项]',
  '',
  '  --data=<dir>      self-experience.jsonl 所在的目录，或它的数据根目录（含 plugin-data/biomimetic-memory）',
  '  --out=<file>      把 HTML 写到这个文件；不给就写到标准输出（不落盘）',
  '  --title=<text>    图顶的标题（默认「记忆星图」）',
  '  --width=<px>      画布宽（默认 1440，320–8000）',
  '  --height=<px>     画布高（默认 900，320–8000）',
  '  --now=<iso>       固定"导出时间"（给可重复的测试用；平时不用传）',
  '  --json            把统计以 JSON 打到标准输出',
  '  --help            这一页',
  '',
  '只读：不写记忆目录、不追加事件；封存的经历与没说出口的抽屉都不会出现在图里。'
].join('\n')

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const argv = process.argv.slice(2)
  const arg = (name, fallback = '') => {
    const hit = argv.find((a) => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : fallback
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    process.exit(0)
  }
  const dataArg = arg('data', process.env.WHALE_DATA_DIR || '')
  const outArg = arg('out', '')
  const nowArg = arg('now', '')
  const title = arg('title', '记忆星图')
  const asJson = argv.includes('--json')
  try {
    if (!dataArg) throw new Error('需要 --data=<记忆目录>。用法见 --help。')
    const opts = { title }
    if (nowArg) {
      const when = new Date(nowArg)
      if (Number.isNaN(when.getTime())) throw new Error('--now 不是能认的时间：' + nowArg)
      opts.now = when
    }
    const wArg = arg('width', '')
    const hArg = arg('height', '')
    if (wArg) opts.width = wArg
    if (hArg) opts.height = hArg

    if (!outArg) {
      // 没有 --out：HTML 走标准输出，人话走标准错误，方便 `> star-map.html`
      const { html, stats } = generateStarMap(dataArg, opts)
      process.stdout.write(html)
      process.stderr.write(statsLine(stats) + '\n（HTML 已写到标准输出；要存文件用 --out=<file.html>）\n')
    } else {
      const res = writeStarMap(dataArg, outArg, opts)
      if (asJson) {
        console.log(JSON.stringify(res.stats, null, 2))
      } else {
        console.log(statsLine(res.stats))
        console.log('写好了：' + res.path + '（' + res.bytes + ' 字节）')
      }
    }
  } catch (error) {
    console.error(String(error && error.message ? error.message : error))
    process.exitCode = 1
  }
}
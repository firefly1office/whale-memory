// 她自己的经历 v2：写下时拍下"当时"，回想分「当时 / 现在」两段；重要的写细，次要的简写
import fs from 'node:fs'
import path from 'node:path'
import * as recallEvents from './recall-events.js'
import * as laterEvents from './later-events.js'

const FILE = 'self-experience.jsonl'
const WEIGHTS = new Set(['important', 'normal', 'minor'])

function readAll(dir, { rewriting = false } = {}) {
  let raw
  try {
    raw = fs.readFileSync(path.join(dir, FILE), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const line of raw.split('\n').filter(line => line.trim())) {
    try { rows.push(JSON.parse(line)) }
    catch {
      if (rewriting) throw new Error('经历文件含损坏记录，请备份并修复后再修改。')
    }
  }
  return rows
}

function atomicWrite(dir, rows) {
  const file = path.join(dir, FILE)
  const tmp = file + '.tmp-' + Date.now() + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

function writeAll(dir, rows) {
  atomicWrite(dir, rows)
}

// 字段上限：写的时候超了就报错，不静默截断
export const LIMITS = { text: 2000, scene: 500, thought: 1000, unfinished: 300, feelings: 8, kind: 20, laterThought: 1000, laterReason: 200 }

function tooLong(name, value, max) {
  const n = String(value || '').length
  if (n > max) throw new Error(`${name} 太长（${n}/${max} 字），删一些或拆成两条再写。`)
  return String(value || '')
}

function normalize(r) {
  if (!r) return null
  if (r.then && typeof r.then === 'object') {
    return { ...r, weight: WEIGHTS.has(r.weight) ? r.weight : 'normal', later: Array.isArray(r.later) ? r.later : [] }
  }
  // 旧格式：text/thought 在顶层
  return {
    id: r.id || ('exp_legacy_' + (r.at || Date.now()).toString().replace(/\D/g, '').slice(0, 12)),
    at: r.at || '',
    day: r.day || String(r.at || '').slice(0, 10),
    author: 'self',
    source: r.source || 'own-time',
    kind: r.kind || '其它',
    weight: WEIGHTS.has(r.weight) ? r.weight : 'normal',
    then: {
      text: String(r.text || ''),
      scene: '',
      feeling: [],
      thought: String(r.thought || ''),
      unfinished: '',
      quote: null,
      state: null
    },
    later: Array.isArray(r.later) ? r.later : [],
    status: r.status || 'kept',
    legacy: true
  }
}

export function loadAll(dir) {
  const rows = readAll(dir).map(normalize).filter((r) => r && r.then && r.then.text)
  if (!rows.length) return rows

  // 想起次数：有事件文件就以事件为准；没有事件时才退回旧字段
  let counts = new Map()
  try { counts = recallEvents.countByExp(dir) } catch { /* 事件文件坏了也不影响读经历 */ }

  // 改主意：旧 later 数组 + later-events 事件，按时间合并
  let laterMap = new Map()
  try { laterMap = laterEvents.groupByExp(dir) } catch { }

  return rows.map((r) => {
    const c = counts.get(r.id)
    const extra = laterMap.get(r.id) || []
    const merged = [...(r.later || []), ...extra]
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    const next = { ...r, later: merged }
    if (c) {
      next.recalls = c.count
      next.lastRecalledAt = c.lastAt || r.lastRecalledAt || ''
    }
    return next
  })
}

// 写下时的"当时"：她写的 + 系统能自动带的状态（情绪/时间/场合）
export function addExperience(dir, { text, scene = '', feeling = [], thought = '', unfinished = '', quote = null, weight = 'normal', kind = '其它', state = null, source = 'own-time' }) {
  if (!String(text || '').trim()) throw new Error('text 不能是空的。')
  const safeText = tooLong('text', text, LIMITS.text)
  const safeScene = tooLong('scene', scene, LIMITS.scene)
  const safeThought = tooLong('thought', thought, LIMITS.thought)
  const safeUnfinished = tooLong('unfinished', unfinished, LIMITS.unfinished)
  const safeKind = tooLong('kind', kind || '其它', LIMITS.kind)
  const feelings = (Array.isArray(feeling) ? feeling : [feeling]).map((f) => String(f || '').trim()).filter(Boolean)
  if (feelings.length > LIMITS.feelings) throw new Error(`feeling 最多 ${LIMITS.feelings} 个，现在是 ${feelings.length} 个。`)

  fs.mkdirSync(dir, { recursive: true })
  const now = new Date()
  const id = 'exp_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6)
  const row = {
    id,
    at: now.toISOString(),
    day: now.toLocaleDateString('sv-SE'),
    author: 'self',
    source,
    kind: safeKind,
    weight: WEIGHTS.has(weight) ? weight : 'normal',
    then: {
      text: safeText,
      scene: safeScene,
      feeling: feelings,
      thought: safeThought,
      unfinished: safeUnfinished,
      quote: quote && quote.text ? { text: tooLong('quote', quote.text, 500), source: tooLong('quote.source', quote.source || '', 120) } : null,
      state: state && typeof state === 'object' ? { at: now.toISOString(), ...state } : { at: now.toISOString() }
    },
    later: [],
    status: 'kept'
  }
  const fd = fs.openSync(path.join(dir, FILE), 'a+')
  try {
    const size = fs.fstatSync(fd).size
    const lastByte = Buffer.alloc(1)
    if (size) fs.readSync(fd, lastByte, 0, 1, size - 1)
    const separator = size && lastByte[0] !== 10 ? '\n' : ''
    fs.writeFileSync(fd, separator + JSON.stringify(row) + '\n', 'utf8')
  } finally {
    fs.closeSync(fd)
  }
  return row
}

// 改主意 / 回头想：只追加一条 later 事件，不读全量、不重写经历文件
export function reviseExperience(dir, { id, thought, reason = '' }) {
  if (!String(id || '').trim()) return { ok: false, error: '需要 id' }
  if (!String(thought || '').trim()) return { ok: false, error: 'thought 不能是空的。' }
  try {
    const safeThought = tooLong('thought', thought, LIMITS.laterThought)
    const safeReason = tooLong('reason', reason, LIMITS.laterReason)
    const row = laterEvents.append(dir, { id: String(id), thought: safeThought, reason: safeReason })
    return { ok: true, id: row.id, at: row.at }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 想起时记一笔：往 recall-events.jsonl 追加一条事件，不动经历正文
// 不做存在性检查：孤儿事件在 loadAll 合并时自然被忽略
export function markRecalled(dir, id) {
  if (!String(id || '').trim()) return false
  try { recallEvents.append(dir, { id: String(id) }) } catch { return false }
  return true
}

export function currentView(dir, id) {
  const rows = loadAll(dir)
  return rows.find((r) => r.id === id) || null
}

// 高频但不携带信息的词：不参与重叠计算，避免「今天/什么/我的」把不相关的东西拉进来
const STOP = new Set([
  '什么', '怎么', '这个', '那个', '我的', '你的', '他的', '她的', '我们', '他们', '她们', '自己',
  '昨天', '今天', '明天', '后天', '前天', '现在', '刚刚', '后来', '以前', '以后', '时候',
  '是不是', '有没有', '一点', '一些', '东西', '事情', '觉得', '知道', '记得', '忘了',
  '可能', '应该', '还是', '就是', '但是', '因为', '所以', '如果', '然后', '已经',
  '没有', '不是', '可以', '一个', '这样', '那样', '真的', '其实', '比较', '非常', '特别',
  '一直', '总是', '大概', '也许', '当然', '而是', '并且', '或者', '不过', '虽然', '只是',
  '还有', '以及', '关于', '对于', '买了', '了什', '说了', '去了', '来了', '看到', '做了'
])

function queryBigrams(q) {
  const cleaned = String(q || '').replace(/[\s\p{P}\p{S}]+/gu, '')
  const out = new Set()
  for (let i = 0; i + 2 <= cleaned.length; i++) {
    const g = cleaned.slice(i, i + 2)
    if (!STOP.has(g)) out.add(g)
  }
  return { cleaned, bigrams: out }
}

// 相关度 × 重要度：重要的先被想起
// 阈值比较的是「原始重叠数」，重要度只影响排序，不影响过线门槛
// 长查询要求按比例命中，避免「命中一个二字词就算相关」
// mark=false（默认）：只读；mark=true 追加一条 recall 事件（不重写经历文件）
export function recall(dir, query, { limit = 3, minOverlap = 1, mark = false, minRatio = 0.6 } = {}) {
  const rows = loadAll(dir)
  const q = String(query || '')
  const { cleaned, bigrams } = queryBigrams(q)
  const required = (q && cleaned.length >= 8)
    ? Math.max(minOverlap, Math.ceil(bigrams.size * minRatio))
    : minOverlap

  const measure = (r) => {
    const s = (r.then.text + ' ' + r.then.thought + ' ' + (r.then.feeling || []).join(' '))
    const t = s.replace(/[\s\p{P}\p{S}]+/gu, '')
    let n = 0
    for (const g of bigrams) if (t.includes(g)) n++
    // 记录自身的 bigram 规模：长记录天然更容易碰巧命中，排序时按 √长度 归一化
    const size = Math.max(1, t.length - 1)
    return { n, size }
  }
  const weightOf = (r) => (r.weight === 'important' ? 3 : r.weight === 'minor' ? 0.5 : 1)
  const picked = rows.map((r) => {
    const { n, size } = measure(r)
    return { r, n, s: (n / Math.sqrt(size)) * weightOf(r) }
  })
    .filter((x) => (q ? x.n >= required : true))
    .sort((a, b) => b.s - a.s || String(b.r.at).localeCompare(String(a.r.at)))
    .slice(0, limit).map((x) => x.r)

  if (!mark || !picked.length) return picked

  // 记完就地 +1，不回读全量；下一次读取自然会对上
  const at = new Date().toISOString()
  for (const r of picked) {
    try { recallEvents.append(dir, { id: r.id, query: q }) } catch { /* 坏文件时不阻断召回 */ }
  }
  return picked.map((r) => ({ ...r, recalls: Number(r.recalls || 0) + 1, lastRecalledAt: at }))
}

// 「当时 / 现在」两段式：模板拼，不调模型；没有的字段就如实说没有
export function renderTwoPart(entry, { now = new Date(), laterCount = 0 } = {}) {
  if (!entry) return ''
  const t = entry.then
  const when = new Date(entry.at || entry.day)
  const hh = Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const lines = []
  lines.push('【当时】')
  lines.push('- 时间：' + (entry.day || '') + (hh ? ' ' + hh : ''))
  if (t.scene) lines.push('- 场景：' + t.scene)
  if (t.quote && t.quote.text) lines.push('- 我读到的原文：' + t.quote.text + (t.quote.source ? '（' + t.quote.source + '）' : ''))
  lines.push('- 我写下的话：' + t.text)
  if ((t.feeling || []).length) lines.push('- 当时的感觉：' + t.feeling.join('、'))
  if (t.thought) lines.push('- 当时的想法：' + t.thought)
  if (t.unfinished) lines.push('- 还没完的：' + t.unfinished)
  if (t.state && t.state.mood) lines.push('- 记录里的情绪：' + t.state.mood)
  if (entry.legacy && !t.quote) lines.push('- （这条只留下感想，当时的原文没记）')
  lines.push('', '【现在】')
  lines.push('- 现在时间：' + now.toLocaleString('zh-CN', { hour12: false }))
  lines.push('- 这条被你想起过 ' + Number(entry.recalls || 0) + ' 次' + (entry.lastRecalledAt ? '，上次是 ' + String(entry.lastRecalledAt).slice(0, 10) : ''))
  const later = Array.isArray(entry.later) ? entry.later : []
  if (later.length) {
    const last = later[later.length - 1]
    lines.push('- 后来你想过：' + String(last.thought || '').slice(0, 80) + (last.day ? '（' + last.day + '）' : ''))
  } else {
    lines.push('- 之后你还没回头想过')
  }
  lines.push('', '以上是那天留下的全部；没留下的，我不记得。')
  return lines.join('\n')
}

export const internals = { WEIGHTS, FILE }
// 兼容旧调用：只要一句摘要的地方仍可用
export function recallForContext(dir, query, { max = 1 } = {}) {
  return recall(dir, query, { limit: max }).map((r) => ({ id: r.id, day: r.day, text: r.then.text, thought: r.then.thought, weight: r.weight, raw: r }))
}

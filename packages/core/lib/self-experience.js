// 她自己的经历 v2：写下时拍下"当时"，回想分「当时 / 现在」两段；重要的写细，次要的简写
import fs from 'node:fs'
import path from 'node:path'

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
  const tmp = file + '.tmp-' + Date.now()
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

function writeAll(dir, rows) {
  atomicWrite(dir, rows)
}

// 字段上限：写的时候超了就报错，不静默截断
export const LIMITS = { text: 2000, scene: 500, thought: 1000, unfinished: 300, feelings: 8, kind: 20 }

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
  return readAll(dir).map(normalize).filter((r) => r && r.then && r.then.text)
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

// 改主意 / 回头想：只往 later 里加，不动"当时"
export function reviseExperience(dir, { id, thought, reason = '' }) {
  const rows = readAll(dir, { rewriting: true })
  const i = rows.findIndex((r) => r.id === id)
  if (i < 0) return { ok: false, error: '找不到这条经历' }
  const cur = normalize(rows[i])
  cur.later = Array.isArray(cur.later) ? cur.later : []
  cur.later.push({ at: new Date().toISOString(), day: new Date().toLocaleDateString('sv-SE'), thought: String(thought || '').slice(0, 300), reason: String(reason || '').slice(0, 200) })
  rows[i] = cur
  writeAll(dir, rows)
  return { ok: true, entry: cur }
}

// 想起时记一笔（不改内容）
export function markRecalled(dir, id) {
  const rows = readAll(dir, { rewriting: true })
  const i = rows.findIndex((r) => r.id === id)
  if (i < 0) return false
  const cur = normalize(rows[i])
  cur.recalls = Number(cur.recalls || 0) + 1
  cur.lastRecalledAt = new Date().toISOString()
  rows[i] = cur
  writeAll(dir, rows)
  return true
}

export function currentView(dir, id) {
  const rows = loadAll(dir)
  return rows.find((r) => r.id === id) || null
}

// 相关度 + 重要度：重要的先被想起
// mark=true 时，被取回的条目会记一次"想起"（计数 +1，内容不动）
export function recall(dir, query, { limit = 3, minOverlap = 1, mark = true } = {}) {
  const rows = loadAll(dir)
  const q = String(query || '')
  const score = (r) => {
    const s = (r.then.text + ' ' + r.then.thought + ' ' + (r.then.feeling || []).join(' '))
    let n = 0
    const big = new Set()
    const qc = q.replace(/[\s\p{P}\p{S}]+/gu, '')
    for (let i = 0; i + 2 <= qc.length; i++) big.add(qc.slice(i, i + 2))
    const t = s.replace(/[\s\p{P}\p{S}]+/gu, '')
    for (const g of big) if (t.includes(g)) n++
    const w = r.weight === 'important' ? 3 : r.weight === 'minor' ? 0.5 : 1
    return n * w
  }
  const picked = rows.map((r) => ({ r, s: score(r) }))
    .filter((x) => (q ? x.s >= minOverlap : true))
    .sort((a, b) => b.s - a.s || String(b.r.at).localeCompare(String(a.r.at)))
    .slice(0, limit).map((x) => x.r)

  if (!mark || !picked.length) return picked

  // 记一笔之后再读回，返回的对象里计数已经是新的
  for (const r of picked) { try { markRecalled(dir, r.id) } catch { /* 坏文件时不阻断召回 */ } }
  const byId = new Map(loadAll(dir).map((r) => [r.id, r]))
  return picked.map((r) => byId.get(r.id) || r)
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

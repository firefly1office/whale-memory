// 她自己的经历 v2：写下时拍下"当时"，回想分「当时 / 现在」两段；重要的写细，次要的简写
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as recallEvents from './recall-events.js'
import * as laterEvents from './later-events.js'
import * as unfinishedEvents from './unfinished-events.js'
import { queryTerms, requiredOverlap, matchedTerms, normalizeText } from './query-match.js'

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

// 字段上限：写的时候超了就报错，不静默截断
export const LIMITS = { text: 2000, scene: 500, thought: 1000, unfinished: 300, feelings: 8, kind: 20, laterThought: 1000, laterReason: 200 }

function tooLong(name, value, max) {
  const n = String(value || '').length
  if (n > max) throw new Error(`${name} 太长（${n}/${max} 字），删一些或拆成两条再写。`)
  return String(value || '')
}

// 旧格式没有 id：用「时间 + 正文指纹」生成，避免同一分钟的多条记录撞成同一个身份
// 只用记录里的内容生成，每次读取都得到同一个 id；没有 at 的旧记录用 noat 代替时间
function legacyId(r) {
  const stamp = r.at ? String(r.at).replace(/\D/g, '').slice(0, 14) : 'noat'
  const body = String(r.text || '') + '\u0000' + String(r.thought || '') + '\u0000' + String(r.at || '')
  const fp = crypto.createHash('sha1').update(body).digest('hex').slice(0, 8)
  return 'exp_legacy_' + stamp + '_' + fp
}

// 0.10.0 之前的旧 id：只到分钟、不带指纹。那时写下的后记和想起事件挂在这个 id 上
// 没有 at 的记录当时用的是 Date.now()，每次都不同，那些事件已无从对上
function preV010Id(r) {
  return r.at ? 'exp_legacy_' + String(r.at).replace(/\D/g, '').slice(0, 12) : ''
}

function normalize(r) {
  if (!r) return null
  if (r.then && typeof r.then === 'object') {
    return { ...r, weight: WEIGHTS.has(r.weight) ? r.weight : 'normal', later: Array.isArray(r.later) ? r.later : [] }
  }
  // 旧格式：text/thought 在顶层
  return {
    id: r.id || legacyId(r),
    formerId: r.id ? '' : preV010Id(r),
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

// 读出经历并认领旧 id：一个旧 id 只对应一条旧记录、也没有别的记录显式用着它，才认领；
// 否则谁也不给（事件原样留在文件里），由 pendingLegacyEvents 报告
function identify(dir) {
  const rows = readAll(dir).map(normalize).filter((r) => r && r.then && r.then.text)
  const explicit = new Set(rows.filter((r) => !r.formerId).map((r) => r.id))
  const owners = new Map()
  for (const r of rows) {
    if (r.formerId) owners.set(r.formerId, [...(owners.get(r.formerId) || []), r.id])
  }
  for (const r of rows) {
    if (r.formerId && (owners.get(r.formerId).length !== 1 || explicit.has(r.formerId))) r.formerId = ''
    if (!r.formerId) delete r.formerId
  }
  return { rows, owners, explicit }
}

export function loadAll(dir) {
  const { rows } = identify(dir)
  if (!rows.length) return rows

  // 想起次数：有事件文件就以事件为准；没有事件时才退回旧字段
  let counts = new Map()
  try { counts = recallEvents.countByExp(dir) } catch { /* 事件文件坏了也不影响读经历 */ }

  // 改主意：旧 later 数组 + later-events 事件，按时间合并
  let laterMap = new Map()
  try { laterMap = laterEvents.groupByExp(dir) } catch { }

  // 没弄完的事后来怎么样了：想通 / 暂放 / 再接着想
  let unfinishedMap = new Map()
  try { unfinishedMap = unfinishedEvents.latestByExp(dir) } catch { }

  return rows.map((r) => {
    const keys = r.formerId ? [r.id, r.formerId] : [r.id]
    const extra = keys.flatMap((k) => laterMap.get(k) || [])
    const merged = [...(r.later || []), ...extra]
      .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    const next = { ...r, later: merged }
    let state = null
    for (const k of keys) {
      const st = unfinishedMap.get(k)
      if (st) state = st
    }
    if (state && next.then && next.then.unfinished) next.unfinishedState = state
    let count = 0
    let lastAt = ''
    for (const k of keys) {
      const c = counts.get(k)
      if (!c) continue
      count += c.count
      if (c.lastAt > lastAt) lastAt = c.lastAt
    }
    if (count) {
      next.recalls = count
      next.lastRecalledAt = lastAt || r.lastRecalledAt || ''
    }
    return next
  })
}

// 挂在 0.10.0 之前的旧 id 上、但这个 id 有几条旧记录共用：事件原样保留，只报告，不替她挑
export function pendingLegacyEvents(dir) {
  const { owners, explicit } = identify(dir)
  let counts = new Map()
  let laterMap = new Map()
  try { counts = recallEvents.countByExp(dir) } catch { }
  try { laterMap = laterEvents.groupByExp(dir) } catch { }
  const out = []
  for (const [id, candidates] of owners) {
    if (candidates.length < 2 || explicit.has(id)) continue
    const later = (laterMap.get(id) || []).length
    const recalls = counts.get(id) ? counts.get(id).count : 0
    if (later || recalls) out.push({ id, candidates, later, recalls })
  }
  return out
}

// 把调用方给的 id 落到一条现存经历上：认当前 id，也认唯一对应的旧 id
// 旧 id 被几条旧经历共用时不落到任何一条上，返回 ambiguous 让调用方说清楚
function resolveId(dir, id) {
  const { rows, owners } = identify(dir)
  const hit = rows.find((r) => r.id === id) || rows.find((r) => r.formerId === id)
  if (hit) return { id: hit.id }
  return { id: '', ambiguous: (owners.get(id) || []).length > 1 }
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

// 改主意 / 回头想：只追加一条 later 事件，不重写经历文件
// 先确认这条经历真的在：id 抄错时明说找不到，不留一条谁也看不见的后记
export function reviseExperience(dir, { id, thought, reason = '' }) {
  if (!String(id || '').trim()) return { ok: false, error: '需要 id' }
  if (!String(thought || '').trim()) return { ok: false, error: 'thought 不能是空的。' }
  try {
    const safeThought = tooLong('thought', thought, LIMITS.laterThought)
    const safeReason = tooLong('reason', reason, LIMITS.laterReason)
    const target = resolveId(dir, String(id))
    if (target.ambiguous) return { ok: false, error: '这个旧 id 有好几条旧经历共用：' + id + '。用 read 里列出的当前 id 来改。' }
    if (!target.id) return { ok: false, error: '找不到这条经历：' + id + '。先用 read 或 recall 看一下 id。' }
    const row = laterEvents.append(dir, { id: target.id, thought: safeThought, reason: safeReason })
    return { ok: true, id: row.id, at: row.at }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 「这件没弄完的事」后来怎么样了：done / shelved / reopen
// 只追加一条状态事件；不改 then.unfinished，也不写成后记
// 重复同一个选择不写第二条；没关过的事 reopen 是空操作
export function setUnfinishedState(dir, { id, choice, note = '' } = {}) {
  if (!String(id || '').trim()) return { ok: false, error: '需要 id' }
  if (!unfinishedEvents.CHOICES.has(choice)) return { ok: false, error: 'state 只能是 done / shelved / reopen' }
  try {
    const target = resolveId(dir, String(id))
    if (target.ambiguous) return { ok: false, error: '这个旧 id 有好几条旧经历共用：' + id + '。用 read 里列出的当前 id。' }
    if (!target.id) return { ok: false, error: '找不到这条经历：' + id + '。先用 read 或 recall 看一下 id。' }
    const row = rowsById(dir, target.id)
    if (!row || !row.then || !row.then.unfinished) return { ok: false, error: '这条经历没有「还没弄完」的内容，不需要结案。' }

    // 重读、判断、追加都在同一把锁里：两个进程同时提交同一选择，只有一个会写
    const decided = unfinishedEvents.decide(dir, { id: target.id, choice, note: tooLong('note', note, 200) })
    if (decided.noop) return { ok: true, id: target.id, at: decided.row ? decided.row.at : '', choice, noop: true }
    return { ok: true, id: target.id, at: decided.row.at, choice, noop: false }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 单条：loadAll 会合并事件，这里绕开全量合并，只给存在性/未完判断用
function rowsById(dir, id) {
  const rows = readAll(dir).map(normalize).filter((r) => r && r.then && r.then.text)
  return rows.find((r) => r.id === id) || rows.find((r) => r.formerId === id) || null
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
  return rows.find((r) => r.id === id) || rows.find((r) => r.formerId === id) || null
}

// 相关度 × 重要度：重要的先被想起
// 阈值比较的是「原始重叠数」，重要度只影响排序，不影响过线门槛；门槛口径见 query-match.js
// mode='strict'（默认）：长查询要求 ≥60% 命中，宁可不召回也不硬凑
// mode='loose'：只要求至少一个实词命中，适合"想起来就该出现在眼前"的日常召回，宿主自行承担误召
// mark=false（默认）：只读；mark=true 追加一条 recall 事件（不重写经历文件）
export function recall(dir, query, { limit = 3, minOverlap = 1, mark = false, minRatio = 0.6, mode = 'strict' } = {}) {
  const rows = loadAll(dir)
  const q = String(query || '')
  const parsed = queryTerms(q)
  const { terms } = parsed
  const required = requiredOverlap(parsed, { mode, minOverlap, minRatio })

  const measure = (r) => {
    const fields = []
    const matched = new Set()
    const take = (hits, label) => {
      if (!hits.size) return
      for (const g of hits) matched.add(g)
      if (!fields.includes(label)) fields.push(label)
    }
    // 最初写下的、原文锚、后来才明白的：都参与匹配；后记逐条看，记下是哪几条让它被想起
    take(matchedTerms(terms, r.then.text + ' ' + r.then.thought + ' ' + (r.then.feeling || []).join(' ')), 'then')
    if (r.then.quote) take(matchedTerms(terms, (r.then.quote.text || '') + ' ' + (r.then.quote.source || '')), 'quote')
    const matchedLater = []
    for (const l of r.later || []) {
      const hits = matchedTerms(terms, l.thought)
      if (hits.size) matchedLater.push(l)
      take(hits, 'later')
    }

    const all = normalizeText([
      r.then.text, r.then.thought, (r.then.feeling || []).join(' '),
      r.then.quote ? r.then.quote.text : '', r.then.quote ? r.then.quote.source : '',
      (r.later || []).map((l) => l.thought).join(' ')
    ].join(' '))
    // 记录自身的规模：长记录天然更容易碰巧命中，排序时按 √长度 归一化
    const size = Math.max(1, all.length - 1)
    return { n: matched.size, size, matchedIn: fields, matchedLater }
  }
  const weightOf = (r) => (r.weight === 'important' ? 3 : r.weight === 'minor' ? 0.5 : 1)
  const picked = rows.map((r) => {
    const { n, size, matchedIn, matchedLater } = measure(r)
    return { r: { ...r, matchedIn, matchedLater }, n, s: (n / Math.sqrt(size)) * weightOf(r) }
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

const laterDay = (l) => l.day || String(l.at || '').slice(0, 10)
const sameLater = (a, b) => a === b || (a.at === b.at && a.thought === b.thought)

// 「当时 / 现在」两段式：模板拼，不调模型；没有的字段就如实说没有
// 后记：这次是被哪条后记想起的，就把那条原样给她；再给最近的一条。各带各的日子，不截断
export function renderTwoPart(entry, { now = new Date() } = {}) {
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
    const hits = (entry.matchedLater || []).filter((l) => !sameLater(l, last))
    for (const l of hits) lines.push('- 这次想起它，是因为后来写过：' + String(l.thought || '') + '（' + laterDay(l) + '）')
    lines.push((hits.length ? '- 最近一次回头想：' : '- 后来你想过：') + String(last.thought || '') + '（' + laterDay(last) + '）')
    const shown = hits.length + 1
    if (later.length > shown) lines.push('- （后来一共回头想过 ' + later.length + ' 次，这里没列出的 ' + (later.length - shown) + ' 次可以用 read 看）')
  } else {
    lines.push('- 还没有文字后记')
  }
  const st = entry.unfinishedState
  if (st && t.unfinished) {
    const when2 = st.day || String(st.at || '').slice(0, 10)
    const history = st.history || []
    // 只看最近一次决定之前的那一次，不用 includes 猜
    const prev = history.length >= 2 ? history[history.length - 2] : ''
    let phrase = ''
    if (st.choice === 'done') phrase = prev === 'shelved' ? '放下过，后来想通了' : '后来想通了'
    else if (st.choice === 'shelved') phrase = prev === 'done' ? '想通过一次，后来又决定先放下' : '先放下了，还没想通'
    else if (st.choice === 'reopen') phrase = prev === 'done' ? '想通过一次，后来又决定接着想' : '放下过，后来又决定接着想'
    if (phrase) lines.push('- 当时没弄完的这件事：' + phrase + '：' + t.unfinished + '（' + when2 + '）')
  }
  lines.push('', '以上是那天留下的全部；没留下的，我不记得。')
  return lines.join('\n')
}

export const internals = { WEIGHTS, FILE }
// 兼容旧调用：只要一句摘要的地方仍可用
export function recallForContext(dir, query, { max = 1 } = {}) {
  return recall(dir, query, { limit: max }).map((r) => ({ id: r.id, day: r.day, text: r.then.text, thought: r.then.thought, weight: r.weight, raw: r }))
}

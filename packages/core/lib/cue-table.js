// 线索表（T12）：给每条经历抽"将来可能被问到的词"。
//
// 借自 abrahamadams2436-glitch/dsh-xiaoyu-wake 的 cue 表（覆盖率门槛 + 频控，MIT，只学设计、未复制代码）。
//
// 为什么要有：`injection.surface()` 每条用户消息都要跑一次全库 recall（10,000 条约 68ms），
// 而大多数消息根本不涉及记忆。线索表是一个便宜的旁路：先看这条消息里有没有"她可能被问到的词"，
// 一个都对不上就别查库。它**不做召回、不给内容**——只回答两件事：
//   1. 要不要往下走（省掉这次全库检索）；
//   2. 要不要在递记忆前带一句迟疑（"我好像有点印象，但不一定对得上"）。
//
// 默认关：不传线索表时 `surface()` 的老路径一个字节没改；这个模块纯函数、不读盘不联网。
import { contentUnits } from './query-match.js'

export const CUE_VERSION = 1
export const CUE_PER_RECORD = 8
export const CUE_MIN_LEN = 2
/** 一半以上的记录都有的词没有区分度，不算线索 */
export const CUE_MAX_DF = 0.5
/** 消息里的词被线索盖住多少才插迟疑提醒 */
export const CUE_HINT_COVER = 0.6
/** 短问句的界：词数不超过这个数，才允许"线索表说不相关就直接跳过全库检索" */
export const CUE_SHORT_UNITS = 6
export const CUE_HINT_LINE = '（这件事我好像有点印象，但不一定对得上；你要是想听，我再往下想。）'

// 一段文本里"能当线索"的词：英文整词（≥2 字符）+ 中文两字组。
// 直接复用召回那套切词（contentUnits）：单字太泛、整句太长，两字组是召回本身就在用的粒度。
function unitsOf(text) {
  const out = []
  for (const item of contentUnits(String(text || ''))) {
    if (item && item.word && item.u) out.push(String(item.u))
    for (const pair of (item && item.pairs) || []) if (pair) out.push(String(pair))
  }
  return [...new Set(out)]
}

/**
 * 建表：输入 loadAll 的形状，输出 {v, byCue: Map<cue, string[]>, records: [{id, cues}]}。
 * - 只给**没封存**的经历建线索：封存的连"提不提"都不该被这张表决定；
 * - 每条记录按词的稀有度（df 升序）取前 perRecord 个：越少见的词越像"线索"；
 * - 坏记录（没有 id / 没有正文）直接跳过，不猜。
 */
export function buildCueTable(rows, { perRecord = CUE_PER_RECORD, maxDf = CUE_MAX_DF, minLen = CUE_MIN_LEN } = {}) {
  const visible = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && !r.sealed && r.then && String(r.then.text || '').trim())
  const df = new Map()
  const perRow = visible.map((row) => {
    const text = [row.then.text, row.then.thought, row.then.quote && row.then.quote.text].filter(Boolean).join(' ')
    const units = unitsOf(text)
    for (const u of units) df.set(u, (df.get(u) || 0) + 1)
    return { row, units }
  })
  const dfLimit = Math.max(1, Math.ceil(visible.length * maxDf))
  const byCue = new Map()
  const records = []
  for (const { row, units } of perRow) {
    const cues = units
      .filter((u) => [...u].length >= minLen && (df.get(u) || 0) <= dfLimit)
      .sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0) || b.length - a.length || a.localeCompare(b))
      .slice(0, perRecord)
    if (!cues.length) continue
    records.push({ id: String(row.id), cues })
    for (const cue of cues) {
      const list = byCue.get(cue)
      if (list) { if (!list.includes(String(row.id))) list.push(String(row.id)) }
      else byCue.set(cue, [String(row.id)])
    }
  }
  return { v: CUE_VERSION, byCue, records }
}

/**
 * 查表：消息里的词能盖住哪几条经历。
 * @returns {{ units:number, cover:number, bestId:string, hits:{id:string, matched:number, cover:number}[] }}
 *   cover = 命中的最好那条盖住了消息里多大比例的词（0 = 一个都对不上）
 */
export function lookupCues(table, text) {
  const units = unitsOf(text)
  if (!units.length) return { units: 0, cover: 0, bestId: '', hits: [] }
  const perRecord = new Map()
  for (const u of units) {
    for (const id of (table && table.byCue && table.byCue.get(u)) || []) {
      perRecord.set(id, (perRecord.get(id) || 0) + 1)
    }
  }
  const hits = [...perRecord]
    .map(([id, matched]) => ({ id, matched, cover: matched / units.length }))
    .sort((a, b) => b.cover - a.cover || b.matched - a.matched || a.id.localeCompare(b.id))
  return { units: units.length, cover: hits.length ? hits[0].cover : 0, bestId: hits.length ? hits[0].id : '', hits }
}

/**
 * 频控：同一标题连贴 ≤ maxStreak 次，同一键两次之间至少隔 minGapTurns 轮。
 * 状态可以 toJSON() 存起来跨轮恢复（宿主负责存）。
 */
export function createCueGate({ maxStreak = 3, minGapTurns = 2 } = {}) {
  let lastKey = ''
  let lastTurn = new Map()
  let streak = new Map()
  const api = {
    /** 这一轮能不能贴这个键 */
    allow(key, turn = 0) {
      const k = String(key || '')
      if (!k) return false
      const run = lastKey === k ? (streak.get(k) || 0) : 0
      if (run >= maxStreak) return false
      if (lastTurn.has(k) && Number(turn) - Number(lastTurn.get(k)) < minGapTurns) return false
      return true
    },
    /** 记一次"已经贴过"（调用方确实贴了才记） */
    note(key, turn = 0) {
      const k = String(key || '')
      const run = lastKey === k ? (streak.get(k) || 0) + 1 : 1
      streak.set(k, run)
      lastKey = k
      lastTurn.set(k, Number(turn))
      return run
    },
    reset() {
      lastKey = ''
      lastTurn = new Map()
      streak = new Map()
    },
    toJSON() {
      return { lastKey, lastTurn: [...lastTurn.entries()], streak: [...streak.entries()] }
    },
    load(state) {
      api.reset()
      if (!state || typeof state !== 'object') return api
      lastKey = String(state.lastKey || '')
      lastTurn = new Map((state.lastTurn || []).map(([k, v]) => [String(k), Number(v)]))
      streak = new Map((state.streak || []).map(([k, v]) => [String(k), Number(v)]))
      return api
    },
    get state() { return api.toJSON() }
  }
  return api
}

/** 该不该插迟疑提醒：覆盖率过门槛 + 频控放行。不碰任何状态（note 由调用方贴完再记）。 */
export function cueHintFor({ lookup, gate = null, key = '', turn = 0, minCover = CUE_HINT_COVER, enabled = true } = {}) {
  if (!enabled || !lookup || lookup.cover < minCover) return { hint: false, key: '', reason: 'below-cover' }
  const k = String(key || (lookup.hits.length ? 'cue:' + lookup.hits[0].id : ''))
  if (!k) return { hint: false, key: '', reason: 'no-key' }
  if (gate && !gate.allow(k, turn)) return { hint: false, key: k, reason: 'throttled' }
  return { hint: true, key: k, reason: 'ok' }
}

export const internals = { CUE_VERSION, CUE_PER_RECORD, CUE_MIN_LEN, CUE_MAX_DF, CUE_HINT_COVER }
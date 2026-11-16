// 没说出口的抽屉：打了没发的（draft）、想问没问的（question）、忍住了的（held）
// unsaid-events.jsonl 只追加：留下时一行 {id, at, day, kind, text, reason, status:'open'}；
// 后来说出口了 / 不想要了，各追加一行 {id, at, day, status:'spoken'|'discarded'}。原文从不删除
//
// 这个抽屉永不自动打开：recall、醒来块、read、memory、recap、book 都不读这个文件。
// 只有 listUnsaid 给她看，而且只在认得出的一对一会话里；丢掉（discarded）的，她自己也看不到了。
// 为了不让原文从"原始接口"漏出去，这里不导出任何返回原始行的函数
import { createLog, stamp } from './event-log.js'
import { isPrivateKey } from './waking.js'

export const KINDS = new Set(['draft', 'question', 'held'])
const STATUSES = new Set(['open', 'spoken', 'discarded'])
export const LIMITS = { text: 1000, reason: 200 }

const log = createLog('unsaid-events.jsonl', {
  valid: (r) => Boolean(r.id && STATUSES.has(r.status) && (r.status !== 'open' || (KINDS.has(r.kind) && r.text)))
})
export const eventsFile = log.eventsFile
export const internals = { FILE: log.FILE }

// 坏行数（给 doctor 用）；只给数字，不给内容
export const badLines = (dir) => log.readAll(dir).bad

function gate(chatKey) {
  if (!isPrivateKey(chatKey)) throw new Error('这个抽屉只在一对一的私聊里打开；群聊和认不出的会话一律不给。')
}

// 重放：每条留下的话现在是什么状态
function replay(rows) {
  const map = new Map()
  for (const r of rows) {
    if (r.status === 'open') {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, at: r.at, day: r.day, kind: r.kind, text: r.text, reason: r.reason || '', status: 'open', history: [] })
      continue
    }
    const item = map.get(r.id)
    if (!item) continue
    item.status = r.status
    item.history.push({ status: r.status, at: r.at, day: r.day })
  }
  return map
}

const fail = (e) => ({ ok: false, error: String(e && e.message ? e.message : e) })
const tooLong = (name, v, max) => {
  const s = String(v || '')
  if ([...s].length > max) throw new Error(`${name} 太长（${[...s].length}/${max} 字）。`)
  return s
}

// 留下一句没说出口的话。同一句（同 kind、同原文）还开着时，重复提交是 noop
export function leaveUnsaid(dir, { chatKey, kind = 'draft', text, reason = '' } = {}) {
  try {
    gate(chatKey)
    if (!KINDS.has(kind)) throw new Error('kind 只能是 draft（打了没发）/ question（想问没问）/ held（忍住了）。')
    const t = tooLong('text', String(text || '').trim(), LIMITS.text)
    if (!t) throw new Error('text 不能是空的。')
    const why = tooLong('reason', String(reason || '').trim(), LIMITS.reason)
    const res = log.decide(dir, (rows) => {
      const same = [...replay(rows).values()].find((x) => x.status === 'open' && x.kind === kind && x.text === t)
      if (same) return null
      return { id: 'unsaid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...stamp(), kind, text: t, reason: why, status: 'open' }
    })
    if (res.noop) {
      const same = [...replay(log.readAll(dir).rows).values()].find((x) => x.status === 'open' && x.kind === kind && x.text === t)
      return { ok: true, id: same ? same.id : '', noop: true }
    }
    return { ok: true, id: res.row.id, day: res.row.day, noop: false }
  } catch (e) { return fail(e) }
}

// 打开抽屉：默认只给还开着的；all=true 时连说出口了的也给（带上哪天说的）。丢掉的从不给
export function listUnsaid(dir, { chatKey, all = false } = {}) {
  try {
    gate(chatKey)
    const items = [...replay(log.readAll(dir).rows).values()]
      .filter((x) => x.status === 'open' || (all && x.status === 'spoken'))
      .map((x) => {
        const spoken = x.history.filter((h) => h.status === 'spoken').pop()
        return { id: x.id, day: x.day, kind: x.kind, text: x.text, reason: x.reason, status: x.status, ...(spoken ? { spokenDay: spoken.day } : {}) }
      })
    return { ok: true, items }
  } catch (e) { return fail(e) }
}

function mark(dir, { chatKey, id }, status) {
  try {
    gate(chatKey)
    if (!String(id || '').trim()) throw new Error('需要 id')
    const res = log.decide(dir, (rows) => {
      const item = replay(rows).get(String(id))
      if (!item) throw new Error('抽屉里没有这一条：' + id)
      if (item.status === status) return null
      if (item.status === 'discarded') throw new Error('这一条已经丢掉了。')
      return { id: String(id), ...stamp(), status }
    })
    return { ok: true, id: String(id), status, noop: res.noop }
  } catch (e) { return fail(e) }
}

// 后来说出口了：原文还在，状态变成 spoken；重复标记不写第二条
export const markUnsaidSpoken = (dir, opts = {}) => mark(dir, opts, 'spoken')

// 不想要了：原文不删，但之后她自己也看不到；重复丢不写第二条
export const discardUnsaid = (dir, opts = {}) => mark(dir, opts, 'discarded')

// 人生章节：她给一段日子起的名字（Conway 自传记忆模型里的"人生时期"）
// 一行一个 { id, at, day, action: open|rename|close, name?, from?, to?, note? }，只追加
// 名字是后来起的、也可以再改：改名不抹掉旧名字，翻回那天看到的是她那时的叫法
// 经历按 day 落进章节：from ≤ day ≤ to（没写 to 就是"还在这段日子里"）；章节可以重叠
import { createLog, stamp } from './event-log.js'
import { before, parseAsOf } from './as-of.js'

export const ACTIONS = new Set(['open', 'rename', 'close'])
const log = createLog('chapter-events.jsonl', { valid: (r) => Boolean(r.id && ACTIONS.has(r.action)) })
export const eventsFile = log.eventsFile
export const readAll = log.readAll
export const internals = { FILE: log.FILE }

const LIMIT_NAME = 30
const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkName(name) {
  const s = String(name || '').trim()
  if (!s) throw new Error('A chapter needs a name, e.g. "the month I worked at the lighthouse bookshop".（章节要有个名字，比如「在灯塔书店打工的那个月」。）')
  if ([...s].length > LIMIT_NAME) throw new Error(`Chapter name is too long (${[...s].length}/${LIMIT_NAME} chars).（章节名太长（${[...s].length}/${LIMIT_NAME} 字）。）`)
  return s
}

function checkDay(v, label) {
  const s = String(v || '').trim()
  if (!DATE.test(s)) throw new Error(`${label} must be a date like 2026-11-01.（${label} 要写成 2026-11-01 这样的日期。）`)
  parseAsOf(s) // 不存在的日期（2026-02-30）在这里报错
  return s
}

// 重放事件，得到每个章节现在（或截至 until）的样子
export function chapters(memDir, { until = null } = {}) {
  const map = new Map()
  for (const r of readAll(memDir).rows) {
    if (!before(r, until)) continue
    if (r.action === 'open') map.set(r.id, { id: r.id, name: r.name, names: [r.name], from: r.from, to: r.to || '', note: r.note || '', openedAt: r.at })
    const c = map.get(r.id)
    if (!c) continue
    if (r.action === 'rename' && r.name !== c.name) { c.name = r.name; c.names.push(r.name) }
    if (r.action === 'close') c.to = r.to
  }
  return [...map.values()].sort((a, b) => a.from.localeCompare(b.from) || a.openedAt.localeCompare(b.openedAt))
}

export const chaptersOn = (list, day) => list.filter((c) => day >= c.from && (!c.to || day <= c.to))

// 开一个章节。同名、同起点的重复提交是 noop
export function open(memDir, { name, from, to = '', note = '' } = {}, opts = {}) {
  const n = checkName(name)
  const f = checkDay(from || new Date().toLocaleDateString('sv-SE'), 'from')
  const t = to ? checkDay(to, 'to') : ''
  if (t && t < f) throw new Error('End date cannot be earlier than start date.（结束日期不能早于开始日期。）')
  return log.decide(memDir, (rows) => rows.some((r) => r.action === 'open' && r.name === n && r.from === f)
    ? null
    : { id: 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...stamp(), action: 'open', name: n, from: f, to: t, note: String(note || '').slice(0, 200) }, opts)
}

// 在已读出的事件里重放某一个章节（decide 的锁内用，不再重读文件）
function current(rows, id) {
  let ch = null
  for (const r of rows) {
    if (r.id !== id) continue
    if (r.action === 'open') ch = { name: r.name, from: r.from, to: r.to || '' }
    else if (ch && r.action === 'rename') ch.name = r.name
    else if (ch && r.action === 'close') ch.to = r.to
  }
  return ch
}

// 改名：旧名字留在 names 里
export function rename(memDir, { id, name } = {}, opts = {}) {
  const n = checkName(name)
  return log.decide(memDir, (rows) => {
    const ch = current(rows, id)
    if (!ch) throw new Error('Chapter not found: ' + id + '（找不到这个章节：' + id + '）')
    return ch.name === n ? null : { id: String(id), ...stamp(), action: 'rename', name: n }
  }, opts)
}

// 这段日子结束了（再 close 一次可以改结束日期）
export function close(memDir, { id, to } = {}, opts = {}) {
  const t = checkDay(to || new Date().toLocaleDateString('sv-SE'), 'to')
  return log.decide(memDir, (rows) => {
    const ch = current(rows, id)
    if (!ch) throw new Error('Chapter not found: ' + id + '（找不到这个章节：' + id + '）')
    if (t < ch.from) throw new Error('End date cannot be earlier than the start date (' + ch.from + ').（结束日期不能早于开始日期（' + ch.from + '）。）')
    return ch.to === t ? null : { id: String(id), ...stamp(), action: 'close', to: t }
  }, opts)
}

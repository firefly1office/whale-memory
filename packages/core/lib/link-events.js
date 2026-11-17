// 事后联想：她后来才发现两件事有关，亲手把它们连起来
// 一行一个 { from, to, at, day, reason }，只追加。不按相似度自动连；不写理由不连
// 和出处（then.refs）的区别：出处是写下这条时就知道的依据；联想是写下之后才发现的关系
import { createLog, stamp } from './event-log.js'
import { before } from './as-of.js'

const log = createLog('link-events.jsonl', { valid: (r) => Boolean(r.from && r.to && r.reason) })
export const eventsFile = log.eventsFile
export const readAll = log.readAll
export const internals = { FILE: log.FILE }

const pair = (a, b) => [String(a), String(b)].sort().join('|')

// 同一对经历（不分方向）只连一次；重复提交是 noop
export function link(memDir, { from, to, reason }, opts = {}) {
  if (!from || !to) throw new Error('Need the ids of two experiences（需要两条经历的 id）')
  if (String(from) === String(to)) throw new Error('Cannot link an experience to itself.（不能把一件事和它自己连起来。）')
  return log.decide(memDir, (rows) => rows.some((r) => pair(r.from, r.to) === pair(from, to))
    ? null
    : { from: String(from), to: String(to), ...stamp(), reason: String(reason) }, opts)
}

// 每条经历连着哪些：不分方向，两头都能看到；until 用于翻回那天
export function linksByExp(memDir, { until = null } = {}) {
  const map = new Map()
  const push = (id, other, r) => map.set(id, [...(map.get(id) || []), { other, reason: r.reason, at: r.at, day: r.day }])
  for (const r of readAll(memDir).rows) {
    if (!before(r, until)) continue
    push(r.from, r.to, r)
    push(r.to, r.from, r)
  }
  return map
}

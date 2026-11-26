// 四本账：承诺（promise）/ 边界（boundary）/ 拒绝（refusal）/ 和解（repair）。
//
// 借自 dsh-emotion-state（MIT）的四本账设计：关系里欠下的东西分四类各记各的，
// 不揉成一个「好感分」。实现自写，没有复制其代码（见 docs/attribution-zh.md）。
//
// 这一层是**纯数据层**，刻意不 import fs：
//   - 记账 = 往数组里追加一条事件，返回新数组（append-only，旧事件与旧数组都不动）；
//   - 折叠 = 只读地把事件按写入顺序重放成「现在四本账各是什么样」。
// 落盘、加锁、擦除、撤回都属于事件层 / 宿主的事。这里没有磁盘副作用，
// 也就没有「不小心默认打开」的风险。
//
// 默认关：包入口（packages/core/index.js）没登记它，仓库里也没有任何调用点。
// 证明见 docs/ledger-zh.md。
//
// 事件形状（一行一个 JSON，将来落盘时直接写）：
//   { book, action, id, at, ...字段 }
// 没有 v 字段：只加不减的兼容靠 action 与可选字段，不靠版本号（与 v1 契约第五节一致）。

const MAX_ID = 200
const MAX_TEXT = 500
const MAX_NOTE = 200

export const BOOKS = Object.freeze(['promise', 'boundary', 'refusal', 'repair'])

export const ACTIONS = Object.freeze({
  promise: Object.freeze(['made', 'kept', 'overdue', 'released']),
  boundary: Object.freeze(['set', 'crossed', 'lifted']),
  refusal: Object.freeze(['declined', 'repeated', 'withdrew']),
  repair: Object.freeze(['attempted'])
})

// 四本账折叠后的状态取值。写进 .d.ts 与文档，别的地方不许自己另起一套。
export const PROMISE_STATUSES = Object.freeze(['open', 'kept', 'overdue', 'released'])
export const BOUNDARY_STATUSES = Object.freeze(['active', 'lifted'])
export const REFUSAL_STATUSES = Object.freeze(['held', 'withdrew'])

// 和解三档：未和解 / 部分和解 / 已和解。
// 一次「部分和解」的尝试只把账从 open 抬到 partial；要到 repaired 必须有一次 full。
// 只升不降：账本只追加，没有「反悔」这种事件（要反悔就追加一条新的 breach，不删旧和解）。
export const REPAIR_LEVELS = Object.freeze(['open', 'partial', 'repaired'])
export const REPAIR_LEVEL_ZH = Object.freeze({ open: '未和解', partial: '部分和解', repaired: '已和解' })
export const REPAIR_SCOPES = Object.freeze(['partial', 'full'])

// 逾期权重封顶。1 → 2 → 4 → 8，第 4 次及以后每次都是 8（不再翻）。
// 为什么封顶：不封顶的话第 20 次逾期权重是 52 万，一本账会把其余三本全压没；
// 惩罚的意义在「越来越重」，不在「无穷重」。
export const OVERDUE_WEIGHT_CAP = 8

const DAY_MS = 24 * 60 * 60 * 1000

/** 第 n 次逾期的权重：2^(n-1)，封顶 cap。n=0（没逾期过）记 0。 */
export function overdueWeight(times, { cap = OVERDUE_WEIGHT_CAP } = {}) {
  if (!Number.isInteger(times) || times < 0) throw new Error('逾期次数必须是非负整数（times）')
  if (!Number.isInteger(cap) || cap < 1) throw new Error('封顶必须是正整数（cap）')
  if (times === 0) return 0
  // 循环而不是 2 ** (n - 1)：n 很大时幂会溢出成 Infinity，循环到封顶就停。
  let weight = 1
  for (let i = 1; i < times; i += 1) {
    if (weight >= cap) break
    weight *= 2
  }
  return Math.min(weight, cap)
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isText = (value) => typeof value === 'string' && value.trim() !== ''
const isIsoTime = (value) => typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))

function checkText(value, field, max = MAX_TEXT) {
  if (!isText(value)) return field + ' 必须是非空字符串'
  if (value.length > max) return field + ' 超过上限 ' + max + ' 字'
  return null
}

function checkId(value) {
  if (!isText(value)) return 'id 必须是非空字符串'
  if (value.length > MAX_ID) return 'id 超过上限 ' + MAX_ID + ' 字'
  return null
}

function checkAt(value) {
  if (!isIsoTime(value)) return 'at 必须是可解析的 ISO 时间'
  return null
}

function checkNote(value) {
  if (value === undefined) return null
  if (typeof value !== 'string') return 'note / reason 必须是字符串'
  if (value.length > MAX_NOTE) return 'note / reason 超过上限 ' + MAX_NOTE + ' 字'
  return null
}

/** 这条事件哪里不合格；合格返回 null。坏数据一律 fail closed，不猜、不兜底。 */
export function eventProblem(e) {
  if (!isObject(e)) return '事件必须是一个对象'
  if (!BOOKS.includes(e.book)) return 'book 认不出：' + String(e.book)
  const actions = ACTIONS[e.book]
  if (!actions.includes(e.action)) return 'action 认不出：' + e.book + '.' + String(e.action)
  const idProblem = checkId(e.id)
  if (idProblem) return idProblem
  const atProblem = checkAt(e.at)
  if (atProblem) return atProblem
  const noteProblem = checkNote(e.note)
  if (noteProblem) return noteProblem
  const reasonProblem = checkNote(e.reason)
  if (reasonProblem) return reasonProblem

  const key = e.book + '.' + e.action
  switch (key) {
    case 'promise.made':
    case 'boundary.set':
    case 'refusal.declined': {
      const textProblem = checkText(e.text, 'text')
      if (textProblem) return textProblem
      if (e.dueAt !== undefined && e.dueAt !== null && !isIsoTime(e.dueAt)) return 'dueAt 必须是可解析的 ISO 时间或 null'
      return null
    }
    case 'repair.attempted': {
      if (!isObject(e.target)) return 'target 必须是 { book, id }'
      if (!BOOKS.includes(e.target.book) || e.target.book === 'repair') return 'target.book 只能是 promise / boundary / refusal'
      const targetId = checkId(e.target.id)
      if (targetId) return 'target.' + targetId
      if (!REPAIR_SCOPES.includes(e.scope)) return 'scope 只能是 partial / full'
      return null
    }
    default:
      return null
  }
}

export function assertEvent(e) {
  const problem = eventProblem(e)
  if (problem) {
    const error = new Error('账本事件不合格：' + problem)
    error.code = 'LEDGER_EVENT_INVALID'
    throw error
  }
  return e
}

export function isValidEvent(e) {
  return eventProblem(e) === null
}

/**
 * 造一条账本事件（不落盘）。
 *
 * 字段按用途分开，不做自由扩展：未知字段不会带出去，写错了在这里就报错，
 * 免得坏事件到了折叠那一步才被发现。
 *
 * @param {'promise'|'boundary'|'refusal'|'repair'} book
 * @param {string} action
 * @param {object} fields
 */
export function ledgerEvent(book, action, fields = {}) {
  if (!BOOKS.includes(book)) throw new Error('book 认不出：' + String(book))
  if (!ACTIONS[book].includes(action)) throw new Error('action 认不出：' + book + '.' + String(action))
  if (!isObject(fields)) throw new Error('fields 必须是对象（fields）')

  const event = {
    book,
    action,
    id: fields.id,
    at: fields.at === undefined ? new Date().toISOString() : fields.at
  }
  const key = book + '.' + action
  switch (key) {
    case 'promise.made':
      event.text = fields.text
      if (fields.dueAt !== undefined) event.dueAt = fields.dueAt
      break
    case 'boundary.set':
    case 'refusal.declined':
      event.text = fields.text
      if (fields.reason !== undefined) event.reason = fields.reason
      break
    case 'repair.attempted':
      event.target = isObject(fields.target) ? Object.freeze({ book: fields.target.book, id: fields.target.id }) : fields.target
      event.scope = fields.scope
      if (fields.note !== undefined) event.note = fields.note
      break
    case 'promise.released':
    case 'boundary.lifted':
    case 'refusal.withdrew':
      if (fields.reason !== undefined) event.reason = fields.reason
      break
    default:
      // kept / overdue / crossed / repeated：只认 note
      if (fields.note !== undefined) event.note = fields.note
      break
  }
  // 造出来就地校验：坏事件在这里报，别等折叠时才发现账目不对。
  return Object.freeze(assertEvent(event))
}

/** 记账：追加一条事件，返回**新数组**。旧数组与旧事件都不动。 */
export function record(events, book, action, fields = {}) {
  if (!Array.isArray(events)) throw new Error('账本事件必须是数组（events）')
  return [...events, ledgerEvent(book, action, fields)]
}

function badEvent(index, problem) {
  const error = new Error('账本事件不合格（第 ' + index + ' 条）：' + problem)
  error.code = 'LEDGER_EVENT_INVALID'
  return error
}

const higherRepairLevel = (a, b) => (REPAIR_LEVELS.indexOf(b) > REPAIR_LEVELS.indexOf(a) ? b : a)

/** scope（partial / full）对应到和解三档。 */
export function repairLevelOf(scope) {
  if (!REPAIR_SCOPES.includes(scope)) throw new Error('scope 只能是 partial / full（scope）')
  return scope === 'full' ? 'repaired' : 'partial'
}

/** 一串和解尝试的 scope → 和解三档。没有尝试就是 open（未和解）。 */
export function repairLevelForAttempts(scopes = []) {
  if (!Array.isArray(scopes)) throw new Error('scopes 必须是数组（scopes）')
  let level = 'open'
  for (const scope of scopes) level = higherRepairLevel(level, repairLevelOf(scope))
  return level
}

function newPromiseState(id) {
  return { book: 'promise', id, text: '', dueAt: null, status: 'open', overdueCount: 0, weight: 0, totalWeight: 0, lastAt: '' }
}

function applyPromise(states, ev) {
  const cur = states.promise.get(ev.id) || newPromiseState(ev.id)
  if (ev.action === 'made') {
    cur.text = ev.text
    cur.dueAt = ev.dueAt === undefined ? null : ev.dueAt
    cur.status = 'open'
  } else if (ev.action === 'overdue') {
    cur.overdueCount += 1
    cur.weight = overdueWeight(cur.overdueCount)
    cur.totalWeight += cur.weight
    cur.status = 'overdue'
  } else if (ev.action === 'kept') {
    cur.status = 'kept'
  } else if (ev.action === 'released') {
    cur.status = 'released'
  }
  cur.lastAt = ev.at
  states.promise.set(ev.id, cur)
}

function newBoundaryState(id) {
  return { book: 'boundary', id, text: '', status: 'active', crossings: 0, firstCrossedAt: null, lastCrossedAt: null, lastAt: '' }
}

function applyBoundary(states, ev) {
  const cur = states.boundary.get(ev.id) || newBoundaryState(ev.id)
  if (ev.action === 'set') {
    cur.text = ev.text
    cur.status = 'active'
  } else if (ev.action === 'crossed') {
    cur.crossings += 1
    if (cur.firstCrossedAt === null) cur.firstCrossedAt = ev.at
    cur.lastCrossedAt = ev.at
  } else if (ev.action === 'lifted') {
    cur.status = 'lifted'
  }
  cur.lastAt = ev.at
  states.boundary.set(ev.id, cur)
}

function newRefusalState(id) {
  return { book: 'refusal', id, text: '', reason: '', status: 'held', repeats: 0, lastAt: '' }
}

function applyRefusal(states, ev) {
  const cur = states.refusal.get(ev.id) || newRefusalState(ev.id)
  if (ev.action === 'declined') {
    cur.text = ev.text
    cur.reason = ev.reason === undefined ? '' : ev.reason
    cur.status = 'held'
  } else if (ev.action === 'repeated') {
    cur.repeats += 1
  } else if (ev.action === 'withdrew') {
    cur.status = 'withdrew'
  }
  cur.lastAt = ev.at
  states.refusal.set(ev.id, cur)
}

function newRepairState(id) {
  return { book: 'repair', id, target: null, level: 'open', attempts: 0, lastAt: '' }
}

function applyRepair(states, ev) {
  const cur = states.repair.get(ev.id) || newRepairState(ev.id)
  if (cur.target === null) {
    cur.target = ev.target
  } else if (cur.target.book !== ev.target.book || cur.target.id !== ev.target.id) {
    // 一条和解记录只能对着一处欠账。前后指向不同说明数据被写错了，宁可报错也不悄悄改口径。
    throw new Error('同一条和解记录的 target 前后不一致（' + ev.id + '）')
  }
  cur.level = higherRepairLevel(cur.level, repairLevelOf(ev.scope))
  cur.attempts += 1
  cur.lastAt = ev.at
  states.repair.set(ev.id, cur)
}

/**
 * 把事件按写入顺序重放成四本账的当前状态。
 *
 * 坏事件直接抛（fail closed）：折叠到一半发现账目不对，不能返回一个看起来正常的快照。
 *
 * @param {object[]} events
 * @returns {{promise: Map<string, object>, boundary: Map<string, object>, refusal: Map<string, object>, repair: Map<string, object>}}
 */
export function foldLedger(events) {
  if (!Array.isArray(events)) throw new Error('账本事件必须是数组（events）')
  const states = { promise: new Map(), boundary: new Map(), refusal: new Map(), repair: new Map() }
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    const problem = eventProblem(ev)
    if (problem) throw badEvent(i, problem)
    if (ev.book === 'promise') applyPromise(states, ev)
    else if (ev.book === 'boundary') applyBoundary(states, ev)
    else if (ev.book === 'refusal') applyRefusal(states, ev)
    else applyRepair(states, ev)
  }
  return states
}

function checkNow(now) {
  if (!Number.isFinite(now)) throw new Error('now 必须是毫秒时间戳（now）')
  return now
}

function asList(map) {
  return [...map.values()]
}

/**
 * 已到期还没了结的承诺（逾期表）。按「累计权重 → 逾期天数 → id」排序，结果是稳定的。
 * 没有 dueAt 的承诺不算逾期：没定什么时候还，就不能按时间追。
 */
export function overduePromises(snapshot, { now = Date.now() } = {}) {
  if (!isObject(snapshot) || !(snapshot.promise instanceof Map)) throw new Error('snapshot 必须来自 foldLedger（snapshot）')
  const at = checkNow(now)
  const rows = []
  for (const s of snapshot.promise.values()) {
    if (s.status !== 'open' && s.status !== 'overdue') continue
    if (!s.dueAt) continue
    const due = Date.parse(s.dueAt)
    if (Number.isNaN(due) || due >= at) continue
    rows.push({
      id: s.id,
      text: s.text,
      dueAt: s.dueAt,
      daysLate: Math.floor((at - due) / DAY_MS),
      overdueCount: s.overdueCount,
      weight: s.weight,
      totalWeight: s.totalWeight
    })
  }
  rows.sort((a, b) => b.totalWeight - a.totalWeight || b.daysLate - a.daysLate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return rows
}

/**
 * 四本账的计数快照（给管理页 / 提示词用，不改变任何东西）。
 *
 * promise.weight 只算还没了结（open / overdue）的累计权重：
 * 已经补上（kept）或撤掉（released）的承诺不再挂着，不压着后面的账。
 */
export function summarize(snapshot, { now = Date.now() } = {}) {
  if (!isObject(snapshot)) throw new Error('snapshot 必须来自 foldLedger（snapshot）')
  const at = checkNow(now)
  const summary = {
    promise: { total: 0, open: 0, due: 0, kept: 0, overdue: 0, released: 0, weight: 0 },
    boundary: { total: 0, active: 0, lifted: 0, crossings: 0 },
    refusal: { total: 0, held: 0, withdrew: 0, repeats: 0 },
    repair: { total: 0, open: 0, partial: 0, repaired: 0, attempts: 0 }
  }

  for (const s of asList(snapshot.promise)) {
    summary.promise.total += 1
    if (s.status === 'kept') summary.promise.kept += 1
    else if (s.status === 'released') summary.promise.released += 1
    else if (s.status === 'overdue') {
      summary.promise.overdue += 1
      summary.promise.weight += s.totalWeight
    } else {
      const due = s.dueAt ? Date.parse(s.dueAt) : NaN
      if (!Number.isNaN(due) && due < at) summary.promise.due += 1
      else summary.promise.open += 1
      summary.promise.weight += s.totalWeight
    }
  }

  for (const s of asList(snapshot.boundary)) {
    summary.boundary.total += 1
    if (s.status === 'lifted') summary.boundary.lifted += 1
    else summary.boundary.active += 1
    summary.boundary.crossings += s.crossings
  }

  for (const s of asList(snapshot.refusal)) {
    summary.refusal.total += 1
    if (s.status === 'withdrew') summary.refusal.withdrew += 1
    else summary.refusal.held += 1
    summary.refusal.repeats += s.repeats
  }

  for (const s of asList(snapshot.repair)) {
    summary.repair.total += 1
    summary.repair[s.level] += 1
    summary.repair.attempts += s.attempts
  }

  return summary
}
// 事实键式取代（K1）：同一个「对象.方面」只留最新一条，旧的标成已被取代——不再出现在现行事实里，
// 但东西留着、能撤销。
//
// 借自 Yuuyuko-uu/dsh-fish-memory 的「事实键（对象.方面）」设计（那仓库是自定义许可，会传染）：
// 这里只学思路，实现自写，未复制任何代码。见 docs/attribution-zh.md。
//
// 为什么另开一个文件：经历是**整条不可变**的（then 一个字都不改）；而"改口"的粒度有时比整条细——
// 她上个月说喜欢咖啡、这个月说戒了，不必把整条经历封掉。硬塞进 self-experience.jsonl 会破坏
// "一行一条经历"的形状，也违背 then 不可变。所以事实单独一个只追加事件文件。
//
// 文件：<dir>/fact-events.jsonl，一行一条：
//   { v: 1, type: 'fact_set', id: 'fact_…', key: '对象.方面', value, about?, expId?, note?, at, day }
//   · expId 指向写这条事实时依据的经历（有就记）：erase 撤回那条经历时，这条事实一起清。
//   · 只追加，永不回写：取代关系由"同一 key 的下一条事件"推出来（读的时候标 supersededBy /
//     supersededAt）。所以旧值一条都没丢，"撤销"很容易——读全量看得见每一代，想退回旧值再 set 一次。
//   · 坏行 fail closed：读现行事实时有坏行直接抛（契约 §3.2 同一个口径：不把看不清的当成"没有"）。
//   · 默认关：没有任何既有模块 import 这个文件；不调用 setFact 就不会产生 fact-events.jsonl，
//     0.27.0 的读写路径逐字不变。
//   · 这一轮只做数据层：不接召回、不进注入、不参与封存判定。
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from './file-lock.js'
import { before, parseAsOf } from './as-of.js'
import { createLog } from './event-log.js'

const FILE = 'fact-events.jsonl'
export const KEY_LIMIT = 120
export const VALUE_LIMIT = 500
export const NOTE_LIMIT = 200

export const eventsFile = (memDir) => path.join(memDir, FILE)

const coded = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra)

// 一行算不算合格的事实事件。文件和将来的其它容器用同一条判据，坏行的口径才一致。
export function isValid(r) {
  return Boolean(
    r &&
    r.v === 1 &&
    r.type === 'fact_set' &&
    typeof r.id === 'string' && r.id.trim() &&
    typeof r.key === 'string' && r.key.trim() &&
    typeof r.value === 'string' && r.value.trim() &&
    typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) &&
    typeof r.day === 'string' && r.day.trim() &&
    (r.about === undefined || typeof r.about === 'string') &&
    (r.expId === undefined || typeof r.expId === 'string') &&
    (r.note === undefined || typeof r.note === 'string')
  )
}

const log = createLog(FILE, { valid: isValid })

// { rows, bad }；文件不存在 = 还没有任何事实（不是坏了）；读不出来抛（不当成空）
export const readAll = log.readAll

// 键必须是「对象.方面」：中间至少一个点，两边都不为空。
// 不强制只有一个点——"她.喜欢.咖啡"这种更细的方面也让它过，读的时候第一个点前面当对象。
function checkKey(key) {
  const raw = typeof key === 'string' ? key : String(key === undefined || key === null ? '' : key)
  const k = raw.trim()
  if (!k) throw coded('需要 key：写清是哪件事的哪一面，形如「对象.方面」。（missing key）', 'FACT_KEY_REQUIRED')
  if (k.length > KEY_LIMIT) throw coded('key 太长（' + k.length + '/' + KEY_LIMIT + ' 字）。（key is too long）', 'FACT_KEY_TOO_LONG')
  const dot = k.indexOf('.')
  if (dot <= 0 || dot === k.length - 1) throw coded('key 要写成「对象.方面」，中间的点两边都不能为空：' + k + '。（key must look like object.aspect）', 'FACT_KEY_SHAPE')
  return k
}

function checkText(name, value, limit) {
  const text = typeof value === 'string' ? value : String(value === undefined || value === null ? '' : value)
  const trimmed = text.trim()
  if (!trimmed) throw coded('需要 ' + name + '：不能为空。（missing ' + name + '）', 'FACT_' + name.toUpperCase() + '_REQUIRED')
  if (text.length > limit) throw coded(name + ' 太长（' + text.length + '/' + limit + ' 字）。（' + name + ' is too long）', 'FACT_' + name.toUpperCase() + '_TOO_LONG')
  return text
}

function optionalText(name, value, limit) {
  if (value === undefined || value === null || value === '') return ''
  const text = String(value)
  if (text.length > limit) throw coded(name + ' 太长（' + text.length + '/' + limit + ' 字）。（' + name + ' is too long）', 'FACT_' + name.toUpperCase() + '_TOO_LONG')
  return text
}

const newId = (now) => 'fact_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6)

// 调用前必须已经持有锁；append 只做一件事：必要时补一个换行，再把这一行追上去
function appendUnlocked(memDir, row) {
  const file = eventsFile(memDir)
  let prefix = ''
  try {
    const st = fs.statSync(file)
    if (st.size) {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(1)
      fs.readSync(fd, buf, 0, 1, st.size - 1)
      fs.closeSync(fd)
      if (buf[0] !== 10) prefix = '\n'
    }
  } catch { }
  fs.appendFileSync(file, prefix + JSON.stringify(row) + '\n', 'utf8')
  return row
}

/**
 * 记一条事实。同一个 key 再记一次，就是"取代"上一代——旧的不会被改，只是读的时候标成已被取代。
 *
 * @returns {{ event: object, noop: boolean, supersededBy: string }}
 *   noop: true 表示最新一条就是这个值（同键同值同 about），没有写新事件，返回的是那一条。
 */
export function setFact(memDir, input = {}, opts = {}) {
  const key = checkKey(input.key)
  const value = checkText('value', input.value, VALUE_LIMIT)
  const about = optionalText('about', input.about, KEY_LIMIT)
  const expId = optionalText('expId', input.expId, KEY_LIMIT)
  const note = optionalText('note', input.note, NOTE_LIMIT)
  const rawNow = input.now instanceof Date ? input.now : input.now === undefined ? new Date() : new Date(input.now)
  if (!Number.isFinite(rawNow.getTime())) throw coded('now 不是一个合法时间。（invalid now）', 'FACT_BAD_NOW')
  const stamp = { at: rawNow.toISOString(), day: rawNow.toLocaleDateString('sv-SE') }

  fs.mkdirSync(memDir, { recursive: true })
  return withFileLock(eventsFile(memDir) + '.lock', () => {
    // 锁里重读一遍再判断：坏行不清不楚，这时候往上叠只会让"现行是哪条"更说不清 → 整次拒绝
    const { rows, bad } = readAll(memDir)
    if (bad > 0) {
      throw coded('事实文件有 ' + bad + ' 行无法解析：先修好再记新事实，不然说不清哪条才是现行的。（fact events are corrupt）', 'FACT_EVENTS_CORRUPT', { bad })
    }
    const prevForKey = [...rows].reverse().find((r) => r.key === key) || null
    if (prevForKey && String(prevForKey.value) === value && String(prevForKey.about || '') === about && String(prevForKey.expId || '') === expId) {
      return { event: prevForKey, noop: true, supersededBy: '' }
    }
    const event = {
      v: 1,
      type: 'fact_set',
      id: newId(rawNow),
      key,
      value,
      ...(about ? { about } : {}),
      ...(expId ? { expId } : {}),
      ...(note ? { note } : {}),
      at: stamp.at,
      day: stamp.day
    }
    appendUnlocked(memDir, event)
    return { event, noop: false, supersededBy: prevForKey ? prevForKey.id : '' }
  }, opts)
}

/**
 * 把事件行推成"每一代 + 现行"。
 * - all：按文件顺序，旧的带 supersededBy / supersededAt（指向取代它的那一条）
 * - current：每个 key 只剩最新一条，顺序按该键第一次出现的位置（稳定）
 * - byKey：key → 现行那一条
 * 纯函数：不碰文件，SQLite 后端将来说走这里。
 */
export function derive(rows, { until = null } = {}) {
  const all = []
  const byKey = new Map()
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!isValid(raw)) continue
    if (!before(raw, until)) continue
    const row = { ...raw }
    const prev = byKey.get(row.key)
    if (prev) {
      prev.supersededBy = row.id
      prev.supersededAt = row.at
    }
    byKey.set(row.key, row)
    all.push(row)
  }
  return { all, current: [...byKey.values()], byKey }
}

/**
 * 读事实：{ all, current, byKey, bad }。
 * 坏行默认 fail closed（抛 FACT_EVENTS_CORRUPT）；allowCorrupt 只给备份/计数这类"不对外展示"的用途。
 * until：毫秒时间戳，或 `2026-11-15` 这样的日期（走 as-of 同一套解析）；看不懂就抛，不静默返回空。
 */
export function readFacts(memDir, { until = null, allowCorrupt = false } = {}) {
  const at = checkUntil(until)
  const { rows, bad } = readAll(memDir)
  if (bad > 0 && !allowCorrupt) {
    throw coded('事实文件有 ' + bad + ' 行无法解析：读不出"现在哪条才算数"。（fact events are corrupt）', 'FACT_EVENTS_CORRUPT', { bad })
  }
  return { ...derive(rows, { until: at }), bad }
}

/** 现行事实（每个 key 一条）。默认 fail closed。 */
export function currentFacts(memDir, opts = {}) {
  return readFacts(memDir, opts).current
}

/** 一个 key 的完整家谱（旧 → 新），用来"撤销"或解释为什么现在这么说 */
export function historyOf(memDir, key, { until = null } = {}) {
  const target = checkKey(key)
  return readFacts(memDir, { until }).all.filter((r) => r.key === target)
}

/**
 * 某条经历带出来的事实（撤回前核对用）：每条带 isCurrent，方便说清"删了之后哪条会重新生效"。
 * **默认 fail closed**：这个函数的用途是"撤回前核对"，最不该在坏行时给一份残缺清单。
 * 只要计数、不要判断的用途传 { allowCorrupt: true }。
 */
export function factsForExp(memDir, expId, { allowCorrupt = false } = {}) {
  const id = String(expId || '').trim()
  if (!id) return []
  const { all, current } = readFacts(memDir, { allowCorrupt })
  const live = new Set(current.map((r) => r.id))
  return all.filter((r) => String(r.expId || '') === id).map((r) => ({ ...r, isCurrent: live.has(r.id) }))
}

// until：null / 毫秒时间戳 / 日期字符串（与 as-of 同一套解析）。看不懂就抛，不静默返回空。
function checkUntil(until) {
  if (until === null || until === undefined || until === '') return null
  if (typeof until === 'number') {
    if (!Number.isFinite(until)) throw coded('until 看不懂：' + String(until) + '（用毫秒时间戳，或 2026-11-15 这样的日期）。（bad until）', 'FACT_BAD_UNTIL')
    return until
  }
  try {
    const t = parseAsOf(until)
    if (!Number.isFinite(t)) throw new Error('not finite')
    return t
  } catch (error) {
    throw coded('until 看不懂：' + String(until) + '（用毫秒时间戳，或 2026-11-15 这样的日期）。（bad until）', 'FACT_BAD_UNTIL', { cause: error })
  }
}

export const internals = { FILE, KEY_LIMIT, VALUE_LIMIT, NOTE_LIMIT }
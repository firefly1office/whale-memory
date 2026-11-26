// 想起是事件：只追加，不改经历正文
// 一行一个 { id, at, query, chatKey?, backfilled? }
// 参数是记忆目录本身（<data>/plugin-data/biomimetic-memory），与 self-experience 一致
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from './file-lock.js'
import { before } from './as-of.js'

const FILE = 'recall-events.jsonl'

export function eventsFile(memDir) {
  return path.join(memDir, FILE)
}

function ensureDir(memDir) {
  fs.mkdirSync(memDir, { recursive: true })
}



// 造一行想起事件，但**不落盘**（写路径切 sqlite 时两边存同一行，见 later-events.buildRow）
export function buildRow({ id, query = '', chatKey = '', backfilled = false } = {}) {
  if (!String(id || '').trim()) throw new Error('id cannot be empty（id 不能为空）')
  const row = {
    id: String(id),
    at: new Date().toISOString(),
    query: String(query || '').slice(0, 200),
    chatKey: String(chatKey || '').slice(0, 120)
  }
  if (backfilled) row.backfilled = true
  return row
}

// 追加一行**已经造好**的事件（双写用）
export function appendRow(memDir, row, opts = {}) {
  if (!isValid(row)) throw new Error('recall 事件不合格（缺 id），拒绝写入')
  ensureDir(memDir)
  return withFileLock(eventsFile(memDir) + '.lock', () => {
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
  }, opts)
}

export function append(memDir, payload = {}, opts = {}) {
  return appendRow(memDir, buildRow(payload), opts)
}

export function readAll(memDir) {
  let raw = ''
  try {
    raw = fs.readFileSync(eventsFile(memDir), 'utf8')
  } catch (error) {
    // 只有"还没有这个文件"能当空；权限、是目录、坏盘必须报出来，不能当成 0 条。
    if (error && error.code === 'ENOENT') return { rows: [], bad: 0 }
    const wrapped = new Error('事件日志读不出来：recall-events.jsonl：' + String(error && error.message ? error.message : error))
    wrapped.code = 'EVENTS_UNREADABLE'
    wrapped.cause = error
    throw wrapped
  }
  const rows = []
  let bad = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (isValid(r)) rows.push(r)
      else bad += 1
    } catch { bad += 1 }
  }
  return { rows, bad }
}

// 一行算不算合格的想起事件。文件和 SQLite 两个容器用同一条判据，坏行的口径才一致
export function isValid(r) {
  return Boolean(r && r.id)
}

// 进程内缓存：同一进程里连续 recall 不再重复解析整个事件文件
const memo = new Map()

// until：只数这一刻之前（含）的想起；截断查询不走缓存
export function countByExp(memDir, { until = null } = {}) {
  const file = eventsFile(memDir)
  let stamp = ''
  try { const st = fs.statSync(file); stamp = st.mtimeMs + ':' + st.size } catch { }
  const hit = until === null ? memo.get(memDir) : null
  if (hit && hit.stamp === stamp) return hit.map

  const map = countRows(readAll(memDir).rows, { until })
  if (until === null) memo.set(memDir, { stamp, map })
  return map
}

// 同上，但输入是已经读出来的行（不碰文件、不走缓存）：SQLite 后端走这里
export function countRows(rows, { until = null } = {}) {
  const map = new Map()
  for (const r of rows) {
    if (!before(r, until)) continue
    const cur = map.get(r.id) || { count: 0, lastAt: '' }
    cur.count += 1
    if (String(r.at || '') > cur.lastAt) cur.lastAt = String(r.at || '')
    map.set(r.id, cur)
  }
  return map
}

export function list(memDir, { id = '', limit = 20 } = {}) {
  const { rows } = readAll(memDir)
  return rows
    .filter((r) => !id || r.id === id)
    .slice(-limit)
    .reverse()
}

export const internals = { FILE }
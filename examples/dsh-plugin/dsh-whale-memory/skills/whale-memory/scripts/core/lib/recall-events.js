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



export function append(memDir, { id, query = '', chatKey = '', backfilled = false } = {}, opts = {}) {
  if (!String(id || '').trim()) throw new Error('id cannot be empty（id 不能为空）')
  const row = {
    id: String(id),
    at: new Date().toISOString(),
    query: String(query || '').slice(0, 200),
    chatKey: String(chatKey || '').slice(0, 120)
  }
  if (backfilled) row.backfilled = true

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

export function readAll(memDir) {
  let raw = ''
  try { raw = fs.readFileSync(eventsFile(memDir), 'utf8') } catch { return { rows: [], bad: 0 } }
  const rows = []
  let bad = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && r.id) rows.push(r)
      else bad += 1
    } catch { bad += 1 }
  }
  return { rows, bad }
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

  const { rows } = readAll(memDir)
  const map = new Map()
  for (const r of rows) {
    if (!before(r, until)) continue
    const cur = map.get(r.id) || { count: 0, lastAt: '' }
    cur.count += 1
    if (String(r.at || '') > cur.lastAt) cur.lastAt = String(r.at || '')
    map.set(r.id, cur)
  }
  if (until === null) memo.set(memDir, { stamp, map })
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
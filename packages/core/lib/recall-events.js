// 想起是事件：只追加，不改经历正文
// 一行一个 { id, at, query, chatKey?, backfilled? }
// 参数是记忆目录本身（<data>/plugin-data/biomimetic-memory），与 self-experience 一致
import fs from 'node:fs'
import path from 'node:path'

const FILE = 'recall-events.jsonl'

export function eventsFile(memDir) {
  return path.join(memDir, FILE)
}

function ensureDir(memDir) {
  fs.mkdirSync(memDir, { recursive: true })
}

// 单写者锁：多进程追加时排队；超时报错，不静默丢事件
function withLock(memDir, fn, { timeoutMs = 3000 } = {}) {
  const lock = eventsFile(memDir) + '.lock'
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        const st = fs.statSync(lock)
        if (Date.now() - st.mtimeMs > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue }
      } catch { }
      if (Date.now() - start > timeoutMs) throw new Error('recall-events 被另一个进程锁着，稍后再试。')
      const t = Date.now()
      while (Date.now() - t < 20) { }
    }
  }
  try { return fn() } finally { try { fs.rmSync(lock, { recursive: true, force: true }) } catch { } }
}

export function append(memDir, { id, query = '', chatKey = '', backfilled = false } = {}, opts = {}) {
  if (!String(id || '').trim()) throw new Error('id 不能为空')
  const row = {
    id: String(id),
    at: new Date().toISOString(),
    query: String(query || '').slice(0, 200),
    chatKey: String(chatKey || '').slice(0, 120)
  }
  if (backfilled) row.backfilled = true

  ensureDir(memDir)
  return withLock(memDir, () => {
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

export function countByExp(memDir) {
  const { rows } = readAll(memDir)
  const map = new Map()
  for (const r of rows) {
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
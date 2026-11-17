// 改主意是事件：只追加，不改 then，也不重写经历文件
// 一行一个 { id, at, day, thought, reason?, feeling? }
// feeling 是她「后来再想起时」的感觉；当时的感觉在 then.feeling 里，永远不动
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from './file-lock.js'
import { before } from './as-of.js'

const FILE = 'later-events.jsonl'

export function eventsFile(memDir) {
  return path.join(memDir, FILE)
}

export function append(memDir, { id, thought, reason = '', feeling = [] } = {}, opts = {}) {
  if (!String(id || '').trim()) throw new Error('id cannot be empty（id 不能为空）')
  if (!String(thought || '').trim()) throw new Error('thought cannot be empty（thought 不能为空）')
  const now = new Date()
  const row = {
    id: String(id),
    at: now.toISOString(),
    day: now.toLocaleDateString('sv-SE'),
    thought: String(thought),
    reason: String(reason || '')
  }
  if (Array.isArray(feeling) && feeling.length) row.feeling = feeling.map(String)

  fs.mkdirSync(memDir, { recursive: true })
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
      if (r && r.id && r.thought) rows.push(r)
      else bad += 1
    } catch { bad += 1 }
  }
  return { rows, bad }
}

// until：只要这一刻之前（含）写下的后记，「翻回那天的自己」用
export function groupByExp(memDir, { until = null } = {}) {
  const { rows } = readAll(memDir)
  const map = new Map()
  for (const r of rows) {
    if (!before(r, until)) continue
    const list = map.get(r.id) || []
    list.push(r)
    map.set(r.id, list)
  }
  return map
}

export function list(memDir, { id = '', limit = 20 } = {}) {
  const { rows } = readAll(memDir)
  return rows.filter((r) => !id || r.id === id).slice(-limit).reverse()
}

export const internals = { FILE }
// 「这件没弄完的事」后来怎么样了：想通 / 先放下 / 再接着想
// 一行一个 { id, at, day, choice, note? }，只追加；不改 then.unfinished，也不冒充后记
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from './file-lock.js'
import { before } from './as-of.js'

const FILE = 'unfinished-events.jsonl'
export const CHOICES = new Set(['done', 'shelved', 'reopen'])

export function eventsFile(memDir) {
  return path.join(memDir, FILE)
}

function makeRow({ id, choice, note }) {
  const now = new Date()
  return {
    id: String(id),
    at: now.toISOString(),
    day: now.toLocaleDateString('sv-SE'),
    choice,
    note: String(note || '').slice(0, 200)
  }
}

// 调用前必须已经持有锁；append 和 decide 共用这一层，避免同一次选择被锁外读到两次
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

export function append(memDir, { id, choice, note = '' } = {}, opts = {}) {
  if (!String(id || '').trim()) throw new Error('id cannot be empty（id 不能为空）')
  if (!CHOICES.has(choice)) throw new Error('choice must be done / shelved / reopen（choice 只能是 done / shelved / reopen）')
  const row = makeRow({ id, choice, note })
  fs.mkdirSync(memDir, { recursive: true })
  return withFileLock(eventsFile(memDir) + '.lock', () => appendUnlocked(memDir, row), opts)
}

// 在同一个锁里「重读最近状态 → 判断 → 追加」：
// 两个进程同时提交同一选择，第二个会看到第一个的结果并返回 noop，不会写出第二条
export function decide(memDir, { id, choice, note = '' } = {}, opts = {}) {
  if (!String(id || '').trim()) throw new Error('id cannot be empty（id 不能为空）')
  if (!CHOICES.has(choice)) throw new Error('choice must be done / shelved / reopen（choice 只能是 done / shelved / reopen）')
  fs.mkdirSync(memDir, { recursive: true })
  return withFileLock(eventsFile(memDir) + '.lock', () => {
    const rows = readAll(memDir).rows.filter((r) => r.id === String(id))
    const last = rows[rows.length - 1] || null
    if (last && last.choice === choice) return { row: last, noop: true }
    if (choice === 'reopen' && !last) return { row: null, noop: true }
    return { row: appendUnlocked(memDir, makeRow({ id, choice, note })), noop: false }
  }, opts)
}

export function readAll(memDir) {
  let raw = ''
  try {
    raw = fs.readFileSync(eventsFile(memDir), 'utf8')
  } catch (error) {
    // 只有"还没有这个文件"能当空；权限、是目录、坏盘必须报出来，不能当成 0 条。
    if (error && error.code === 'ENOENT') return { rows: [], bad: 0 }
    const wrapped = new Error('事件日志读不出来：unfinished-events.jsonl：' + String(error && error.message ? error.message : error))
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

// 一行算不算合格的「没弄完」事件。文件和 SQLite 两个容器用同一条判据，坏行的口径才一致
export function isValid(r) {
  return Boolean(r && r.id && CHOICES.has(r.choice))
}

// 每个经历 id 的最新状态，附带完整的选择历史（渲染"中间放下过"要用）
// until：按这一刻之前（含）的选择重放，「翻回那天的自己」用
export function latestByExp(memDir, { until = null } = {}) {
  return latestRows(readAll(memDir).rows, { until })
}

// 同上，但输入是已经读出来的行（不碰文件）：SQLite 后端走这里
export function latestRows(rows, { until = null } = {}) {
  const map = new Map()
  for (const r of rows) {
    if (!before(r, until)) continue
    const cur = map.get(r.id) || { id: r.id, at: '', day: '', choice: '', note: '', history: [] }
    cur.at = r.at
    cur.day = r.day
    cur.choice = r.choice
    cur.note = r.note || ''
    cur.history.push(r.choice)
    map.set(r.id, cur)
  }
  return map
}

export function countByExp(memDir) {
  const { rows } = readAll(memDir)
  const map = new Map()
  for (const r of rows) map.set(r.id, (map.get(r.id) || 0) + 1)
  return map
}
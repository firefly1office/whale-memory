// 她选择的遗忘：封存 / 解封。一行一个 { id, at, day, action, note? }，只追加
// 封存不是删除：原文、后记、选择都还在；只是不再被主动想起（召回、醒来、别的回想里的摘要都避开它）
// 要真的抹掉一条，用 eraseExperience（阶段 4：整条撤回 + 墓碑）；封存事件本身不删
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from './file-lock.js'
import { before } from './as-of.js'

const FILE = 'seal-events.jsonl'
export const ACTIONS = new Set(['seal', 'unseal'])

export function eventsFile(memDir) {
  return path.join(memDir, FILE)
}

function makeRow({ id, action, note }) {
  const now = new Date()
  return { id: String(id), at: now.toISOString(), day: now.toLocaleDateString('sv-SE'), action, note: String(note || '').slice(0, 200) }
}

// 调用前必须已经持有锁
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

// 同一把锁里「重读当前状态 → 判断 → 追加」：已经封存的再封存、没封存的解封，都是空操作，不写第二条
export function decide(memDir, { id, action, note = '' } = {}, opts = {}) {
  if (!String(id || '').trim()) throw new Error('id cannot be empty（id 不能为空）')
  if (!ACTIONS.has(action)) throw new Error('action must be seal / unseal（action 只能是 seal / unseal）')
  fs.mkdirSync(memDir, { recursive: true })
  return withFileLock(eventsFile(memDir) + '.lock', () => {
    const all = readAll(memDir)
    const rows = all.rows.filter((r) => r.id === String(id))
    const last = rows[rows.length - 1] || null
    const sealedNow = Boolean(last && last.action === 'seal')
    // 有坏行时状态不确定：不做"重复操作"的合并，直接按她的请求追加，
    // 让最后一次显式动作成为真正生效的那条。
    if (!all.bad && ((action === 'seal' && sealedNow) || (action === 'unseal' && !sealedNow))) return { row: last, noop: true }
    return { row: appendUnlocked(memDir, makeRow({ id, action, note })), noop: false }
  }, opts)
}

export function readAll(memDir) {
  let raw = ''
  try {
    raw = fs.readFileSync(eventsFile(memDir), 'utf8')
  } catch (error) {
    // 只有"还没有这个文件"能当空；权限、磁盘、路径是目录这类错误必须抛出去。
    // 否则正文可读、封存日志读不出来时，召回/醒来/书会当成"她什么都没封存"。
    if (error?.code === 'ENOENT') return { rows: [], bad: 0 }
    const wrapped = new Error('封存日志读不出来：' + String(error?.message || error))
    wrapped.code = 'SEAL_EVENTS_UNREADABLE'
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

// 一行算不算合格的封存事件。文件和 SQLite 两个容器用同一条判据，坏行的口径才一致
export function isValid(r) {
  return Boolean(r && r.id && ACTIONS.has(r.action))
}

// 每个经历 id 现在是否封存着：只收最后一次是 seal 的；until 用于翻回那天（那时还没封存就不算）
// strict：展示路径用。日志里有坏行时"某条经历唯一一次封存"可能正好坏掉，
// 这时不能默认可见——把"状态未知"抛给调用方（fail closed）。
export function sealedByExp(memDir, { until = null, strict = false } = {}) {
  return sealedFrom(readAll(memDir), { until, strict })
}

// 同上，但输入是已经读出来的 { rows, bad }（不碰文件）：SQLite 后端走这里，坏行同样 fail closed
export function sealedFrom({ rows, bad }, { until = null, strict = false } = {}) {
  if (strict && bad > 0) {
    const error = new Error('封存日志有 ' + bad + ' 行无法解析，封存状态不确定')
    error.code = 'SEAL_EVENTS_CORRUPT'
    error.bad = bad
    throw error
  }
  const last = new Map()
  for (const r of rows) {
    if (!before(r, until)) continue
    last.set(r.id, r)
  }
  const map = new Map()
  for (const [id, r] of last) if (r.action === 'seal') map.set(id, { at: r.at, day: r.day, note: r.note || '' })
  return map
}

export const internals = { FILE }

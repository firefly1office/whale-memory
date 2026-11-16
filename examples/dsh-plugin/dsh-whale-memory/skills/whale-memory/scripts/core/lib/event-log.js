// 只追加的事件文件：一行一个 JSON。新加的事件类型共用这一份读写，不再各抄一遍
// - readAll：坏行跳过、计数，不阻断读取
// - decide：同一把锁里「重读 → 判断 → 追加」，重复提交只记一次
import fs from 'node:fs'
import path from 'node:path'
import { withFileLock } from './file-lock.js'

export function createLog(fileName, { valid = (r) => Boolean(r) } = {}) {
  const eventsFile = (memDir) => path.join(memDir, fileName)

  function readAll(memDir) {
    let raw = ''
    try { raw = fs.readFileSync(eventsFile(memDir), 'utf8') } catch { return { rows: [], bad: 0 } }
    const rows = []
    let bad = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r && valid(r)) rows.push(r)
        else bad += 1
      } catch { bad += 1 }
    }
    return { rows, bad }
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

  // judge(rows) 返回要追加的那一行，或 null 表示不用写（noop）
  function decide(memDir, judge, opts = {}) {
    fs.mkdirSync(memDir, { recursive: true })
    return withFileLock(eventsFile(memDir) + '.lock', () => {
      const row = judge(readAll(memDir).rows)
      if (!row) return { row: null, noop: true }
      return { row: appendUnlocked(memDir, row), noop: false }
    }, opts)
  }

  return { FILE: fileName, eventsFile, readAll, decide }
}

export const stamp = () => {
  const now = new Date()
  return { at: now.toISOString(), day: now.toLocaleDateString('sv-SE') }
}

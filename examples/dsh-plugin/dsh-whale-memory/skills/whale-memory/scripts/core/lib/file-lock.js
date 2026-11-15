// 跨进程文件锁：mkdir 独占 + 忙等重试；Windows 上并发 mkdir/rm 会短暂 EPERM/ENOENT，按“忙”处理
import fs from 'node:fs'
import path from 'node:path'

const BUSY = new Set(['EEXIST', 'EPERM', 'ENOENT', 'EBUSY', 'EACCES'])

export function withFileLock(lockPath, fn, { timeoutMs = 3000 } = {}) {
  const start = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true })
      fs.mkdirSync(lockPath)
      break
    } catch (e) {
      if (!BUSY.has(e.code)) throw e
      try {
        const st = fs.statSync(lockPath)
        if (Date.now() - st.mtimeMs > 10000) { fs.rmSync(lockPath, { recursive: true, force: true }); continue }
      } catch { /* 锁刚被释放 */ }
      if (Date.now() - start > timeoutMs) throw new Error('文件被另一个进程锁着，稍后再试。')
      sleep(20)
    }
  }
  try { return fn() } finally { try { fs.rmSync(lockPath, { recursive: true, force: true }) } catch { } }
}

// 阻塞式小睡，不空转 CPU；Node 主线程允许 Atomics.wait
const sleepBuf = new Int32Array(new SharedArrayBuffer(4))
function sleep(ms) {
  try { Atomics.wait(sleepBuf, 0, 0, ms) } catch { const t = Date.now(); while (Date.now() - t < ms) { } }
}
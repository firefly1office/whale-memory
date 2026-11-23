// 这份锁是从 packages/core/lib/file-lock.js 复制的（同一份实现，MIT）。
// 为什么复制而不是依赖：whale-drafts 要能单独安（不拉 whale-memory-core）。
// 两边改锁的时候记得同步；tests/drafts.test.mjs 里有并发用例守着它的行为。
// 跨进程文件锁：mkdir 独占 + 忙等重试；Windows 上并发 mkdir/rm 会短暂 EPERM/ENOENT，按“忙”处理
//
// 抢锁规则（2026-11 修）：
// - 锁目录里写 owner.json（pid + hostname + token + 心跳时间），抢锁时先看持有者是否还活着。
// - 同一台机器：用 pid 存活校验（process.kill(pid, 0)）。持有者还活着就绝不抢，哪怕锁很旧。
// - 别的机器/认不出持有者：用心跳判断；心跳过期才回收。心跳只在拿到锁时写一次，
//   所以跨机共享目录上的长任务仍可能被误判——跨机写入应在更高层串行化。
// - 回收先原子 rename 成 tombstone，只有一个竞争者能 rename 成功，避免两个写入者同时进入。
// - 释放时核对 token，只删自己的锁，不误删别人刚抢到的锁。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const BUSY = new Set(['EEXIST', 'EPERM', 'ENOENT', 'EBUSY', 'EACCES'])
const OWNER_FILE = 'owner.json'
const DEFAULT_TIMEOUT_MS = 3000
const DEFAULT_STALE_MS = 10000
const DEFAULT_POLL_MS = 20
const LOCKED_MESSAGE = 'The file is locked by another process; try again shortly.（文件被另一个进程锁着，稍后再试。）'

// 临时文件 + fsync + rename 原子替换。中途崩了只会留下 <file>.tmp-*，正式文件保持旧内容。
export function writeFileAtomic(file, data) {
  const target = String(file)
  const dir = path.dirname(target)
  const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomUUID()
  let fd
  try {
    fd = fs.openSync(tmp, 'w')
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
    let offset = 0
    while (offset < buf.length) offset += fs.writeSync(fd, buf, offset, buf.length - offset)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    renameWithRetry(tmp, target)
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd) } catch { } }
    try { fs.rmSync(tmp, { force: true }) } catch { }
    throw error
  }
  // 目录项也落盘（POSIX 上才有意义；Windows 打开目录会失败，静默跳过）
  try {
    const dirFd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
  } catch { }
  return target
}

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try { return fs.renameSync(from, to) } catch (error) {
      if (attempt >= 9 || !BUSY.has(error.code)) throw error
      sleep(10)
    }
  }
}

export function withFileLock(lockPath, fn, { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  const waitMs = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  const staleAfter = Number.isFinite(staleMs) && staleMs >= 0 ? staleMs : DEFAULT_STALE_MS
  const interval = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_POLL_MS
  const token = crypto.randomUUID()
  const owner = {
    pid: process.pid,
    hostname: os.hostname(),
    token,
    acquiredAt: Date.now(),
    heartbeatAt: Date.now()
  }
  const start = Date.now()
  for (;;) {
    if (acquire(lockPath, owner)) break
    // 过时锁只在持有者已退出（或跨机心跳过期）时回收；活着就继续等。
    tryReclaimIfStale(lockPath, staleAfter)
    if (Date.now() - start >= waitMs) throw new Error(LOCKED_MESSAGE)
    sleep(interval)
  }
  try { return fn() } finally { release(lockPath, token) }
}

function acquire(lockPath, owner) {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.mkdirSync(lockPath)
  } catch (error) {
    if (error.code === 'EEXIST') return false
    if (BUSY.has(error.code)) return false
    throw error
  }
  try {
    fs.writeFileSync(path.join(lockPath, OWNER_FILE), JSON.stringify(owner), 'utf8')
  } catch (error) {
    try { fs.rmSync(lockPath, { recursive: true, force: true }) } catch { }
    throw error
  }
  return true
}

function readOwner(lockPath) {
  try {
    const row = JSON.parse(fs.readFileSync(path.join(lockPath, OWNER_FILE), 'utf8'))
    return row && typeof row === 'object' ? row : null
  } catch { return null }
}

// 'alive' | 'dead' | 'unknown'（别的机器、字段缺失、旧版锁目录）
function ownerStatus(owner) {
  const pid = Number(owner?.pid)
  const hostname = typeof owner?.hostname === 'string' ? owner.hostname : ''
  const sameHost = hostname === '' ? pid === process.pid : hostname === os.hostname()
  if (sameHost) {
    if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
    if (pid === process.pid) return 'alive'
    try {
      process.kill(pid, 0)
      return 'alive'
    } catch (error) {
      if (error.code === 'EPERM') return 'alive' // 系统进程/权限不足：当成活着，宁可等
      if (error.code === 'ESRCH') return 'dead'
      return 'unknown'
    }
  }
  return 'unknown'
}

// 返回 true 表示这轮尝试过回收（或锁已经不在），调用方睡一下再重试
function tryReclaimIfStale(lockPath, staleMs) {
  let stats
  try { stats = fs.statSync(lockPath) } catch { return true }
  const now = Date.now()
  const age = now - stats.mtimeMs
  const owner = readOwner(lockPath)
  if (owner) {
    const status = ownerStatus(owner)
    if (status === 'alive') return false
    if (status === 'dead') return takeOver(lockPath)
    const beat = Number(owner.heartbeatAt) || Number(owner.acquiredAt) || stats.mtimeMs
    if (now - beat <= staleMs) return false
    return takeOver(lockPath)
  }
  if (age <= staleMs) return false
  return takeOver(lockPath)
}

function takeOver(lockPath) {
  const tombstone = lockPath + '.stale-' + process.pid + '-' + crypto.randomUUID()
  try {
    fs.renameSync(lockPath, tombstone)
  } catch {
    // 另一个竞争者先回收了（ENOENT），或 Windows 上暂时不让改名；下一轮再看
    return false
  }
  try { fs.rmSync(tombstone, { recursive: true, force: true }) } catch { }
  return true
}

function release(lockPath, token) {
  const owner = readOwner(lockPath)
  // 锁已经被别人回收/替换时不能删：只释放自己拿到的这一把。
  if (!owner || owner.token !== token) return
  try { fs.rmSync(lockPath, { recursive: true, force: true }) } catch { }
}

// 阻塞式小睡，不空转 CPU；Node 主线程允许 Atomics.wait
const sleepBuf = new Int32Array(new SharedArrayBuffer(4))
function sleep(ms) {
  try { Atomics.wait(sleepBuf, 0, 0, ms) } catch { const t = Date.now(); while (Date.now() - t < ms) { } }
}
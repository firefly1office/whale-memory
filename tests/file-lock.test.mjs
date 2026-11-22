// 文件锁：持有者存活校验、过时锁回收、并发进程互斥。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import { withFileLock } from '../packages/core/lib/file-lock.js'
import { safeRemove, tmpDir } from './_safety.mjs'

const LOCK_MODULE = new URL('../packages/core/lib/file-lock.js', import.meta.url).href

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    sleep(20)
  }
}

function makeLock(lockPath, owner) {
  fs.mkdirSync(lockPath, { recursive: true })
  if (owner) fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner), 'utf8')
}

function backdate(target, ageMs) {
  const when = new Date(Date.now() - ageMs)
  fs.utimesSync(target, when, when)
}

function runChild(args) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('child exited with ' + code + ': ' + stderr))
    })
  })
}

function deadPid() {
  const res = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  assert.equal(res.status, 0)
  return Number(res.stdout)
}

test('持有者还活着：锁再旧也不抢', (t) => {
  const dir = tmpDir('lock-')
  t.after(() => safeRemove(dir))
  const lock = path.join(dir, 'memory.lock')
  makeLock(lock, {
    pid: process.pid,
    hostname: os.hostname(),
    token: 'held-by-live-process',
    acquiredAt: Date.now() - 60000,
    heartbeatAt: Date.now() - 60000
  })
  backdate(lock, 60000)
  let entered = false
  assert.throws(() => withFileLock(lock, () => { entered = true }, { timeoutMs: 120, staleMs: 30 }), /locked by another process/)
  assert.equal(entered, false, '活着的持有者不能被抢锁')
  const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'))
  assert.equal(owner.token, 'held-by-live-process', '原锁不能被换掉')
})

test('持有者进程已退出：锁被回收，写入继续', (t) => {
  const dir = tmpDir('lock-')
  t.after(() => safeRemove(dir))
  const lock = path.join(dir, 'memory.lock')
  makeLock(lock, {
    pid: deadPid(),
    hostname: os.hostname(),
    token: 'dead-holder',
    acquiredAt: Date.now(),
    heartbeatAt: Date.now()
  })
  const result = withFileLock(lock, () => 'ran', { timeoutMs: 1000, staleMs: 60000 })
  assert.equal(result, 'ran', '持有者已退出，不该等满 staleMs')
  assert.equal(fs.existsSync(lock), false, '退出后锁要清干净')
})

test('跨机持有者：心跳新就等，心跳过期才回收', (t) => {
  const dir = tmpDir('lock-')
  t.after(() => safeRemove(dir))
  const lock = path.join(dir, 'remote.lock')

  makeLock(lock, {
    pid: 4242,
    hostname: 'another-machine',
    token: 'remote-live',
    acquiredAt: Date.now(),
    heartbeatAt: Date.now()
  })
  backdate(lock, 60000)
  let entered = false
  assert.throws(() => withFileLock(lock, () => { entered = true }, { timeoutMs: 80, staleMs: 10000 }), /locked by another process/)
  assert.equal(entered, false, '心跳还新的跨机锁不能抢')

  fs.rmSync(lock, { recursive: true, force: true })
  makeLock(lock, {
    pid: 4242,
    hostname: 'another-machine',
    token: 'remote-dead',
    acquiredAt: Date.now() - 60000,
    heartbeatAt: Date.now() - 60000
  })
  backdate(lock, 60000)
  assert.equal(withFileLock(lock, () => 'reclaimed', { timeoutMs: 1000, staleMs: 100 }), 'reclaimed')
})

test('没有 owner.json 的旧锁：新鲜时等，过时才回收', (t) => {
  const dir = tmpDir('lock-')
  t.after(() => safeRemove(dir))
  const lock = path.join(dir, 'legacy.lock')
  makeLock(lock)
  assert.throws(() => withFileLock(lock, () => { }, { timeoutMs: 80, staleMs: 10000 }), /locked by another process/)

  backdate(lock, 60000)
  assert.equal(withFileLock(lock, () => 'ok', { timeoutMs: 1000, staleMs: 1000 }), 'ok')
})

test('真正跨进程：持有期间过了 staleMs 也不会被第二个写者抢进去', async (t) => {
  const dir = tmpDir('lock-')
  const lock = path.join(dir, 'held.lock')
  const ready = path.join(dir, 'ready')
  const script = path.join(dir, 'holder.mjs')
  fs.writeFileSync(script, [
    "import fs from 'node:fs'",
    `import { withFileLock } from ${JSON.stringify(LOCK_MODULE)}`,
    "const [lockPath, readyPath, holdMs] = process.argv.slice(2)",
    'withFileLock(lockPath, () => {',
    "  fs.writeFileSync(readyPath, '1')",
    '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs))',
    '}, { timeoutMs: 15000 })'
  ].join('\n'))
  const child = spawn(process.execPath, [script, lock, ready, '400'], { stdio: 'ignore' })
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('holder exited with ' + code))))
  })
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGKILL')
    try { await exited } catch { }
    safeRemove(dir)
  })

  waitFor(() => fs.existsSync(ready))
  assert.ok(fs.existsSync(lock), '另一个进程应该已经持有锁')
  let entered = false
  assert.throws(() => withFileLock(lock, () => { entered = true }, { timeoutMs: 150, staleMs: 40 }), /locked by another process/)
  assert.equal(entered, false, '持有者进程还活着，过了 staleMs 也不能进')
  await exited
  assert.equal(withFileLock(lock, () => 'after-exit', { timeoutMs: 1000, staleMs: 40 }), 'after-exit')
})

test('释放只删自己的锁：锁被别人换掉后不能误删', (t) => {
  const dir = tmpDir('lock-')
  t.after(() => safeRemove(dir))
  const lock = path.join(dir, 'handover.lock')
  const result = withFileLock(lock, () => {
    // 模拟：本进程被挂起太久，锁被回收后另一个进程重新建了一把
    fs.rmSync(lock, { recursive: true, force: true })
    makeLock(lock, { pid: process.pid, hostname: os.hostname(), token: 'someone-else', heartbeatAt: Date.now() })
    return 'done'
  })
  assert.equal(result, 'done')
  assert.ok(fs.existsSync(lock), '不能删掉别人刚拿到的锁')
  const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'))
  assert.equal(owner.token, 'someone-else')
})

test('并发进程串行进入，计数不丢', async (t) => {
  const dir = tmpDir('lock-')
  const lock = path.join(dir, 'counter.lock')
  const counter = path.join(dir, 'counter.txt')
  const script = path.join(dir, 'counter-child.mjs')
  fs.writeFileSync(counter, '0', 'utf8')
  fs.writeFileSync(script, [
    "import fs from 'node:fs'",
    `import { withFileLock } from ${JSON.stringify(LOCK_MODULE)}`,
    'const [lockPath, counterPath] = process.argv.slice(2)',
    'withFileLock(lockPath, () => {',
    "  const n = Number(fs.readFileSync(counterPath, 'utf8'))",
    '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40)',
    "  fs.writeFileSync(counterPath, String(n + 1), 'utf8')",
    '}, { timeoutMs: 15000 })'
  ].join('\n'))
  t.after(() => safeRemove(dir))

  await Promise.all(Array.from({ length: 4 }, () => runChild([script, lock, counter])))
  assert.equal(fs.readFileSync(counter, 'utf8'), '4', '四个写者必须各自看到上一个写者的结果')
  assert.equal(fs.existsSync(lock), false, '全部结束后锁目录不能残留')
})
// N3 · 并发写：先把"单写者假设"打掉，再谈规模。
//
// 验收口径（缺一不可）：
// 1. file 后端：4 个进程 × 200 次写（每条记录配一条后记 / 一次封存 / 一次想起）——
//    一条不丢（loadAll 条数 = 期望）、没有坏行、id 不重复；
// 2. doctor 全绿；跑完不残留写锁；
// 3. 一边擦除一边写：擦除要么和写串行、要么 fail closed（抛错且一个字节都没动），不许半截；
// 4. sqlite 后端：并发写不丢；BEGIN IMMEDIATE 撞锁会重试（等对方提交），重试用尽报 STORE_BUSY，
//    而不是把原始 "database is locked" 直接甩给调用方；
// 5. 这个文件可以重复跑（同一命令连跑 3 次都过，见交接里的 N3 报告）。
//
// 全部用临时目录和虚构数据，不碰任何真实记忆。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { tmpDir, safeRemove } from './_safety.mjs'
import { loadAll, addExperience, badLines } from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import { beginImmediate, sqliteAvailable } from '../packages/core/lib/sqlite-store.js'

const REPO = path.resolve(import.meta.dirname, '..')
// 子进程里的 import 要 file:// URL（Windows 上绝对路径直接写会被当成 d: 协议）
const CORE = pathToFileURL(path.join(REPO, 'packages/core/lib/self-experience.js')).href
const HAS_SQLITE = sqliteAvailable()
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function runChild(args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { }
      reject(new Error('child timeout: ' + path.basename(args[0])))
    }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error('child exited ' + code + '：' + stderr.slice(0, 1000)))
    })
  })
}

// 子进程脚本：每条记录后面跟一次后记、一次封存、一次想起——四类写交错，各自都走同一把目录写锁
const WRITE_CHILD = `
import { addExperience, reviseExperience, setSealed, markRecalled } from ${JSON.stringify(CORE)}
const [dir, tag, rounds] = process.argv.slice(2)
const failures = []
const ids = []
for (let i = 0; i < Number(rounds); i += 1) {
  try {
    const row = addExperience(dir, { text: tag + ' 记录 ' + i })
    ids.push(row.id)
    const rev = reviseExperience(dir, { id: row.id, thought: tag + ' 后记 ' + i })
    if (!rev.ok) failures.push('later: ' + rev.error)
    const seal = setSealed(dir, { id: row.id, sealed: true })
    if (!seal.ok) failures.push('seal: ' + seal.error)
    if (!markRecalled(dir, row.id, { query: tag + ' 想起 ' + i })) failures.push('recall failed')
  } catch (error) {
    failures.push('throw: ' + String(error && error.message ? error.message : error))
  }
}
process.stdout.write(JSON.stringify({ tag, ids, failures }))
`

// 只追加记录的子进程：用来跟"擦除"抢同一个目录
const APPEND_CHILD = `
import { addExperience } from ${JSON.stringify(CORE)}
const [dir, tag, rounds] = process.argv.slice(2)
const failures = []
const ids = []
for (let i = 0; i < Number(rounds); i += 1) {
  try { ids.push(addExperience(dir, { text: tag + ' 记录 ' + i }).id) }
  catch (error) { failures.push(String(error && error.message ? error.message : error)) }
}
process.stdout.write(JSON.stringify({ tag, ids, failures }))
`

const JSONL = ['self-experience.jsonl', 'later-events.jsonl', 'seal-events.jsonl', 'recall-events.jsonl']

// 逐文件逐行解析：坏行一个都不许有（也核对 doctor 看到的同一份）
function assertNoBadLines(dir) {
  assert.equal(badLines(dir), 0, 'badLines 必须是 0')
  for (const name of JSONL) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      assert.doesNotThrow(() => JSON.parse(line), name + ' 里有一行不是合法 JSON')
    }
  }
}

const lineCount = (dir, name) => {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) return 0
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).length
}

function assertDoctorGreen(dir) {
  const res = spawnSync(process.execPath, [path.join(REPO, 'tools/doctor.mjs'), dir, '--json'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(res.status, 0, 'doctor 退出码 ' + res.status + '：' + String(res.stdout || '') + String(res.stderr || ''))
  const report = JSON.parse(res.stdout)
  assert.equal(report.ok, true, 'doctor 有红灯：' + JSON.stringify(report.checks.filter((c) => !c.ok)))
}

function assertNoLockLeft(dir) {
  const locks = fs.readdirSync(dir).filter((name) => name === '.write.lock' || name === 'erase.lock' || name.endsWith('.lock'))
  assert.deepEqual(locks, [], '写锁 / 擦除锁必须释放干净')
}

test('N3：file 后端 4 进程 × 200 次写——一条不丢、没有坏行、id 不重复、doctor 全绿', async (t) => {
  const dir = tmpDir('wm-n3-')
  const work = tmpDir('wm-n3-work-')
  t.after(() => { safeRemove(dir); safeRemove(work) })
  const script = path.join(work, 'writer.mjs')
  fs.writeFileSync(script, WRITE_CHILD, 'utf8')

  const ROUNDS = 50 // 每个进程 50 轮 × 4 次写 = 200 次
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => runChild([script, dir, 'p' + i, String(ROUNDS)])))
  const children = results.map((res) => JSON.parse(res.stdout))
  const ids = children.flatMap((c) => c.ids)
  assert.equal(ids.length, 4 * ROUNDS, '每个进程都该写下 ' + ROUNDS + ' 条记录')
  for (const child of children) assert.deepEqual(child.failures, [], '子进程写入报错：' + child.tag)

  // 一条不丢：loadAll 条数 = 期望
  const rows = loadAll(dir)
  assert.equal(rows.length, 4 * ROUNDS, 'loadAll 条数不对：' + rows.length)
  // id 不重复
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'id 有重复')
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(ids), '写下去的 id 和读回来的一致')
  // 后记 / 封存 / 想起都没丢
  for (const row of rows) {
    assert.equal(row.later.length, 1, '每条记录该有 1 条后记：' + row.id)
    assert.ok(row.sealed, '每条记录都封存过：' + row.id)
    assert.equal(Number(row.recalls || 0), 1, '每条记录该被想起 1 次：' + row.id)
  }
  assertNoBadLines(dir)
  // 行数对得上：记录 200、后记 200、封存 200、想起 200
  assert.equal(lineCount(dir, 'self-experience.jsonl'), 200)
  assert.equal(lineCount(dir, 'later-events.jsonl'), 200)
  assert.equal(lineCount(dir, 'seal-events.jsonl'), 200)
  assert.equal(lineCount(dir, 'recall-events.jsonl'), 200)
  assertNoLockLeft(dir)
  assertDoctorGreen(dir)
})

test('N3：一边擦除一边写——要么串行、要么 fail closed，不许半截', async (t) => {
  const dir = tmpDir('wm-n3-erase-')
  const work = tmpDir('wm-n3-erase-work-')
  t.after(() => { safeRemove(dir); safeRemove(work) })
  const script = path.join(work, 'appender.mjs')
  fs.writeFileSync(script, APPEND_CHILD, 'utf8')

  const seed = addExperience(dir, { text: '这条一边写一边撤回' })
  const WRITES = 60
  const pending = runChild([script, dir, '旁路', String(WRITES)])
  await sleep(30) // 让写者先写几条，擦除再插进去

  let erased = null
  let lastError = null
  for (let attempt = 0; attempt < 6 && !erased; attempt += 1) {
    try {
      erased = eraseExperience(dir, { id: seed.id, reason: '测试：一边擦除一边写', actor: 'self' })
    } catch (error) {
      // fail closed 是允许的结果：抛错、文件按原样放回；稍后重试直到串行成功
      lastError = error
      assert.match(String(error && (error.code || error.message)), /ERASE_|locked|LOCKED/, '擦除失败的错要是 fail closed，不是半截：' + String(error && error.message))
      await sleep(40)
    }
  }
  const child = JSON.parse((await pending).stdout)
  assert.ok(erased && erased.ok, '擦除最终应该成功（串行）：' + String(lastError && lastError.message))
  assert.equal(erased.alreadyGone, false)
  assert.equal(child.failures.length, 0, '写者不该因为擦除而失败：' + JSON.stringify(child.failures.slice(0, 3)))

  // 写者的每一条都在，撤回的那条不在；没有半截（坏行 / 重复 id）
  const rows = loadAll(dir)
  assert.equal(rows.length, WRITES, '写者 ' + WRITES + ' 条一条都不能丢：' + rows.length)
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length)
  assert.equal(rows.some((row) => row.id === seed.id), false, '撤回的那条不许复活')
  assert.equal(lineCount(dir, 'self-experience.jsonl'), WRITES)
  assertNoBadLines(dir)
  assert.equal(tombstones.readAll(dir).rows.length, 1, '撤回要留下墓碑')
  assertNoLockLeft(dir)
  assertDoctorGreen(dir)
})

// sqlite 子进程：每进程 15 次写（记录 + 真库事务，双写 JSONL）
const SQLITE_CHILD = `
import { addExperience } from ${JSON.stringify(CORE)}
const [dir, tag, rounds] = process.argv.slice(2)
const failures = []
for (let i = 0; i < Number(rounds); i += 1) {
  try { addExperience(dir, { text: tag + ' sqlite 记录 ' + i }, { backend: 'sqlite' }) }
  catch (error) { failures.push(String(error && error.message ? error.message : error)) }
}
process.stdout.write(JSON.stringify({ tag, failures }))
`

sq('N3：sqlite 后端并发写——4 进程一条不丢，doctor 全绿', async (t) => {
  const dir = tmpDir('wm-n3-sq-')
  const work = tmpDir('wm-n3-sq-work-')
  t.after(() => { safeRemove(dir); safeRemove(work) })
  addExperience(dir, { text: '迁移前的底子' })
  const migrate = spawnSync(process.execPath, [path.join(REPO, 'tools/migrate-storage.mjs'), dir, '--write'], { encoding: 'utf8', timeout: 120000 })
  assert.equal(migrate.status, 0, '迁移失败：' + String(migrate.stdout || '') + String(migrate.stderr || ''))

  const script = path.join(work, 'sq-writer.mjs')
  fs.writeFileSync(script, SQLITE_CHILD, 'utf8')
  const ROUNDS = 15
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => runChild([script, dir, 'q' + i, String(ROUNDS)])))
  for (const res of results) assert.deepEqual(JSON.parse(res.stdout).failures, [])

  const fromJsonl = loadAll(dir)
  const fromStore = loadAll(dir, { backend: 'sqlite' })
  assert.equal(fromJsonl.length, 1 + 4 * ROUNDS, 'JSONL 条数不对：' + fromJsonl.length)
  assert.equal(fromStore.length, 1 + 4 * ROUNDS, '库里条数不对：' + fromStore.length)
  assert.equal(new Set(fromJsonl.map((row) => row.id)).size, fromJsonl.length, 'id 有重复')
  assertNoBadLines(dir)
  assertDoctorGreen(dir)
})

// 持锁的子进程：拿到 BEGIN IMMEDIATE 后写 ready 文件，等 holdMs 再提交
const HOLDER_CHILD = `
import fs from 'node:fs'
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
const [file, ready, holdMs] = process.argv.slice(2)
const db = new DatabaseSync(file)
db.exec('PRAGMA busy_timeout = 0')
try {
  db.exec('BEGIN IMMEDIATE')
  db.exec('INSERT INTO t (x) VALUES (0)')
  fs.writeFileSync(ready, '1')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs))
  db.exec('COMMIT')
} finally { db.close() }
`

sq('N3：sqlite 撞锁——重试等到对方提交；重试用尽报 STORE_BUSY（不甩原始 database is locked）', async (t) => {
  const dir = tmpDir('wm-n3-busy-')
  t.after(() => safeRemove(dir))
  const file = path.join(dir, 'busy.db')
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const setup = new DatabaseSync(file)
  setup.exec('PRAGMA journal_mode = WAL')
  setup.exec('CREATE TABLE t (x INTEGER)')
  setup.close()

  const script = path.join(dir, 'holder.mjs')
  fs.writeFileSync(script, HOLDER_CHILD, 'utf8')
  const waiter = new DatabaseSync(file)
  waiter.exec('PRAGMA busy_timeout = 20')
  const ready = path.join(dir, 'ready-a')
  const holder = runChild([script, file, ready, '400'])
  for (let i = 0; i < 200 && !fs.existsSync(ready); i += 1) await sleep(10)
  assert.ok(fs.existsSync(ready), '持锁子进程没起来')

  // 重试 6 次（约 100+200+300+400+500ms）→ 对方 400ms 后提交，这里应该等到并成功
  beginImmediate(waiter, { attempts: 6, baseDelayMs: 100 })
  waiter.exec('INSERT INTO t (x) VALUES (1)')
  waiter.exec('COMMIT')
  await holder

  // 重试用尽：持锁 400ms，只给 1 次机会 → STORE_BUSY
  const readyB = path.join(dir, 'ready-b')
  const holderB = runChild([script, file, readyB, '400'])
  for (let i = 0; i < 200 && !fs.existsSync(readyB); i += 1) await sleep(10)
  assert.ok(fs.existsSync(readyB), '第二个持锁子进程没起来')
  assert.throws(() => beginImmediate(waiter, { attempts: 1 }), (error) => error.code === 'STORE_BUSY' && /store busy/.test(error.message))
  await holderB
  waiter.close()

  // 两次写入都在，库没坏
  const check = new DatabaseSync(file)
  assert.equal(check.prepare('SELECT count(*) AS n FROM t').get().n, 3, '持锁 1 条 + 成功那次 1 条 + 第二次持锁 1 条')
  check.close()
})
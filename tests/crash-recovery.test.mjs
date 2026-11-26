// 阶段 3 健壮性：真的 kill 掉进程，再看磁盘上剩下什么。
//
// 两条演练（都不做"模拟失败"：父进程发的是 SIGKILL，Windows 上走 TerminateProcess）：
//   1. sqlite 后端在 transaction() 中途被杀：已经提交的事务整组都在；被杀的这个事务要么整组全在、
//      要么一条都没有（不许半提交）；库本身还能读、能接着写，loadAll(dir, { backend: 'sqlite' }) 不抛错；
//   2. tools/migrate-storage.mjs 在三个不同的步上被杀（事务里 / 提交后改名前 / 改名后对拍时）：
//      正式文件名 memory.sqlite 上不会留下半成品库挡住下一次迁移；再跑一次能成功，
//      迁移前后 loadAll 逐条相等，源 JSONL 一个字节都没变。
//
// "停在某一步再杀"是这么做出来的：后端演练由子进程自己 process.send('mid')；迁移演练用一个
// --import 预加载的钩子把进程同步停在我们选的那一步上、写个标记文件，父进程看到标记就 SIGKILL。
// 钩子只决定"什么时候停"，不伪造任何失败。
//
// ---------------------------------------------------------------- 演练中观察到的源码问题（三条已在 0.25.0 修掉，修法见每段末尾）
//
// 【F1】首次建库不是原子的：openDatabaseFile(create:true) 里 ensureSchema 的 5 条 DDL 各自自动提交。
//   最小复现：空目录里子进程 await openBackend({ kind: 'sqlite', dir }) 后第一次 append（#open() 才建库），
//   在 DatabaseSync.prototype.exec 上钩住 'CREATE TABLE IF NOT EXISTS events' 那一句、停住、SIGKILL。
//   库里只剩 records 表（加它的索引），之后 loadAll(dir, { backend: 'sqlite' }) 永远抛，原文：
//     STORAGE_INCOMPLETE | memory.sqlite 缺表（events）：多半是阶段 1 早期只搬了记录的库。移走它重新迁移，
//     否则记录在库里、事件不在，读一半就断。
//   (a) 文案与事实不符：这不是"阶段 1 早期只搬了记录的库"，是刚建库时被杀，库里一条记录都没有；
//   (b) 只读的宿主会一直拿到 STORAGE_INCOMPLETE，直到有人走一次写路径（openBackend 会补建缺的表，
//       count() = 0，之后 loadAll 恢复正常），而提示让人以为要删库重迁。
//   建议：ensureSchema 包进一个事务；另外"两张表都不存在"可以当成空库（没有表就是没有数据，
//   不存在读一半），或者建库最后写一个 schema 版本行、它在了才算建完。
//   已修（0.25.0）：ensureSchema 把整组 DDL 包进一个事务（SQLite 的 DDL 可回滚）。
//   验证：注入第 3 条 DDL 失败后库里一张表都没有，重开重建正常。这里仍然不写"半成品库"的用例——
//   那个窗口已经被事务关掉了，钉住它没有意义。
//
// 【F2】SqliteBackend.transaction() / #group() 的 catch 里 `db.exec('ROLLBACK')` 没有 try 包着。
//   如果 SQLite 已经自己回滚了这个事务（SQLITE_FULL、SQLITE_IOERR 这类错误会让语句/事务隐式回滚），
//   这一句会抛 'cannot rollback - no transaction is active'，把真正的错误盖掉；#group 里 ROLLBACK 失败时
//   SAVEPOINT 也没清。我只做了审读，没能造出真实触发（要触发得把盘写满），所以不算演练结论。
//   已修（0.25.0）：6 处 ROLLBACK 全走 rollbackQuiet()，回滚失败不吭声、原错误照抛。
//
// 【F3】被杀留下的临时库没人清：每次崩溃在数据目录里漏一个 `.memory.sqlite.migrating-<pid>`
//   （+ -wal / -shm；我这次量到 4096 + 32768 + 53592 字节，杀在改名前的那个是完整的 36864 单文件）。
//   下次迁移只打印一句"上次中断留下的临时库"就继续，文件一直留着。
//   更实的一条：临时名只用 pid。pid 被复用时迁移会直接打开上次那个临时库（create:true），如果上次已经
//   COMMIT（正好杀在 COMMIT 和改名之间），这次会以 `id 已存在：exp_xxx` 失败一次（之后自己清掉，再跑就成功）。
//   实测顺序：先杀在 rename 前，再用同一个 pid 跑一次迁移 → 退出码 1，stderr 原文（exp_ 后面那次是随机 id）：
//     迁移失败，已回滚（没有留下库文件，源文件未改）：id 已存在：exp_mwx91d8pkyzh
//   已修（0.25.0）：临时库名加随机后缀（残留检测仍按前缀扫，本文件的断言不受影响）。
//   注意：被杀之后留下的临时文件仍然不会自动清（只是不再撞名），那一句提示照旧打。
//
// 全部用临时目录和虚构数据，不碰任何真实记忆。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { openBackend } from '../packages/core/lib/storage/backend.js'
import {
  loadAll, addExperience, reviseExperience, setSealed, markRecalled, setUnfinishedState, linkExperiences
} from '../packages/core/lib/self-experience.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import { DB_FILE } from '../packages/core/lib/sqlite-store.js'
import { safeRemove, tmpDir } from './_safety.mjs'

// node:sqlite 要 Node >= 22.5；CI 还在 Node 20 上跑全量。没有它时 sqlite 用例跳过（file 用例照跑）
const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const repo = path.resolve(import.meta.dirname, '..')
const TOOL = path.join(repo, 'tools/migrate-storage.mjs')
const urlOf = (rel) => pathToFileURL(path.join(repo, rel)).href
const BACKEND_URL = urlOf('packages/core/lib/storage/backend.js')

// 子进程一律 20 秒为限：到点就 kill，测试不许挂死
const CHILD_TIMEOUT = 20000
const TMP_DB_PREFIX = '.' + DB_FILE + '.migrating-'

const at = (s) => new Date(s).toISOString()
const dayOfIso = (iso) => iso.slice(0, 10)

const mkdir = (root, name) => {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// 目录里 JSONL 的字节快照：用来证明演练全程源文件一个字节都没变
function jsonlBytes(dir) {
  return Object.fromEntries(fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()
    .map((name) => [name, fs.readFileSync(path.join(dir, name)).toString('base64')]))
}

// 迁移留下的临时库（含 -wal / -shm）
const tempDbs = (dir) => fs.readdirSync(dir).filter((name) => name.startsWith(TMP_DB_PREFIX))

const isPlainTempDb = (name) => name.startsWith(TMP_DB_PREFIX) && !/-(wal|shm|journal)$/.test(name)

// 一份覆盖六类事件的虚构记忆：迁移演练要证明"每一类都搬过去了"
function writeMemory(dir) {
  const a = addExperience(dir, { text: '在海边捡到一只小海螺，壳是粉色的', feeling: ['平静'], unfinished: '还没查它叫什么' })
  const b = addExperience(dir, { text: '把小海螺放在了窗台上，太阳一照亮亮的', refs: [a.id] })
  assert.equal(reviseExperience(dir, { id: a.id, thought: '后来查到了，是一种小海螺', feeling: ['高兴'] }).ok, true)
  assert.equal(setSealed(dir, { id: b.id, sealed: true, note: '这件事先不想被提起' }).ok, true)
  assert.equal(markRecalled(dir, a.id), true)
  assert.equal(setUnfinishedState(dir, { id: a.id, choice: 'done', note: '查到了' }).ok, true)
  assert.equal(linkExperiences(dir, { from: a.id, to: b.id, reason: '同一件事' }).ok, true)
  chapterEvents.open(dir, { name: '海边的那些天', from: '2026-11-01' })
  // 自己验一下夹具：两条记录都要能读出来（不然下面的"逐条相等"说明不了什么）
  assert.deepEqual(loadAll(dir).map((r) => r.id), [a.id, b.id])
}

// ---------------------------------------------------------------- 后端演练的子进程

// 第一组：自己提交（证明"提交过的不会丢"）；第二组：写到第三条之前停下，等父进程 SIGKILL。
// mode=stall：停住等杀；mode=commit：不打搅，整段写完（对照，证明上一条的"空"不是脚本没写）。
function backendChildScript() {
  return `
import fs from 'node:fs'
const [dir, mode] = process.argv.slice(2)
const { openBackend } = await import(${JSON.stringify(BACKEND_URL)})
const at = (s) => new Date(s).toISOString()
const day = (s) => at(s).slice(0, 10)
const rec = (id, s, text) => ({ id, at: at(s), day: day(s), then: { text, feeling: [], thought: '', state: { at: at(s) } } })

const backend = await openBackend({ kind: 'sqlite', dir })

// 第一组：transaction 里一次提交，带一条后记
await backend.transaction(async (t) => {
  await t.appendWithEvents(rec('drill_a1', '2026-11-20T01:00:00Z', '已经提交的第一条'), [
    { kind: 'later', row: { id: 'drill_a1', at: at('2026-11-20T02:00:00Z'), day: day('2026-11-20T02:00:00Z'), thought: '已经提交的后记', reason: '' } },
    { kind: 'recall', row: { id: 'drill_a1', at: at('2026-11-20T02:30:00Z'), query: '已经提交' } }
  ])
  await t.append(rec('drill_a2', '2026-11-20T03:00:00Z', '已经提交的第二条'))
})
process.send({ phase: 'a-committed' })

// 第二组：写进事务、还没 COMMIT，停在中间等人来杀
await backend.transaction(async (t) => {
  await t.append(rec('drill_b1', '2026-11-21T01:00:00Z', '事务里的第一条'))
  await t.appendEvent('seal', { id: 'drill_b1', at: at('2026-11-21T02:00:00Z'), action: 'seal', note: '事务里的封存' })
  await t.append(rec('drill_b2', '2026-11-21T03:00:00Z', '事务里的第二条'))
  // 事务里自己看一眼：这些写在杀之前**确实写进了事务**（库的总数是 4 条、封存事件 1 条）
  const inTransaction = { records: await t.count(), seal: (await t.events('seal')).length }
  process.send({ phase: 'mid', inTransaction })
  if (mode === 'stall') await new Promise(() => {}) // 卡在这里：事务不提交，等 SIGKILL
  await t.append(rec('drill_b3', '2026-11-21T04:00:00Z', '事务里的第三条'))
})
process.send({ phase: 'committed' })
await backend.close()
`
}

// 起子进程；stall 模式下收到 'mid' 立刻 SIGKILL，再等它真的退出
function runBackendChild(script, dir, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, dir, mode], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const messages = []
    let stdout = ''
    let stderr = ''
    let killed = false
    const failed = (message) => {
      child.kill('SIGKILL')
      clearTimeout(timer)
      reject(new Error(message + '。stdout：' + stdout + '；stderr：' + stderr))
    }
    const timer = setTimeout(() => failed('子进程 ' + CHILD_TIMEOUT + 'ms 没走到约定位置，已强制结束'), CHILD_TIMEOUT)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('message', (message) => {
      messages.push(message)
      if (mode === 'stall' && message && message.phase === 'mid' && !killed) {
        killed = true
        child.kill('SIGKILL')
      }
    })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, messages, stdout, stderr }) })
  })
}

// ---------------------------------------------------------------- 迁移演练的预加载钩子 + 子进程

// 只在"该停的那一步"停住（写标记文件），停住之后由父进程真的 SIGKILL。不伪造任何失败。
function writePreload(helperDir) {
  const file = path.join(helperDir, 'drill-preload.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'

const where = process.env.WM_DRILL_AT
const marker = process.env.WM_DRILL_MARKER

// 同步停住，等父进程 SIGKILL；万一没人来杀，30 秒后自己退出，绝不继续往下写
function park(tag) {
  fs.writeFileSync(marker, JSON.stringify({ tag, pid: process.pid, when: Date.now() }))
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
  process.exit(97)
}

const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
const watch = (proto, name, match, limit) => {
  const original = proto[name]
  let seen = 0
  proto[name] = function (...args) {
    if (match(String(args[0] ?? '')) && (seen += 1) === limit) park(where + '：' + String(args[0]).slice(0, 40))
    return original.apply(this, args)
  }
}

if (where === 'prepare') {
  // 迁移的事务里：写第二条记录时（还没 COMMIT）
  watch(DatabaseSync.prototype, 'prepare', (sql) => sql.startsWith('INSERT INTO records'), 2)
} else if (where === 'rename') {
  // 提交、关库之后，把临时库改成 memory.sqlite 之前
  const original = fs.renameSync
  fs.renameSync = function (from, to) {
    if (String(to).endsWith('memory.sqlite')) park('rename：改名前')
    return original.call(this, from, to)
  }
} else if (where === 'verify') {
  // 改名之后，对拍读到第一条记录时
  watch(DatabaseSync.prototype, 'prepare', (sql) => sql.startsWith('SELECT json FROM records'), 1)
}
`)
  // --import 要的是 URL（Windows 上给绝对路径会被当成协议 'c:'）
  return pathToFileURL(file).href
}

// 跑迁移子进程，停在 where 那一步之后 SIGKILL；等它真的退出再返回
async function killMigration(preload, memDir, helperDir, where) {
  const marker = path.join(helperDir, where + '.marker')
  const child = spawn(process.execPath, ['--import', preload, TOOL, memDir, '--write'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WM_DRILL_AT: where, WM_DRILL_MARKER: marker }
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
  const parked = new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = setInterval(() => {
      if (fs.existsSync(marker)) {
        clearInterval(poll)
        resolve(JSON.parse(fs.readFileSync(marker, 'utf8')))
        return
      }
      if (Date.now() - started > CHILD_TIMEOUT) {
        clearInterval(poll)
        child.kill('SIGKILL')
        reject(new Error('迁移子进程 ' + CHILD_TIMEOUT + 'ms 没停到「' + where + '」这一步，已强制结束。stderr：' + stderr))
      }
    }, 10)
    exited.then(() => {
      clearInterval(poll)
      reject(new Error('迁移子进程在停到「' + where + '」这一步之前就自己退出了。stdout：' + stdout + '；stderr：' + stderr))
    })
  })
  const info = await parked
  child.kill('SIGKILL')
  const exit = await exited
  return { ...exit, marker: info, stdout, stderr }
}

const migrate = (dir, ...flags) => spawnSync(process.execPath, [TOOL, dir, ...flags], { encoding: 'utf8' })

// ---------------------------------------------------------------- 演练 1：后端事务中途被杀

sq('sqlite：transaction 中途被 SIGKILL——已提交的整组在、没提交的整组一条不留，库还能读能写', async (t) => {
  const root = tmpDir('wm-crash-tx-')
  t.after(() => safeRemove(root))
  const memDir = mkdir(root, 'memory')
  const script = path.join(root, 'backend-drill.mjs')
  fs.writeFileSync(script, backendChildScript())

  const killed = await runBackendChild(script, memDir, 'stall')
  assert.deepEqual(killed.messages.map((m) => m.phase), ['a-committed', 'mid'],
    '子进程应当先提交第一组，再停在第二组事务里（stderr：' + killed.stderr + '）')
  assert.equal(killed.signal, 'SIGKILL', '进程必须是真的被 SIGKILL 杀死的，不是自己跑完退出的')
  assert.equal(killed.code, null, '被杀的子进程不该有正常退出码')
  // 杀之前事务里已经有 4 条记录 + 1 条封存事件（子进程自己在事务里数的）：这条用例不是空转
  assert.deepEqual(killed.messages.find((m) => m.phase === 'mid').inTransaction, { records: 4, seal: 1 },
    '杀之前第二组必须真的写进事务了')

  // 重开库：库必须还能用，而且里面只能是"提交过的那些"
  const backend = await openBackend({ kind: 'sqlite', dir: memDir })
  const ids = (await backend.all()).map((r) => r.id)
  assert.deepEqual(ids, ['drill_a1', 'drill_a2'], '第一组（已经 COMMIT 的）必须整组都在，而且只有它')

  // 全有或全无：第二组的三条要么都在、要么都不在，不许半提交
  const inFlight = ['drill_b1', 'drill_b2', 'drill_b3']
  const present = inFlight.filter((id) => ids.includes(id))
  assert.ok(present.length === 0 || present.length === inFlight.length,
    '一个事务不许半提交：第二组只出现了 ' + JSON.stringify(present))
  assert.deepEqual(present, [], '子进程没走到 COMMIT 就被杀，第二组应当一条都不留')

  // 事件同样整组走：第一组的后记与想起在，第二组那条封存不在
  assert.deepEqual((await backend.events('later')).map((r) => r.id), ['drill_a1'])
  assert.deepEqual((await backend.events('recall')).map((r) => r.id), ['drill_a1'])
  assert.deepEqual((await backend.events('seal')), [], '第二组的封存事件不许落盘')

  // 读路径：loadAll 不许抛，读出来的和库里一致
  const afterCrash = loadAll(memDir, { backend: 'sqlite' })
  assert.deepEqual(afterCrash.map((r) => r.id), ids, 'loadAll 在崩溃后应当照常读出库里那两条')
  assert.equal(afterCrash[0].later.length, 1, '第一组的后记要能读到')

  // 还能接着写，而且写进去的关库再开还在
  await backend.append({ id: 'drill_after', at: at('2026-11-22T01:00:00Z'), day: '2026-11-22', then: { text: '崩溃之后接着写' } })
  assert.equal(await backend.count(), 3)
  await backend.close()
  const reopened = await openBackend({ kind: 'sqlite', dir: memDir })
  assert.deepEqual((await reopened.all()).map((r) => r.id), ['drill_a1', 'drill_a2', 'drill_after'])
  await reopened.close()
  assert.deepEqual(loadAll(memDir, { backend: 'sqlite' }).map((r) => r.id), ['drill_a1', 'drill_a2', 'drill_after'])
})

sq('对照：同一个子进程不被打断时 5 条全写进去（上面那条的"空"是被杀造成的，不是脚本没写）', async (t) => {
  const root = tmpDir('wm-crash-tx-control-')
  t.after(() => safeRemove(root))
  const memDir = mkdir(root, 'memory')
  const script = path.join(root, 'backend-drill.mjs')
  fs.writeFileSync(script, backendChildScript())

  const done = await runBackendChild(script, memDir, 'commit')
  assert.equal(done.code, 0, '不被打断时子进程应当正常退出：' + done.stderr)
  assert.equal(done.signal, null, '不被打断时不该有信号')
  assert.deepEqual(done.messages.map((m) => m.phase), ['a-committed', 'mid', 'committed'])
  const backend = await openBackend({ kind: 'sqlite', dir: memDir })
  assert.deepEqual((await backend.all()).map((r) => r.id), ['drill_a1', 'drill_a2', 'drill_b1', 'drill_b2', 'drill_b3'],
    '不被打断时两组都该提交，5 条一条不少')
  assert.deepEqual((await backend.events('seal')).map((r) => r.id), ['drill_b1'])
  await backend.close()
  assert.equal(loadAll(memDir, { backend: 'sqlite' }).length, 5)
})

// ---------------------------------------------------------------- 演练 2：迁移中途被杀

// 三个演练共用同一套断言骨架：被杀之后正式库不许是半成品，再跑一次要成功，前后 loadAll 逐条相等
function assertRemigrate(memDir, before, beforeBytes) {
  assert.equal(fs.existsSync(path.join(memDir, DB_FILE)), false, '正式文件名上不许出现半成品库')
  assert.deepEqual(jsonlBytes(memDir), beforeBytes, '迁移被杀也不许改任何源文件')
  assert.ok(tempDbs(memDir).length > 0, '这次被杀应当在临时文件名上留下东西（不然没演练到）')
  // 半截的临时库不许被当成库读，也不许把"没迁移"当成"她什么都没写"
  assert.throws(() => loadAll(memDir, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')

  const again = migrate(memDir, '--write')
  assert.equal(again.status, 0, '再跑一次迁移必须成功：' + again.stdout + again.stderr)
  assert.match(again.stdout, /上次中断留下的临时库/, '要提示上次留下的临时库')
  assert.match(again.stdout, /逐条对拍通过/, '迁移自己要完成逐条对拍')

  assert.deepEqual(loadAll(memDir, { backend: 'sqlite' }), before, '迁移前后 loadAll 必须逐条相等')
  assert.deepEqual(loadAll(memDir), before, 'file 后端读到的也必须一模一样')
  assert.deepEqual(jsonlBytes(memDir), beforeBytes, '源文件全程不许变')
  assert.ok(fs.existsSync(path.join(memDir, DB_FILE)), '这次该真的建出 memory.sqlite 了')
}

sq('迁移：SQLite 事务写到一半被 SIGKILL——正式库一个字都没写出来，再跑一次能成功', async (t) => {
  const root = tmpDir('wm-crash-migrate-tx-')
  t.after(() => safeRemove(root))
  const memDir = mkdir(root, 'memory')
  const helperDir = mkdir(root, 'helper')
  const preload = writePreload(helperDir)
  writeMemory(memDir)
  const before = loadAll(memDir)
  const beforeBytes = jsonlBytes(memDir)

  const killed = await killMigration(preload, memDir, helperDir, 'prepare')
  assert.equal(killed.signal, 'SIGKILL', '迁移进程必须是真的被 SIGKILL 杀死的')
  assert.match(killed.marker.tag, /^prepare：INSERT INTO records/, '应当停在第二条 records 的写入上，实际停在：' + killed.marker.tag)
  assertRemigrate(memDir, before, beforeBytes)
})

sq('迁移：提交之后、改名之前被 SIGKILL——留下的还是临时名字，不挡下一次迁移', async (t) => {
  const root = tmpDir('wm-crash-migrate-rename-')
  t.after(() => safeRemove(root))
  const memDir = mkdir(root, 'memory')
  const helperDir = mkdir(root, 'helper')
  const preload = writePreload(helperDir)
  writeMemory(memDir)
  const before = loadAll(memDir)
  const beforeBytes = jsonlBytes(memDir)

  const killed = await killMigration(preload, memDir, helperDir, 'rename')
  assert.equal(killed.signal, 'SIGKILL')
  assert.match(killed.marker.tag, /^rename/)
  assert.equal(fs.existsSync(path.join(memDir, DB_FILE)), false, '改名还没发生，正式文件名上不该有东西')

  // 这个窗口里被杀，临时库其实已经完整（改了名就是成品）：先验一下，证明换名才是一步到底的
  const leftovers = tempDbs(memDir).filter(isPlainTempDb)
  assert.equal(leftovers.length, 1, '应当恰好留下一个临时库：' + JSON.stringify(tempDbs(memDir)))
  assert.ok(!tempDbs(memDir).some((name) => /-wal$/.test(name)), '改名前已经把 WAL 收成单文件')
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const leftover = new DatabaseSync(path.join(memDir, leftovers[0]))
  const rows = Number(leftover.prepare('SELECT COUNT(*) AS c FROM records').get().c)
  const events = Number(leftover.prepare('SELECT COUNT(*) AS c FROM events').get().c)
  leftover.close()
  assert.equal(rows, before.length, '临时库里的记录应当已经齐了')
  assert.equal(events, 6, '临时库里六类事件也都齐了（夹具里每类各一条）')

  assertRemigrate(memDir, before, beforeBytes)
})

sq('迁移：改名之后、对拍之前被 SIGKILL——正式库已经完整，--verify-only 能过，loadAll 一致', async (t) => {
  const root = tmpDir('wm-crash-migrate-verify-')
  t.after(() => safeRemove(root))
  const memDir = mkdir(root, 'memory')
  const helperDir = mkdir(root, 'helper')
  const preload = writePreload(helperDir)
  writeMemory(memDir)
  const before = loadAll(memDir)
  const beforeBytes = jsonlBytes(memDir)

  const killed = await killMigration(preload, memDir, helperDir, 'verify')
  assert.equal(killed.signal, 'SIGKILL')
  assert.match(killed.marker.tag, /^verify/)

  // 这次改名已经完成：正式库在，而且是完整的（不是半成品，也不是靠临时文件才完整）
  assert.ok(fs.existsSync(path.join(memDir, DB_FILE)), '改名已经发生，正式库应当存在')
  assert.deepEqual(tempDbs(memDir), [], '改名之后不该再有临时库')
  assert.deepEqual(jsonlBytes(memDir), beforeBytes, '源文件不许变')

  const verify = migrate(memDir, '--verify-only')
  assert.equal(verify.status, 0, '被杀之后正式库应当能通过逐条对拍：' + verify.stdout + verify.stderr)
  assert.match(verify.stdout, /逐条对拍通过/)
  assert.deepEqual(loadAll(memDir, { backend: 'sqlite' }), before, '被杀之后 loadAll 必须照常读到全部记忆')
  assert.deepEqual(loadAll(memDir), before)

  // 契约里迁移不覆盖已有的库：这里拒绝是设计如此，库里是完整的（上面 --verify-only 已经证明）
  const rewrite = migrate(memDir, '--write')
  assert.equal(rewrite.status, 3, '已有的库不许被覆盖：' + rewrite.stdout + rewrite.stderr)
  assert.match(rewrite.stdout + rewrite.stderr, /已存在/)
})
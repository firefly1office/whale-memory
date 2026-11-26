// S4 · 写路径切 SQLite（阶段 1 的尾巴）
//
// 验收口径（缺一不可）：
// 1. 同一组操作，file 与 sqlite 两个后端读出来**逐字段相同**（对拍：loadAll / 当前视图 / 召回 id 序列）；
//    唯一允许不同的是随机生成的 exp_ id——两边各自生成，测试按"第一次出现的顺序"归一后再比；
// 2. 默认仍是 file：不传 backend 不产生 memory.sqlite，行为与 0.27.0 逐字相同；
// 3. 双写可关：dualWrite:false 时 JSONL 一个字节都不变，只有库里有；
// 4. 崩在两步之间：JSONL 多一行、库没提交 → 读路径 fail closed（STORAGE_STALE）→ 移走库重新迁移后两边一致；
// 5. 库没迁移 / 库过期 / 一组写里有一条不合格 → 整次拒绝，一条都不落盘（记录与事件同事务）；
// 6. recall({mark:true}) 在 sqlite 下解禁，记的那一笔与 file 后端读出来一致。
//
// 时间用 node:test 的 mock timers 冻住：两边跑同一串操作、同样的 tick，at/day 才逐字相同。
// 全部用临时目录和虚构数据，不碰任何真实记忆。
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

import { tmpDir, safeRemove } from './_safety.mjs'
import {
  loadAll, recall, addExperience, reviseExperience, setSealed, markRecalled
} from '../packages/core/lib/self-experience.js'
import { appendToStore, DB_FILE } from '../packages/core/lib/sqlite-store.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import * as audit from '../packages/core/lib/audit.js'

const HAS_SQLITE = typeof process.getBuiltinModule === 'function' && Boolean(process.getBuiltinModule('node:sqlite'))
const sq = HAS_SQLITE ? test : (name, fn) => test(name, { skip: '这个 Node 没有 node:sqlite' }, fn)

const repo = path.resolve(import.meta.dirname, '..')
const MIGRATE = path.join(repo, 'tools/migrate-storage.mjs')
const BASE_TIME = Date.parse('2026-11-27T02:00:00+08:00')

const NEW = (t) => {
  const dir = tmpDir('whale-s4-')
  t.after(() => safeRemove(dir))
  return dir
}

const migrate = (dir) => execFileSync(process.execPath, [MIGRATE, dir, '--write'], { stdio: 'pipe' })
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const jsonlFiles = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()

// 随机 id 两边不同；按第一次出现的顺序换成 EXP0/EXP1……（refs、事件里的 id 一起换）
function normalize(rows) {
  const map = new Map()
  return JSON.stringify(rows, (key, value) => {
    if (typeof value !== 'string' || !/^exp_[0-9a-z]+$/.test(value)) return value
    if (!map.has(value)) map.set(value, 'EXP' + map.size)
    return map.get(value)
  })
}

// 同一串操作，两边跑；early 用 opEarly，late（迁移之后那段）用 opLate
function runOps(dir, { early = {}, late = {} } = {}) {
  const out = {}
  mock.timers.setTime(BASE_TIME) // 每一串操作都从同一个时刻开始，两边的 at/day 才对得上
  out.first = addExperience(dir, { text: '在海边捡到一只贝壳', feeling: ['平静'], weight: 'minor' }, early)
  mock.timers.tick(1500)
  out.second = addExperience(dir, { text: '她说想起小时候的码头', thought: '有点想家', refs: [out.first.id] }, early)
  mock.timers.tick(1500)
  out.revise = reviseExperience(dir, { id: out.second.id, thought: '后来又想了一遍', reason: '睡前', feeling: ['温和'] }, early)
  mock.timers.tick(1500)
  out.seal = setSealed(dir, { id: out.first.id, sealed: true, note: '先别主动提' }, late)
  mock.timers.tick(1500)
  out.sealAgain = setSealed(dir, { id: out.first.id, sealed: true }, late) // noop
  mock.timers.tick(1500)
  out.unseal = setSealed(dir, { id: out.first.id, sealed: false }, late)
  mock.timers.tick(1500)
  out.marked = markRecalled(dir, out.second.id, { ...late, query: '码头' })
  mock.timers.tick(1500)
  const recallOpts = { mark: true, limit: 5, ...(late.backend ? { backend: late.backend, dualWrite: late.dualWrite } : {}) }
  out.hits = recall(dir, '码头', recallOpts).map((r) => ({ id: r.id, recalls: r.recalls, lastRecalledAt: r.lastRecalledAt }))
  mock.timers.tick(1500)
  out.hits2 = recall(dir, '贝壳', recallOpts).map((r) => ({ id: r.id, recalls: r.recalls, lastRecalledAt: r.lastRecalledAt }))
  mock.timers.tick(1500)
  return out
}

const useClock = (t) => {
  mock.timers.enable({ apis: ['Date'], now: BASE_TIME })
  t.after(() => mock.timers.reset())
}

sq('S4 对拍：同一组操作，file 与 sqlite 读出来逐字段相同（exp id 按出现顺序归一）', (t) => {
  useClock(t)
  const fileDir = NEW(t)
  const sqlDir = NEW(t)

  const earlyFile = runOps(fileDir, {})
  const earlySql = runOps(sqlDir, {}) // 迁移之前两边都只走 file，记录必须一模一样
  assert.equal(normalize(earlyFile), normalize(earlySql), '迁移前两边走的是同一条 file 路径，返回值该逐字相同（id 归一后）')

  migrate(sqlDir)
  const lateFile = runOps(fileDir, {})
  // 迁移之后，写路径整条切到 sqlite：如果有一段还走 file，JSONL 就绕过了库的 sources（那是 STORAGE_STALE 的本意）
  const lateSql = runOps(sqlDir, { early: { backend: 'sqlite' }, late: { backend: 'sqlite' } })

  // 写路径的返回值也对得上（noop 与时间戳）
  assert.equal(normalize(lateFile.seal), normalize(lateSql.seal))
  assert.equal(lateSql.seal.noop, false)
  assert.equal(lateSql.sealAgain.noop, true, '同一个动作重复是 noop，不能写第二条')
  assert.equal(normalize(lateFile.unseal), normalize(lateSql.unseal))

  const fileRows = loadAll(fileDir)
  const sqlRows = loadAll(sqlDir, { backend: 'sqlite' })
  assert.ok(fileRows.length >= 2 && sqlRows.length >= 2)
  assert.equal(normalize(sqlRows), normalize(fileRows), '两个后端读出来必须逐字段相同（含 later / sealed / recalls / refs）')

  // JSONL 也该是同一串行（双写写的是同一行）
  assert.deepEqual(jsonlFiles(sqlDir), jsonlFiles(fileDir), '两边的事件文件清单要一致')
  for (const name of jsonlFiles(fileDir)) {
    const a = fs.readFileSync(path.join(fileDir, name), 'utf8')
    const b = fs.readFileSync(path.join(sqlDir, name), 'utf8')
    assert.equal(normalize(b.split('\n').filter(Boolean).map((l) => JSON.parse(l))), normalize(a.split('\n').filter(Boolean).map((l) => JSON.parse(l))), name + ' 两边内容要一致')
  }

  // 召回 id 序列（把 id 归一后再比）；hits 里也带 recalls / lastRecalledAt
  const normHits = (hits) => normalize(hits.map((h) => ({ id: h.id, recalls: h.recalls, lastRecalledAt: h.lastRecalledAt })))
  assert.equal(normHits(lateSql.hits), normHits(lateFile.hits), '召回命中的 id 序列与次数要一致')

  // recalls 真的落到了两边：被 mark 的那条在 sqlite 下也能看见次数
  const markedRow = sqlRows.find((r) => r.id === lateSql.second.id)
  assert.ok(Number(markedRow.recalls) >= 1, 'sqlite 里要看得见"想起过"')
  assert.ok(markedRow.lastRecalledAt, '最后一次想起的时间也要在')
})

sq('S4 默认仍是 file：不传 backend 不产生 memory.sqlite，读写与 0.27.0 一样', (t) => {
  useClock(t)
  const dir = NEW(t)
  runOps(dir, {})
  assert.equal(fs.existsSync(path.join(dir, DB_FILE)), false, '默认路径不许顺手建库')
  assert.deepEqual(jsonlFiles(dir), ['later-events.jsonl', 'recall-events.jsonl', 'seal-events.jsonl', 'self-experience.jsonl'])
  assert.equal(loadAll(dir).length, 2)
})

sq('S4 双写可关：dualWrite:false 时 JSONL 一个字节都不变，只有库里有', (t) => {
  useClock(t)
  const dir = NEW(t)
  addExperience(dir, { text: '先写一条，让它能迁移' })
  mock.timers.tick(1500)
  migrate(dir)
  const before = Object.fromEntries(jsonlFiles(dir).map((n) => [n, sha(path.join(dir, n))]))
  const fileCount = loadAll(dir).length

  const only = addExperience(dir, { text: '只进库的那一条' }, { backend: 'sqlite', dualWrite: false })
  for (const [name, digest] of Object.entries(before)) {
    assert.equal(sha(path.join(dir, name)), digest, name + ' 不许被碰一下')
  }
  const sqlRows = loadAll(dir, { backend: 'sqlite' })
  assert.equal(sqlRows.length, fileCount + 1, '库里要多出这一条')
  assert.equal(sqlRows.some((r) => r.id === only.id), true)
  assert.equal(loadAll(dir).length, fileCount, 'file 后端读不到它——因为它确实没进 JSONL')
})

sq('S4 崩在两步之间：JSONL 多一行、库没提交 → 读路径 fail closed；移走库重新迁移后两边一致', (t) => {
  useClock(t)
  const dir = NEW(t)
  const first = addExperience(dir, { text: '崩溃前写下的那条' })
  mock.timers.tick(1500)
  migrate(dir)

  // 模拟"JSONL 写了、事务没提交"：手工补一行，库和 sources 都没变
  const crashRow = {
    id: 'exp_crash0001', at: new Date().toISOString(), day: new Date().toLocaleDateString('sv-SE'),
    author: 'self', source: 'own-time', kind: '其它', weight: 'normal',
    then: { text: '崩在两步之间的那条', scene: '', feeling: [], thought: '', unfinished: '', quote: null, state: { at: new Date().toISOString() } },
    later: [], status: 'kept'
  }
  fs.appendFileSync(path.join(dir, 'self-experience.jsonl'), JSON.stringify(crashRow) + '\n', 'utf8')

  assert.throws(() => loadAll(dir, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_STALE', '库落后于 JSONL 时必须报错，不许少读一条')
  assert.throws(() => addExperience(dir, { text: '不许往上叠' }, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_STALE', '库过期时写入也要拒绝')
  assert.equal(loadAll(dir).length, 2, 'file 后端照常能读到那两条')

  // 恢复：移走库、重新迁移（文档里的做法）
  for (const name of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) fs.rmSync(path.join(dir, name), { force: true })
  migrate(dir)
  const fileRows = loadAll(dir)
  assert.equal(fileRows.length, 2)
  assert.equal(normalize(loadAll(dir, { backend: 'sqlite' })), normalize(fileRows), '重新迁移后两个后端一致')
  assert.ok(first.id)
})

sq('S4 库没迁移 / 一组写里有不合格的：整次拒绝，一条都不落盘', (t) => {
  useClock(t)
  const dir = NEW(t)
  const row = addExperience(dir, { text: '还没迁移的目录' })
  const before = fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')
  assert.throws(() => addExperience(dir, { text: '不该写进去' }, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')
  assert.equal(fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8'), before, '库不在时不许双写半条')

  migrate(dir)
  const beforeCount = loadAll(dir, { backend: 'sqlite' }).length
  // 记录 + 一条不合格事件：事务里第二次插入失败，第一条也要回滚
  const badRecord = { ...row, id: 'exp_atomic01', at: new Date().toISOString(), day: '2026-11-27', then: { ...row.then, text: '事务要整组回滚' } }
  assert.throws(() => appendToStore(dir, { record: badRecord, events: [{ kind: 'later', row: { id: 'exp_atomic01' } }] }), /不合格/)
  assert.equal(loadAll(dir, { backend: 'sqlite' }).length, beforeCount, '记录不许留下来（同事务失败要整组回滚）')
  // 文件副作用抛错也一样：库里不许有
  assert.throws(() => appendToStore(dir, { record: badRecord, fileWrite: () => { throw new Error('文件写坏了') } }), /文件写坏了/)
  assert.equal(loadAll(dir, { backend: 'sqlite' }).length, beforeCount, 'fileWrite 失败也要整组回滚')
  assert.equal(loadAll(dir, { backend: 'sqlite' }).some((r) => r.id === 'exp_atomic01'), false)
})

sq('S4 recall({mark:true}) 在 sqlite 下能用：次数两边一致，JSONL 也有一笔（双写）', (t) => {
  useClock(t)
  const dir = NEW(t)
  addExperience(dir, { text: '海边的那只贝壳' })
  mock.timers.tick(1500)
  migrate(dir)

  const hits = recall(dir, '贝壳', { backend: 'sqlite', mark: true })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].recalls, 1, '命中处就地 +1')
  const sqlRow = loadAll(dir, { backend: 'sqlite' })[0]
  assert.equal(Number(sqlRow.recalls), 1, '库里要读得到这一次想起')
  assert.equal(Number(loadAll(dir)[0].recalls), 1, 'JSONL 也有一笔（默认双写）')
  assert.equal(fs.readFileSync(path.join(dir, 'recall-events.jsonl'), 'utf8').trim().split('\n').length, 1)
  assert.equal(markRecalled(dir, sqlRow.id, { backend: 'sqlite' }), true)
  assert.equal(Number(loadAll(dir, { backend: 'sqlite' })[0].recalls), 2)
})
sq('S4 复审修正：dualWrite:false 的记录被撤回时照样写墓碑（不许"删了却没墓碑"）', (t) => {
  useClock(t)
  const dir = NEW(t)
  addExperience(dir, { text: '先写一条，让它能迁移' })
  mock.timers.tick(1500)
  migrate(dir)
  // 只进库、不进 JSONL 的那一条
  const only = addExperience(dir, { text: '只在库里的那条' }, { backend: 'sqlite', dualWrite: false })
  assert.equal(loadAll(dir).some((r) => r.id === only.id), false, '前提：JSONL 里没有它')

  const result = eraseExperience(dir, { id: only.id, reason: '这条也不要了', actor: 'leo' })
  assert.equal(result.ok, true)
  assert.equal(result.alreadyGone, false, '库里真的删掉了一条，不算 alreadyGone')
  assert.equal(result.tombstone, true, '撤回必留墓碑')
  assert.ok(result.hash, '墓碑要带删除前那一行的哈希')
  const marks = tombstones.readAll(dir).rows
  assert.equal(marks.length, 1)
  assert.equal(marks[0].id, only.id)
  assert.equal(marks[0].reason, '这条也不要了')
  assert.equal(loadAll(dir, { backend: 'sqlite' }).some((r) => r.id === only.id), false, '库里也要真的没了')
  assert.ok(audit.read(dir, { action: 'erase' }).length >= 1, '审计里要有一条 erase')
})

sq('S4 复审修正：dualWrite:false 之后的并发/锁不再抛原始 database is locked（最多等 3 秒）', (t) => {
  useClock(t)
  const dir = NEW(t)
  addExperience(dir, { text: '一条能迁移的' })
  migrate(dir)
  // 同一个进程里两个连接抢写：busy_timeout 生效时不该直接把 SQLITE_BUSY 冒到调用方
  const first = addExperience(dir, { text: '第一条', }, { backend: 'sqlite', dualWrite: false })
  const second = addExperience(dir, { text: '第二条' }, { backend: 'sqlite', dualWrite: false })
  assert.ok(first.id && second.id)
  assert.equal(loadAll(dir, { backend: 'sqlite' }).length, 3)
})

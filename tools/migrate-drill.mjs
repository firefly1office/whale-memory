#!/usr/bin/env node
// 迁移演练：把「JSONL → memory.sqlite」这条路上每一步都真跑一遍，而且**全部在临时目录里**。
//
// 跑的是四件事，缺一样都不能算演练过：
//   1. 造一份 0.27.0 形态的数据（用 0.27.0 自己的写入 API 造，形状不是手写的），
//   2. 迁移 → 逐条对拍（file 与 sqlite 读出来逐字段相同）→ 记下这次的结果摘要，
//   3. 回滚（删掉 memory.sqlite）→ 确认读库回到"没迁移"、“不是空”，file 照常，
//   4. 再迁移 → 再对拍 → **两次结果摘要必须相同**（可重复，不是碰运气）。
// 另外三条反向用例：坏行要被拒绝且不留库；已有库要拒绝覆盖；迁移后源文件又变过要报 STORAGE_STALE、
// 删库重迁之后必须恢复正常。
//
// 零依赖。`--from <dir>` 时只会**读**那个目录：先整体复制到临时目录，再在副本上演练，
// 演练结束核对原目录里每个文件的字节没变。
//
// 用法：
//   node tools/migrate-drill.mjs                      # 自造数据，在系统临时目录里演练
//   node tools/migrate-drill.mjs --from <memory-dir>  # 用真实目录当只读样本（复制后再演练）
//   node tools/migrate-drill.mjs --work <dir>          # 指定演练工作目录（默认系统临时目录下新建）
//   node tools/migrate-drill.mjs --keep                # 保留工作目录（默认演练完删掉）
//   node tools/migrate-drill.mjs --json                # 只输出一行机器可读的摘要
//
// 退出码：0 演练通过 / 1 有一步不符合预期 / 2 环境不具备（拿不到 node:sqlite）/ 3 用法错
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  addExperience, loadAll, reviseExperience, setSealed, markRecalled, setUnfinishedState, linkExperiences
} from '../packages/core/lib/self-experience.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import * as laterEvents from '../packages/core/lib/later-events.js'
import * as sealEvents from '../packages/core/lib/seal-events.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'
import * as unfinishedEvents from '../packages/core/lib/unfinished-events.js'
import * as linkEvents from '../packages/core/lib/link-events.js'
import { DB_FILE, KIND_NAMES, sqliteAvailable, readSnapshot } from '../packages/core/lib/sqlite-store.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const MIGRATE = path.join(root, 'tools', 'migrate-storage.mjs')
const READERS = { later: laterEvents, seal: sealEvents, recall: recallEvents, unfinished: unfinishedEvents, link: linkEvents, chapter: chapterEvents }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2)
const flag = (name) => argv.includes('--' + name)
const valueOf = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}
const fromDir = valueOf('from')
const workArg = valueOf('work')
const keep = flag('keep')
const jsonOnly = flag('json')

if (flag('help') || flag('h')) {
  console.log('用法：node tools/migrate-drill.mjs [--from <memory-dir>] [--work <dir>] [--keep] [--json]')
  process.exit(0)
}
if (fromDir && !fs.existsSync(fromDir)) {
  console.error('--from 指向的目录不存在：' + fromDir)
  process.exit(3)
}

const log = (line) => { if (!jsonOnly) console.log(line) }
const step = (name, detail) => log('  ' + name + (detail ? '：' + detail : ''))

// 演练里每一步的断言都走这里：失败立刻收工，把"哪一步、期望什么、实际什么"一起报出来
const checks = []
function check(ok, what, detail = '') {
  checks.push({ ok: Boolean(ok), what, detail })
  if (!ok) throw new DrillFailure(what + (detail ? '（' + detail + '）' : ''))
}
class DrillFailure extends Error { }

// ---------------------------------------------------------------- 工作目录

function makeWorkdir() {
  if (workArg) {
    fs.mkdirSync(workArg, { recursive: true })
    return { dir: path.resolve(workArg), own: false }
  }
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'wm-migrate-drill-')), own: true }
}

// 只读真实数据：把源目录里的**普通文件**复制一份（子目录、库文件、锁不复制）
function copyReadonly(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  const copied = []
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith(DB_FILE) || entry.name.endsWith('.lock')) continue
    fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name))
    copied.push(entry.name)
  }
  return copied
}

function jsonlSha(dir) {
  const out = {}
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    out[name] = sha(fs.readFileSync(path.join(dir, name)))
  }
  return out
}

// ---------------------------------------------------------------- 造 0.27.0 形态的数据

function makeFixture(dir) {
  const rows = [
    addExperience(dir, { text: '在西湖边坐到天黑，风把桂花吹了一身', scene: '西湖', feeling: ['平静', '喜欢'], thought: '想多坐一会儿' }),
    addExperience(dir, { text: '把旧柜子修好了，抽屉终于不卡了', unfinished: '还差一个把手', weight: 'important' }),
    addExperience(dir, { text: '她说下次一起去看海', kind: '别人', source: 'chat' })
  ]
  reviseExperience(dir, { id: rows[0].id, thought: '后来想起还是想笑', reason: '过了几天', feeling: ['释然'] })
  reviseExperience(dir, { id: rows[1].id, thought: '把手买到了' })
  setSealed(dir, { id: rows[2].id, sealed: true, note: '先不提这件事' })
  markRecalled(dir, rows[0].id)
  markRecalled(dir, rows[0].id)
  setUnfinishedState(dir, { id: rows[1].id, choice: 'done', note: '装好了' })
  linkExperiences(dir, { from: rows[0].id, to: rows[1].id, reason: '都是慢慢弄好的事' })
  const ch = chapterEvents.open(dir, { name: '西湖的那个秋天', from: '2026-11-01' })
  return { records: rows.length, chapter: ch.row ? ch.row.id : '' }
}

// ---------------------------------------------------------------- 迁移 / 读 / 回滚

function migrate(dir) {
  const res = spawnSync(process.execPath, [MIGRATE, dir, '--write'], { encoding: 'utf8' })
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' }
}

const dbFiles = (dir) => [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', DB_FILE + '-journal'].map((f) => path.join(dir, f))

function removeDb(dir) {
  for (const f of dbFiles(dir)) fs.rmSync(f, { force: true })
}

// file 后端与 sqlite 后端读出来必须逐字段相同：记录走 loadAll（含合并），事件走各自模块/快照的原始行
function compareBackends(dir) {
  const viaFile = loadAll(dir, { backend: 'file' })
  const viaSqlite = loadAll(dir, { backend: 'sqlite' })
  if (JSON.stringify(viaFile) !== JSON.stringify(viaSqlite)) {
    return { ok: false, why: 'loadAll 两个后端结果不同（file ' + viaFile.length + ' / sqlite ' + viaSqlite.length + ' 条）' }
  }
  const snap = readSnapshot(dir)
  let events = 0
  for (const kind of KIND_NAMES) {
    const file = READERS[kind].readAll(dir)
    if (file.bad) return { ok: false, why: kind + ' 事件：源文件里有 ' + file.bad + ' 行坏行' }
    if (snap.events[kind].bad) return { ok: false, why: kind + ' 事件：库里有 ' + snap.events[kind].bad + ' 行不合格' }
    const a = JSON.stringify(file.rows)
    const b = JSON.stringify(snap.events[kind].rows)
    if (a !== b) return { ok: false, why: kind + ' 事件：两侧不是逐条相同' }
    events += file.rows.length
  }
  if (viaFile.length !== snap.records.rows.length) return { ok: false, why: '库里的记录条数与全量读不同' }
  return { ok: true, records: viaFile.length, events }
}

// 结果摘要：只取内容（记录 + 六类事件的原始行），不含时间戳与库的物理字节——
// 后者每次迁移都可能不同（sources.migrated_at / 页布局），拿它当"可重复"的判据是假的
function contentDigest(dir) {
  const snap = readSnapshot(dir)
  const payload = {
    records: snap.records.rows.map((r) => r.json ?? r),
    events: Object.fromEntries(KIND_NAMES.map((k) => [k, snap.events[k].rows.map((r) => r.json ?? r)]))
  }
  return sha(JSON.stringify(payload))
}

// ---------------------------------------------------------------- 用例

function caseRepeatable(base, seedDir) {
  const dir = path.join(base, 'case-repeatable')
  let built
  if (seedDir) {
    // --from：所有用例都用这份真实数据（复制出来的一份），两边不会各演一套
    const copied = copyReadonly(seedDir, dir)
    built = { records: loadAll(dir).length }
    step('复制真实样本', copied.length + ' 个文件，记录 ' + built.records + ' 条')
  } else {
    built = makeFixture(dir)
    step('造 0.27.0 形态数据', '记录 ' + built.records + ' 条，事件文件 ' +
      fs.readdirSync(dir).filter((f) => f.endsWith('events.jsonl')).length + ' 个')
  }
  const before = jsonlSha(dir)

  const first = migrate(dir)
  check(first.status === 0, '第一次迁移应成功', 'exit ' + first.status + '；' + (first.stderr || first.stdout).trim().split('\n').slice(-1)[0])
  let cmp = compareBackends(dir)
  check(cmp.ok, '迁移后 file 与 sqlite 应逐条相同', cmp.why || '')
  step('迁移 + 对拍', '记录 ' + cmp.records + ' 条 / 事件 ' + cmp.events + ' 条全部一致')
  const digest1 = contentDigest(dir)
  step('第一次结果摘要', digest1.slice(0, 16) + '…')

  check(JSON.stringify(jsonlSha(dir)) === JSON.stringify(before), '迁移不许改任何源文件')

  // 回滚：删库。删完必须回到"没迁移过"，而不是"什么都没有"
  removeDb(dir)
  check(!fs.existsSync(path.join(dir, DB_FILE)), '回滚后 memory.sqlite 应该不在了')
  let threw = null
  try { loadAll(dir, { backend: 'sqlite' }) } catch (error) { threw = error }
  check(threw && threw.code === 'STORAGE_NOT_MIGRATED', '回滚后读 sqlite 应报 STORAGE_NOT_MIGRATED', threw ? String(threw.code) : '没有抛错')
  check(loadAll(dir).length === built.records, '回滚后 file 后端照常')
  step('回滚', '删库 → sqlite 报 STORAGE_NOT_MIGRATED，file 照常（' + built.records + ' 条）')

  // 再迁移：结果必须和第一次一模一样
  const second = migrate(dir)
  check(second.status === 0, '第二次迁移应成功', 'exit ' + second.status)
  cmp = compareBackends(dir)
  check(cmp.ok, '第二次迁移后也应逐条相同', cmp.why || '')
  const digest2 = contentDigest(dir)
  check(digest2 === digest1, '两次迁移的结果摘要必须相同（可重复）', digest1.slice(0, 16) + ' vs ' + digest2.slice(0, 16))
  step('回滚后再迁移', '结果摘要与第一次相同：' + digest2.slice(0, 16) + '…')

  // 迁移之后源文件又变了：读库必须 fail closed，删库重迁之后恢复
  addExperience(dir, { text: '迁移之后又写了一条' })
  threw = null
  try { loadAll(dir, { backend: 'sqlite' }) } catch (error) { threw = error }
  check(threw && threw.code === 'STORAGE_STALE', '源文件变过之后读库应报 STORAGE_STALE', threw ? String(threw.code) : '没有抛错')
  removeDb(dir)
  const third = migrate(dir)
  check(third.status === 0, '源文件变过之后重新迁移应成功', 'exit ' + third.status)
  cmp = compareBackends(dir)
  check(cmp.ok, '重迁之后应逐条相同', cmp.why || '')
  check(cmp.records === built.records + 1, '重迁之后记录数应跟着源文件走', String(cmp.records))
  step('源文件变过 → 重迁', 'STORAGE_STALE → 删库重迁 → ' + cmp.records + ' 条一致')

  return { cases: 'repeatable', digest: digest1, records: cmp.records, events: cmp.events }
}

function caseCorruptRefused(base) {
  const dir = path.join(base, 'case-corrupt')
  makeFixture(dir)
  fs.appendFileSync(path.join(dir, 'self-experience.jsonl'), '{"id": "exp_broken"\n')
  const before = jsonlSha(dir) // 掺坏行之后的样子：拒绝迁移时它要一个字节都不变
  const res = migrate(dir)
  check(res.status === 1, '源文件有坏行时迁移应失败（exit 1）', 'exit ' + res.status)
  check(!fs.existsSync(path.join(dir, DB_FILE)), '迁移失败后不应留下 memory.sqlite')
  check(JSON.stringify(jsonlSha(dir)) === JSON.stringify(before), '拒绝迁移时源文件不许被改')
  step('坏行 → 拒绝迁移', 'exit 1，没留下库，源文件未改')
  return { cases: 'corrupt-refused' }
}

function caseRefuseOverwrite(base) {
  const dir = path.join(base, 'case-overwrite')
  makeFixture(dir)
  const first = migrate(dir)
  check(first.status === 0, '第一次迁移应成功', 'exit ' + first.status)
  const second = migrate(dir)
  check(second.status === 3, '已有 memory.sqlite 时应拒绝覆盖（exit 3）', 'exit ' + second.status)
  const cmp = compareBackends(dir)
  check(cmp.ok, '被拒绝之后原来的库应仍然可用', cmp.why || '')
  step('已有库 → 拒绝覆盖', 'exit 3，原库仍可用')
  return { cases: 'refuse-overwrite' }
}

function caseFromRealData(base) {
  const dir = path.join(base, 'case-from-real')
  const copied = copyReadonly(fromDir, dir)
  if (!copied.includes('self-experience.jsonl')) {
    check(false, '--from 目录里没有 self-experience.jsonl，没什么可演练的')
  }
  const records = loadAll(dir).length
  step('复制真实目录', copied.length + ' 个文件，记录 ' + records + ' 条（只读样本，演练在副本上）')
  const res = migrate(dir)
  check(res.status === 0, '真实样本应能迁移', 'exit ' + res.status + '；' + (res.stderr || '').trim().split('\n').slice(-1)[0])
  const cmp = compareBackends(dir)
  check(cmp.ok, '真实样本迁移后应逐条相同', cmp.why || '')
  step('迁移 + 对拍', '记录 ' + cmp.records + ' 条 / 事件 ' + cmp.events + ' 条全部一致')
  return { cases: 'from-real', digest: contentDigest(dir), records: cmp.records, events: cmp.events }
}

// ---------------------------------------------------------------- 跑

if (!sqliteAvailable()) {
  console.error('这台机器拿不到内置 node:sqlite（需要 Node >= 22.5），没法演练迁移。演练未执行。')
  process.exit(2)
}

const work = makeWorkdir()
const summary = { ok: false, work: work.dir, cases: [], checks: 0, sourceReadonly: null }
let failure = null
let sourceBefore = null
try {
  log('=== 迁移演练（全部在临时目录里）===')
  if (fromDir) {
    sourceBefore = jsonlSha(fromDir)
    summary.cases.push(caseFromRealData(work.dir))
  }
  summary.cases.push(caseRepeatable(work.dir, fromDir))
  summary.cases.push(caseCorruptRefused(work.dir))
  summary.cases.push(caseRefuseOverwrite(work.dir))
  summary.ok = true
  log('结论：演练通过（' + checks.length + ' 项断言全部成立）')
} catch (error) {
  failure = error instanceof DrillFailure ? error.message : String(error?.stack || error)
  console.error('演练失败：' + failure)
} finally {
  if (fromDir) {
    const after = jsonlSha(fromDir)
    const changed = Object.keys({ ...sourceBefore, ...after }).filter((k) => sourceBefore[k] !== after[k])
    summary.sourceReadonly = { files: Object.keys(after).length, changed }
    if (changed.length) {
      summary.ok = false
      failure = '演练改动了 --from 指向的真实目录：' + changed.join('、')
      console.error(failure)
    } else if (!jsonOnly) {
      console.log('  --from 源目录未被改动：' + Object.keys(after).length + ' 个 JSONL 逐字节相同')
    }
  }
  if (!keep && work.own) fs.rmSync(work.dir, { recursive: true, force: true })
  else if (!jsonOnly) console.log('演练目录保留在：' + work.dir)
}

summary.checks = checks.length
summary.failed = checks.filter((c) => !c.ok).length
if (jsonOnly) {
  console.log(JSON.stringify(summary))
} else if (summary.ok) {
  console.log('可重复性：两次迁移的结果摘要相同；坏行/覆盖/过期三条反向用例都按预期拒绝。')
}
process.exit(summary.ok ? 0 : 1)
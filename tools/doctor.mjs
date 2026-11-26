#!/usr/bin/env node
// 体检：可定时跑、机器可读。
//
// 用法：
//   node tools/doctor.mjs <memory-dir> [--json]
//   node tools/doctor.mjs --data=<memory-dir> [--json]
//   WHALE_DATA_DIR=<memory-dir> node tools/doctor.mjs --json
//
// --json 打一个对象：{ version, dir, at, ok, checks: [{ name, ok, detail }] }；
// 不带 --json 打中文人读版本（一行一项）。
//
// 退出码：全部通过 0，任一项失败 1（目录/文件读不出来算失败，不当成"没问题"；
// 静默返回 0 的体检比没有体检更危险）。用法错误 2。
//
// 只读：不建库、不改文件、不写日志，也不记任何正文——detail 里只出现文件名、行数、id 和错误码。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAll, badLines } from '../packages/core/lib/self-experience.js'
import * as laterEvents from '../packages/core/lib/later-events.js'
import * as sealEvents from '../packages/core/lib/seal-events.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'
import * as unfinishedEvents from '../packages/core/lib/unfinished-events.js'
import * as linkEvents from '../packages/core/lib/link-events.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import * as tombstones from '../packages/core/lib/tombstones.js'
import * as audit from '../packages/core/lib/audit.js'
import { DB_FILE } from '../packages/core/lib/sqlite-store.js'

export const VERSION = 1

// 主文件 + 六类事件。
// 事件文件是**按需创建**的：一个从来没封存过、没想起过的库，磁盘上就只有 self-experience.jsonl
// （她真实的数据目录就是这样）。所以"事件文件不存在"是正常状态，不是丢了——两边在磁盘上长得一样，
// 但判据不同：事件文件缺 = 这类事件一次都没发生过；**经历主文件缺、事件还在** = 真丢了。
// 把缺事件文件报成失败的话，体检会永远亮红灯，等于训练人忽略它。
export const RECORDS_FILE = 'self-experience.jsonl'
const EVENT_READERS = new Map([
  ['later-events.jsonl', laterEvents],
  ['seal-events.jsonl', sealEvents],
  ['recall-events.jsonl', recallEvents],
  ['unfinished-events.jsonl', unfinishedEvents],
  ['link-events.jsonl', linkEvents],
  ['chapter-events.jsonl', chapterEvents]
])
export const FILES = Object.freeze([RECORDS_FILE, ...EVENT_READERS.keys()])

const shortName = (file) => file.replace(/-events\.jsonl$/, '').replace(/\.jsonl$/, '')
const linesOf = (text) => text.split('\n').filter((line) => line.trim()).length

// 一行一条检查项里的一项
const check = (name, ok, detail) => ({ name, ok, detail })

// ---------------------------------------------------------------- 读

// 把 7 个文件都读一遍：存在吗、多少行、几行坏的。坏行口径和线上读法一致：
// 经历用 badLines（解析不了才算坏），事件用各自模块的 readAll（解析不了或不合格都算坏）。
// 读不出来（权限、是目录、坏盘）记在 error 上，由各检查项报失败，不在这里静默吞掉。
function scan(dir) {
  const files = []
  for (const name of FILES) {
    const file = path.join(dir, name)
    const entry = { name, exists: false, lines: 0, bad: 0, error: null, rows: null }
    try {
      const st = fs.statSync(file)
      entry.exists = true
      if (!st.isFile()) throw Object.assign(new Error(name + ' 不是普通文件'), { code: 'EISDIR' })
      if (name === RECORDS_FILE) {
        entry.lines = linesOf(fs.readFileSync(file, 'utf8'))
        entry.bad = badLines(dir)
      } else {
        const { rows, bad } = EVENT_READERS.get(name).readAll(dir)
        entry.lines = rows.length + bad
        entry.bad = bad
        // 封存事件后面还要核对指向，留一份在手（其它几类只报数，不留正文）
        if (name === 'seal-events.jsonl') entry.rows = rows
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') entry.exists = false
      else entry.error = String((error && (error.code || error.message)) || error)
    }
    files.push(entry)
  }
  return files
}

// ---------------------------------------------------------------- 检查项

function checkDir(dir) {
  try {
    const st = fs.statSync(dir)
    if (!st.isDirectory()) return check('数据目录', false, dir + ' 不是目录')
    const n = fs.readdirSync(dir).length
    return check('数据目录', true, dir + '（能读，' + n + ' 个条目）')
  } catch (error) {
    return check('数据目录', false, dir + ' 读不出来：' + String((error && (error.code || error.message)) || error))
  }
}

function checkFiles(files, dirOk = true) {
  const unreadable = files.filter((f) => f.exists && f.error)
  const records = files.find((f) => f.name === RECORDS_FILE)
  const events = files.filter((f) => f.name !== RECORDS_FILE)
  const presentEvents = events.filter((f) => f.exists)
  const missingEvents = events.filter((f) => !f.exists).map((f) => shortName(f.name))
  if (!dirOk) return check('文件存在', false, '数据目录读不出来，没法判断文件在不在')
  const parts = []
  let ok = true
  if (unreadable.length) {
    ok = false
    parts.push(unreadable.length + ' 个读不出来：' + unreadable.map((f) => f.name + '（' + f.error + '）').join('、'))
  }
  if (!records.exists) {
    if (presentEvents.length) {
      ok = false
      parts.push('经历主文件 ' + RECORDS_FILE + ' 不见了，但事件文件还在（' + presentEvents.map((f) => f.name).join('、') + '）——这不是全新目录')
    } else {
      parts.push('还没有 ' + RECORDS_FILE + '（全新目录，还没有任何记忆）')
    }
  }
  if (missingEvents.length) parts.push('还没出现：' + missingEvents.join('、') + '（这类事件一次都没发生过，不是丢了）')
  return check('文件存在', ok, parts.join('；') || FILES.length + ' 个文件都在（经历 + 六类事件）')
}

function checkLines(files, dirOk = true) {
  if (!dirOk) return check('行数', false, '数据目录读不出来，数不了行')
  const broken = files.filter((f) => f.error)
  if (broken.length) {
    return check('行数', false, broken.map((f) => f.name + ' 读不出来（' + f.error + '）').join('；'))
  }
  const records = files.find((f) => f.name === RECORDS_FILE)
  const events = files.filter((f) => f.name !== RECORDS_FILE)
  if (!records.exists) {
    // 主文件不在：事件还在就是丢了（报失败）；一个都没有就是全新目录
    return events.some((f) => f.exists)
      ? check('行数', false, '经历主文件不在（事件文件还在），行数没法算')
      : check('行数', true, '还没有经历（全新目录）')
  }
  const eventTotal = events.reduce((n, f) => n + f.lines, 0)
  // 还没出现的事件文件用「—」，不冒充 0 行
  const shown = events.map((f) => shortName(f.name) + ' ' + (f.exists ? f.lines : '—')).join(' / ')
  return check('行数', true, '经历 ' + records.lines + ' 行 · 六类事件 ' + eventTotal + ' 行（' + shown + '；— = 还没出现）')
}

function checkBad(files, dir) {
  const broken = files.filter((f) => f.error)
  const bad = files.filter((f) => f.bad > 0)
  if (bad.length) {
    return check('坏行', false, bad.map((f) => f.name + ' ' + f.bad + ' 行无法解析或不合格').join('；'))
  }
  if (broken.length) {
    return check('坏行', false, broken.map((f) => f.name + ' 读不出来（' + f.error + '）').join('；'))
  }
  // 墓碑与审计不在上面 7 个文件里（是阶段 4 新加的），但坏了同样要报出来：
  // 墓碑坏了说不清"哪条撤回过"，审计坏了这份留痕就不完整。
  try {
    const badTombs = tombstones.badLines(dir)
    if (badTombs > 0) return check('坏行', false, 'tombstones.jsonl ' + badTombs + ' 行无法解析或不合格')
  } catch (error) {
    return check('坏行', false, 'tombstones.jsonl 读不出来（' + String((error && (error.code || error.message)) || error) + '）')
  }
  try {
    audit.read(dir)
  } catch (error) {
    return check('坏行', false, 'audit.jsonl 读不出来或不完整（' + String((error && (error.code || error.message)) || error) + '）')
  }
  return check('坏行', true, '没有坏行（' + files.filter((f) => f.exists).length + ' 个文件读完了）')
}

// 封存事件一致性：每条封存都要指向一条真的存在的经历；同一个 id 的动作必须交替
// （先 seal 再 unseal，再 seal……）。连续两条同样的动作、或者没封就先解封，
// 说明日志被手改过或写路径出过问题——这种"重复对不上"要报出来，不能当成正常。
function checkSeal(dir, files) {
  const sealFile = files.find((f) => f.name === 'seal-events.jsonl')
  if (!sealFile || sealFile.error) return check('封存一致性', false, 'seal-events.jsonl 读不出来，无法核对封存状态')
  const rows = sealFile.rows || []

  // 墓碑（阶段 4）：撤回过的 id 也算"指向一条存在的经历"，否则每撤回一条封存过的经历，
  // 体检就会永远亮红灯。同时反着核对一遍：已撤回的 id 不许又出现在经历文件里（撤回没生效或被恢复）。
  let tombs
  try {
    tombs = tombstones.readAll(dir)
  } catch (error) {
    return check('封存一致性', false, 'tombstones.jsonl 读不出来，无法核对撤回记录：' + String((error && (error.code || error.message)) || error))
  }
  if (tombs.bad) return check('封存一致性', false, 'tombstones.jsonl ' + tombs.bad + ' 行无法解析或不合格')
  const withdrawn = new Set(tombs.rows.map((r) => r.id))
  const tombNote = withdrawn.size ? '；' + withdrawn.size + ' 条经历已整条撤回（墓碑在）' : ''

  // 经历一条都读不出来时不能当成"封存全指向不存在"：那是两件事，先报读失败。
  // allowCorrupt / allowSealCorrupt：坏行已由「坏行」那一项负责报，这里只核对指向。
  let records
  try {
    records = loadAll(dir, { allowCorrupt: true, allowSealCorrupt: true })
  } catch (error) {
    return check('封存一致性', false, '经历读不出来，无法核对封存事件指向：' + String((error && (error.code || error.message)) || error))
  }
  const known = new Set()
  for (const r of records) {
    known.add(r.id)
    if (r.formerId) known.add(r.formerId) // 0.10 之前的旧 id：封存可能挂在它上面
  }
  const resurrected = [...withdrawn].filter((id) => known.has(id))
  if (resurrected.length) {
    return check('封存一致性', false, resurrected.length + ' 个已撤回的 id 又出现在经历文件里（撤回没生效或被恢复）：' + resurrected.slice(0, 3).join('、'))
  }

  if (!rows.length) {
    return check('封存一致性', true, withdrawn.size ? '没有封存事件' + tombNote : '没有封存事件（没有经历被封存过）')
  }
  for (const id of withdrawn) known.add(id)

  const orphan = []
  const repeated = []
  const earlyUnseal = []
  const lastAction = new Map()
  for (const row of rows) {
    const id = String(row.id)
    if (!known.has(id) && !orphan.includes(id)) orphan.push(id)
    const prev = lastAction.get(id)
    if (prev === undefined) {
      if (row.action === 'unseal') earlyUnseal.push(id)
    } else if (prev === row.action) {
      if (!repeated.includes(id)) repeated.push(id)
    }
    lastAction.set(id, row.action)
  }

  const seals = rows.filter((r) => r.action === 'seal').length
  const problems = []
  if (orphan.length) problems.push(orphan.length + ' 个 id 指向不存在的经历（' + orphan.slice(0, 3).join('、') + '）')
  if (repeated.length) problems.push(repeated.length + ' 个 id 连续写了两条同样的动作（' + repeated.slice(0, 3).join('、') + '）')
  if (earlyUnseal.length) problems.push(earlyUnseal.length + ' 个 id 没封就先解封（' + earlyUnseal.slice(0, 3).join('、') + '）')
  if (problems.length) return check('封存一致性', false, problems.join('；'))
  return check('封存一致性', true, '封存 ' + seals + ' 条 / 解封 ' + (rows.length - seals) + ' 条，指向的经历都在，动作顺序正常' + tombNote)
}

// 为什么某个码会失败：直接说清要做什么，别只丢一个错误码
const SQLITE_REASONS = {
  STORAGE_STALE: '迁移之后 JSONL 又变过，sqlite 读出来会少东西；重新迁移（node tools/migrate-storage.mjs <dir> --write）或继续用 file 后端',
  STORAGE_INCOMPLETE: '库缺表（多半是早期只搬了记录的库）；移走它重新迁移',
  STORAGE_NOT_MIGRATED: '还没迁移到 SQLite，但有 JSONL 数据；先跑 tools/migrate-storage.mjs，或继续用 file 后端',
  SQLITE_UNAVAILABLE: '这台机器的 Node 拿不到内置 node:sqlite（需要 >= 22.5），库打不开',
  STORAGE_UNREADABLE: '库本身读不出来（权限、坏盘或文件不是数据库）'
}

// 迁移状态：没有库不算错（file 后端本来就正常）；有库就必须读得通、而且和 JSONL 对得上。
function checkStorage(dir, files) {
  const dbPath = path.join(dir, DB_FILE)
  let hasDb = false
  try { hasDb = fs.existsSync(dbPath) } catch { hasDb = false }
  if (!hasDb) {
    const data = files.filter((f) => f.exists && f.lines > 0).length
    return check('迁移状态', true, data
      ? '没有 ' + DB_FILE + '（还没迁移，用 file 后端就行；目录里已有 JSONL 数据：' + data + ' 个文件非空）'
      : '没有 ' + DB_FILE + '，目录里也还没有数据（全新目录）')
  }
  try {
    const rows = loadAll(dir, { backend: 'sqlite', allowCorrupt: true, allowSealCorrupt: true })
    return check('迁移状态', true, DB_FILE + ' 可读：按 sqlite 读到经历 ' + rows.length + ' 条，和目录里的 JSONL 对得上')
  } catch (error) {
    const code = String((error && error.code) || 'ERROR')
    const why = SQLITE_REASONS[code] || String((error && error.message) || error)
    return check('迁移状态', false, DB_FILE + ' 读不了（' + code + '）：' + why)
  }
}

/** 跑一遍体检：返回 { version, dir, at, ok, checks }。纯读，不写盘。 */
export function runDoctor(dir) {
  const target = path.resolve(String(dir || ''))
  const files = scan(target)
  const dirCheck = checkDir(target)
  const checks = [
    dirCheck,
    // 目录本身读不出来（路径写错、盘没挂上）时，"文件都不在"不是全新目录，是没法判断
    checkFiles(files, dirCheck.ok),
    checkLines(files, dirCheck.ok),
    checkBad(files, target),
    checkSeal(target, files),
    checkStorage(target, files)
  ]
  return {
    version: VERSION,
    dir: target,
    at: new Date().toISOString(),
    ok: checks.every((c) => c.ok),
    checks
  }
}

/** 人读版本：一行一项，带 ✓ / ✗ 和中文说明。 */
export function renderReport(report) {
  const lines = ['体检：' + report.dir]
  for (const c of report.checks) lines.push((c.ok ? '✓ ' : '✗ ') + c.name + '：' + c.detail)
  const failed = report.checks.filter((c) => !c.ok).length
  lines.push('')
  lines.push(report.ok
    ? '共 ' + report.checks.length + ' 项，全部通过。'
    : '共 ' + report.checks.length + ' 项，' + failed + ' 项没通过（看上面带 ✗ 的那几行）。')
  return lines.join('\n')
}

function parseArgs(argv) {
  const opts = { dir: '', json: false }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--data') { opts.dir = argv[i + 1] || ''; i += 1 }
    else if (arg.startsWith('--data=')) opts.dir = arg.slice('--data='.length)
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg.startsWith('--')) throw new Error('未知参数：' + arg)
    else positional.push(arg)
  }
  if (!opts.dir) opts.dir = positional[0] || process.env.WHALE_DATA_DIR || process.cwd()
  return opts
}

const USAGE = '用法：node tools/doctor.mjs <memory-dir> [--json]\n'
  + '       node tools/doctor.mjs --data=<memory-dir> [--json]\n'
  + '       WHALE_DATA_DIR=<memory-dir> node tools/doctor.mjs --json'

function main(argv) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (error) {
    console.error(String(error && error.message ? error.message : error))
    console.error(USAGE)
    return 2
  }
  if (opts.help) {
    console.log(USAGE)
    return 0
  }
  if (!opts.dir) {
    console.error(USAGE)
    return 2
  }
  const report = runDoctor(opts.dir)
  if (opts.json) console.log(JSON.stringify(report, null, 2))
  else console.log(renderReport(report))
  return report.ok ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
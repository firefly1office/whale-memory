// 存储迁移：JSONL → SQLite（记录 + 六类事件）。默认只演练，不落盘。
//
// 用法：
//   node tools/migrate-storage.mjs <memory-dir>                # 演练：读、检查、报数，不写盘
//   node tools/migrate-storage.mjs <memory-dir> --write        # 建 memory.sqlite
//   node tools/migrate-storage.mjs <memory-dir> --verify-only  # 已有的库和源文件逐条对拍
//
// 搬什么：self-experience.jsonl，以及 loadAll 会读的六类事件
//   later-events / seal-events / recall-events / unfinished-events / link-events / chapter-events
//
// 原则：
//   · 源文件一个字都不改（迁移是叠加，不是替换）；回滚 = 删掉 memory.sqlite（及 -wal / -shm）；
//   · 记录与事件在同一个事务里写；写完重新打开库，逐条对拍：条数相同、顺序相同、每条 JSON 逐字节相同；
//   · 任何一步失败（含对拍失败）→ 整体回滚，删掉半成品，不留"迁移了一半"的库；
//   · 源文件有坏行、缺 id 的旧格式记录、重复 id：拒绝迁移，说清是哪一类，先修复再来；
//   · 目标已存在时拒绝覆盖。
//
// 退出码：0 成功 / 1 失败（已回滚或对拍不一致）/ 2 用法或前提不满足 / 3 目标已存在
import fs from 'node:fs'
import path from 'node:path'
import { FileBackend } from '../packages/core/lib/storage/file-backend.js'
import {
  DB_FILE, RECORDS_FILE, EVENT_KINDS, KIND_NAMES,
  sqliteAvailable, openDatabase, insertRecord, insertEvent, writeSources, sourceSizes, readSnapshot
} from '../packages/core/lib/sqlite-store.js'
import * as laterEvents from '../packages/core/lib/later-events.js'
import * as sealEvents from '../packages/core/lib/seal-events.js'
import * as recallEvents from '../packages/core/lib/recall-events.js'
import * as unfinishedEvents from '../packages/core/lib/unfinished-events.js'
import * as linkEvents from '../packages/core/lib/link-events.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'

// 各类事件用它自己模块的 readAll 读：坏行口径和线上读法完全一致
const READERS = { later: laterEvents, seal: sealEvents, recall: recallEvents, unfinished: unfinishedEvents, link: linkEvents, chapter: chapterEvents }

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const write = args.includes('--write')
const verifyOnly = args.includes('--verify-only')

const fail = (message, code = 1) => {
  console.error(message)
  process.exit(code)
}

if (!dir) fail('用法：node tools/migrate-storage.mjs <memory-dir> [--write] [--verify-only]', 2)

const filePath = path.join(dir, RECORDS_FILE)
if (!fs.existsSync(filePath)) fail('没有找到 ' + filePath + '（这个目录里还没有经历记录）', 2)

// ---- 读源：前后各量一次字节数，读的过程中有人写就不迁（单写者假设被打破了）
let source
try {
  source = await readSource(dir)
} catch (error) {
  fail('读源文件失败，没有迁移：' + (error?.message || error))
}
console.log('源文件：记录 ' + source.records.length + ' 条；事件 ' + KIND_NAMES.map((k) => k + ' ' + source.events[k].length).join(' / '))

const targetPath = path.join(dir, DB_FILE)

if (!sqliteAvailable()) fail('这台机器拿不到内置 node:sqlite（需要 Node >= 22.5），不能迁移到 SQLite。', 2)

if (verifyOnly) {
  if (!fs.existsSync(targetPath)) fail('没有 ' + DB_FILE + '，无法 verify-only', 2)
  try {
    verify(dir, source)
  } catch (error) {
    fail('对拍不一致：' + (error?.message || error))
  }
  process.exit(0)
}

if (!write) {
  console.log('演练模式：不写盘。加 --write 才会建 ' + DB_FILE + '。')
  process.exit(0)
}

if (fs.existsSync(targetPath)) fail(DB_FILE + ' 已存在；迁移不覆盖。要重来请先手工移走它（连同 -wal / -shm）。', 3)

let db = null
try {
  db = openDatabase(dir, { create: true })
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of source.records) insertRecord(db, row)
    for (const kind of KIND_NAMES) for (const row of source.events[kind]) insertEvent(db, kind, row)
    writeSources(db, source.sizes)
    if (process.env.WM_MIGRATE_FAIL_AFTER_INSERT === '1') throw new Error('（测试注入）写完、提交前失败')
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { }
    throw error
  }
  db.close()
  db = null
  // 重新打开、按线上读法读回来再对拍：不信写入时的内存，只信落盘的库
  verify(dir, source)
  console.log('已写入 ' + targetPath)
  console.log('回滚：删掉 ' + DB_FILE + '（及 -wal / -shm）即可；源文件没有改动。')
} catch (error) {
  // 失败就把半成品删掉，不留一个"迁移了一半"的库
  try { if (db) db.close() } catch { }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(targetPath + suffix, { force: true }) } catch { }
  }
  fail('迁移失败，已回滚（' + DB_FILE + ' 已删除，源文件未改）：' + (error?.message || error))
}

// ------------------------------------------------------------------

async function readSource(memDir) {
  const before = sourceSizes(memDir)
  const records = await new FileBackend(memDir).all() // 坏行直接抛
  const missingId = records.filter((r) => !r || typeof r.id !== 'string' || !r.id).length
  if (missingId) throw new Error('有 ' + missingId + ' 条旧格式记录没有 id（0.10 之前写的）。SQLite 容器按 id 存，这一版不搬没有 id 的记录；先留在 file 后端。')
  const seen = new Set()
  const dup = new Set()
  for (const r of records) { if (seen.has(r.id)) dup.add(r.id); seen.add(r.id) }
  if (dup.size) throw new Error('有 ' + dup.size + ' 个 id 在经历文件里出现了不止一次（例如 ' + [...dup][0] + '）。id 永不复用，先查清再迁。')
  const events = {}
  for (const kind of KIND_NAMES) {
    const { rows, bad } = READERS[kind].readAll(memDir)
    if (bad) throw new Error(EVENT_KINDS[kind].file + ' 有 ' + bad + ' 行坏行或不合格行。迁过去会把"状态不确定"变成"确定"，先备份再修复。')
    events[kind] = rows
  }
  const after = sourceSizes(memDir)
  const moved = Object.keys(before).filter((name) => before[name] !== after[name])
  if (moved.length) throw new Error('读的过程中这些文件变了：' + moved.join('、') + '。迁移要求没有别的进程在写，停掉宿主再来。')
  return { records, events, sizes: before }
}

// 用 loadAll 同一条读路径（readSnapshot）读回来，逐条对拍
function verify(memDir, src) {
  const snap = readSnapshot(memDir) // 源文件在迁移后又变过会在这里抛 STORAGE_STALE
  same('记录', src.records, snap.records)
  for (const kind of KIND_NAMES) same(kind + ' 事件', src.events[kind], snap.events[kind])
  const events = KIND_NAMES.reduce((n, k) => n + src.events[k].length, 0)
  console.log('逐条对拍通过：记录 ' + src.records.length + ' 条、事件 ' + events + ' 条全部一致')
}

function same(label, expected, got) {
  if (got.bad) throw new Error(label + '：库里有 ' + got.bad + ' 行解析不了或不合格')
  const back = got.rows
  if (expected.length !== back.length) throw new Error(`${label}条数不一致：源 ${expected.length} / 目标 ${back.length}`)
  for (let i = 0; i < expected.length; i += 1) {
    if (JSON.stringify(back[i]) !== JSON.stringify(expected[i])) {
      const id = (expected[i] && (expected[i].id || expected[i].from)) || '?'
      throw new Error(`${label}第 ${i + 1} 条对不上（${id}）：内容或顺序不一致`)
    }
  }
}

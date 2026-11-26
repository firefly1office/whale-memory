// SQLite 容器的同步内核（阶段 1 续）：表结构、整库快照、写入。
//
// 为什么是同步的：loadAll / recall 是同步 API，宿主不用改一行；node:sqlite 的 DatabaseSync
// 本来就是同步的。node:sqlite 用 process.getBuiltinModule 同步取，取不到就**报错**，不静默退回 file。
// 这个文件只在真的要用 SQLite 时才去取 node:sqlite；只 import 它不会碰 node:sqlite（Node 20 照常能加载）。
//
// 换容器不换内容：记录和事件的 JSON 形状一个字不改，库里存的就是 JSONL 里那一行。
// 坏行口径也一样：事件用各自模块的 isValid 判，记录只看能不能解析——和读文件时完全同一条判据。
import fs from 'node:fs'
import path from 'node:path'
import * as laterEvents from './later-events.js'
import * as sealEvents from './seal-events.js'
import * as recallEvents from './recall-events.js'
import * as unfinishedEvents from './unfinished-events.js'
import * as linkEvents from './link-events.js'
import * as chapterEvents from './chapter-events.js'

export const DB_FILE = 'memory.sqlite'
export const RECORDS_FILE = 'self-experience.jsonl'

const fileOf = (mod) => path.basename(mod.eventsFile('.'))

// 事件种类 → 原来的 JSONL 文件、合格判据、索引用的主体 id。
// 契约里点名的四类之外，loadAll 还读联想与章节两类；只搬一部分的话，sqlite 读出来会缺东西，所以六类一起搬。
// subject：建索引用。联想按 from，章节按章节 id（不是经历 id），其余按经历 id。
// expIds：这条事件指向哪些经历（mustExist 要逐一确认在）。联想两头都算；章节不指向经历。
export const EVENT_KINDS = Object.freeze({
  later: { file: fileOf(laterEvents), valid: laterEvents.isValid, subject: (r) => r.id, expIds: (r) => [r.id] },
  seal: { file: fileOf(sealEvents), valid: sealEvents.isValid, subject: (r) => r.id, expIds: (r) => [r.id] },
  recall: { file: fileOf(recallEvents), valid: recallEvents.isValid, subject: (r) => r.id, expIds: (r) => [r.id] },
  unfinished: { file: fileOf(unfinishedEvents), valid: unfinishedEvents.isValid, subject: (r) => r.id, expIds: (r) => [r.id] },
  link: { file: fileOf(linkEvents), valid: linkEvents.isValid, subject: (r) => r.from, expIds: (r) => [r.from, r.to] },
  chapter: { file: fileOf(chapterEvents), valid: chapterEvents.isValid, subject: (r) => r.id, expIds: () => [] }
})
export const KIND_NAMES = Object.freeze(Object.keys(EVENT_KINDS))

// 迁移时要对账的全部源文件：一条经历文件 + 六类事件文件
export const SOURCE_FILES = Object.freeze([RECORDS_FILE, ...KIND_NAMES.map((k) => EVENT_KINDS[k].file)])

export function kindOf(kind) {
  // 只认自己的键：constructor / toString / __proto__ 这类原型上的名字不能混进来
  const k = typeof kind === 'string' && Object.hasOwn(EVENT_KINDS, kind) ? EVENT_KINDS[kind] : null
  if (!k) throw new Error('未知的事件类型：' + kind + '（支持 ' + KIND_NAMES.join(' / ') + '）')
  return k
}

function coded(message, code, extra = {}) {
  return Object.assign(new Error(message), { code }, extra)
}

// ---------------------------------------------------------------- node:sqlite

// 只用 process.getBuiltinModule（Node 22.3 起有）：凡是有 node:sqlite 的版本（>= 22.5）都有它，
// 不需要 createRequire 兜底（也就不多引一个 node:module，宿主的高危模块检查不会因此拦这份内核）
function loadSqlite() {
  let mod
  try { mod = typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('node:sqlite') : undefined } catch { mod = undefined }
  if (!mod || typeof mod.DatabaseSync !== 'function') {
    throw coded('当前 Node 拿不到内置的 node:sqlite（需要 >= 22.5；22.13 起默认可用，22.5–22.12 要加 --experimental-sqlite；用 --no-experimental-sqlite 关掉了也会这样）。请改用 file 后端——这里不会替你静默降级。', 'SQLITE_UNAVAILABLE')
  }
  return mod
}

/** 拿不到 node:sqlite 就抛 SQLITE_UNAVAILABLE（不打开任何文件）。 */
export function requireSqlite() {
  loadSqlite()
}

/** 这台机器上能不能用 SQLite 后端（不打开任何文件）。 */
export function sqliteAvailable() {
  try { loadSqlite(); return true } catch { return false }
}

// ---------------------------------------------------------------- 表结构

export function ensureSchema(db) {
  // 建表必须一次成。DDL 逐条自动提交的话，第一次建库时进程被杀（或盘满）会留下"有 records、没 events"
  // 的半截库，之后读路径会永远报缺表。SQLite 的 DDL 在事务里可以整组回滚，包一层就好。
  db.exec('BEGIN IMMEDIATE')
  try {
    createTables(db)
    db.exec('COMMIT')
  } catch (error) {
    // 回滚本身也可能失败（连接已坏）：不能盖掉真正的错误
    try { db.exec('ROLLBACK') } catch { }
    throw error
  }
}

function createTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    at TEXT NOT NULL,
    json TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_records_day ON records(day)')
  // 事件：seq 就是追加顺序（= 原 JSONL 里的行序）；json 是那一行原样
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    exp_id TEXT,
    at TEXT,
    json TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_kind_exp ON events(kind, exp_id)')
  // 迁移时每个源文件的字节数：读的时候拿来判断 JSONL 在迁移之后有没有又被写过
  db.exec(`CREATE TABLE IF NOT EXISTS sources (
    file TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    migrated_at TEXT NOT NULL
  )`)
}

/**
 * 打开库。create=false 时库不存在就返回 null（读路径不许顺手建出一个空库）。
 * 先取 node:sqlite 再看文件：拿不到 node:sqlite 时，不管库在不在都报错。
 */
export function openDatabase(dir, { create = false } = {}) {
  return openDatabaseFile(path.join(dir, DB_FILE), { create })
}

/** 同上，但直接给库文件路径（迁移先建在临时文件名上，对拍通过再改名）。建表失败时句柄当场关掉，不漏。 */
export function openDatabaseFile(file, { create = false } = {}) {
  const { DatabaseSync } = loadSqlite()
  if (!create && !fs.existsSync(file)) return null
  if (create) fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  if (create) {
    try {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      ensureSchema(db)
    } catch (error) {
      try { db.close() } catch { }
      throw error
    }
  }
  return db
}

export function tablesOf(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
}

// ---------------------------------------------------------------- 写入（调用方负责事务）

export function insertRecord(db, record) {
  if (!record || typeof record.id !== 'string' || !record.id) throw new Error('记录缺少 id')
  try {
    db.prepare('INSERT INTO records (id, day, at, json) VALUES (?, ?, ?, ?)')
      .run(record.id, String(record.day || ''), String(record.at || ''), JSON.stringify(record))
  } catch (error) {
    // 同一个 id 写两次是调用方的 bug；契约里 id 永不复用，这里直接拒绝
    if (String(error?.message || '').includes('UNIQUE')) throw new Error('id 已存在：' + record.id)
    throw error
  }
  return record
}

export function insertEvent(db, kind, row) {
  const k = kindOf(kind)
  if (!k.valid(row)) throw new Error(kind + ' 事件不合格（缺必填字段），拒绝写入')
  db.prepare('INSERT INTO events (kind, exp_id, at, json) VALUES (?, ?, ?, ?)')
    .run(kind, String(k.subject(row) ?? ''), String(row.at ?? ''), JSON.stringify(row))
  return row
}

export function recordExists(db, id) {
  return Boolean(db.prepare('SELECT 1 AS ok FROM records WHERE id = ?').get(String(id)))
}

export function writeSources(db, sizes, at = new Date().toISOString()) {
  const stmt = db.prepare('INSERT OR REPLACE INTO sources (file, size, migrated_at) VALUES (?, ?, ?)')
  for (const [file, size] of Object.entries(sizes)) stmt.run(file, Number(size) || 0, at)
}

// ---------------------------------------------------------------- 读

/** 源文件现在的字节数；不存在算 0。读不出来（权限、是目录）就抛。 */
export function sourceSizes(dir) {
  const out = {}
  for (const name of SOURCE_FILES) {
    try {
      const st = fs.statSync(path.join(dir, name))
      if (!st.isFile()) throw coded(name + ' 不是普通文件', 'EISDIR')
      out[name] = st.size
    } catch (error) {
      if (error && error.code === 'ENOENT') out[name] = 0
      else throw error
    }
  }
  return out
}

// 一列 json 文本 → { rows, bad }：解析不了或不合格的算坏行（和读 JSONL 时同一条判据）
function parseColumn(texts, valid = null) {
  const rows = []
  let bad = 0
  for (const text of texts) {
    try {
      const r = JSON.parse(text)
      if (!valid || valid(r)) rows.push(r)
      else bad += 1
    } catch { bad += 1 }
  }
  return { rows, bad }
}

function emptySnapshot() {
  const events = {}
  for (const k of KIND_NAMES) events[k] = { rows: [], bad: 0 }
  return { records: { rows: [], bad: 0 }, events }
}

/**
 * 整库快照：一次读事务里把记录和六类事件全读出来，保证看到的是同一个时刻。
 *
 * fail closed 的几种情况（都抛，不返回空）：
 *   · 拿不到 node:sqlite                          → SQLITE_UNAVAILABLE
 *   · 没有 memory.sqlite，但目录里有 JSONL 数据     → STORAGE_NOT_MIGRATED（没迁移过，不能当"她什么都没写"）
 *   · 库是阶段 1 早期建的、没有事件表              → STORAGE_INCOMPLETE（记录在库里、事件不在，读一半就断）
 *   · JSONL 在迁移之后又变了（写路径还在 JSONL 上） → STORAGE_STALE（sqlite 读出来会少最新的东西）
 *   · 库本身读不出来                              → STORAGE_UNREADABLE
 * 目录里既没有库、也没有任何 JSONL 数据：如实返回空。
 */
export function readSnapshot(dir) {
  let db
  try { db = openDatabase(dir) } catch (error) {
    if (error && error.code === 'SQLITE_UNAVAILABLE') throw error
    throw unreadable(error)
  }
  if (!db) {
    const present = Object.entries(sourceSizes(dir)).filter(([, size]) => size > 0).map(([name]) => name)
    if (present.length) {
      throw coded('这个目录还没迁移到 SQLite（没有 ' + DB_FILE + '），但有 JSONL 数据：' + present.join('、') + '。先跑 tools/migrate-storage.mjs，或继续用 file 后端；不能当成"什么都没有"。', 'STORAGE_NOT_MIGRATED', { files: present })
    }
    return emptySnapshot()
  }
  try {
    let tables
    try { tables = tablesOf(db) } catch (error) { throw unreadable(error) }
    if (!tables.has('records') || !tables.has('events')) {
      throw coded(DB_FILE + ' 缺表（' + ['records', 'events'].filter((t) => !tables.has(t)).join('、') + '）：多半是阶段 1 早期只搬了记录的库。移走它重新迁移，否则记录在库里、事件不在，读一半就断。', 'STORAGE_INCOMPLETE')
    }
    checkFresh(db, dir, tables.has('sources'))
    let recordTexts
    let eventRows
    try {
      db.exec('BEGIN')
      try {
        recordTexts = db.prepare('SELECT json FROM records ORDER BY rowid').all().map((r) => r.json)
        eventRows = db.prepare('SELECT kind, json FROM events ORDER BY seq').all()
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch { }
        throw error
      }
    } catch (error) { throw unreadable(error) }
    const snap = emptySnapshot()
    snap.records = parseColumn(recordTexts)
    const texts = {}
    for (const k of KIND_NAMES) texts[k] = []
    // 不认识的事件种类（更新版本写进来的）：契约里新增事件类型算兼容，这里不认识就不读，也不当坏行
    for (const r of eventRows) if (texts[r.kind]) texts[r.kind].push(r.json)
    for (const k of KIND_NAMES) snap.events[k] = parseColumn(texts[k], EVENT_KINDS[k].valid)
    return snap
  } finally {
    try { db.close() } catch { }
  }
}

function unreadable(cause) {
  const error = coded('记忆库读不出来（' + DB_FILE + '）：' + String(cause && cause.message ? cause.message : cause), 'STORAGE_UNREADABLE')
  error.cause = cause
  return error
}

// 只追加的文件，追加就一定变长：字节数对不上 = 迁移之后又写过（或被换过）。
// 库不是迁移来的（没有 sources）时，目录里任何 JSONL 数据都没进库，同样算对不上。
function checkFresh(db, dir, hasSources) {
  const recorded = new Map()
  if (hasSources) {
    for (const r of db.prepare('SELECT file, size FROM sources').all()) recorded.set(r.file, Number(r.size))
  }
  const now = sourceSizes(dir)
  const changed = SOURCE_FILES.filter((name) => now[name] !== (recorded.get(name) ?? 0))
  if (changed.length) {
    throw coded('memory.sqlite 和目录里的 JSONL 对不上：' + changed.join('、') + ' 在迁移之后变了（写路径还在 JSONL 上）。sqlite 读出来会少东西，所以拒绝；重新迁移，或继续用 file 后端。', 'STORAGE_STALE', { files: changed })
  }
}

/** 某一类事件（按追加顺序）。坏行与不合格行计数，交给调用方决定要不要 fail closed。 */
export function readEvents(db, kind) {
  const k = kindOf(kind)
  const texts = db.prepare('SELECT json FROM events WHERE kind = ? ORDER BY seq').all(kind).map((r) => r.json)
  return parseColumn(texts, k.valid)
}

/** 全部记录（按写入顺序），坏行计数。 */
export function readRecords(db) {
  return parseColumn(db.prepare('SELECT json FROM records ORDER BY rowid').all().map((r) => r.json))
}

// ---------------------------------------------------------------- 擦除（阶段 4）
//
// 撤回一条经历时，SQLite 副本里也得把它删掉——不然 JSONL 里没了、库里还留着，等于没删干净。
// 两件事必须分开：
//   1. eraseReadiness()：动手之前先确认"库在不在、结构全不全、和 JSONL 对不对得上"。
//      拿不到 node:sqlite / 库缺表 → 直接抛（不许只删一半：一边删了、另一边删不了最糟）。
//      "过期"不算错——照样能删，但**不能刷新 sources**，否则会把"库缺了最近的记录"伪装成"库是新的"。
//   2. eraseFromStore()：一个事务里删 records + events（seal 留着），提交后按需刷新 sources。
//      墓碑写失败不回滚删除，这个取舍写在 docs/erase-audit-zh.md 里。
//
// 注意：SQLite 删除行之后，旧字节可能还留在文件页里。擦除路径会先开 secure_delete（见 eraseFromStore）；
// 其余删除路径不保证，所以"按原始字节能不能搜到正文"只对擦除做承诺。
// 这不是"没擦掉"，是"磁盘上的碎片不追溯"——和备份里的历史副本一样，文档里写明不承诺。

// 库文件本身的存在性/形状：不存在 = null；是目录 / 0 字节 = 抛（不能当"没有库"糊弄过去）
function statDatabase(dir) {
  const file = path.join(dir, DB_FILE)
  let st
  try {
    st = fs.statSync(file)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw coded(DB_FILE + ' 读不出来：' + String(error && error.message ? error.message : error), 'STORAGE_UNREADABLE')
  }
  if (!st.isFile()) throw coded(DB_FILE + ' 不是普通文件（是目录？）：不能当库用，先移走它。', 'STORAGE_UNREADABLE')
  if (st.size === 0) throw coded(DB_FILE + ' 是 0 字节的空文件，不是完整的库（先移走它重新迁移）。', 'STORAGE_INCOMPLETE')
  return st
}

/** 擦除前的体检：库不存在 = { present:false }；存在但打不开/不全/0 字节 = 抛；过期 = fresh:false。 */
export function eraseReadiness(dir) {
  // 没有库就不碰 node:sqlite：Node 20 上擦一个只用 file 后端的目录必须照常能跑
  if (!statDatabase(dir)) return { present: false, fresh: false }
  let db
  try {
    db = openDatabase(dir)
  } catch (error) {
    if (error && error.code === 'SQLITE_UNAVAILABLE') throw error
    throw unreadable(error)
  }
  if (!db) return { present: false, fresh: false }
  try {
    let tables
    try { tables = tablesOf(db) } catch (error) { throw unreadable(error) }
    if (!tables.has('records') || !tables.has('events')) {
      throw coded(DB_FILE + ' 缺表（' + ['records', 'events'].filter((t) => !tables.has(t)).join('、') + '）：结构不全的库不能拿来擦，先移走它重新迁移。', 'STORAGE_INCOMPLETE')
    }
    // sources 是"库和 JSONL 对不对得上"的唯一依据；没有它就没法判断过期，宁可拒绝
    if (!tables.has('sources')) {
      throw coded(DB_FILE + ' 缺 sources 表（阶段 1 早期建的库）：没法判断这个库是不是过期，先移走它重新迁移。', 'STORAGE_INCOMPLETE')
    }
    let fresh = true
    try { checkFresh(db, dir, true) } catch (error) {
      if (error && error.code === 'STORAGE_STALE') fresh = false
      else throw unreadable(error)
    }
    return { present: true, fresh }
  } finally {
    try { db.close() } catch { }
  }
}

// 过期库擦完之后必须继续过期：把 sources 全都写成 -1 这个不可能等于真实字节数的哨兵。
// 只靠"不刷新"不够——JSONL 删小之后可能恰好缩回迁移时记的字节数，checkFresh 就会误判成"对得上"。
const STALE_SIZE = -1
function invalidateSources(db) {
  const st = db.prepare('INSERT OR REPLACE INTO sources (file, size, migrated_at) VALUES (?, ?, ?)')
  const at = new Date().toISOString()
  for (const name of SOURCE_FILES) st.run(name, STALE_SIZE, at)
}

/**
 * 从 SQLite 副本里删掉这些 id 的经历与关联事件（seal 保留，章节不指向经历所以不动）。
 * 删除与 sources 更新在**同一个事务**里：要么都成，要么都不成（不会出现"记录删了、source 还挂着旧尺寸"）。
 * @param {string} dir
 * @param {string[]} ids 要删的经历 id
 * @param {{ refreshSources?: boolean }} opts refreshSources：擦除前库和 JSONL 对得上时才为 true
 *   （这时删完把 sources 的字节数刷成现在 JSONL 的大小；否则写 -1 哨兵，让库继续保持过期、读路径 fail closed）
 */
export function eraseFromStore(dir, ids, { refreshSources = false } = {}) {
  if (!statDatabase(dir)) return { present: false, records: 0, events: 0 }
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))]
  const db = openDatabase(dir)
  if (!db) return { present: false, records: 0, events: 0 }
  try {
    let records = 0
    let events = 0
    // 擦除要把旧页里的字节也抹掉：否则被删的正文还留在库文件里（验收抓到的）
    db.exec('PRAGMA secure_delete = ON')
    db.exec('BEGIN IMMEDIATE')
    try {
      const delRecord = db.prepare('DELETE FROM records WHERE id = ?')
      for (const id of wanted) records += Number(delRecord.run(id).changes || 0)
      // 按 exp_id 删；seal 事件留着（封存状态不是正文）
      const delEvent = db.prepare("DELETE FROM events WHERE exp_id = ? AND kind <> 'seal'")
      for (const id of wanted) events += Number(delEvent.run(id).changes || 0)
      // 联想：exp_id 只存 from，to 那一头要自己看
      const delSeq = db.prepare('DELETE FROM events WHERE seq = ?')
      for (const row of db.prepare("SELECT seq, json FROM events WHERE kind = 'link'").all()) {
        let link
        try { link = JSON.parse(row.json) } catch { continue }
        if (wanted.includes(String(link.from)) || wanted.includes(String(link.to))) {
          events += Number(delSeq.run(row.seq).changes || 0)
        }
      }
      if (refreshSources) writeSources(db, sourceSizes(dir))
      else invalidateSources(db)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { }
      throw error
    }
    return { present: true, records, events }
  } finally {
    try { db.close() } catch { }
  }
}

// 她自己的经历 v2：写下时拍下"当时"，回想分「当时 / 现在」两段；重要的写细，次要的简写
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import * as recallEvents from './recall-events.js'
import * as laterEvents from './later-events.js'
import * as unfinishedEvents from './unfinished-events.js'
import * as sealEvents from './seal-events.js'
import * as linkEvents from './link-events.js'
import * as chapterEvents from './chapter-events.js'
import { queryTerms, requiredOverlap, matchedTerms, normalizeText, contentUnits, coverage, MIN_COVER } from './query-match.js'
import { hybridRank } from './hybrid-recall.js'
import { embedRank } from './embed-recall.js'
import { expandHits } from './graph-expand.js'
import { parseAsOf, before, dayOf } from './as-of.js'
import { readSnapshot, appendToStore, readFromStore, recordOfStore, legacyOwnersOfStore, lastSealOfStore } from './sqlite-store.js'
import { readLines, readLinesAsync } from './jsonl-stream.js'
import * as metrics from './metrics.js'

const FILE = 'self-experience.jsonl'
const WEIGHTS = new Set(['important', 'normal', 'minor'])

// 坏行不再静默跳过：返回解析失败的行数，展示路径（strict）遇到坏行直接拒绝。
// 写入路径用非 strict：追加一条新记录不会碰坏行，坏行原样留在文件里等人工修复。
//
// 逐行读，不整读文件（见 jsonl-stream.js）。坏行口径一个字没改：只跳过 trim 后为空的行，
// 解析的是**原样那一行**（不先 trim，行首带 BOM 的行照旧算坏行）。
function* recordLines(dir, { withOffset = false } = {}) {
  const file = path.join(dir, FILE)
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch (error) {
    if (error.code === 'ENOENT') return
    // 只有"还没有这个文件"能当空；权限、是目录、坏盘必须报出来，不能当成 0 条
    throw experienceUnreadable(error)
  }
  try {
    for (const line of readLines(fd)) {
      if (!line.text.trim()) continue
      let row
      try { row = JSON.parse(line.text) } catch { row = undefined }
      if (withOffset) yield row === undefined ? { bad: true, offset: line.offset, bytes: line.bytes } : { row, offset: line.offset, bytes: line.bytes }
      else yield row === undefined ? { bad: true } : { row }
    }
  } finally {
    fs.closeSync(fd)
  }
}

// 同上，异步那份（iterate / page 用）。读不出来的错误同样要报出来。
// withOffset：分页要把每行在文件里的字节位置一起记下来（之后只回读这一页，不扫全文件）
async function* recordLinesAsync(dir, { withOffset = false } = {}) {
  const file = path.join(dir, FILE)
  let fh
  try {
    fh = await fsp.open(file, 'r')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw experienceUnreadable(error)
  }
  try {
    for await (const line of readLinesAsync(fh)) {
      if (!line.text.trim()) continue
      let row
      try { row = JSON.parse(line.text) } catch { row = undefined }
      if (withOffset) yield row === undefined ? { bad: true, offset: line.offset, bytes: line.bytes } : { row, offset: line.offset, bytes: line.bytes }
      else yield row === undefined ? { bad: true } : { row }
    }
  } finally {
    await fh.close()
  }
}

function readAll(dir, { strict = false } = {}) {
  const rows = []
  let bad = 0
  for (const rec of recordLines(dir)) {
    if (rec.bad) bad += 1
    else rows.push(rec.row)
  }
  if (strict && bad > 0) throw experienceCorrupt(bad)
  return { rows, bad }
}

function experienceCorrupt(bad) {
  const error = new Error('经历文件有 ' + bad + ' 行无法解析：这里少了她写下的记录，不能当成空的照常展示（先备份再修复）。')
  error.code = 'EXPERIENCE_CORRUPT'
  error.bad = bad
  return error
}

function experienceUnreadable(cause) {
  const error = new Error('经历文件读不出来（' + FILE + '）：' + String(cause && cause.message ? cause.message : cause))
  error.code = 'EXPERIENCE_UNREADABLE'
  error.cause = cause
  return error
}

// 坏行计数（体检 / 工具用）：解析失败的行数。读文件本身失败仍然抛，不当成"0 行坏行"
export function badLines(dir) {
  return readAll(dir).bad
}

// 事件文件：只有"还没有这个文件"能当空。读不出来（权限、是目录、坏盘）必须报出来，
// 否则正文可读、事件读不了时，这里会当成"她没想起过、也没后记、没结过案"，替她编一段空白。
function eventsUnreadable(file, cause) {
  const error = new Error('事件日志读不出来（' + path.basename(file) + '）：' + String(cause && cause.message ? cause.message : cause))
  error.code = 'EVENTS_UNREADABLE'
  error.cause = cause
  return error
}

function readEvents(dir, eventsFile, read, onError = null) {
  const file = eventsFile(dir)
  try {
    const st = fs.statSync(file)
    if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'EISDIR' })
    const fd = fs.openSync(file, 'r')
    fs.closeSync(fd)
  } catch (error) {
    // 还没有这组事件：当空是如实的
    if (error.code === 'ENOENT') return read()
    if (onError) return onError(file, error)
    throw eventsUnreadable(file, error)
  }
  try { return read() } catch (error) {
    if (onError) return onError(file, error)
    throw eventsUnreadable(file, error)
  }
}

// 字段上限：写的时候超了就报错，不静默截断
export const LIMITS = { text: 2000, scene: 500, thought: 1000, unfinished: 300, feelings: 8, feelingWord: 20, kind: 20, laterThought: 1000, laterReason: 200, refs: 8 }

// 感觉词：逗号分隔的字符串或数组都收；去空白、去重；超了就报错，不静默丢
function feelingList(feeling, { name = 'feeling', perWord = false } = {}) {
  const raw = Array.isArray(feeling) ? feeling : String(feeling || '').split(/[,，、]/)
  const out = []
  for (const f of raw.map((x) => String(x || '').trim()).filter(Boolean)) {
    if (perWord && f.length > LIMITS.feelingWord) throw new Error(`${name} item "${f.slice(0, 10)}…" is too long (${f.length}/${LIMITS.feelingWord} chars); write a feeling as a word, not a sentence.（${name} 里的「${f.slice(0, 10)}…」太长（${f.length}/${LIMITS.feelingWord} 字），感觉写成词就好。）`)
    if (!out.includes(f)) out.push(f)
  }
  if (out.length > LIMITS.feelings) throw new Error(`${name} allows at most ${LIMITS.feelings} items; got ${out.length}.（${name} 最多 ${LIMITS.feelings} 个，现在是 ${out.length} 个。）`)
  return out
}

function tooLong(name, value, max) {
  const n = String(value || '').length
  if (n > max) throw new Error(`${name} is too long (${n}/${max} chars); shorten it or split it into two entries.（${name} 太长（${n}/${max} 字），删一些或拆成两条再写。）`)
  return String(value || '')
}

// 旧格式没有 id：用「时间 + 正文指纹」生成，避免同一分钟的多条记录撞成同一个身份
// 只用记录里的内容生成，每次读取都得到同一个 id；没有 at 的旧记录用 noat 代替时间
function legacyId(r) {
  const stamp = r.at ? String(r.at).replace(/\D/g, '').slice(0, 14) : 'noat'
  const body = String(r.text || '') + '\u0000' + String(r.thought || '') + '\u0000' + String(r.at || '')
  const fp = crypto.createHash('sha1').update(body).digest('hex').slice(0, 8)
  return 'exp_legacy_' + stamp + '_' + fp
}

// 0.10.0 之前的旧 id：只到分钟、不带指纹。那时写下的后记和想起事件挂在这个 id 上
// 没有 at 的记录当时用的是 Date.now()，每次都不同，那些事件已无从对上
function preV010Id(r) {
  return r.at ? 'exp_legacy_' + String(r.at).replace(/\D/g, '').slice(0, 12) : ''
}

function normalize(r) {
  if (!r) return null
  if (r.then && typeof r.then === 'object') {
    return { ...r, weight: WEIGHTS.has(r.weight) ? r.weight : 'normal', later: Array.isArray(r.later) ? r.later : [] }
  }
  // 旧格式：text/thought 在顶层
  return {
    id: r.id || legacyId(r),
    formerId: r.id ? '' : preV010Id(r),
    at: r.at || '',
    day: r.day || String(r.at || '').slice(0, 10),
    author: 'self',
    source: r.source || 'own-time',
    kind: r.kind || '其它',
    weight: WEIGHTS.has(r.weight) ? r.weight : 'normal',
    then: {
      text: String(r.text || ''),
      scene: '',
      feeling: [],
      thought: String(r.thought || ''),
      unfinished: '',
      quote: null,
      state: null
    },
    later: Array.isArray(r.later) ? r.later : [],
    status: r.status || 'kept',
    legacy: true
  }
}

// 读出经历并认领旧 id：一个旧 id 只对应一条旧记录、也没有别的记录显式用着它，才认领；
// 否则谁也不给（事件原样留在文件里），由 pendingLegacyEvents 报告
// strict：展示路径用，坏行直接抛（见 readAll）
function identify(dir, { strict = false } = {}) {
  return identifyRaw(readAll(dir, { strict }))
}

// 同上，输入是已经读出来的 { rows, bad }（文件或 SQLite 都行）
function identifyRaw(raw) {
  const rows = raw.rows.map(normalize).filter((r) => r && r.then && r.then.text)
  const explicit = new Set(rows.filter((r) => !r.formerId).map((r) => r.id))
  const owners = new Map()
  for (const r of rows) {
    if (!r.formerId) continue
    // push 而不是 [...旧数组, id]：四万条同一分钟的旧记录共用一个旧 id 时，后者是 O(n²)
    const list = owners.get(r.formerId)
    if (list) list.push(r.id)
    else owners.set(r.formerId, [r.id])
  }
  // 同一个 id 在文件里出现两次（导入合并、手改都可能）：只认最先写下的那条，
  // 后面的标 duplicateOf，事件不再往它身上回填——否则一次「想起」会挂在两条上
  const canonical = new Map()
  for (const r of rows) {
    const first = canonical.get(r.id)
    if (first) { r.duplicateOf = first.id; continue }
    canonical.set(r.id, r)
  }
  for (const r of rows) {
    if (r.formerId && (owners.get(r.formerId).length !== 1 || explicit.has(r.formerId))) r.formerId = ''
    if (!r.formerId) delete r.formerId
  }
  return { rows, owners, explicit, bad: raw.bad }
}

// 出处的一句话摘要：只用来指路，全文用 read / currentView 看
// 索引里也存这一份（buildIndex 的 t24），两处必须同一个口径
const briefText = (s) => {
  const t = String(s || '')
  const chars = [...t]
  return chars.length > 24 ? chars.slice(0, 24).join('') + '…' : t
}
const brief = (r) => ({ id: r.id, day: r.day, text: briefText((r.then && r.then.text) || '') })

// asOf：翻回那天的自己。只保留那一刻之前（含）写下的经历、后记、想起和选择；
// 那之后发生的一律看不见。不传 asOf 就是现在的样子
//
// 坏行（self-experience.jsonl 里有解析不了的行）默认 fail closed：返回的部分经历会
// 把"少了一条"装成"就这些"，召回/书/体检都会当真。要按字节备份、恢复演练、计数这种
// 不展示内容的工具，传 allowCorrupt（导出/恢复那条路走 allowSealCorrupt，含义相同）。
// 数据从哪来：file（默认，原样走各模块的读文件函数，调用顺序与参数和以前一模一样）
// 或 sqlite（一次读事务拿到记录 + 六类事件的快照，再走同一套合并逻辑）。
// 合并逻辑只有一份，所以两个后端在同一份数据上读出来的结果逐条相同。
const BACKENDS = new Set(['file', 'sqlite'])

function backendName(backend) {
  const name = backend === undefined || backend === null || backend === '' ? 'file' : String(backend)
  if (!BACKENDS.has(name)) throw new Error('未知的存储后端：' + name + '（支持 file / sqlite）')
  return name
}

// 写路径的后端选项：backend 与读路径同一个名字；dualWrite=JSONL 还写不写（默认写）。
// 双写的意思是"同一行同时进 JSONL 和库"——不是各写各的，所以两边读出来逐字段相同。
function writeTarget(opts) {
  return { backend: backendName(opts && opts.backend), dualWrite: !(opts && opts.dualWrite === false) }
}

function fileSource(dir) {
  return {
    records: (strict) => readAll(dir, { strict }),
    recalls: (until, onError) => readEvents(dir, recallEvents.eventsFile, () => recallEvents.countByExp(dir, { until }), onError),
    later: (until, onError) => readEvents(dir, laterEvents.eventsFile, () => laterEvents.groupByExp(dir, { until }), onError),
    unfinished: (until, onError) => readEvents(dir, unfinishedEvents.eventsFile, () => unfinishedEvents.latestByExp(dir, { until }), onError),
    sealed: (until, strict) => sealEvents.sealedByExp(dir, { until, strict }),
    links: (until, onError) => readEvents(dir, linkEvents.eventsFile, () => linkEvents.linksByExp(dir, { until }), onError),
    chapters: (until, onError) => readEvents(dir, chapterEvents.eventsFile, () => chapterEvents.chapters(dir, { until }), onError)
  }
}

// 快照在这里一次读完：拿不到 node:sqlite、没迁移、库不全、JSONL 在迁移后又变过，都在这一步抛（见 sqlite-store.readSnapshot）
function sqliteSource(dir) {
  const snap = readSnapshot(dir)
  const ev = (kind) => snap.events[kind]
  return {
    records: (strict) => {
      if (strict && snap.records.bad > 0) throw experienceCorrupt(snap.records.bad)
      return snap.records
    },
    recalls: (until) => recallEvents.countRows(ev('recall').rows, { until }),
    later: (until) => laterEvents.groupRows(ev('later').rows, { until }),
    unfinished: (until) => unfinishedEvents.latestRows(ev('unfinished').rows, { until }),
    sealed: (until, strict) => sealEvents.sealedFrom(ev('seal'), { until, strict }),
    links: (until) => linkEvents.linksRows(ev('link').rows, { until }),
    chapters: (until) => chapterEvents.chapterRows(ev('chapter').rows, { until })
  }
}

// 擦除后留下的"共用旧 id"：同一个旧 id 被两条以上经历用过，擦掉其中一条之后，
// 剩下那条会独占这个旧 id，旧后记就会被算到它头上。墓碑里记下了这些 id（ambiguousIds）；
// 读的时候把它们的事件摘掉——"对不上就不归任何人"，擦除不该改变别的记录读出来的样子。
function ambiguousLegacyIds(dir) {
  const out = new Set()
  let raw
  try {
    raw = fs.readFileSync(path.join(dir, 'tombstones.jsonl'), 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row && Array.isArray(row.ambiguousIds)) for (const id of row.ambiguousIds) out.add(String(id))
  }
  return out
}

// 事件侧：两个后端在这里分开，往上走的是同一套合并逻辑（同一份数据读出来逐字段相同）
function readSide(src, { until, rawMode, allowSealCorrupt, dir = null }) {
  // 想起次数：有事件文件就以事件为准；没有事件时才退回旧字段。
  // 读不出来必须报出来（readEvents）：否则会当成"她从没想起过"。
  // rawMode（按字节备份/恢复/计数）不看事件内容，读不出来也不该拦住备份。
  const onEventError = rawMode ? () => new Map() : null
  const counts = src.recalls(until, onEventError)

  // 改主意：旧 later 数组 + later-events 事件，按时间合并
  const laterMap = src.later(until, onEventError)

  // 没弄完的事后来怎么样了：想通 / 暂放 / 再接着想
  const unfinishedMap = src.unfinished(until, onEventError)

  // 她选择封存的：不再被主动想起，但还在。
  // 读不出来就抛出去，不能当成"什么都没封存"——否则正文可读、日志读不了时，
  // 召回/醒来/书会把本该藏起来的经历重新拿出来。
  // strict：坏行也算"状态未知"，展示路径必须 fail closed。
  // allowSealCorrupt：只给"按字节备份/恢复/计数"这种不展示内容的工具用；
  // 它们要能保住损坏现场，但不能把结果当"可见"用。
  const sealedMap = src.sealed(until, !allowSealCorrupt)
  // 翻回那天时，她**现在**封存着的也不翻出来：封存说的是她现在不想被提起，而翻回那天正是在提起旧事。
  // 那时还没封存的，标成 afterAsOf（后来才封存），各处过滤照常生效；点名读仍然给，并写明是后来封存的
  const sealedNowMap = until === null ? sealedMap : src.sealed(null, !allowSealCorrupt)

  // 事后联想（两头都看得见）与人生章节（按 day 落进她起过名字的那段日子）
  const linkMap = src.links(until, onEventError)
  const chapterList = src.chapters(until, rawMode ? () => [] : null)

  // 共用旧 id：这些旧 id 上的事件不在读路径上归给任何人（见 ambiguousLegacyIds）。
  // 不直接删 map 的键——显式 id 恰好等于那个旧 id 的记录会被误伤（复审抓到的）。
  // 交给 mergeRow / attachLinks 在"这条记录自己的旧 id"这一层跳过。
  const ambiguous = (!rawMode && dir) ? ambiguousLegacyIds(dir) : new Set()
  return { until, rawMode, counts, laterMap, unfinishedMap, sealedMap, sealedNowMap, linkMap, chapterList, ambiguous }
}

// 封存状态的口径只写这一份：loadAll / iterate / page 共用，不许各自推一遍
// （entry 和行对象形状一致：都有 id / formerId / sealed，所以两处都能喂进来）
function sealedOf(r, side) {
  const keys = r.formerId && !(side.ambiguous && side.ambiguous.has(String(r.formerId))) ? [r.id, r.formerId] : [r.id]
  let sealed = r.sealed
  for (const k of keys) {
    const s = side.sealedMap.get(k)
    if (s) sealed = s
  }
  if (!sealed && side.until !== null) {
    for (const k of keys) {
      const s = side.sealedNowMap.get(k)
      if (s) sealed = { ...s, afterAsOf: true }
    }
  }
  return sealed
}

// 一条记录 + 事件 → 读出来的那条经历。三条读路径共用这一份，保证逐字段相同。
function mergeRow(r, side) {
  const until = side.until
  const keys = r.formerId && !(side.ambiguous && side.ambiguous.has(String(r.formerId))) ? [r.id, r.formerId] : [r.id]
  // 同一个 id 出现两次时，事件只回填到最先写下的那条（duplicateOf）：一次想起不该挂两条
  const duplicate = Boolean(r.duplicateOf)
  const extra = duplicate ? [] : keys.flatMap((k) => side.laterMap.get(k) || [])
  const merged = [...(r.later || []).filter((l) => before(l, until)), ...extra]
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
  const next = { ...r, later: merged }
  if (until !== null) {
    next.viewAsOf = new Date(until).toISOString()
    // 旧格式行内的 recalls 没有时间，放不到那天的时间线上
    delete next.recalls
    delete next.lastRecalledAt
  }
  let state = null
  if (!duplicate) {
    for (const k of keys) {
      const st = side.unfinishedMap.get(k)
      if (st) state = st
    }
  }
  if (state && next.then && next.then.unfinished) next.unfinishedState = state
  const sealed = sealedOf(r, side)
  if (sealed) next.sealed = sealed
  let count = 0
  let lastAt = ''
  if (!duplicate) {
    for (const k of keys) {
      const c = side.counts.get(k)
      if (!c) continue
      count += c.count
      if (c.lastAt > lastAt) lastAt = c.lastAt
    }
  }
  if (count) {
    next.recalls = count
    next.lastRecalledAt = lastAt || (until === null ? r.lastRecalledAt : '') || ''
  }
  return next
}

// 指路用的摘要：封存了的经历不露摘要，别的回想里只说"一件你封存了的事"，
// 不借着引用把它又提起来
function pointerOf(row) {
  return row.sealed ? { id: row.id, day: row.day, sealed: true } : brief(row)
}

// 同一个 key 被多行指到时，以文件里靠后那一行为准（和以前 byId.set 覆盖的顺序一致）
function putPointer(map, key, seq, p) {
  const cur = map.get(key)
  if (!cur || cur.seq <= seq) map.set(key, { seq, p })
}

// 「谁引用了谁」：出处（refsInfo）与反向引用（citedBy）都查这一份
// seq 是记录在文件里的顺序号：用来判断"引用的其实是它自己"
function buildCrossRef(pairs) {
  const pointers = new Map()
  // 重复 id 不覆盖先写下的那条：指路一律指向它
  for (const { seq, row } of pairs) {
    if (row.duplicateOf) continue
    const p = pointerOf(row)
    putPointer(pointers, row.id, seq, p)
    if (row.formerId) putPointer(pointers, row.formerId, seq, p)
  }
  const cited = new Map()
  for (const { seq, row } of pairs) {
    const refs = (row.then && Array.isArray(row.then.refs)) ? row.then.refs : []
    if (!refs.length) continue
    for (const id of refs) {
      const target = pointers.get(id)
      if (!target || target.seq === seq) continue
      const list = cited.get(target.seq)
      if (list) list.push(pointerOf(row))
      else cited.set(target.seq, [pointerOf(row)])
    }
  }
  return { pointers, cited }
}

// 出处（这条是从哪几件事想到的）和反向引用（后来有哪些回想提到它）：都从 then.refs 派生
function attachRefs(row, seq, cross) {
  const refs = (row.then && Array.isArray(row.then.refs)) ? row.then.refs : []
  if (refs.length) {
    row.refsInfo = refs.map((id) => { const hit = cross.pointers.get(id); return hit ? hit.p : { id, missing: true } })
  }
  const cited = cross.cited.get(seq)
  if (cited && cited.length) row.citedBy = cited
  return row
}

// 事后联想（两头都看得见）与人生章节（按 day 落进她起过名字的那段日子）
function attachLinks(row, seq, cross, side) {
  const keys = row.formerId && !(side.ambiguous && side.ambiguous.has(String(row.formerId))) ? [row.id, row.formerId] : [row.id]
  const links = !row.duplicateOf && keys.flatMap((k) => side.linkMap.get(k) || [])
    .map((l) => {
      const other = cross.pointers.get(l.other)
      if (!other || other.seq === seq) return null
      const o = other.p
      // 另一头封存了：只给 id 和日子，连理由也不露，免得借联想又把它提起来
      if (o.sealed) return { id: o.id, day: o.day, sealed: true, linkDay: l.day }
      return { ...o, reason: l.reason, linkDay: l.day }
    })
    .filter(Boolean)
  if (links.length) row.links = links
  const ch = chapterEvents.chaptersOn(side.chapterList, row.day || '')
  if (ch.length) row.chapters = ch.map((c) => ({ id: c.id, name: c.name }))
  return row
}

// backend：'file'（默认，零行为变化）或 'sqlite'（读 memory.sqlite，要求 node:sqlite；拿不到就报错，不静默退回 file）
export function loadAll(dir, { asOf = null, allowSealCorrupt = false, allowCorrupt = false, backend = 'file' } = {}) {
  const until = parseAsOf(asOf)
  const rawMode = Boolean(allowSealCorrupt || allowCorrupt)
  const src = backendName(backend) === 'sqlite' ? sqliteSource(dir) : fileSource(dir)
  const raw = src.records(!rawMode)
  // 坏行数只给指标（不记内容）；一次读库观测一次，0 也记，修好之后指标才会回落
  metrics.recordBadLines(raw.bad)
  const { rows: all } = identifyRaw(raw)
  const rows = until === null ? all : all.filter((r) => before(r, until))
  if (!rows.length) return rows

  const side = readSide(src, { until, rawMode, allowSealCorrupt, dir })
  const viewed = rows.map((r) => mergeRow(r, side))
  const cross = buildCrossRef(viewed.map((row, seq) => ({ seq, row })))
  for (let seq = 0; seq < viewed.length; seq++) attachLinks(attachRefs(viewed[seq], seq, cross), seq, cross, side)
  return viewed
}

// ---------------------------------------------------------------- 规模：逐条读与分页
// loadAll 要把整个库读成数组，而它返回的正是这个数组：十万条时绕不开几百 MB。
// 需要"一条一条处理"的地方（导出、备份、体检、搬家）用 iterate：
// 内存只跟一份小索引走——每个 id 只留日子、前 24 字和封存状态，正文不进索引。
//
// 代价说清楚：为了填 refsInfo / citedBy / links 这些要看"别处有哪些 id"的字段，
// iterate 要把经历文件读两遍（loadAll 一遍就够，因为它本来就持有全部记录）。
// 另一条路是产出"没有跨行字段"的行：一趟就够，但读出来和 loadAll 不一致，
// 调用方得自己记住哪些字段没有——那更容易出错，所以没这么做。
//
// 遍历期间文件被改（并发追加）：两遍的记录数对不上，直接抛 EXPERIENCE_CHANGED，
// 不静默少返一条。要"同一时刻的一次性快照"请用 loadAll。

function experienceChanged() {
  const error = new Error('经历文件在遍历期间变了：两遍读到的记录数对不上。重跑一次，或改用 loadAll（同一时刻的一次性快照）。')
  error.code = 'EXPERIENCE_CHANGED'
  return error
}

// 第一遍：扫一遍记录，只留下"指路"需要的东西，正文解析完就丢掉。
// entries：asOf 范围内的记录，按文件顺序；bySeq：按记录序号索引（范围外/被过滤掉的是 null）
// 坏行这里**不抛**：只把条数记在 index.bad 上，由调用方按"这次是不是按字节抢救"决定抛不抛。
// 这样同一份索引（分页会缓存）在两种口径下都能用，不会把 raw 模式的结果漏给展示路径。
async function buildIndex(dir, { until }) {
  const entries = []
  const bySeq = []
  const seenIds = new Set()     // 所有主 id（重复 id 靠它标）
  const explicitIds = new Set() // 文件里**显式写着**这个 id 的那些主 id（identifyRaw 里的 explicit）
  const legacy = []             // 需要认领旧 id 的在范围记录：{ entry, formerId }
  const owners = new Map()      // 旧 id → [主 id]
  let bad = 0
  let seq = 0
  for await (const rec of recordLinesAsync(dir, { withOffset: true })) {
    if (rec.bad) { bad += 1; continue }
    const mySeq = seq++
    const row = normalize(rec.row)
    if (!row || !row.then || !row.then.text) { bySeq[mySeq] = null; continue }
    // 同一个 id 出现两次：只认先写下的那条（identifyRaw 就是这么标的）
    const dup = seenIds.has(row.id)
    if (!dup) seenIds.add(row.id)
    if (!row.formerId) explicitIds.add(row.id)
    else {
      const list = owners.get(row.formerId)
      if (list) list.push(row.id)
      else owners.set(row.formerId, [row.id])
    }
    // asOf 只决定"在不在这一页里"：重复 id 与旧 id 的判据用的是全部记录，和 identifyRaw 一致
    if (until !== null && !before(row, until)) { bySeq[mySeq] = null; continue }
    const entry = {
      seq: mySeq,
      offset: rec.offset,
      bytes: rec.bytes,
      id: row.id,
      day: row.day,
      t24: briefText(row.then.text),
      formerId: row.formerId || '',
      dup: dup ? row.id : '',
      sealed: row.sealed,
      refs: (row.then && Array.isArray(row.then.refs) && row.then.refs.length) ? row.then.refs : null
    }
    entries.push(entry)
    bySeq[mySeq] = entry
    if (row.formerId) legacy.push({ entry, formerId: row.formerId })
  }
  metrics.recordBadLines(bad)
  return { entries, bySeq, total: seq, bad, seenIds, explicitIds, legacy, owners }
}

// 旧格式记录的 id 认领：只有一个旧记录用着它、也没有别的记录显式用着这个 id，才认领
// （判据和 identifyRaw 里 owners / explicit 那两条逐字相同）
function resolveLegacy(index) {
  for (const item of index.legacy) {
    const owners = index.owners.get(item.formerId) || []
    if (owners.length !== 1 || index.explicitIds.has(item.formerId)) item.entry.formerId = ''
  }
  return index
}

// 从索引里还原"指路表"：pointers（id / 前 24 字 / 封存）+ cited（谁引用了它）
function indexCrossRef(index, side) {
  const pointers = new Map()
  for (const e of index.entries) {
    if (e.dup) continue
    const sealed = sealedOf(e, side)
    const p = sealed ? { id: e.id, day: e.day, sealed: true } : { id: e.id, day: e.day, text: e.t24 }
    putPointer(pointers, e.id, e.seq, p)
    if (e.formerId) putPointer(pointers, e.formerId, e.seq, p)
  }
  const cited = new Map()
  for (const e of index.entries) {
    if (!e.refs) continue
    const sealed = sealedOf(e, side)
    const p = sealed ? { id: e.id, day: e.day, sealed: true } : { id: e.id, day: e.day, text: e.t24 }
    for (const id of e.refs) {
      const target = pointers.get(id)
      if (!target || target.seq === e.seq) continue
      const list = cited.get(target.seq)
      if (list) list.push(p)
      else cited.set(target.seq, [p])
    }
  }
  return { pointers, cited }
}

// 索引里存的是"精简版的一行"，读出来的正文行要靠这两条对齐：重复 id、认领后的旧 id
function applyEntry(row, entry) {
  if (entry.dup) row.duplicateOf = entry.dup
  else delete row.duplicateOf
  if (entry.formerId) row.formerId = entry.formerId
  else delete row.formerId
  return row
}

// 逐条读：不建全量数组，内存只跟索引走。
// 异步生成器：块读走 fs/promises，不把事件循环卡住（事件文件仍是同步读，与 loadAll 同一份代码）
// backend='sqlite' 时退回整库快照（结果与 loadAll 逐条相同，但没有内存收益）：sqlite 的快照本来就整库进内存。
export async function* iterate(dir, { asOf = null, backend = 'file', allowCorrupt = false, allowSealCorrupt = false } = {}) {
  const name = backendName(backend)
  const rawMode = Boolean(allowSealCorrupt || allowCorrupt)
  if (name !== 'file') {
    for (const row of loadAll(dir, { asOf, backend, allowCorrupt, allowSealCorrupt })) yield row
    return
  }
  const until = parseAsOf(asOf)
  const index = await buildIndex(dir, { until })
  // 坏行：展示路径 fail closed，而且要在吐出第一条之前就拒绝（不许先给几条再抛）
  if (index.bad && !rawMode) throw experienceCorrupt(index.bad)
  if (!index.entries.length) return
  const side = readSide(fileSource(dir), { until, rawMode, allowSealCorrupt, dir })
  resolveLegacy(index)
  const cross = indexCrossRef(index, side)

  let seq = 0
  for await (const rec of recordLinesAsync(dir)) {
    if (rec.bad) {
      if (rawMode) continue
      throw experienceCorrupt(1)
    }
    const mySeq = seq++
    if (mySeq >= index.total) throw experienceChanged()
    const entry = index.bySeq[mySeq]
    if (!entry) continue
    const row = normalize(rec.row)
    if (!row || !row.then || !row.then.text) continue
    applyEntry(row, entry)
    const view = mergeRow(row, side)
    yield attachLinks(attachRefs(view, mySeq, cross), mySeq, cross, side)
  }
  if (seq !== index.total) throw experienceChanged()
}

// 分页：after 是上一页最后一个 id（也收 page 自己给的 { id, n }：n = 那一页末尾连着几条同 id，
// 只在文件里有重复 id 时才用得上）。不给 after 就是第一页。
//
// 代价：一页 = 一次索引扫描 + 只读这一页的字节。索引按「文件 size + mtime + asOf」认库：
// 同一份没变过的文件连着翻页只建一次，否则十万条下每页都要重扫一遍（成了 O(n²)）。
// 只留最近一份索引（换目录/文件一变就重来），避免长期占着一份几十 MB 的东西。
// 事件文件每次仍然现读（封存可能刚变），所以翻页看到的状态不会停在建索引那一刻。
let pageCache = { dir: null, key: '', until: null, index: null }

function recordsKey(dir) {
  try {
    const st = fs.statSync(path.join(dir, FILE))
    return st.size + ':' + st.mtimeMs
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing'
    throw experienceUnreadable(error)
  }
}

export async function page(dir, { limit = 50, after = null, asOf = null, backend = 'file', allowCorrupt = false, allowSealCorrupt = false } = {}) {
  const size = Number(limit)
  if (!Number.isInteger(size) || size <= 0) throw new Error('limit must be a positive integer.（limit 必须是正整数。）')
  const until = parseAsOf(asOf)
  const rawMode = Boolean(allowSealCorrupt || allowCorrupt)
  const name = backendName(backend)
  if (name !== 'file') {
    // sqlite：快照本来就整库在内存里，分页只能从全量里切（结果相同，但没有内存收益）
    const all = loadAll(dir, { asOf, backend, allowCorrupt, allowSealCorrupt })
    const ids = all.map((r) => r.id)
    const start = cursorStart(ids, after)
    const rows = all.slice(start, start + size)
    const hasMore = start + size < all.length
    return { rows, next: hasMore ? cursorOf(ids, start, size) : null, hasMore, total: all.length }
  }
  const key0 = recordsKey(dir)
  let index = pageCache.dir === dir && pageCache.key === key0 && pageCache.until === until ? pageCache.index : null
  if (!index) {
    index = await buildIndex(dir, { until })
    // 建的过程中文件又变了：这份索引已经对不上，别进缓存（下一页会重建）
    if (recordsKey(dir) === key0) pageCache = { dir, key: key0, until, index }
  }
  if (index.bad && !rawMode) throw experienceCorrupt(index.bad)
  const ids = index.entries.map((e) => e.id)
  const start = cursorStart(ids, after)
  const selected = index.entries.slice(start, start + size)
  const total = index.entries.length
  if (!selected.length) return { rows: [], next: null, hasMore: false, total }
  const side = readSide(fileSource(dir), { until, rawMode, allowSealCorrupt, dir })
  resolveLegacy(index)
  const cross = indexCrossRef(index, side)
  const rows = await readEntries(dir, selected, side, cross)
  const hasMore = start + selected.length < total
  return { rows, next: hasMore ? cursorOf(ids, start, selected.length) : null, hasMore, total }
}

// 按索引里记下的字节位置把这一页的行读回来（只读这一页，不扫全文件）
async function readEntries(dir, selected, side, cross) {
  let fh
  try {
    fh = await fsp.open(path.join(dir, FILE), 'r')
  } catch (error) {
    throw experienceUnreadable(error)
  }
  try {
    let max = 0
    for (const e of selected) if (e.bytes > max) max = e.bytes
    const buf = Buffer.allocUnsafe(max + 1)
    const rows = []
    for (const e of selected) {
      const { bytesRead } = await fh.read(buf, 0, e.bytes, e.offset)
      let row
      try { row = normalize(JSON.parse(buf.toString('utf8', 0, bytesRead))) } catch { row = null }
      if (!row || !row.then || !row.then.text) throw experienceChanged()
      applyEntry(row, e)
      const view = mergeRow(row, side)
      rows.push(attachLinks(attachRefs(view, e.seq, cross), e.seq, cross, side))
    }
    return rows
  } finally {
    await fh.close()
  }
}

// 游标落在第几行之后：找不到这个 id 就说清楚，不静默从头开始（那会把一页重复一遍）
function cursorStart(ids, after) {
  if (after === null || after === undefined || after === '') return 0
  const cur = typeof after === 'string' ? { id: after, n: 1 } : after
  const at = ids.indexOf(String(cur.id))
  if (at < 0) {
    const error = new Error('分页游标失效：找不到 id ' + String(cur.id) + '。用 after: null 从头开始，或换一个还在这一页里的 id。')
    error.code = 'PAGE_CURSOR_UNKNOWN'
    throw error
  }
  const n = Number.isInteger(cur.n) && cur.n > 0 ? cur.n : 1
  return at + n
}

// 这一页的游标：n = 从这个 id **第一次出现**到这一页最后一行，一共走了几条。
// 重复 id 的时候只有这样才不漏、不重（只数"本页末尾连着几条"会让下一页原地打转）。
function cursorOf(ids, start, size) {
  const lastAt = start + size - 1
  const last = ids[lastAt]
  const first = ids.indexOf(last)
  return { id: last, n: lastAt - first + 1 }
}

// 事后联想：她发现两件事有关，亲手连起来，并说清为什么。两条都必须存在；同一对只连一次
export function linkExperiences(dir, { from, to, reason = '' } = {}) {
  if (!String(from || '').trim() || !String(to || '').trim()) return { ok: false, error: 'Need the ids of two experiences: from and to（需要 from 与 to 两条经历的 id）' }
  if (!String(reason || '').trim()) return { ok: false, error: 'Say why you are linking them (reason). If you cannot say why, do not link them yet.（说一句为什么把它们连起来（reason）。说不出来就先别连。）' }
  try {
    const why = tooLong('reason', String(reason).trim(), LIMITS.laterReason)
    const a = resolveId(dir, String(from))
    const b = resolveId(dir, String(to))
    for (const [x, t] of [[from, a], [to, b]]) {
      if (t.ambiguous) return { ok: false, error: 'This legacy id is shared by several old experiences: ' + x + '. Use the current id listed by `read`.（这个旧 id 有好几条旧经历共用：' + x + '。用 read 里列出的当前 id。）' }
      if (!t.id) return { ok: false, error: 'Experience not found: ' + x + '. Run `read` to check the id.（找不到这条经历：' + x + '。先用 read 看一下 id。）' }
    }
    const res = linkEvents.link(dir, { from: a.id, to: b.id, reason: why })
    return { ok: true, from: a.id, to: b.id, noop: res.noop, ...(res.row ? { at: res.row.at } : {}) }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 封存 / 解封：她不想再被这件事主动提醒了，或者又愿意了
// 不删除任何东西；重复同一个动作不写第二条
// backend='sqlite' 时事件进库（dualWrite 默认还写 JSONL，两边是同一行）；重复动作照样是 noop
export function setSealed(dir, { id, sealed = true, note = '' } = {}, opts = {}) {
  if (!String(id || '').trim()) return { ok: false, error: 'Missing id（需要 id）' }
  try {
    const target = writeTarget(opts)
    const hit = target.backend === 'sqlite' ? resolveIdInStore(dir, String(id)) : resolveId(dir, String(id))
    if (hit.ambiguous) return { ok: false, error: 'This legacy id is shared by several old experiences: ' + id + '. Use the current id listed by `read`.（这个旧 id 有好几条旧经历共用：' + id + '。用 read 里列出的当前 id。）' }
    if (!hit.id) return { ok: false, error: 'Experience not found: ' + id + '. Run `read` to check the id.（找不到这条经历：' + id + '。先用 read 看一下 id。）' }
    const action = sealed ? 'seal' : 'unseal'
    const safeNote = tooLong('note', note, 200)
    if (target.backend === 'file') {
      const decided = sealEvents.decide(dir, { id: hit.id, action, note: safeNote })
      return { ok: true, id: hit.id, sealed: Boolean(sealed), at: decided.row ? decided.row.at : '', noop: decided.noop }
    }
    // sqlite：先看库里最后一次动作，重复就是 noop——和文件后端同一条判据（有坏行时不合并，按她的请求追加）
    const last = readFromStore(dir, (db) => lastSealOfStore(db, hit.id))
    const sealedNow = last.action === 'seal'
    if (!last.bad && ((action === 'seal' && sealedNow) || (action === 'unseal' && !sealedNow))) {
      return { ok: true, id: hit.id, sealed: Boolean(sealed), at: last.at, noop: true }
    }
    const row = sealEvents.buildRow({ id: hit.id, action, note: safeNote })
    appendToStore(dir, { events: [{ kind: 'seal', row }], fileWrite: target.dualWrite ? () => sealEvents.appendRow(dir, row) : null })
    return { ok: true, id: hit.id, sealed: Boolean(sealed), at: row.at, noop: false }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 挂在 0.10.0 之前的旧 id 上、但这个 id 有几条旧记录共用：事件原样保留，只报告，不替她挑
export function pendingLegacyEvents(dir) {
  const { owners, explicit } = identify(dir)
  let counts = new Map()
  let laterMap = new Map()
  try { counts = recallEvents.countByExp(dir) } catch { }
  try { laterMap = laterEvents.groupByExp(dir) } catch { }
  const out = []
  for (const [id, candidates] of owners) {
    if (candidates.length < 2 || explicit.has(id)) continue
    const later = (laterMap.get(id) || []).length
    const recalls = counts.get(id) ? counts.get(id).count : 0
    if (later || recalls) out.push({ id, candidates, later, recalls })
  }
  return out
}

// 把调用方给的 id 落到一条现存经历上：认当前 id，也认唯一对应的旧 id
// 旧 id 被几条旧经历共用时不落到任何一条上，返回 ambiguous 让调用方说清楚
function resolveId(dir, id) {
  const { rows, owners } = identify(dir)
  const hit = rows.find((r) => r.id === id) || rows.find((r) => r.formerId === id)
  if (hit) return { id: hit.id }
  return { id: '', ambiguous: (owners.get(id) || []).length > 1 }
}

// 出处的清单：逗号分隔的字符串或数组都收，去重前先校验条数上限
function refList(refs) {
  const list = (Array.isArray(refs) ? refs : String(refs || '').split(/[,，\s]+/)).map((s) => String(s || '').trim()).filter(Boolean)
  if (list.length > LIMITS.refs) throw new Error(`refs allows at most ${LIMITS.refs} entries; got ${list.length}. Pick the most important ones.（出处最多 ${LIMITS.refs} 条，现在是 ${list.length} 条。挑最主要的几件写。）`)
  return list
}

// 出处：回想只能引用已经写下的经历。找不到、或旧 id 有歧义，就整条不写，并说清是哪一个
function resolveRefs(dir, refs) {
  const list = refList(refs)
  if (!list.length) return []
  const { rows, owners } = identify(dir)
  const out = []
  for (const x of list) {
    const hit = rows.find((r) => r.id === x) || rows.find((r) => r.formerId === x)
    if (!hit && (owners.get(x) || []).length > 1) throw new Error('A legacy id in refs is shared by several experiences: ' + x + '. Use the current id listed by `read`.（出处里的旧 id 有几条经历共用：' + x + '。用 read 里列出的当前 id。）')
    if (!hit) throw new Error('refs points to an experience that does not exist: ' + x + '. A look-back can only cite experiences already written.（出处里有找不到的经历：' + x + '。回想只能引用已经写下的经历。）')
    if (!out.includes(hit.id)) out.push(hit.id)
  }
  return out
}

// 同上，但从库里认（写路径切 sqlite、或 JSONL 不双写时，文件里可能没有这条）
function resolveRefsFromStore(dir, refs) {
  const list = refList(refs)
  if (!list.length) return []
  return readFromStore(dir, (db) => {
    const owners = legacyOwnersOfStore(db)
    const out = []
    for (const x of list) {
      if (recordOfStore(db, x)) {
        if (!out.includes(x)) out.push(x)
        continue
      }
      const candidates = owners.get(x) || []
      if (candidates.length > 1) throw new Error('A legacy id in refs is shared by several experiences: ' + x + '. Use the current id listed by `read`.（出处里的旧 id 有几条经历共用：' + x + '。用 read 里列出的当前 id。）')
      if (!candidates.length) throw new Error('refs points to an experience that does not exist: ' + x + '. A look-back can only cite experiences already written.（出处里有找不到的经历：' + x + '。回想只能引用已经写下的经历。）')
      if (!out.includes(candidates[0])) out.push(candidates[0])
    }
    return out
  })
}

// 把调用方给的 id 落到库里一条现存经历上（与 resolveId 同一套口径：认当前 id，也认唯一对应的旧 id）
function resolveIdInStore(dir, id) {
  return readFromStore(dir, (db) => {
    if (recordOfStore(db, id)) return { id }
    const candidates = legacyOwnersOfStore(db).get(id) || []
    if (candidates.length > 1) return { id: '', ambiguous: true }
    if (candidates.length === 1) return { id: candidates[0] }
    return { id: '' }
  })
}

// 写下时的"当时"：她写的 + 系统能自动带的状态（情绪/时间/场合）
// refs：这条是从哪几件事想到的（回想、归纳时用）。写入时就校验，引用不存在的经历直接拒绝
export function addExperience(dir, input = {}, opts = {}) {
  // 指标：写入延迟（含 refs 的存在性校验，那是这条路径真实的一部分）
  const t0 = process.hrtime.bigint()
  const target = writeTarget(opts)
  const row = target.backend === 'sqlite' ? addExperienceToStore(dir, input, target) : addExperienceInner(dir, input)
  metrics.recordWrite({ ms: Number(process.hrtime.bigint() - t0) / 1e6 })
  return row
}

// file 后端（默认）：一个字都没改，还是"造好行 → 追加进 JSONL"
function addExperienceInner(dir, input) {
  const row = buildExperienceRow(dir, input, 'file')
  appendRecordLine(dir, row)
  return row
}

// sqlite 后端：记录进库（事务里），双写时同一行也追进 JSONL。
// 默认双写：JSONL 是"无论如何都留着"的那一份，库随时能从它重建。
function addExperienceToStore(dir, input, { dualWrite }) {
  const row = buildExperienceRow(dir, input, 'sqlite')
  appendToStore(dir, { record: row, fileWrite: dualWrite ? () => appendRecordLine(dir, row) : null })
  return row
}

function buildExperienceRow(dir, { text, scene = '', feeling = [], thought = '', unfinished = '', quote = null, weight = 'normal', kind = '其它', state = null, source = 'own-time', refs = [] }, backend = 'file') {
  if (!String(text || '').trim()) throw new Error('text cannot be empty.（text 不能是空的。）')
  const safeText = tooLong('text', text, LIMITS.text)
  const safeScene = tooLong('scene', scene, LIMITS.scene)
  const safeThought = tooLong('thought', thought, LIMITS.thought)
  const safeUnfinished = tooLong('unfinished', unfinished, LIMITS.unfinished)
  const safeKind = tooLong('kind', kind || '其它', LIMITS.kind)
  // 和 revise 同一套：逗号分隔的字符串或数组都收、去重；写入时不限单个词的长度（旧宿主可能写过短句）
  const feelings = feelingList(feeling, { name: 'feeling' })
  const refIds = backend === 'sqlite' ? resolveRefsFromStore(dir, refs) : resolveRefs(dir, refs)

  const now = new Date()
  const id = 'exp_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6)
  const row = {
    id,
    at: now.toISOString(),
    day: now.toLocaleDateString('sv-SE'),
    author: 'self',
    source,
    kind: safeKind,
    weight: WEIGHTS.has(weight) ? weight : 'normal',
    then: {
      text: safeText,
      scene: safeScene,
      feeling: feelings,
      thought: safeThought,
      unfinished: safeUnfinished,
      quote: quote && quote.text ? { text: tooLong('quote', quote.text, 500), source: tooLong('quote.source', quote.source || '', 120) } : null,
      state: state && typeof state === 'object' ? { at: now.toISOString(), ...state } : { at: now.toISOString() }
    },
    later: [],
    status: 'kept'
  }
  if (refIds.length) row.then.refs = refIds
  return row
}

// 追加一条经历（只追加；必要时补换行）。原来的写入逻辑原样搬出来，file 与 sqlite 双写共用这一份
function appendRecordLine(dir, row) {
  fs.mkdirSync(dir, { recursive: true })
  const fd = fs.openSync(path.join(dir, FILE), 'a+')
  try {
    const size = fs.fstatSync(fd).size
    const lastByte = Buffer.alloc(1)
    if (size) fs.readSync(fd, lastByte, 0, 1, size - 1)
    const separator = size && lastByte[0] !== 10 ? '\n' : ''
    fs.writeFileSync(fd, separator + JSON.stringify(row) + '\n', 'utf8')
  } finally {
    fs.closeSync(fd)
  }
  return row
}

// 改主意 / 回头想：只追加一条 later 事件，不重写经历文件
// 先确认这条经历真的在：id 抄错时明说找不到，不留一条谁也看不见的后记
// feeling：她现在再想起这件事的感觉。当时的感觉留在 then.feeling 里不动；系统从不替她"淡化"
// backend='sqlite' 时事件进库（dualWrite 默认还写 JSONL，两边是同一行）
export function reviseExperience(dir, { id, thought, reason = '', feeling = [] }, opts = {}) {
  if (!String(id || '').trim()) return { ok: false, error: 'Missing id（需要 id）' }
  if (!String(thought || '').trim()) return { ok: false, error: 'thought cannot be empty.（thought 不能是空的。）' }
  try {
    const safeThought = tooLong('thought', thought, LIMITS.laterThought)
    const safeReason = tooLong('reason', reason, LIMITS.laterReason)
    const feelings = feelingList(feeling, { name: 'feeling', perWord: true })
    const target = writeTarget(opts)
    const hit = target.backend === 'sqlite' ? resolveIdInStore(dir, String(id)) : resolveId(dir, String(id))
    if (hit.ambiguous) return { ok: false, error: 'This legacy id is shared by several old experiences: ' + id + '. Use the current id listed by `read` to revise it.（这个旧 id 有好几条旧经历共用：' + id + '。用 read 里列出的当前 id 来改。）' }
    if (!hit.id) return { ok: false, error: 'Experience not found: ' + id + '. Run `read` or `recall` to check the id.（找不到这条经历：' + id + '。先用 read 或 recall 看一下 id。）' }
    if (target.backend === 'file') {
      const row = laterEvents.append(dir, { id: hit.id, thought: safeThought, reason: safeReason, feeling: feelings })
      return { ok: true, id: row.id, at: row.at, ...(feelings.length ? { feeling: feelings } : {}) }
    }
    const row = laterEvents.buildRow({ id: hit.id, thought: safeThought, reason: safeReason, feeling: feelings })
    appendToStore(dir, { events: [{ kind: 'later', row }], fileWrite: target.dualWrite ? () => laterEvents.appendRow(dir, row) : null })
    return { ok: true, id: row.id, at: row.at, ...(feelings.length ? { feeling: feelings } : {}) }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 「这件没弄完的事」后来怎么样了：done / shelved / reopen
// 只追加一条状态事件；不改 then.unfinished，也不写成后记
// 重复同一个选择不写第二条；没关过的事 reopen 是空操作
export function setUnfinishedState(dir, { id, choice, note = '' } = {}) {
  if (!String(id || '').trim()) return { ok: false, error: 'Missing id（需要 id）' }
  if (!unfinishedEvents.CHOICES.has(choice)) return { ok: false, error: 'state must be done / shelved / reopen（state 只能是 done / shelved / reopen）' }
  try {
    const target = resolveId(dir, String(id))
    if (target.ambiguous) return { ok: false, error: 'This legacy id is shared by several old experiences: ' + id + '. Use the current id listed by `read`.（这个旧 id 有好几条旧经历共用：' + id + '。用 read 里列出的当前 id。）' }
    if (!target.id) return { ok: false, error: 'Experience not found: ' + id + '. Run `read` or `recall` to check the id.（找不到这条经历：' + id + '。先用 read 或 recall 看一下 id。）' }
    const row = rowsById(dir, target.id)
    if (!row || !row.then || !row.then.unfinished) return { ok: false, error: 'This experience has no "unfinished" part, so there is nothing to close.（这条经历没有「还没弄完」的内容，不需要结案。）' }

    // 重读、判断、追加都在同一把锁里：两个进程同时提交同一选择，只有一个会写
    const decided = unfinishedEvents.decide(dir, { id: target.id, choice, note: tooLong('note', note, 200) })
    if (decided.noop) return { ok: true, id: target.id, at: decided.row ? decided.row.at : '', choice, noop: true }
    return { ok: true, id: target.id, at: decided.row.at, choice, noop: false }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// 单条：loadAll 会合并事件，这里绕开全量合并，只给存在性/未完判断用
function rowsById(dir, id) {
  const rows = readAll(dir).rows.map(normalize).filter((r) => r && r.then && r.then.text)
  return rows.find((r) => r.id === id) || rows.find((r) => r.formerId === id) || null
}

// 想起时记一笔：往 recall-events 追加一条事件，不动经历正文
// 不做存在性检查：孤儿事件在 loadAll 合并时自然被忽略
// backend='sqlite' 时事件进库（dualWrite 默认还写 JSONL，两边是同一行）
export function markRecalled(dir, id, opts = {}) {
  if (!String(id || '').trim()) return false
  try {
    const target = writeTarget(opts)
    const query = (opts && opts.query) || ''
    if (target.backend === 'file') {
      recallEvents.append(dir, { id: String(id), query })
      return true
    }
    const row = recallEvents.buildRow({ id: String(id), query })
    appendToStore(dir, { events: [{ kind: 'recall', row }], fileWrite: target.dualWrite ? () => recallEvents.appendRow(dir, row) : null })
    return true
  } catch { return false }
}

// asOf：看那天的这一条（那之后的后记、选择、想起都不算）；那天还没写下就返回 null
export function currentView(dir, id, { asOf = null, backend = 'file' } = {}) {
  const rows = loadAll(dir, { asOf, backend })
  return rows.find((r) => r.id === id) || rows.find((r) => r.formerId === id) || null
}

// 相关度 × 重要度：重要的先被想起
// 阈值比较的是「原始重叠数」，重要度只影响排序，不影响过线门槛；门槛口径见 query-match.js
// mode='strict'（默认）：至少对上一个词，并且查询的意思至少 70% 被接住，宁可不召回也不硬凑
// mode='loose'：比 strict 松，但最低比例还在（长查询仍要够一定比例的词命中），
//               适合"想起来就该出现在眼前"的日常召回，宿主自行承担误召
// mark=false（默认）：只读；mark=true 追加一条 recall 事件（不重写经历文件）
// asOf：在那天的自己里找（只读）；翻旧日子不算"想起"，所以不能和 mark 一起用
// 她封存了的经历不会被召回；includeSealed=true 只给"她自己要翻"这种明确场景用
// gate：strict 下用哪套门槛。'cover'（默认，0.17 起）= 至少对上一个词 + 意思至少 70% 被接住；
//       'legacy' = 0.16 及以前的口径（长查询要 60% 的两字词对上），排序也照旧。宿主想保持旧行为时用
// backend：读哪个容器（默认 file，见 loadAll）；写路径（mark=true）同样认这个参数，
// dualWrite=false 时只写库、不碰 JSONL（S4 起）；两边是同一行，读出来一样
// ranker：'literal'（默认，0.23.0 及以前的行为一个字都没改）或 'hybrid'（BM25 + 字符 n-gram + 小同义词表，
//         见 hybrid-recall.js）。实验性：指标没显著提升就不切默认，默认仍是字面检索。
// context：上一轮查询（字符串或数组）。宿主做多轮追问时把上下文一起递进来；字面检索把它拼到查询前面，
//         混合检索只用它排序（追问句本身几乎没有内容词时才用它补足门禁）。不传就是单轮，行为不变。
// ranker='embed' 时 mode / gate / minOverlap / minRatio 都不参与（它有自己的覆盖率门槛，见 embed-recall.js）；
// embed：向量函数注入（text → Float64Array）。不给就是确定性桩，每条命中带 embedKind='stub:char-ngram-hash'；
// 给了真模型时必须同时给 embedKind（模型名），否则会用桩的标签——宁可标签错，不许把桩说成语义。
// 空查询在 hybrid / embed 下返回空（字面检索的旧行为不变）。ranker 传 null / undefined 都按 literal 处理。
// graphExpand：图扩展（1 跳），默认 false —— 不传时结果与以前逐条相同。
//   打开后只在 limit 还有空位时补邻居（then.refs / link-events / 同一章节），补进来的
//   一律排在基础命中之后，不许插到已有命中前面；每条带 via，说明"因为哪几条才想到它"。
//   封存与 asOf 同样生效；补进来的不算"想起"，mark=true 也只给基础命中记一笔。
>>>>>>> feat/s10-graphexpand
export function recall(dir, query, opts = {}) {
  // 指标：召回延迟、返回条数、后端类型。只记成功返回的那次——抛错由调用方和 doctor 说
  const t0 = process.hrtime.bigint()
  const hits = recallInner(dir, query, opts)
  metrics.recordRecall({ ms: Number(process.hrtime.bigint() - t0) / 1e6, hits: hits.length, backend: backendName(opts && opts.backend) })
  return hits
}

function recallInner(dir, query, { limit = 3, minOverlap = 1, mark = false, minRatio = 0.6, mode = 'strict', asOf = null, includeSealed = false, gate = 'cover', backend = 'file', ranker = 'literal', context = null, embed = null, embedKind = null, dualWrite = true, graphExpand = false } = {}) {
  if (mark && asOf !== null && asOf !== undefined && asOf !== '') throw new Error('Looking back at an earlier day does not record a recall: mark and asOf cannot be used together.（翻回旧日子时不记「想起」：mark 和 asOf 不能一起用。）')
  if (ranker !== 'literal' && ranker !== 'hybrid' && ranker !== 'embed') {
    if (ranker === null || ranker === undefined) ranker = 'literal'
    else throw new Error('ranker must be "literal", "hybrid" or "embed"（ranker 只能是 literal / hybrid / embed）')
  }
  const rows = loadAll(dir, { asOf, backend }).filter((r) => includeSealed || !r.sealed)
  const q0 = String(query || '')
  const ctxText = Array.isArray(context) ? context.filter(Boolean).join(' ') : String(context || '')

  // 图扩展：只填基础命中剩下的名额。默认关时这一步整个不存在（返回的就是基础命中本身，
  // 连数组都不换），所以不传 graphExpand 的结果与以前逐条相同。
  // rows 已经按封存 / asOf / backend 过滤过，邻居不会绕开这些口径。
  const withExpand = (found) => {
    if (!graphExpand) return found
    const extra = expandHits({ rows, hits: found, limit, includeSealed })
    return extra.length ? found.concat(extra) : found
  }

  // 混合检索：放行门槛仍是防编造那套（覆盖率），BM25 只重排；mark 的行为和字面检索一致
  if (ranker === 'hybrid') {
    const found = hybridRank({ rows, query: q0, context: ctxText, limit })
    const hits = withExpand(found)
    if (!mark || !found.length) return hits
    const at = new Date().toISOString()
for (const r of found) {
      markRecalled(dir, r.id, { backend, dualWrite, query: q0 })
    }
    // 只有基础命中算"想起"：扩展补进来的她并没有被问起，记成想起会污染次数
    return found.map((r) => ({ ...r, recalls: Number(r.recalls || 0) + 1, lastRecalledAt: at })).concat(hits.slice(found.length))
  }

  // 语义检索（实验）：门禁与 hybrid 同口径，排序用向量；默认桩，不代表语义效果
  if (ranker === 'embed') {
// 真向量由调用方注入（见 tools/ollama-embed.mjs）；不注入就用确定性桩，命中里带 embedKind 标明是桩
    const found = embedRank({ rows, query: q0, context: ctxText, limit, ...(embed ? { embed } : {}), ...(embedKind ? { embedKind } : {}) })
    const hits = withExpand(found)
    if (!mark || !found.length) return hits
    const at = new Date().toISOString()
    for (const r of found) {
      markRecalled(dir, r.id, { backend, dualWrite, query: q0 })
    }
    return found.map((r) => ({ ...r, recalls: Number(r.recalls || 0) + 1, lastRecalledAt: at })).concat(hits.slice(found.length))
  }

  const q = ctxText ? ctxText + ' ' + q0 : q0
  const parsed = queryTerms(q)
  const { terms } = parsed
  const required = requiredOverlap(parsed, { mode, minOverlap, minRatio })
  const units = contentUnits(q)

  const measure = (r) => {
    const fields = []
    const matched = new Set()
    const take = (hits, label) => {
      if (!hits.size) return
      for (const g of hits) matched.add(g)
      if (!fields.includes(label)) fields.push(label)
    }
    // 最初写下的、原文锚、后来才明白的：都参与匹配；后记逐条看，记下是哪几条让它被想起
    take(matchedTerms(terms, r.then.text + ' ' + r.then.thought + ' ' + (r.then.feeling || []).join(' ')), 'then')
    if (r.then.quote) take(matchedTerms(terms, (r.then.quote.text || '') + ' ' + (r.then.quote.source || '')), 'quote')
    const matchedLater = []
    const laterText = (l) => String(l.thought || '') + ' ' + (Array.isArray(l.feeling) ? l.feeling.join(' ') : '')
    for (const l of r.later || []) {
      const hits = matchedTerms(terms, laterText(l))
      if (hits.size) matchedLater.push(l)
      take(hits, 'later')
    }

    // 记录自身的规模：长记录天然更容易碰巧命中，排序时按 √长度 归一化
    // cover 用原文拼起来的这段算（不要先归一化：拉丁词要按整词比，抹掉空格就成了一整个词）
    const fieldsText = [
      r.then.text, r.then.thought, (r.then.feeling || []).join(' '),
      r.then.quote ? r.then.quote.text : '', r.then.quote ? r.then.quote.source : '',
      (r.later || []).map(laterText).join(' ')
    ].join(' ')
    const size = Math.max(1, normalizeText(fieldsText).length - 1)
    return { n: matched.size, size, matchedIn: fields, matchedLater, cover: coverage(units, fieldsText) }
  }
  const weightOf = (r) => (r.weight === 'important' ? 3 : r.weight === 'minor' ? 0.5 : 1)
  const found = rows.map((r) => {
    const { n, size, matchedIn, matchedLater, cover } = measure(r)
    const legacy = gate === 'legacy'
    return { r: { ...r, matchedIn, matchedLater }, n, cover, s: (n / Math.sqrt(size)) * weightOf(r) * (legacy ? 1 : 0.5 + cover) }
  })
    // strict（0.17 起）：至少对上一个词，并且查询的意思至少 MIN_COVER 在这段记忆里找得到；
    // loose：要够 minOverlap 个词，并且长查询还要够最低比例（requiredOverlap 里算）
    .filter((x) => (!q ? true : mode === 'loose' || gate === 'legacy' ? x.n >= required : x.n >= minOverlap && x.cover >= MIN_COVER))
    .sort((a, b) => b.s - a.s || String(b.r.at).localeCompare(String(a.r.at)))
    .slice(0, limit).map((x) => x.r)
  const picked = withExpand(found)

  if (!mark || !found.length) return picked

  // 记完就地 +1，不回读全量；下一次读取自然会对上。
  // 只记基础命中：扩展补进来的不算"想起"（她没被问起，是顺着别的线索想到的）。
  const at = new Date().toISOString()
for (const r of found) {
    markRecalled(dir, r.id, { backend, dualWrite, query: q })
  }
  return found.map((r) => ({ ...r, recalls: Number(r.recalls || 0) + 1, lastRecalledAt: at })).concat(picked.slice(found.length))
}

const laterDay = (l) => l.day || String(l.at || '').slice(0, 10)
const sameLater = (a, b) => a === b || (a.at === b.at && a.thought === b.thought)

// 两段式的文字：zh（默认，原样不变）/ en。宿主按自己的用户选；鲸鲸的插件不传 lang，照旧是中文
const TEXT = {
  zh: {
    missing: (id) => '（' + id + '，找不到了）', sealedRef: '（一件你封存了的事）', ref: (x) => x.day + '「' + x.text + '」',
    then: '【当时】', time: '- 时间：', scene: '- 场景：', quote: '- 我读到的原文：', src: (s) => '（' + s + '）', text: '- 我写下的话：',
    refs: '- 是从这几件事想到的：', sep: '；', feelSep: '、', feeling: '- 当时的感觉：', thought: '- 当时的想法：', unfinished: '- 还没完的：',
    mood: '- 记录里的情绪：', legacy: '- （这条只留下感想，当时的原文没记）',
    asOfHead: (d) => '【那时（截至 ' + d + '）】', asOfNote: (d) => '- 这是截至 ' + d + ' 的样子；那之后写下的后记和选择不在这里',
    nowHead: '【现在】', nowTime: '- 现在时间：', locale: 'zh-CN',
    sealed: (s) => '- 这件事你' + (s.afterAsOf ? '后来' : '') + '封存了（' + s.day + '）：不会再被主动想起；它还在，想解封随时可以',
    recalls: (n, last) => '- 这条被你想起过 ' + n + ' 次' + (last ? '，上次是 ' + last : ''),
    hit: '- 这次想起它，是因为后来写过：', latest: '- 最近一次回头想：', laterOnly: '- 后来你想过：', day: (d) => '（' + d + '）',
    more: (all, rest) => '- （后来一共回头想过 ' + all + ' 次，这里没列出的 ' + rest + ' 次可以用 read 看）',
    felt: '- 后来再想起的感觉：', noLater: '- 还没有文字后记',
    citedBy: (n, list, more) => '- 后来有 ' + n + ' 条回想提到它：' + list + (more ? '；……' : ''),
    links: '- 你后来把它和这些事连在一起：', linkReason: (r, d) => '——' + r + '（' + d + '）',
    chapters: (names) => '- 你把那段日子叫做' + names.map((c) => '「' + c + '」').join('、'),
    done: (prev) => (prev === 'shelved' ? '放下过，后来想通了' : '后来想通了'),
    shelved: (prev) => (prev === 'done' ? '想通过一次，后来又决定先放下' : '先放下了，还没想通'),
    reopen: (prev) => (prev === 'done' ? '想通过一次，后来又决定接着想' : '放下过，后来又决定接着想'),
    unfinishedState: (u, p, d) => '- 当时没弄完的「' + u + '」：' + p + '（' + d + '）',
    end: '以上是那天留下的全部；没留下的，我不记得。'
  },
  en: {
    missing: (id) => '(' + id + ', can no longer be found)', sealedRef: '(something you sealed)', ref: (x) => x.day + ' "' + x.text + '"',
    then: '[Then]', time: '- When: ', scene: '- Scene: ', quote: '- What I read: ', src: (s) => ' (' + s + ')', text: '- What I wrote: ',
    refs: '- What made me think of it: ', sep: '; ', feelSep: ', ', feeling: '- How I felt then: ', thought: '- What I thought then: ', unfinished: '- Left unfinished: ',
    mood: '- Mood on record: ', legacy: '- (Only the reflection was kept; the original text was not recorded)',
    asOfHead: (d) => '[As of ' + d + ']', asOfNote: (d) => '- This is how it looked as of ' + d + '; later notes and choices are not shown',
    nowHead: '[Now]', nowTime: '- Current time: ', locale: 'en-CA',
    sealed: (s) => '- You ' + (s.afterAsOf ? 'later ' : '') + 'sealed this (' + s.day + '): it will not be brought up again; it still exists and can be unsealed any time',
    recalls: (n, last) => '- You have recalled this ' + n + ' time' + (n === 1 ? '' : 's') + (last ? ', last on ' + last : ''),
    hit: '- Recalled this time because of a later note: ', latest: '- Most recent look back: ', laterOnly: '- Later you thought: ', day: (d) => ' (' + d + ')',
    more: (all, rest) => '- (You looked back ' + all + ' times in all; the other ' + rest + ' are in `read`)',
    felt: '- How it felt when recalled later: ', noLater: '- No later notes yet',
    citedBy: (n, list, more) => '- Later, ' + n + ' look-back' + (n === 1 ? '' : 's') + ' mentioned it: ' + list + (more ? '; …' : ''),
    links: '- Later you linked it with: ', linkReason: (r, d) => ' — ' + r + ' (' + d + ')',
    chapters: (names) => '- You call that time ' + names.map((c) => '"' + c + '"').join(', '),
    done: (prev) => (prev === 'shelved' ? 'set aside once, then resolved' : 'resolved later'),
    shelved: (prev) => (prev === 'done' ? 'resolved once, then set aside again' : 'set aside, not resolved yet'),
    reopen: (prev) => (prev === 'done' ? 'resolved once, then picked up again' : 'set aside once, then picked up again'),
    unfinishedState: (u, p, d) => '- The unfinished "' + u + '": ' + p + ' (' + d + ')',
    end: 'That is everything left from that day; what was not written down, I do not remember.'
  }
}
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'zh']
const refLineIn = (L) => (x) => x.missing ? L.missing(x.id) : x.sealed ? L.sealedRef : L.ref(x)
const refLine = refLineIn(TEXT.zh)

// 「当时 / 现在」两段式：模板拼，不调模型；没有的字段就如实说没有
// 后记：这次是被哪条后记想起的，就把那条原样给她；再给最近的一条。各带各的日子，不截断
// 翻回那天（entry.viewAsOf）时，第二段是【那时】：只有那天之前的后记和选择
// lang：'zh'（默认）或 'en'。只换标签，她写下的内容原样不动
export function renderTwoPart(entry, { now = new Date(), lang = 'zh' } = {}) {
  if (!entry) return ''
  const L = textOf(lang)
  const ref = refLineIn(L)
  const t = entry.then
  const when = new Date(entry.at || entry.day)
  const hh = Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const lines = []
  lines.push(L.then)
  lines.push(L.time + (entry.day || '') + (hh ? ' ' + hh : ''))
  if (t.scene) lines.push(L.scene + t.scene)
  if (t.quote && t.quote.text) lines.push(L.quote + t.quote.text + (t.quote.source ? L.src(t.quote.source) : ''))
  lines.push(L.text + t.text)
  if (Array.isArray(entry.refsInfo) && entry.refsInfo.length) lines.push(L.refs + entry.refsInfo.map(ref).join(L.sep))
  if ((t.feeling || []).length) lines.push(L.feeling + t.feeling.join(L.feelSep))
  if (t.thought) lines.push(L.thought + t.thought)
  if (t.unfinished) lines.push(L.unfinished + t.unfinished)
  if (t.state && t.state.mood) lines.push(L.mood + t.state.mood)
  if (entry.legacy && !t.quote) lines.push(L.legacy)
  // 截在一天的最后一刻就只写日期；截在一天当中就写到分钟，免得让人以为整天都算进去了
  let asOfDay = ''
  if (entry.viewAsOf) {
    const d = new Date(entry.viewAsOf)
    const endOfDay = d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59 && d.getMilliseconds() === 999
    asOfDay = dayOf(d.getTime()) + (endOfDay ? '' : ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))
  }
  if (asOfDay) {
    lines.push('', L.asOfHead(asOfDay))
    lines.push(L.asOfNote(asOfDay))
  } else {
    lines.push('', L.nowHead)
    lines.push(L.nowTime + now.toLocaleString(L.locale, { hour12: false }))
  }
  if (entry.sealed) lines.push(L.sealed(entry.sealed))
  lines.push(L.recalls(Number(entry.recalls || 0), entry.lastRecalledAt ? String(entry.lastRecalledAt).slice(0, 10) : ''))
  const later = Array.isArray(entry.later) ? entry.later : []
  if (later.length) {
    const last = later[later.length - 1]
    const hits = (entry.matchedLater || []).filter((l) => !sameLater(l, last))
    for (const l of hits) lines.push(L.hit + String(l.thought || '') + L.day(laterDay(l)))
    lines.push((hits.length ? L.latest : L.laterOnly) + String(last.thought || '') + L.day(laterDay(last)))
    const shown = hits.length + 1
    if (later.length > shown) lines.push(L.more(later.length, later.length - shown))
    // 后来再想起时的感觉：取最近一条写了感觉的后记；她没写，就不替她说
    const felt = [...later].reverse().find((l) => Array.isArray(l.feeling) && l.feeling.length)
    if (felt) lines.push(L.felt + felt.feeling.join(L.feelSep) + L.day(laterDay(felt)))
  } else {
    lines.push(L.noLater)
  }
  if (Array.isArray(entry.citedBy) && entry.citedBy.length) {
    const shownRefs = entry.citedBy.slice(-3)
    lines.push(L.citedBy(entry.citedBy.length, shownRefs.map(ref).join(L.sep), entry.citedBy.length > shownRefs.length))
  }
  // 事后联想：另一头封存了的，连理由也不给（理由本身也会把那件事带回来）
  if (Array.isArray(entry.links) && entry.links.length) {
    lines.push(L.links + entry.links.map((l) => l.sealed ? ref(l) : ref(l) + L.linkReason(l.reason, l.linkDay)).join(L.sep))
  }
  if (Array.isArray(entry.chapters) && entry.chapters.length) {
    lines.push(L.chapters(entry.chapters.map((c) => c.name)))
  }
  const st = entry.unfinishedState
  if (st && t.unfinished) {
    const when2 = st.day || String(st.at || '').slice(0, 10)
    const history = st.history || []
    // 只看最近一次决定之前的那一次，不用 includes 猜
    const prev = history.length >= 2 ? history[history.length - 2] : ''
    const phrase = L[st.choice] ? L[st.choice](prev) : ''
    if (phrase) lines.push(L.unfinishedState(t.unfinished, phrase, when2))
  }
  lines.push('', L.end)
  return lines.join('\n')
}

// 给擦除（阶段 4）复用的内部口径：一行原样 → 她的一条经历（含旧格式的 id 推导）
export const internals = { WEIGHTS, FILE, normalize, legacyId }
// 兼容旧调用：只要一句摘要的地方仍可用
// 宿主拿用户的原话直接来召回、再自动塞进提示词：默认走 strict 的新口径（cover）。
// 旧口径（legacy）在同批用例上编造率 27.8%（见 docs/eval.md），自动递回不能默认用它；
// 确实要保持 0.16 行为的宿主显式传 gate: 'legacy'。
export function recallForContext(dir, query, { max = 1, gate = 'cover' } = {}) {
  return recall(dir, query, { limit: max, gate }).map((r) => ({ id: r.id, day: r.day, text: r.then.text, thought: r.then.thought, weight: r.weight, raw: r }))
}

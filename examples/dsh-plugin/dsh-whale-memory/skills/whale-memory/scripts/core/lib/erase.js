// 整条撤回（阶段 4）：把一条经历连同挂在它身上的事件从库里物理删掉，只留一块墓碑。
//
// 为什么允许删除、但不允许改：契约里"记录不可变"防的是**篡改历史**（把当时写的话换掉）。
// 整条撤回是另一件事：她（或 Leo）明确要求"这件事不要再留在库里"，那就整条拿掉；
// 拿掉之后留一行墓碑（id / 时间 / 原因 / 哈希），让"这条存在过、被撤回了"仍然可核。
//
// 守住的几条：
//   · 不改别的记录：没被撤回的行**一个字节都不动**（含它引用了被撤回那条的 then.refs——
//     那是她当时写下的原文，不许替她删改；读的时候那段引用会显示"找不到了"）。
//   · 先查后删：经历文件或要重写的事件文件里有坏行，**整次拒绝**——坏行说不清是不是那条，
//     不能假装删干净了。擦除不做"尽量"。
//   · 文件原子：读全量 → 过滤 → 写 .tmp → rename（见 file-lock.writeFileAtomic），
//     永远不会出现"写了一半"的经历文件。
//   · 幂等：第二次调用返回 { ok: true, alreadyGone: true }，不再写第二条墓碑。
//   · 只由宿主在"她本人或 Leo 明确要求"时调用；库不自动擦除，也没有定时清理。
//
// 做不到（文档里也写清）：备份与快照里的历史副本不追溯；SQLite 删除后文件页里可能残留旧字节
// （安全删除 / VACUUM 不在承诺里）；多写者不承诺（同一目录并发写按契约本来就是单写者假设）。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { withFileLock, writeFileAtomic } from './file-lock.js'
import { readLines } from './jsonl-stream.js'
import * as tombstones from './tombstones.js'
import * as audit from './audit.js'
import { internals as expInternals } from './self-experience.js'
import { eraseReadiness, eraseFromStore } from './sqlite-store.js'

const RECORDS = 'self-experience.jsonl'
// 挂在这条经历上的事件文件：撤回了就一起删。
// seal-events 不删：封存是"别再主动提起"的状态记录，不是正文；删了反而让"曾经封存过"这段历史断掉。
// chapter-events 不删：章节按日子命名一段时间，不指向某一条经历（见 link/chapter 的事件格式）。
const EVENT_FILES = ['later-events.jsonl', 'recall-events.jsonl', 'unfinished-events.jsonl', 'link-events.jsonl']
const LIMIT_REASON = 500

const coded = (message, code, extra = {}) => Object.assign(new Error(message), { code }, extra)

function readLinesOf(dir, name) {
  const file = path.join(dir, name)
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, lines: [], bad: 0 }
    throw coded('要擦除的文件读不出来（' + name + '）：' + String(error && error.message ? error.message : error), 'ERASE_UNREADABLE', { cause: error })
  }
  try {
    const lines = []
    let bad = 0
    for (const line of readLines(fd)) {
      if (!line.text.trim()) continue
      let row
      try { row = JSON.parse(line.text) } catch { row = undefined; bad += 1 }
      lines.push({ text: line.text, row })
    }
    return { exists: true, lines, bad }
  } finally {
    fs.closeSync(fd)
  }
}

// 一行算不算"她的一条经历"（口径与 self-experience.normalize 一致；这里用它的实现，不另抄一份）
function recordOf(row) {
  if (!row || typeof row !== 'object') return null
  const normalized = expInternals.normalize(row)
  return normalized && normalized.then && normalized.then.text ? normalized : null
}

// 事件行指向了哪些经历 id：联想是 from/to，其余三类是 id
function eventIdsOf(row) {
  if (!row || typeof row !== 'object') return []
  const out = []
  for (const key of ['id', 'from', 'to']) if (row[key] !== undefined && row[key] !== null) out.push(String(row[key]))
  return out
}

const hashOfLine = (text) => crypto.createHash('sha256').update(String(text).replace(/\r$/, ''), 'utf8').digest('hex')

// 把经历文件解析成一行一条，并按 identifyRaw 同一套规则认领旧 id。
// 返回 { infos, target, ambiguous }：target 是要删掉的**当前 id** 集合（含通过旧 id 认领到的）
function analyse(records, id) {
  const key = String(id)
  const infos = records.lines.map((line) => {
    const row = recordOf(line.row)
    return { line, row, rawFormerId: row && row.formerId ? String(row.formerId) : '' }
  })
  const owners = new Map()
  const explicit = new Set()
  for (const info of infos) {
    if (!info.row) continue
    if (!info.row.formerId) explicit.add(info.row.id)
    else {
      const list = owners.get(info.row.formerId)
      if (list) list.push(info.row.id)
      else owners.set(info.row.formerId, [info.row.id])
    }
  }
  // 同一个旧 id 被几条经历共用：不猜，报错让她用当前 id
  if ((owners.get(key) || []).length > 1 && !explicit.has(key)) {
    throw coded('这个旧 id 有好几条经历共用（' + key + '）：先用 read 看一下当前 id 再撤回。（legacy id is ambiguous）', 'ERASE_AMBIGUOUS_ID')
  }
  for (const info of infos) {
    if (info.row && info.row.formerId && (owners.get(info.row.formerId).length !== 1 || explicit.has(info.row.formerId))) info.row.formerId = ''
  }
  const target = new Set([key])
  for (const info of infos) {
    if (!info.row) continue
    if (info.row.formerId === key) target.add(String(info.row.id))
  }
  return { infos, target }
}

function rewriteIfChanged(dir, name, lines, keep) {
  const kept = []
  let removed = 0
  for (const line of lines) {
    if (keep(line)) kept.push(line.text)
    else removed += 1
  }
  if (!removed) return 0
  writeFileAtomic(path.join(dir, name), kept.length ? kept.join('\n') + '\n' : '')
  return removed
}

/**
 * 整条撤回一条经历。
 *
 * @param {string} dir 记忆目录
 * @param {{ id: string, reason: string, actor: string, now?: Date|string }} opts
 *   id：要撤回的经历 id（也收 0.10 之前那个唯一对应的旧 id）
 *   reason：为什么撤回（人写的短句，写进墓碑；不写正文）
 *   actor：谁要求的（self / leo / host……，写进墓碑与审计）
 * @returns {{ ok: true, id: string, alreadyGone: boolean, at: string, hash?: string, removed: object }}
 */
export function eraseExperience(dir, { id, reason = '', actor = '', now = new Date() } = {}) {
  const key = String(id || '').trim()
  if (!key) throw new Error('需要 id：说清要撤回哪一条经历。（missing id）')
  if (!String(reason || '').trim()) throw new Error('需要 reason：撤回是破坏性操作，必须说清为什么（会写进墓碑）。（missing reason）')
  if (String(reason).length > LIMIT_REASON) throw new Error('reason 太长（' + String(reason).length + '/' + LIMIT_REASON + ' 字）。（reason is too long）')
  if (!String(actor || '').trim()) throw new Error('需要 actor：说清是谁要求的（self / leo / host……）。（missing actor）')
  const actorText = String(actor).trim()
  const at = (now instanceof Date ? now : new Date(now)).toISOString()

  fs.mkdirSync(dir, { recursive: true })
  // 同一目录的撤回串行化；它跟事件文件各自的锁不是同一把，但擦除本身是单写者操作
  return withFileLock(path.join(dir, 'erase.lock'), () => {
    // 1) 账本先看一遍：墓碑文件坏了就不知道撤回没撤回，宁可不猜
    const marks = tombstones.readAll(dir)
    if (marks.bad > 0) throw coded('墓碑文件有 ' + marks.bad + ' 行无法解析：先修好再撤回，不然没法确认这条是不是已经撤回过。（tombstones are corrupt）', 'ERASE_TOMBSTONES_CORRUPT', { bad: marks.bad })
    const old = marks.rows.find((r) => r.id === key)
    if (old) return { ok: true, id: key, alreadyGone: true, at: old.at, reason: old.reason, actor: old.actor, hash: old.hash, removed: emptyRemoved() }

    // 2) 读全量 + 预检：坏行 / 读不出来都整次拒绝，一个字节都不改
    const records = readLinesOf(dir, RECORDS)
    if (records.bad > 0) throw coded('经历文件有 ' + records.bad + ' 行无法解析：撤回没法保证删干净，先修好或先备份。（records are corrupt）', 'ERASE_RECORDS_CORRUPT', { bad: records.bad })
    const events = EVENT_FILES.map((name) => ({ name, ...readLinesOf(dir, name) }))
    const badEvent = events.find((e) => e.bad > 0)
    if (badEvent) throw coded('事件文件 ' + badEvent.name + ' 有 ' + badEvent.bad + ' 行无法解析：撤回没法保证删干净，先修好再撤回。（events are corrupt）', 'ERASE_EVENTS_CORRUPT', { file: badEvent.name, bad: badEvent.bad })

    // 3) 目录里有 SQLite 副本：先确认它打不开/不全（那就整次拒绝，不许只删一半），
    //    顺便记下它跟 JSONL 对不对得上——决定删完要不要刷新 sources
    const store = eraseReadiness(dir)

    // 4) 认领要删的 id（含旧 id），并取出删除前那一行的哈希
    const analysed = analyse(records, key)
    const doomed = analysed.infos.filter((info) => info.row && analysed.target.has(String(info.row.id)))
    const removed = emptyRemoved()
    let hash = ''
    if (doomed.length) {
      hash = hashOfLine(doomed[0].line.text)
      if (doomed.length > 1) removed.duplicates = doomed.length - 1
    }

    // 5) 经历文件：过滤 → 原子替换（没命中就不碰文件）
    removed.records = rewriteIfChanged(dir, RECORDS, records.lines, (line) => {
      const row = recordOf(line.row)
      return !(row && analysed.target.has(String(row.id)))
    })

    // 6) 关联事件：later / recall / unfinished / link 一起清（seal 与 chapter 不动）
    const eventIds = new Set([key, ...analysed.target])
    for (const file of events) {
      removed[shortName(file.name)] = rewriteIfChanged(dir, file.name, file.lines, (line) => !eventIdsOf(line.row).some((x) => eventIds.has(x)))
    }

    // 7) SQLite 副本：记录 + 事件一起删（seal 留），删完按擦除前是否对得上决定刷不刷 sources
    const sq = eraseFromStore(dir, [key, ...analysed.target], { refreshSources: store.fresh })
    if (sq.present) { removed.sqliteRecords = sq.records; removed.sqliteEvents = sq.events }
    removed.sqlite = Boolean(sq.present)

    // 8) 什么都没找到：这次是"已经没了"（崩溃后重跑也走这里：顺手把残留事件清掉）
    if (!doomed.length) {
      if (!removed.records && !removed.later && !removed.recall && !removed.unfinished && !removed.link && !removed.sqliteRecords && !removed.sqliteEvents) {
        return { ok: true, id: key, alreadyGone: true, at: '', removed }
      }
      // 记录已经不在了、事件/库里的残留清掉了：不写墓碑（我们从没看见过那条记录，写不出它的哈希）
      return { ok: true, id: key, alreadyGone: true, at: '', removed }
    }

    // 9) 墓碑：删除成功之后才写（墓碑不会早于删除出现，谎报"已撤回"）
    try {
      tombstones.append(dir, { v: 1, id: key, at, reason: String(reason).trim(), actor: actorText, hash })
    } catch (error) {
      throw coded('记录已经删掉了，但墓碑写失败：' + String(error && error.message ? error.message : error) + '。请先把墓碑补上再对外说"撤回了"。（tombstone write failed after erase）', 'ERASE_TOMBSTONE_FAILED', { cause: error, erased: true })
    }

    // 10) 审计：只记 id 与动作，不记正文（reason 里有人的话，不往审计里抄）
    try {
      audit.record(dir, { actor: actorText, action: 'erase', ids: [key], note: 'tombstone' })
    } catch (error) {
      throw coded('记录与墓碑都在，但审计追加失败：' + String(error && error.message ? error.message : error) + '。（audit write failed after erase）', 'ERASE_AUDIT_FAILED', { cause: error, erased: true })
    }

    return { ok: true, id: key, alreadyGone: false, at, hash, actor: actorText, reason: String(reason).trim(), removed }
  })
}

function emptyRemoved() {
  return { records: 0, later: 0, recall: 0, unfinished: 0, link: 0, sqlite: false, sqliteRecords: 0, sqliteEvents: 0 }
}

const shortName = (file) => file.replace(/-events\.jsonl$/, '')

export const internals = { RECORDS, EVENT_FILES }
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
//     永远不会出现"写了一半"的经历文件；墓碑写下之前任何一步失败，改过的文件按原样放回去。
//   · 先删事件、再删经历：万一进程在中间被杀，记录还在，重跑还能把墓碑补出来。
//   · 幂等：第二次调用返回 { ok: true, alreadyGone: true, tombstone: true }，不再写第二条墓碑；
//     本来就没有这条记录时返回 alreadyGone + `tombstone: false`（宿主能分清"已撤回"和"id 抄错了"）。
//   · 只由宿主在"她本人或 Leo 明确要求"时调用；库不自动擦除，也没有定时清理。
//
// 做不到（文档里也写清）：备份与快照里的历史副本不追溯；SQLite 删除后文件页里可能残留旧字节
// （安全删除 / VACUUM 不在承诺里）；多写者不承诺（同一目录并发写按契约本来就是单写者假设）；
// seal 事件的 note 是人的自由文本，可能提到原话，不在本函数删除范围内。
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

// 改写一个文件（真正的删除动作）。写之前把原文记进 journal：任何一步失败都能原样放回去。
// 返回删掉的行数；一行都没删就不碰文件。
function rewriteTracked(dir, name, lines, keep, journal) {
  const kept = []
  let removed = 0
  for (const line of lines) {
    if (keep(line)) kept.push(line.text)
    else removed += 1
  }
  if (!removed) return 0
  const file = path.join(dir, name)
  let before = null
  try { before = fs.readFileSync(file, 'utf8') } catch { before = null }
  journal.push({ name, before })
  writeFileAtomic(file, kept.length ? kept.join('\n') + '\n' : '')
  return removed
}

// 把 journal 里已经改过的文件按原样放回去（倒序）。只在墓碑写成功之前用：
// 墓碑一旦写下就代表"撤回了"，再把记录放回去会变成"墓碑说有、文件里又有"。
function rollbackFiles(dir, journal) {
  const failures = []
  for (const item of [...journal].reverse()) {
    const file = path.join(dir, item.name)
    try {
      // 已经和原文一样（比如那次写入本来就失败了）就不用再动它：省得把"写不进去"误报成"回滚失败"
      const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
      if (now === item.before) continue
      if (item.before === null) fs.rmSync(file, { force: true })
      else writeFileAtomic(file, item.before)
    } catch (error) {
      failures.push(item.name + '：' + String(error && error.message ? error.message : error))
    }
  }
  return failures
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
    // 这条以前撤回过没有：有墓碑不代表"现在一定不在"——恢复旧备份会把记录带回来（复审抓到的：
    // 恢复之后再撤，返回已撤回却没删，正文还读得到）。所以先记下墓碑，真正判断放到读完记录之后。
    const oldMark = marks.rows.find((r) => r.id === key || (Array.isArray(r.ids) && r.ids.includes(key)))

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
    // 旧 id 上挂着的事件也要删：0.10 之前的后记/想起是挂在 12 位旧 id 上的，
    // 用当前 id 撤回时如果不带上它，后记正文会留在盘上（独立复审抓到的）。
    const formerIds = [...new Set(doomed.map((i) => (i.row && i.row.formerId ? String(i.row.formerId) : '')).filter(Boolean))]
    // 墓碑记下这一条用过的所有 id（当前 id / 旧 id）：按旧 id 撤回时，封存事件挂在当前 id 上，
    // 体检要靠 ids 把两边对上（复审抓到的：只记 key 会让 doctor 永远红灯）。
    // 共用旧 id：同一个旧 id 被两条以上经历用过，擦掉其中一条之后，剩下那条会"独占"这个旧 id，
  // 旧后记就可能被算到它头上。旧数据里没有区分手段，所以这里把这种情况记进墓碑，让 doctor 提示。
  const legacyCount = new Map()
  for (const info of analysed.infos) {
    if (!info.row || !info.rawFormerId) continue
    legacyCount.set(info.rawFormerId, (legacyCount.get(info.rawFormerId) || 0) + 1)
  }
  const ambiguousIds = [...new Set(doomed.map((i) => i.rawFormerId).filter(Boolean))]
    .filter((oldId) => (legacyCount.get(oldId) || 0) > 1)

  const tombIds = [...new Set([key, ...analysed.target, ...formerIds])]
    const eventIds = new Set(tombIds)

    const journal = []
    let tombstoned = false
    try {
      // 5) 先删事件、再删经历：万一进程在中间被杀，记录还在，重跑还能把墓碑补出来。
      //    每一步写之前都把原文记进 journal；任何一步失败就整体放回去（墓碑写下之前）。
      for (const file of events) {
        removed[shortName(file.name)] = rewriteTracked(dir, file.name, file.lines, (line) => !eventIdsOf(line.row).some((x) => eventIds.has(x)), journal)
      }
      removed.records = rewriteTracked(dir, RECORDS, records.lines, (line) => {
        const row = recordOf(line.row)
        return !(row && analysed.target.has(String(row.id)))
      }, journal)

      // 6) SQLite 副本：记录 + 事件一起删（seal 留），删完按擦除前是否对得上决定刷不刷 sources
      const sq = eraseFromStore(dir, tombIds, { refreshSources: store.fresh })
      if (sq.present) { removed.sqliteRecords = sq.records; removed.sqliteEvents = sq.events }
      removed.sqlite = Boolean(sq.present)

      // 7) 记录一条都没找到：这次是"已经没了"（崩溃后重跑也走这里：顺手把残留事件清掉）
      if (!doomed.length) {
      // 记录行已经没了、但这次确实清掉了残留事件（崩溃后重跑会走这里）：
      // 既然真的删了东西，就要在审计里留一条，否则事后查不到任何痕迹（验收抓到的）。
      const cleaned = Number(removed.records || 0) + Number(removed.sqliteRecords || 0) + Number(removed.sqliteEvents || 0) +
        EVENT_FILES.reduce((n, name) => n + Number(removed[shortName(name)] || 0), 0)
      let auditFailed = false
      if (cleaned > 0) {
        try { audit.record(dir, { actor: actorText, action: 'erase', ids: [key], note: 'already-gone-cleanup' }) } catch { auditFailed = true }
      }
      // 以前撤回过（有墓碑）：这次确实什么都没删，如实说"已撤回"
      return {
        ok: true, id: key, alreadyGone: true,
        at: oldMark ? oldMark.at : '', reason: oldMark ? oldMark.reason : '', actor: oldMark ? oldMark.actor : '',
        hash: oldMark ? oldMark.hash : undefined,
        tombstone: Boolean(oldMark), cleaned, auditFailed, removed
      }
    }

      // 8) 墓碑：删除成功之后才写（墓碑不会早于删除出现，谎报"已撤回"）
      //    ids 记下"这一条经历在库里用过的所有 id"（当前 id + 旧 id），体检核对封存事件时用
      //    已经撤回过、这次是恢复备份带回来的记录：不再写第二条墓碑（同一条只留一份），
      //    删完照旧算"已撤回"，审计里记一笔 erase-resurrected。
      if (!oldMark) {
        try {
          tombstones.append(dir, { v: 1, id: key, ids: tombIds, at, reason: String(reason).trim(), actor: actorText, hash, ...(ambiguousIds.length ? { ambiguousIds } : {}) })
        } catch (error) {
          throw coded('墓碑写失败：' + String(error && error.message ? error.message : error) + '。（tombstone write failed）', 'ERASE_TOMBSTONE_FAILED', { cause: error })
        }
      }
      tombstoned = true

      // 9) 审计：只记 id 与动作，不记正文（reason 里有人的话，不往审计里抄）
      try {
        audit.record(dir, { actor: actorText, action: 'erase', ids: [key], note: oldMark ? 'erase-resurrected' : 'tombstone' })
      } catch (error) {
        throw coded('记录与墓碑都在，但审计追加失败：' + String(error && error.message ? error.message : error) + '。（audit write failed after erase）', 'ERASE_AUDIT_FAILED', { cause: error, erased: true })
      }

      return { ok: true, id: key, alreadyGone: false, at, hash, tombstone: true, resurrected: Boolean(oldMark), actor: actorText, reason: String(reason).trim(), removed }
    } catch (error) {
      // 墓碑还没写下 = 这次撤回不算数：把改过的文件按原样放回去（SQLite 的事务自己回滚；
      // 万一删除已经在库里提交过，回滚后库会判为过期、读路径 fail closed，重新迁移即可）
      if (!tombstoned) {
        const failures = rollbackFiles(dir, journal)
        if (failures.length) {
          throw coded(String(error && error.message ? error.message : error) + '；回滚失败：' + failures.join('；') + '（文件可能只删了一半，先别对外说撤回了）。（rollback failed）', 'ERASE_ROLLBACK_FAILED', { cause: error, rollback: failures })
        }
        // 回滚干净了：宿主看到的应该是"这次没撤成"，而不是一个光秃秃的 EPERM
        throw coded('擦除没有完成（改过的文件已按原样放回）：' + String(error && error.message ? error.message : error) + '。（erase aborted, files rolled back）', (error && error.code) || 'ERASE_FAILED', { cause: error })
      }
      throw error
    }
  })
}

function emptyRemoved() {
  return { records: 0, later: 0, recall: 0, unfinished: 0, link: 0, sqlite: false, sqliteRecords: 0, sqliteEvents: 0 }
}

const shortName = (file) => file.replace(/-events\.jsonl$/, '')

export const internals = { RECORDS, EVENT_FILES }
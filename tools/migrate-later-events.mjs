#!/usr/bin/env node
// 把经历行里的 later 数组迁移成 later-events.jsonl 事件
// 默认 dry-run；--apply 才写盘。写前备份，写后做等价校验，不一致就回滚。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { writeManifest, rollback as rollbackFromBackup } from './lib/migration-backup.mjs'
import { withFileLock } from '../packages/core/lib/file-lock.js'
import { eventsFile } from '../packages/core/lib/later-events.js'
import { loadAll } from '../packages/core/lib/self-experience.js'

const EXPERIENCES = 'self-experience.jsonl'

function memDir(dataDir) {
  return path.join(dataDir, 'plugin-data', 'biomimetic-memory')
}

function readRows(dataDir) {
  const file = path.join(memDir(dataDir), EXPERIENCES)
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    // 只有"还没有经历文件"能当成空库；权限/磁盘错误必须停下来，不能报"成功、0 条"。
    if (error?.code === 'ENOENT') return { rows: [], file }
    throw new Error('经历文件读不出来：' + String(error?.message || error))
  }
  const rows = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { throw new Error('经历文件里有坏行，先修好再迁移。') }
  }
  return { rows, file }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)

export function plan({ dataDir }) {
  const { rows } = readRows(dataDir)
  const events = []
  const invalid = []
  const skipped = []
  for (const r of rows) {
    const list = Array.isArray(r.later) ? r.later : []
    if (!list.length) continue
    const id = String(r.id || '').trim()
    // 没有 id 的行不能迁移：事件必须能挂回某条经历，否则校验必然失败。
    // 在写盘之前就把它们挑出来，避免"写了一半再回滚"。
    if (!id) { invalid.push({ day: String(r.day || ''), laterCount: list.length }); continue }
    // 行内后记缺 at 时迁移会借用经历时间：asOf 会提前看到它。
    // 时间未知就整行保留在原文件里，行为不变。
    if (list.some((l) => l && l.thought && !l.at)) { skipped.push({ id, reason: '行内后记缺 at，保留原样' }); continue }
    for (const l of list) {
      if (!l || !l.thought) continue
      const event = {
        id,
        at: String(l.at || r.at || new Date().toISOString()),
        day: String(l.day || r.day || ''),
        thought: String(l.thought),
        reason: String(l.reason || '')
      }
      // feeling 是她后来再想起时的感觉；迁移必须原样带过去，不能丢。
      if (Array.isArray(l.feeling) && l.feeling.length) event.feeling = l.feeling.map(String)
      events.push(event)
    }
  }
  return { rows, events, invalid, skipped }
}

function sameFeeling(a, b) {
  const x = Array.isArray(a) ? a.map(String) : []
  const y = Array.isArray(b) ? b.map(String) : []
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export function migrate({ dataDir, apply = false, backupDir = '' }) {
  let rows, file, events, invalid, skipped
  try {
    ({ rows, file } = readRows(dataDir))
    ;({ events, invalid, skipped } = plan({ dataDir }))
  } catch (error) {
    // 读不了就明确失败：不能回退成"空库、成功迁移 0 条"。
    return { ok: false, error: String(error?.message || error) }
  }
  if (invalid.length) {
    return { ok: false, error: '有 ' + invalid.length + ' 条经历没有 id，不能迁移（先在经历里补 id 再跑）。', invalid, experiences: rows.length }
  }
  if (!apply) return { ok: true, dryRun: true, experiences: rows.length, eventsToCreate: events.length }
  if (!events.length) return { ok: true, dryRun: false, experiences: rows.length, eventsCreated: 0, skipped }

  const dir = memDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const bakDir = backupDir || path.join(dataDir, 'backups')
  fs.mkdirSync(bakDir, { recursive: true })
  const backup = path.join(bakDir, 'self-experience-pre-later-events-' + stamp() + '.jsonl')
  fs.copyFileSync(file, backup)

  const ev = eventsFile(dir)
  const eventsExisted = fs.existsSync(ev)
  const existing = eventsExisted ? fs.readFileSync(ev, 'utf8') : ''
  const eventsBackup = eventsExisted ? backup + '.events' : ''
  if (eventsExisted) fs.copyFileSync(ev, eventsBackup)
  writeManifest(backup, { eventsBackup })

  // 迁移回执：只有上一次迁移明确写过的副本才允许抵扣。
  // 没有回执时宁可留两条（来源不明的重复），也不能吞掉一条独立写下的后记。
  const receiptFile = path.join(dir, 'later-events-migration-receipt.json')
  const experiencesText = fs.readFileSync(file, 'utf8')
  const sourceHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const receiptBefore = fs.existsSync(receiptFile) ? fs.readFileSync(receiptFile, 'utf8') : null
  let receipt = { version: 1, events: [] }
  if (receiptBefore) {
    try {
      const parsed = JSON.parse(receiptBefore)
      if (parsed && Array.isArray(parsed.events)) receipt = parsed
    } catch { /* 回执坏了就当没有：只影响抵扣，不影响安全 */ }
  }

  // 每条事件的全字段签名：字段不同就是不同事件，自然日不同也不能合并。
  const sigOf = (e) => JSON.stringify({
    at: String(e.at || ''),
    day: String(e.day || ''),
    thought: String(e.thought || ''),
    reason: String(e.reason || ''),
    feeling: Array.isArray(e.feeling) ? e.feeling.map(String) : []
  })

  // 已有事件按"出现次数"抵扣：一条已有事件最多抵一条待迁移记录，
  // 两条相同的行内后记不能被同一条已有事件一起抵掉。
  const existingEvents = []
  for (const line of existing.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && r.id && r.thought) existingEvents.push(r)
    } catch { /* 已有坏行原样保留，不参与抵扣 */ }
  }
  // 旧后记可能挂在 formerId 上；读取时两条 id 会合并到同一条经历。
  // 抵扣与校验都按"当前 id"归并，否则合法旧 id 会被误判成缺一条。
  // 与读取端同一套规则：显式 id 优先；formerId 只有在不是任何一条的当前 id 时才作别名。
  const idSet = new Set(rows.map((r) => String(r.id || '')).filter(Boolean))
  const aliasSeen = new Map()
  const ambiguous = new Set()
  for (const r of rows) {
    const id = String(r.id || '')
    if (!id || !r.formerId) continue
    const alias = String(r.formerId)
    // 别名恰好是另一条的当前 id：读取端会把同一事件算给两条，归谁无法判定，写盘前拒绝。
    if (idSet.has(alias)) { ambiguous.add(alias); continue }
    if (aliasSeen.has(alias) && aliasSeen.get(alias) !== id) ambiguous.add(alias)
    else aliasSeen.set(alias, id)
  }
  if (ambiguous.size) {
    return { ok: false, error: 'formerId 指向多条经历，迁移前需人工确认：' + [...ambiguous].join(', '), ambiguous: [...ambiguous] }
  }
  const ownerKey = (id) => (idSet.has(String(id)) ? String(id) : (aliasSeen.get(String(id)) || String(id)))

  // 只有"文件里确实有这条 + 上次迁移回执也承认写过这条"才抵扣。
  const fileCounts = new Map()
  for (const e of existingEvents) {
    const k = ownerKey(e.id) + '|' + sigOf(e)
    fileCounts.set(k, (fileCounts.get(k) || 0) + 1)
  }
  const receiptValid = Boolean(receipt && receipt.sourceHash && receipt.sourceHash === sourceHash)
  const receiptCounts = new Map()
  for (const e of (receiptValid && Array.isArray(receipt.events) ? receipt.events : [])) {
    if (!e || !e.id) continue
    const k = ownerKey(e.id) + '|' + sigOf(e)
    receiptCounts.set(k, (receiptCounts.get(k) || 0) + 1)
  }
  const available = new Map()
  for (const [k, n] of fileCounts) {
    const r = receiptCounts.get(k) || 0
    if (r > 0) available.set(k, Math.min(n, r))
  }
  const fresh = []
  let matched = 0
  for (const e of events) {
    const k = ownerKey(e.id) + '|' + sigOf(e)
    const left = available.get(k) || 0
    if (left > 0) { available.set(k, left - 1); matched += 1; continue }
    fresh.push(e)
  }

  // 任何一步失败都把两份文件恢复原样，并核对回滚本身是否成功。
  // 事件文件"原本存在但为空"也要恢复成空文件，不能当成没有文件删掉。
  const restoreBoth = () => {
    const restored = { experiences: false, events: false, receipt: false }
    try { fs.copyFileSync(backup, file); restored.experiences = true } catch { /* 记在结果里 */ }
    try {
      if (eventsExisted) fs.copyFileSync(eventsBackup, ev)
      else fs.rmSync(ev, { force: true })
      restored.events = true
    } catch { /* 记在结果里 */ }
    try {
      if (receiptBefore === null) fs.rmSync(receiptFile, { force: true })
      else fs.writeFileSync(receiptFile, receiptBefore, 'utf8')
      restored.receipt = true
    } catch { /* 记在结果里 */ }
    return restored
  }

  // 迁移后的预期视图：已有事件 + 这次真正要写入的 fresh；同一时间戳时 fresh 在前。
  const viewAfter = new Map()
  const skippedIdsForView = new Set((skipped || []).map((s) => s.id))
  for (const r of rows) {
    const id = String(r.id || '')
    if (!id) continue
    const existingForId = existingEvents.filter((e) => ownerKey(e.id) === id)
    const freshForId = fresh.filter((e) => ownerKey(e.id) === id)
    const keptInline = skippedIdsForView.has(id)
      ? (Array.isArray(r.later) ? r.later.filter(Boolean).map((l) => ({
        at: String(l.at || r.at || ''),
        day: String(l.day || r.day || ''),
        thought: String(l.thought || ''),
        reason: String(l.reason || ''),
        feeling: l.feeling
      })) : [])
      : []
    const items = [
      ...keptInline.map((e) => ({ sig: sigOf(e), at: String(e.at || ''), kind: 0 })),
      ...freshForId.map((e) => ({ sig: sigOf(e), at: String(e.at || ''), kind: 0 })),
      ...existingForId.map((e) => ({ sig: sigOf(e), at: String(e.at || ''), kind: 1 }))
    ]
    items.sort((a, b) => (a.at === b.at ? a.kind - b.kind : a.at.localeCompare(b.at)))
    viewAfter.set(id, items.map((x) => x.sig))
  }
  try {
    return withFileLock(ev + '.lock', () => {
      const beforeWrite = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : ''
      if (beforeWrite !== existing) {
        const err = new Error('事件文件在迁移期间被改动（可能有并发写入），已停止')
        err.code = 'CONCURRENT_WRITE'
        throw err
      }

      if (fresh.length) {
        // 事件文件按时间插入，而不是整批追加：同一时间戳时，行内后记原本在事件之前，
        // 追加到末尾会把"现在怎么想"从后一条换成前一条。
        const items = []
        for (const line of existing.split('\n')) {
          if (!line.trim()) continue
          let at = ''
          try { const r = JSON.parse(line); if (r?.at) at = String(r.at) } catch { /* 坏行保留 */ }
          items.push({ line, at, kind: 1, seq: items.length })
        }
        fresh.forEach((e, i) => items.push({ line: JSON.stringify(e), at: String(e.at || ''), kind: 0, seq: i }))
        items.sort((a, b) => (a.at === b.at ? (a.kind - b.kind || a.seq - b.seq) : a.at.localeCompare(b.at)))
        const tmp = ev + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
        fs.writeFileSync(tmp, items.map((x) => x.line).join('\n') + '\n', 'utf8')
        fs.renameSync(tmp, ev)
      }

      // 去掉行内 later（缺 at 的行整行保留，行为不变）
      const skippedIds = new Set((skipped || []).map((s) => s.id))
      const nextRows = rows.map((r) => {
        if (skippedIds.has(String(r.id || ''))) return r
        const { later, ...rest } = r
        void later
        return rest
      })
      // 宿主追加经历时不持锁：写前复核快照，变了就停，不能用旧快照覆盖。
      if (fs.readFileSync(file, 'utf8') !== experiencesText) {
        const err = new Error('经历文件在迁移期间被追加/修改（可能有并发写入），已停止')
        err.code = 'CONCURRENT_WRITE'
        throw err
      }
      const tmp2 = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
      fs.writeFileSync(tmp2, nextRows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      fs.renameSync(tmp2, file)

      // 校验：按当前 id 比较完整字段、条数，以及**顺序**。
      const after = new Map()
      for (const r of loadAll(dir, { allowSealCorrupt: true })) {
        after.set(String(r.id), (r.later || []).map(sigOf))
      }
      const diffs = []
      for (const [id, want] of viewAfter) {
        const got = after.get(id) || []
        const n = Math.max(want.length, got.length)
        for (let i = 0; i < n; i += 1) {
          if (want[i] !== got[i]) diffs.push({ id, index: i + 1, field: 'poster' })
        }
      }
      if (diffs.length) {
        const err = new Error('校验不一致')
        err.missing = diffs
        throw err
      }

      // 回执最后写：只有真正落盘并校验通过后，才承认"这些副本是迁移写的"。
      if (fresh.length) {
        const nextReceipt = {
          version: 2,
          sourceHash,
          updatedAt: new Date().toISOString(),
          events: [
            ...(Array.isArray(receipt.events) ? receipt.events : []),
            ...fresh.map((e) => ({ id: String(e.id), ...JSON.parse(sigOf(e)) }))
          ]
        }
        fs.writeFileSync(receiptFile, JSON.stringify(nextReceipt) + '\n', 'utf8')
      }

      return { ok: true, dryRun: false, experiences: rows.length, eventsCreated: fresh.length, eventsMatched: matched, skipped, backup, eventsBackup }
    })
  } catch (error) {
    if (error && error.code === 'CONCURRENT_WRITE') {
      return { ok: false, error: String(error.message || error), concurrent: true, backup, eventsBackup }
    }
    const restored = restoreBoth()
    return {
      ok: false,
      error: '迁移中途失败（' + String(error?.code || error?.message || error) + '），已回滚两份文件：'
        + (restored.experiences ? '经历已恢复' : '经历恢复失败') + '；' + (restored.events ? '事件已恢复' : '事件恢复失败'),
      missing: error?.missing,
      restored,
      backup,
      eventsBackup
    }
  }
}

// 可以重复回滚：备份不删，当前事件文件只挪开不删（见 lib/migration-backup.mjs）
export function rollback({ dataDir, backup, eventsBackup = '' }) {
  const dir = memDir(dataDir)
  const out = rollbackFromBackup({ experiencesFile: path.join(dir, EXPERIENCES), eventsFile: eventsFile(dir), backup, eventsBackup })
  try { fs.rmSync(path.join(dir, 'later-events-migration-receipt.json'), { force: true }) } catch { /* 清不掉不影响回滚结果 */ }
  return out
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const arg = (name, fallback = '') => {
    const hit = process.argv.find((a) => a.startsWith('--' + name + '='))
    return hit ? hit.slice(name.length + 3) : fallback
  }
  const dataDir = path.resolve(arg('data', process.env.WHALE_DATA_DIR || process.cwd()))
  try {
    const out = migrate({ dataDir, apply: process.argv.includes('--apply'), backupDir: arg('backup-dir', '') })
    console.log(JSON.stringify(out, null, 2))
    process.exitCode = out.ok ? 0 : 1
  } catch (e) {
    console.error(String(e && e.message ? e.message : e))
    process.exitCode = 1
  }
}
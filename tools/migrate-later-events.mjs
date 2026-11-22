#!/usr/bin/env node
// 把经历行里的 later 数组迁移成 later-events.jsonl 事件
// 默认 dry-run；--apply 才写盘。写前备份，写后做等价校验，不一致就回滚。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeManifest, rollback as rollbackFromBackup } from './lib/migration-backup.mjs'
import { eventsFile } from '../packages/core/lib/later-events.js'
import { loadAll } from '../packages/core/lib/self-experience.js'

const EXPERIENCES = 'self-experience.jsonl'

function memDir(dataDir) {
  return path.join(dataDir, 'plugin-data', 'biomimetic-memory')
}

function readRows(dataDir) {
  const file = path.join(memDir(dataDir), EXPERIENCES)
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { rows: [], file } }
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
  for (const r of rows) {
    const list = Array.isArray(r.later) ? r.later : []
    if (!list.length) continue
    const id = String(r.id || '').trim()
    // 没有 id 的行不能迁移：事件必须能挂回某条经历，否则校验必然失败。
    // 在写盘之前就把它们挑出来，避免"写了一半再回滚"。
    if (!id) { invalid.push({ day: String(r.day || ''), laterCount: list.length }); continue }
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
  return { rows, events, invalid }
}

function sameFeeling(a, b) {
  const x = Array.isArray(a) ? a.map(String) : []
  const y = Array.isArray(b) ? b.map(String) : []
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export function migrate({ dataDir, apply = false, backupDir = '' }) {
  const { rows, file } = readRows(dataDir)
  const { events, invalid } = plan({ dataDir })
  if (invalid.length) {
    return { ok: false, error: '有 ' + invalid.length + ' 条经历没有 id，不能迁移（先在经历里补 id 再跑）。', invalid, experiences: rows.length }
  }
  if (!apply) return { ok: true, dryRun: true, experiences: rows.length, eventsToCreate: events.length }
  if (!events.length) return { ok: true, dryRun: false, experiences: rows.length, eventsCreated: 0 }

  const dir = memDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const bakDir = backupDir || path.join(dataDir, 'backups')
  fs.mkdirSync(bakDir, { recursive: true })
  const backup = path.join(bakDir, 'self-experience-pre-later-events-' + stamp() + '.jsonl')
  fs.copyFileSync(file, backup)

  const ev = eventsFile(dir)
  const existing = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : ''
  const eventsBackup = existing ? backup + '.events' : ''
  if (existing) fs.copyFileSync(ev, eventsBackup)
  writeManifest(backup, { eventsBackup })
  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  const tmp = ev + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  fs.writeFileSync(tmp, existing + prefix + events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  fs.renameSync(tmp, ev)

  // 去掉行内 later（保留其他字段原样）
  const nextRows = rows.map((r) => {
    const { later, ...rest } = r
    void later
    return rest
  })
  const tmp2 = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  fs.writeFileSync(tmp2, nextRows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  fs.renameSync(tmp2, file)

  // 等价校验：每条计划事件都要能在迁移后的视图里找到，且 at / thought / reason / feeling 都对得上
  const views = new Map(loadAll(dir).map((r) => [r.id, r]))
  const missing = []
  for (const e of events) {
    const row = views.get(e.id)
    const hit = row && (row.later || []).some((l) => String(l.at || '') === e.at
      && String(l.thought) === e.thought
      && String(l.reason || '') === String(e.reason || '')
      && sameFeeling(l.feeling, e.feeling))
    if (!hit) missing.push(e)
  }
  if (missing.length) {
    // 两份文件一起回滚：只恢复经历、留下事件就是重复后记的来源。
    fs.copyFileSync(backup, file)
    if (eventsBackup) fs.copyFileSync(eventsBackup, ev)
    else { try { fs.rmSync(ev, { force: true }) } catch { /* 删不掉就标明 */ } }
    return { ok: false, error: '校验不一致，已回滚经历与事件两份文件。', missing, backup }
  }

  return { ok: true, dryRun: false, experiences: rows.length, eventsCreated: events.length, backup, eventsBackup }
}

// 可以重复回滚：备份不删，当前事件文件只挪开不删（见 lib/migration-backup.mjs）
export function rollback({ dataDir, backup, eventsBackup = '' }) {
  const dir = memDir(dataDir)
  return rollbackFromBackup({ experiencesFile: path.join(dir, EXPERIENCES), eventsFile: eventsFile(dir), backup, eventsBackup })
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
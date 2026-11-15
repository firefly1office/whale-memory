#!/usr/bin/env node
// 把经历行里的 later 数组迁移成 later-events.jsonl 事件
// 默认 dry-run；--apply 才写盘。写前备份，写后做等价校验，不一致就回滚。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  for (const r of rows) {
    const list = Array.isArray(r.later) ? r.later : []
    for (const l of list) {
      if (!l || !l.thought) continue
      events.push({
        id: String(r.id || ''),
        at: String(l.at || r.at || new Date().toISOString()),
        day: String(l.day || r.day || ''),
        thought: String(l.thought),
        reason: String(l.reason || '')
      })
    }
  }
  return { rows, events }
}

export function migrate({ dataDir, apply = false, backupDir = '' }) {
  const { rows, file } = readRows(dataDir)
  const { events } = plan({ dataDir })
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

  // 等价校验：迁移后 loadAll 的 later 条数与内容，必须和计划一致
  const planned = new Map()
  for (const e of events) planned.set(e.id + '|' + e.at + '|' + e.thought, true)
  const views = new Map(loadAll(dir).map((r) => [r.id, r]))
  const missing = []
  for (const e of events) {
    const row = views.get(e.id)
    const hit = row && (row.later || []).some((l) => String(l.thought) === e.thought)
    if (!hit) missing.push(e)
  }
  if (missing.length) {
    fs.copyFileSync(backup, file)
    return { ok: false, error: '校验不一致，已回滚经历文件；事件文件保留，请人工检查。', missing, backup }
  }

  return { ok: true, dryRun: false, experiences: rows.length, eventsCreated: events.length, backup, eventsBackup }
}

export function rollback({ dataDir, backup, eventsBackup = '' }) {
  if (!backup || !fs.existsSync(backup)) throw new Error('找不到备份文件')
  fs.copyFileSync(backup, path.join(memDir(dataDir), EXPERIENCES))
  const ev = eventsFile(memDir(dataDir))
  const pre = eventsBackup || (backup + '.events')
  if (fs.existsSync(pre)) {
    // 迁移前就有事件：原样恢复，不能把迁移期间别人的修订一起删掉
    fs.copyFileSync(pre, ev)
    fs.rmSync(pre, { force: true })
  } else if (fs.existsSync(ev)) {
    fs.rmSync(ev)
  }
  return { ok: true }
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
#!/usr/bin/env node
// 把经历行里的 recalls / lastRecalledAt 迁移成 recall-events.jsonl 事件
// 默认 dry-run；--apply 才写盘。写之前先备份，写完做等价校验，不一致就中止。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventsFile, countByExp } from '../packages/core/lib/recall-events.js'

const EXPERIENCES = 'self-experience.jsonl'

function memDir(dataDir) {
  return path.join(dataDir, 'plugin-data', 'biomimetic-memory')
}

function readRows(dataDir) {
  const file = path.join(memDir(dataDir), EXPERIENCES)
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { rows: [], raw: '', file } }
  const rows = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { throw new Error('经历文件里有坏行，先修好再迁移。') }
  }
  return { rows, raw, file }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
}

function atomicWrite(file, body) {
  const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  fs.writeFileSync(tmp, body, 'utf8')
  fs.renameSync(tmp, file)
}

export function plan({ dataDir }) {
  const { rows } = readRows(dataDir)
  const existing = countByExp(memDir(dataDir))
  const events = []
  for (const r of rows) {
    const n = Number(r.recalls || 0)
    if (!Number.isFinite(n) || n <= 0) continue
    const at = String(r.lastRecalledAt || r.at || new Date().toISOString())
    for (let i = 0; i < n; i++) {
      events.push({ id: String(r.id || ''), at, query: '', chatKey: '', backfilled: true })
    }
  }
  const conflicts = [...existing.keys()].filter((id) => rows.some((r) => r.id === id && Number(r.recalls || 0) > 0))
  return { rows, events, conflicts, existingCounts: existing }
}

export function migrate({ dataDir, apply = false, force = false, backupDir = '' }) {
  if (!dataDir) throw new Error('需要 dataDir')
  const { rows, file } = readRows(dataDir)
  const { events, conflicts, existingCounts: existed } = plan({ dataDir })

  if (!apply) {
    return { ok: true, dryRun: true, experiences: rows.length, eventsToCreate: events.length, conflicts }
  }

  if (conflicts.length && !force) {
    return { ok: false, error: '事件文件里已经有这些 id 的想起记录，先确认是否重复；确认无误加 --force。', conflicts }
  }

  const dir = memDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const bakDir = backupDir || path.join(dataDir, 'backups')
  fs.mkdirSync(bakDir, { recursive: true })
  const backup = path.join(bakDir, 'self-experience-pre-recall-events-' + stamp() + '.jsonl')
  fs.copyFileSync(file, backup)

  // 1) 写事件文件（已存在则追加，保持只追加语义）
  const ev = eventsFile(memDir(dataDir))
  const existingRaw = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : ''
  const eventsBackup = existingRaw ? backup + '.events' : ''
  if (existingRaw) fs.copyFileSync(ev, eventsBackup)
  const prefix = existingRaw && !existingRaw.endsWith('\n') ? '\n' : ''
  atomicWrite(ev, existingRaw + prefix + events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''))

  // 2) 重写经历行：只去掉 recalls / lastRecalledAt，其他字段原样
  const nextRows = rows.map((r) => {
    const { recalls, lastRecalledAt, ...rest } = r
    void recalls
    void lastRecalledAt
    return rest
  })
  atomicWrite(file, nextRows.map((r) => JSON.stringify(r)).join('\n') + '\n')

  // 3) 等价校验：迁移后按事件算出来的次数 = 迁移前 + 迁移前已有的事件数
  const after = countByExp(memDir(dataDir))
  const problems = []
  for (const r of rows) {
    const before = Number(r.recalls || 0)
    if (!before) continue
    const preexisting = existed.get(String(r.id)) ? existed.get(String(r.id)).count : 0
    const got = after.get(r.id) ? after.get(r.id).count : 0
    if (got !== before + preexisting) problems.push({ id: r.id, before, preexisting, after: got })
  }
  if (problems.length) {
    fs.copyFileSync(backup, file)
    return { ok: false, error: '校验不一致，已回滚经历文件；事件文件保留，请人工检查。', problems, backup }
  }

  return { ok: true, dryRun: false, experiences: rows.length, eventsCreated: events.length, backup, eventsBackup }
}

export function rollback({ dataDir, backup, eventsBackup = '' }) {
  if (!backup || !fs.existsSync(backup)) throw new Error('找不到备份文件')
  fs.copyFileSync(backup, path.join(memDir(dataDir), EXPERIENCES))
  const ev = eventsFile(memDir(dataDir))
  const pre = eventsBackup || (backup + '.events')
  if (fs.existsSync(pre)) {
    // 迁移前就有事件：原样恢复，不能把迁移期间别人的「想起」一起删掉
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
  const apply = process.argv.includes('--apply')
  const force = process.argv.includes('--force')
  const backupDir = arg('backup-dir', '')
  try {
    const out = migrate({ dataDir, apply, force, backupDir })
    console.log(JSON.stringify(out, null, 2))
    process.exitCode = out.ok ? 0 : 1
  } catch (e) {
    console.error(String(e && e.message ? e.message : e))
    process.exitCode = 1
  }
}
// 记忆目录的打包与恢复：导出、校验、导入共用这一份。CLI 的 export/import、tools/backup.mjs、tools/restore-check.mjs 都走这里
// 导出包 = 记忆目录里每个文件的原样副本 + manifest.json（每个文件的大小与 SHA-256）
// 导入前先校验全部文件，坏一个就一个字节都不写；路径越界（正反斜杠、绝对路径、盘符、..）一律拒绝
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { loadAll } from './self-experience.js'
import { writeFileAtomic } from './file-lock.js'

export const FORMAT = 'whale-memory-export'
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// 导入日志：rename(旧目录→备份) 与 rename(暂存→新目录) 之间没有事务，进程被强杀/断电时
// target 会短暂不存在。动手改目录之前先把「target / backup / stage 各在哪」写到 target 旁边的
// <memDir>.import-journal.json（原子写 + fsync），下次 import/export 进来先按它恢复。
const IMPORT_JOURNAL_FORMAT = 'whale-memory-import-journal'
const IMPORT_JOURNAL_VERSION = 1

export function importJournalPath(memDir) {
  return path.resolve(String(memDir || '')) + '.import-journal.json'
}

function readImportJournal(target) {
  let row
  try { row = JSON.parse(fs.readFileSync(importJournalPath(target), 'utf8')) } catch { return null }
  if (!row || row.format !== IMPORT_JOURNAL_FORMAT) return null
  if (row.target && path.resolve(String(row.target)) !== target) return null
  return row
}

function writeImportJournal(target, details) {
  const journal = {
    format: IMPORT_JOURNAL_FORMAT,
    version: IMPORT_JOURNAL_VERSION,
    target,
    ...details,
    pid: process.pid,
    hostname: os.hostname(),
    updatedAt: new Date().toISOString()
  }
  writeFileAtomic(importJournalPath(target), JSON.stringify(journal, null, 2) + '\n')
  fsyncDir(path.dirname(target))
  return journal
}

// 日志的主人还活着：说明另一个进程正在导入（日志只在真正搬运目录前写，窗口很短），
// 这时候绝不能把它的备份/暂存当成断电残留清掉。
function journalOwnerAlive(journal) {
  const pid = Number(journal?.pid)
  const hostname = typeof journal?.hostname === 'string' ? journal.hostname : ''
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return false // 当前进程没有正在进行的 import，日志应是残留
  if (hostname && hostname !== os.hostname()) return false // 跨机无法校验 pid，按残留处理
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function removeImportJournal(target) {
  try { fs.rmSync(importJournalPath(target), { force: true }) } catch { }
  fsyncDir(path.dirname(target))
}

// 目录项落盘（POSIX 上才有意义；Windows 打开目录会失败，静默跳过）
function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  } catch { }
}

// 只认 target 旁边、名字符合导入产物的兄弟目录，避免被篡改的日志指向任意路径
function siblingArtifact(target, candidate, prefix) {
  if (typeof candidate !== 'string' || !candidate) return ''
  const resolved = path.resolve(candidate)
  if (path.dirname(resolved) !== path.dirname(target)) return ''
  if (!path.basename(resolved).startsWith(path.basename(target) + prefix)) return ''
  return resolved
}

function scanInterruptedSiblings(target) {
  const parent = path.dirname(target)
  const base = path.basename(target)
  let entries
  try { entries = fs.readdirSync(parent, { withFileTypes: true }) } catch { return { backups: [], stages: [] } }
  const pick = (suffix) => entries
    .filter((e) => e.isDirectory() && e.name.startsWith(base + suffix))
    .map((e) => path.join(parent, e.name))
    .sort()
  return { backups: pick('.pre-import-'), stages: pick('.import-stage-') }
}

function recoverResult(target, action, extra = {}) {
  return {
    recovered: false,
    action,
    target,
    journal: importJournalPath(target),
    backup: '',
    ...extra
  }
}

/**
 * 恢复被打断的导入。返回 { recovered, action, target, journal, backup }。
 * - 正常：no-journal / cleaned-journal，什么也不动。
 * - target 不见了、备份还在：把备份改回 target（回滚到导入前，数据不丢）。
 * - target 不见了、只有完整暂存目录：把暂存目录装回 target（空目录导入时）。
 * - 装好新目录但日志没来得及删：保留新目录与备份，只清日志。
 * 自动恢复失败时保留日志与产物（这就是“可恢复标识”），action 会指出卡在哪一步。
 */
export function recoverImport(memDir) {
  const target = path.resolve(String(memDir || ''))
  const journalFile = importJournalPath(target)
  const journalExists = fs.existsSync(journalFile)
  const journal = readImportJournal(target)
  const targetExists = fs.existsSync(target)

  if (!journal) {
    if (targetExists) {
      return recoverResult(target, journalExists ? 'journal-unreadable-target-intact' : 'no-journal')
    }
    // 日志丢了（老版本崩溃/被手工删掉）时按老命名兜底：备份与暂存同时存在才动手
    const siblings = scanInterruptedSiblings(target)
    if (siblings.backups.length && siblings.stages.length) {
      const backup = siblings.backups[siblings.backups.length - 1]
      try { fs.renameSync(backup, target) } catch (error) {
        return recoverResult(target, 'restore-failed', { backup, error: String(error?.message || error) })
      }
      for (const stage of siblings.stages) {
        try { fs.rmSync(stage, { recursive: true, force: true }) } catch { }
      }
      try { fs.rmSync(journalFile, { force: true }) } catch { }
      fsyncDir(path.dirname(target))
      return recoverResult(target, 'restored-backup-fallback', { recovered: true, backup })
    }
    return recoverResult(target, journalExists ? 'missing-target-and-artifacts' : 'no-journal')
  }

  const backup = siblingArtifact(target, journal.backup, '.pre-import-')
  const stage = siblingArtifact(target, journal.stage, '.import-stage-')
  if (journalOwnerAlive(journal)) return recoverResult(target, 'in-progress')
  const backupExists = Boolean(backup) && fs.existsSync(backup)
  const stageExists = Boolean(stage) && fs.existsSync(stage)

  if (!targetExists) {
    if (backupExists) {
      try { fs.renameSync(backup, target) } catch (error) {
        return recoverResult(target, 'restore-failed', { backup, error: String(error?.message || error) })
      }
      if (stageExists) {
        try { fs.rmSync(stage, { recursive: true, force: true }) } catch { }
      }
      try { fs.rmSync(journalFile, { force: true }) } catch { }
      fsyncDir(path.dirname(target))
      return recoverResult(target, 'restored-backup', { recovered: true, backup })
    }
    if (stageExists) {
      try { fs.renameSync(stage, target) } catch (error) {
        return recoverResult(target, 'restore-failed', { stage, error: String(error?.message || error) })
      }
      try { fs.rmSync(journalFile, { force: true }) } catch { }
      fsyncDir(path.dirname(target))
      return recoverResult(target, 'installed-stage', { recovered: true, backup: '' })
    }
    // 目录不见了、备份和暂存也都不在：保留日志，等人看
    return recoverResult(target, 'missing-target-and-artifacts', { backup })
  }

  // target 在：说明新目录已经装好（或还没开始搬），暂存目录只是没来得及清
  if (stageExists) {
    try { fs.rmSync(stage, { recursive: true, force: true }) } catch { }
  }
  try { fs.rmSync(journalFile, { force: true }) } catch { }
  fsyncDir(path.dirname(target))
  return recoverResult(target, stageExists ? 'kept-target' : 'kept-installed', {
    recovered: true,
    backup: backupExists ? backup : ''
  })
}

function recoveryNeedsAttention(recovery) {
  return recovery.action === 'restore-failed' || recovery.action === 'missing-target-and-artifacts'
}

function recoveryBusyError() {
  return new Error('Another import is still running on this memory directory; try again after it finishes.（另一个进程正在导入这个记忆目录，等它结束再试）')
}

function manualRecoveryError(recovery) {
  return new Error(
    'An earlier import was interrupted and could not be recovered automatically. Keep the journal and inspect the backup/stage directories: '
    + recovery.journal + '（上一次导入被打断，没能自动恢复。请保留这个日志文件并检查旁边的备份/暂存目录：' + recovery.journal + '）'
  )
}

// 导出的文件清单：跳过锁文件和临时文件，其余按相对路径收
export function collectFiles(root) {
  const out = []
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.endsWith('.lock') || e.name.includes('.tmp-')) continue
      const abs = path.join(dir, e.name)
      const next = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) { walk(abs, next); continue }
      if (e.isFile()) out.push({ name: next, abs })
    }
  }
  walk(root, '')
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function countLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length
  } catch { return 0 }
}

// a 是否等于 b 或在 b 里面（都按解析后的绝对路径比）
export function inside(a, b) {
  const relative = path.relative(physicalPath(b), physicalPath(a))
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
}

// Resolve existing parents too, so junctions and differently cased Windows paths
// cannot disguise overlapping source and destination directories.
function physicalPath(file) {
  const abs = path.resolve(file)
  try { return fs.realpathSync(abs) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = path.dirname(abs)
    if (parent === abs) throw error
    return path.join(physicalPath(parent), path.basename(abs))
  }
}

// 导出包里的相对路径：正反斜杠、绝对路径、盘符相对路径、任何 '..' 段都拒绝，
// 再用解析后的绝对路径确认确实落在 root 里面（不靠枚举写法）
export function safeJoin(root, name) {
  const n = String(name || '')
  if (!n || n.includes('\0')) throw new Error('Suspicious path in export: ' + JSON.stringify(name) + '（导出里有可疑路径：' + JSON.stringify(name) + '）')
  if (path.isAbsolute(n) || path.win32.isAbsolute(n) || /^[a-zA-Z]:/.test(n)) throw new Error('Absolute path in export: ' + n + '（导出里有绝对路径：' + n + '）')
  if (n.split(/[\\/]+/).includes('..')) throw new Error('Path in export escapes the export directory: ' + n + '（导出里有越界路径：' + n + '）')
  const rootAbs = path.resolve(root)
  const abs = path.resolve(rootAbs, n)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error('Path in export escapes the export directory: ' + n + '（导出里有越界路径：' + n + '）')
  return abs
}

// 打包：outDir 下新建 <name>/（默认 memory-export-<时间>），不能和记忆目录互相包含
export function exportArchive(memDir, outDir, { name = '' } = {}) {
  // 若上次导入正好崩在两次 rename 之间，先自动恢复，别对着一个不存在的目录导出
  const recovery = recoverImport(memDir)
  if (recovery.action === 'in-progress') throw recoveryBusyError()
  if (recoveryNeedsAttention(recovery)) throw manualRecoveryError(recovery)
  if (!fs.existsSync(memDir)) throw new Error('Memory directory not found: ' + memDir + '（没有找到记忆目录：' + memDir + '）')
  const target = path.resolve(outDir, name || 'memory-export-' + stamp())
  if (inside(target, memDir) || inside(memDir, target)) throw new Error('Export directory and memory directory must not be inside each other: ' + target + '（导出目录不能和记忆目录互相包含：' + target + '）')
  if (fs.existsSync(target)) throw new Error('Export directory already exists: ' + target + '（导出目录已存在：' + target + '）')

  const files = collectFiles(memDir)
  fs.mkdirSync(target, { recursive: true })
  const manifestFiles = []
  let bytes = 0
  for (const f of files) {
    const content = fs.readFileSync(f.abs)
    const dest = path.join(target, f.name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
    manifestFiles.push({ name: f.name, bytes: content.length, sha256: sha256(content) })
    bytes += content.length
  }
  const manifest = {
    format: FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    files: manifestFiles,
    counts: {
      experiences: loadAll(memDir, { allowSealCorrupt: true }).length,
      diaries: countLines(path.join(memDir, 'autobiography.jsonl')),
      laterEvents: countLines(path.join(memDir, 'later-events.jsonl')),
      recallEvents: countLines(path.join(memDir, 'recall-events.jsonl')),
      unfinishedEvents: countLines(path.join(memDir, 'unfinished-events.jsonl')),
      sealEvents: countLines(path.join(memDir, 'seal-events.jsonl')),
      linkEvents: countLines(path.join(memDir, 'link-events.jsonl')),
      chapterEvents: countLines(path.join(memDir, 'chapter-events.jsonl')),
      unsaidEvents: countLines(path.join(memDir, 'unsaid-events.jsonl'))
    }
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { ok: true, dir: target, files: manifestFiles.length, bytes, counts: manifest.counts }
}

// 校验导出包：manifest 读得出、格式对、每个文件都在且 SHA-256 一致；不对就抛错，说清是哪一个
export function verifyArchive(fromDir) {
  const src = path.resolve(fromDir)
  const manifestFile = path.join(src, 'manifest.json')
  if (!fs.existsSync(manifestFile)) throw new Error('Not a whale-memory export directory (manifest.json is missing): ' + src + '（不是 whale-memory 导出目录（缺 manifest.json）：' + src + '）')
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch {
    throw new Error('Cannot read manifest.json: ' + manifestFile + '（manifest.json 读不出来：' + manifestFile + '）')
  }
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.files)) {
    throw new Error('manifest.json is malformed: ' + manifestFile + '（manifest.json 格式不对：' + manifestFile + '）')
  }
  for (const f of manifest.files) {
    const n = String(f.name || '')
    const abs = safeJoin(src, n)
    if (!fs.existsSync(abs)) throw new Error('File missing from export: ' + n + '（导出缺少文件：' + n + '）')
    if (!inside(abs, src)) throw new Error('File link escapes export directory: ' + n + '（文件链接越出导出目录）')
    const buf = fs.readFileSync(abs)
    if (sha256(buf) !== f.sha256) throw new Error('Checksum mismatch: ' + n + '（文件校验不通过：' + n + '）')
    if (buf.length !== f.bytes) throw new Error('File size mismatch: ' + n + '（文件大小校验不通过）')
  }
  return manifest
}

// 恢复：先整包校验；目标已有数据时默认拒绝，force 会先把现有目录改名备份
//
// 崩溃窗口（2026-11 修）：rename(target→backup) 之后、rename(stage→target) 之前进程被强杀，
// 以前会只剩一个 pre-import-* 备份、记忆目录整个消失，只能人工认领。现在动手前先原子写
// <memDir>.import-journal.json（fsync），记录 target/backup/stage；同一函数入口以及
// exportArchive 入口都会先调 recoverImport：
// - 崩在两次 rename 之间：把备份改回 target，删除暂存目录，等这次 import 重新来；
// - 崩在装好之后、清日志之前：保留新目录与备份，只清日志；
// - 自动恢复失败时保留日志与产物，报错并指出日志路径（可恢复标识）。
export function importArchive(fromDir, memDir, { force = false } = {}) {
  const target = path.resolve(memDir)
  const recovery = recoverImport(target)
  if (recovery.action === 'in-progress') throw recoveryBusyError()
  if (recoveryNeedsAttention(recovery)) throw manualRecoveryError(recovery)
  const src = path.resolve(fromDir)
  if (inside(src, target) || inside(target, src)) throw new Error('Import source and target directories must not overlap（导入源与目标目录不能互相包含）')
  const manifest = verifyArchive(src)
  const exists = fs.existsSync(target) && fs.readdirSync(target).length > 0
  if (exists && !force) throw new Error('Target already has data: ' + memDir + '. To overwrite, add --force true (the existing data is backed up first).（目标已有数据：' + memDir + '。确认覆盖请加 --force true（会先备份））')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const stage = fs.mkdtempSync(target + '.import-stage-')
  let backup = exists && force ? target + '.pre-import-' + stamp() + '-' + crypto.randomUUID() : ''
  let backupMoved = false
  let installed = false
  let removedEmpty = false
  let keepArtifacts = false
  try {
    for (const f of manifest.files) {
      const source = safeJoin(src, f.name)
      if (!inside(source, src)) throw new Error('File link escapes export directory: ' + f.name)
      const dest = safeJoin(stage, f.name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(source, dest)
      const copied = fs.readFileSync(dest)
      if (copied.length !== f.bytes || sha256(copied) !== f.sha256) {
        throw new Error('Export changed during import: ' + f.name + '（导入期间备份内容发生变化）')
      }
    }
    const loaded = loadAll(stage, { allowSealCorrupt: true })

    // 动手改目录之前先落盘日志：从这一刻起任何崩溃都能自动找回旧数据
    writeImportJournal(target, { phase: 'prepared', backup, stage })
    if (exists && force) {
      fs.renameSync(target, backup)
      backupMoved = true
      fsyncDir(path.dirname(target))
      writeImportJournal(target, { phase: 'backup-moved', backup, stage })
    } else if (fs.existsSync(target)) {
      // rmdir only accepts an empty directory; concurrent new data is preserved.
      fs.rmdirSync(target)
      removedEmpty = true
      fsyncDir(path.dirname(target))
    }
    fs.renameSync(stage, target)
    installed = true
    fsyncDir(path.dirname(target))
    removeImportJournal(target)
    return {
      ok: true,
      files: manifest.files.length,
      restoreTo: memDir,
      backup,
      counts: { experiences: loaded.length },
      recovered: recovery.recovered,
      recoveredFrom: recovery.recovered ? recovery.action : ''
    }
  } catch (error) {
    // 只要还没装好新目录，就把旧目录滚回去。日志第二次写盘失败也走这里，
    // 不能因为“日志没写成功”就把已经移到备份里的旧目录留在外面。
    if (!installed && backupMoved) {
      try {
        fs.renameSync(backup, target)
        backupMoved = false
        fsyncDir(path.dirname(target))
      } catch (rollbackError) {
        // 回滚也失败：保留日志和暂存目录，下一次 recoverImport 还能把备份装回去
        keepArtifacts = true
        throw new Error(
          'Import failed and restoring the backup also failed. The import journal kept the recovery information: '
          + importJournalPath(target) + '（导入失败，备份也还原失败。恢复信息保留在日志里：' + importJournalPath(target) + '）'
          + ' [' + String(error?.message || error) + '; ' + String(rollbackError?.message || rollbackError) + ']'
        )
      }
    }
    if (!installed && removedEmpty) {
      // 目标原本是空目录（rmdir 已经删掉）。保留完整暂存目录和日志，下次 recoverImport 会装回去
      keepArtifacts = true
      throw new Error(
        'Import failed after removing the empty target directory; the staged copy was kept for automatic recovery: '
        + importJournalPath(target) + '（导入失败。完整暂存副本已保留，下次导入会自动恢复：' + importJournalPath(target) + '）'
        + ' [' + String(error?.message || error) + ']'
      )
    }
    throw error
  } finally {
    if (!keepArtifacts) {
      try { fs.rmSync(stage, { recursive: true, force: true }) } catch { }
      // 成功、回滚成功、或根本没动过目录时，日志已无意义；失败且保留产物时上面会置 keepArtifacts
      if (!installed) removeImportJournal(target)
    }
  }
}

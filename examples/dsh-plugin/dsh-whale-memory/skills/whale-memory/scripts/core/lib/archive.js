// 记忆目录的打包与恢复：导出、校验、导入共用这一份。CLI 的 export/import、tools/backup.mjs、tools/restore-check.mjs 都走这里
// 导出包 = 记忆目录里每个文件的原样副本 + manifest.json（每个文件的大小与 SHA-256）
// 导入前先校验全部文件，坏一个就一个字节都不写；路径越界（正反斜杠、绝对路径、盘符、..）一律拒绝
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadAll } from './self-experience.js'

export const FORMAT = 'whale-memory-export'
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

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
  const x = path.resolve(a), y = path.resolve(b)
  return x === y || x.startsWith(y + path.sep)
}

// 导出包里的相对路径：正反斜杠、绝对路径、盘符相对路径、任何 '..' 段都拒绝，
// 再用解析后的绝对路径确认确实落在 root 里面（不靠枚举写法）
export function safeJoin(root, name) {
  const n = String(name || '')
  if (!n || n.includes('\0')) throw new Error('导出里有可疑路径：' + JSON.stringify(name))
  if (path.isAbsolute(n) || path.win32.isAbsolute(n) || /^[a-zA-Z]:/.test(n)) throw new Error('导出里有绝对路径：' + n)
  if (n.split(/[\\/]+/).includes('..')) throw new Error('导出里有越界路径：' + n)
  const rootAbs = path.resolve(root)
  const abs = path.resolve(rootAbs, n)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error('导出里有越界路径：' + n)
  return abs
}

// 打包：outDir 下新建 <name>/（默认 memory-export-<时间>），不能和记忆目录互相包含
export function exportArchive(memDir, outDir, { name = '' } = {}) {
  if (!fs.existsSync(memDir)) throw new Error('没有找到记忆目录：' + memDir)
  const target = path.resolve(outDir, name || 'memory-export-' + stamp())
  if (inside(target, memDir) || inside(memDir, target)) throw new Error('导出目录不能和记忆目录互相包含：' + target)
  if (fs.existsSync(target)) throw new Error('导出目录已存在：' + target)

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
      experiences: loadAll(memDir).length,
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
  if (!fs.existsSync(manifestFile)) throw new Error('不是 whale-memory 导出目录（缺 manifest.json）：' + src)
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch {
    throw new Error('manifest.json 读不出来：' + manifestFile)
  }
  if (!manifest || manifest.format !== FORMAT || !Array.isArray(manifest.files)) {
    throw new Error('manifest.json 格式不对：' + manifestFile)
  }
  for (const f of manifest.files) {
    const n = String(f.name || '')
    const abs = safeJoin(src, n)
    if (!fs.existsSync(abs)) throw new Error('导出缺少文件：' + n)
    const buf = fs.readFileSync(abs)
    if (sha256(buf) !== f.sha256) throw new Error('文件校验不通过：' + n)
  }
  return manifest
}

// 恢复：先整包校验；目标已有数据时默认拒绝，force 会先把现有目录改名备份
export function importArchive(fromDir, memDir, { force = false } = {}) {
  const src = path.resolve(fromDir)
  const manifest = verifyArchive(src)
  const exists = fs.existsSync(memDir) && fs.readdirSync(memDir).length > 0
  if (exists && !force) throw new Error('目标已有数据：' + memDir + '。确认覆盖请加 --force true（会先备份）')
  let backup = ''
  if (exists && force) {
    backup = memDir + '.pre-import-' + stamp()
    fs.renameSync(memDir, backup)
  }
  fs.mkdirSync(memDir, { recursive: true })
  for (const f of manifest.files) {
    const dest = safeJoin(memDir, f.name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(safeJoin(src, f.name), dest)
  }
  const loaded = loadAll(memDir)
  return { ok: true, files: manifest.files.length, restoreTo: memDir, backup, counts: { experiences: loaded.length } }
}

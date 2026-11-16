#!/usr/bin/env node
// 通用 CLI 适配层：任何能执行命令的 agent（DSH、自建、其他框架）都能用
// 用法：node memory-cli.mjs <命令> [参数]，输出 JSON 到 stdout
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as exp from '../../packages/core/lib/self-experience.js'
import * as mem from '../../packages/core/lib/self-memory.js'
import * as waking from '../../packages/core/lib/waking.js'
import * as prompt from '../../packages/core/lib/self-prompt.js'
import * as settings from '../../packages/core/lib/self-settings.js'

const WEIGHTS = new Set(['important', 'normal', 'minor'])

// 参数写成 --name value 或 --name=value 都行
function arg(name, fallback = null) {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='))
  if (eq !== undefined) return eq.slice(name.length + 3)
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error('--' + name + ' 缺少参数值')
  return v
}

// --limit 必须是非负整数：0 表示一条都不要，负数直接拒绝（不能变成“全部”）
function limitArg(name, fallback) {
  const v = arg(name, null)
  if (v === null) return fallback
  if (!/^\d+$/.test(v)) throw new Error('--' + name + ' 必须是非负整数')
  return Number(v)
}

function weightArg() {
  const w = arg('weight', 'normal') || 'normal'
  if (!WEIGHTS.has(w)) throw new Error('--weight 只能是 important / normal / minor')
  return w
}

function out(obj) { console.log(JSON.stringify(obj, null, 2)) }

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// 导出的文件清单：跳过锁文件和临时文件，其余按相对路径收
function collectFiles(root) {
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

function doExport(outArg) {
  if (!fs.existsSync(MEM_DIR)) throw new Error('没有找到记忆目录：' + MEM_DIR)
  const target = path.resolve(outArg, 'memory-export-' + stamp())
  const insideSource = target === MEM_DIR || target.startsWith(MEM_DIR + path.sep)
  const sourceInsideTarget = MEM_DIR.startsWith(target + path.sep)
  if (insideSource || sourceInsideTarget) throw new Error('导出目录不能和记忆目录互相包含：' + target)
  if (fs.existsSync(target)) throw new Error('导出目录已存在：' + target)

  const files = collectFiles(MEM_DIR)
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
    format: 'whale-memory-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    files: manifestFiles,
    counts: {
      experiences: exp.loadAll(MEM_DIR).length,
      diaries: countLines(path.join(MEM_DIR, 'autobiography.jsonl')),
      laterEvents: countLines(path.join(MEM_DIR, 'later-events.jsonl')),
      recallEvents: countLines(path.join(MEM_DIR, 'recall-events.jsonl'))
    }
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { ok: true, dir: target, files: manifestFiles.length, bytes, counts: manifest.counts }
}

function doImport(fromArg, force) {
  const src = path.resolve(fromArg)
  const manifestFile = path.join(src, 'manifest.json')
  if (!fs.existsSync(manifestFile)) throw new Error('不是 whale-memory 导出目录（缺 manifest.json）：' + src)
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch {
    throw new Error('manifest.json 读不出来：' + manifestFile)
  }
  if (!manifest || manifest.format !== 'whale-memory-export' || !Array.isArray(manifest.files)) {
    throw new Error('manifest.json 格式不对：' + manifestFile)
  }
  // 先校验全部文件，再动目标目录：坏一个就一个字节都不写
  for (const f of manifest.files) {
    const name = String(f.name || '')
    if (!name || path.isAbsolute(name) || name.split('/').includes('..')) throw new Error('导出里有可疑路径：' + name)
    const abs = path.join(src, name)
    if (!fs.existsSync(abs)) throw new Error('导出缺少文件：' + name)
    const buf = fs.readFileSync(abs)
    if (sha256(buf) !== f.sha256) throw new Error('文件校验不通过：' + name)
  }

  const exists = fs.existsSync(MEM_DIR) && fs.readdirSync(MEM_DIR).length > 0
  if (exists && !force) throw new Error('目标已有数据：' + MEM_DIR + '。确认覆盖请加 --force true（会先备份）')
  let backup = ''
  if (exists && force) {
    backup = MEM_DIR + '.pre-import-' + stamp()
    fs.renameSync(MEM_DIR, backup)
  }
  fs.mkdirSync(MEM_DIR, { recursive: true })
  for (const f of manifest.files) {
    const dest = path.join(MEM_DIR, f.name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(src, f.name), dest)
  }
  const loaded = exp.loadAll(MEM_DIR)
  return { ok: true, files: manifest.files.length, restoreTo: MEM_DIR, backup, counts: { experiences: loaded.length } }
}

const cmd = process.argv[2]
let DATA = ''
let MEM_DIR = ''
try {
  // 数据根目录（下面有 plugin-data/）：--data 优先，其次 WHALE_DATA_DIR，最后是当前目录下的 data/
  DATA = path.resolve(arg('data', '') || process.env.WHALE_DATA_DIR || path.join(process.cwd(), 'data'))
  MEM_DIR = path.join(DATA, 'plugin-data', 'biomimetic-memory')
  if (cmd === 'write') {
    const text = arg('text')
    if (typeof text !== 'string' || !text.trim()) throw new Error('缺少 --text（不能是空白）')
    const row = exp.addExperience(MEM_DIR, {
      text,
      scene: arg('scene', '') || '',
      feeling: (arg('feeling', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
      thought: arg('thought', '') || '',
      unfinished: arg('unfinished', '') || '',
      quote: arg('quote') ? { text: arg('quote'), source: arg('source', '') || '' } : null,
      weight: weightArg(),
      kind: arg('kind', '其它') || '其它'
    })
    out({ ok: true, id: row.id, day: row.day })
  } else if (cmd === 'recall') {
    // 空 query = 最近 N 条（不是“什么都不返回”）；想看最近就用空 query，想按相关度就给词
    const q = arg('query', '') || ''
    const n = limitArg('limit', 3)
    const mark = String(arg('mark', 'false')) === 'true'
    const mode = String(arg('mode', 'strict'))
    if (mode !== 'strict' && mode !== 'loose') throw new Error('--mode 只能是 strict 或 loose')
    const rows = n === 0 ? [] : exp.recall(MEM_DIR, q, { limit: n, mark, mode })
    out({ ok: true, items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: exp.renderTwoPart(r) })) })
  } else if (cmd === 'read') {
    const n = limitArg('limit', 8)
    const all = exp.loadAll(MEM_DIR)
    const rows = n === 0 ? [] : all.slice(-n)
    const res = { ok: true, items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: r.then.text, thought: r.then.thought, later: (r.later || []).map((x) => x.thought) })) }
    // 旧 id 有几条记录共用、认不出归属的事件：原样留着，提醒人来核对
    const pending = exp.pendingLegacyEvents(MEM_DIR)
    if (pending.length) res.pending = { note: '这些后记/想起记录挂在几条旧经历共用的旧 id 上，没有自动归给任何一条，请人工核对。', items: pending }
    out(res)
  } else if (cmd === 'revise') {
    const id = arg('id')
    const thought = arg('thought')
    if (!id || typeof thought !== 'string' || !thought.trim()) throw new Error('需要 --id 与 --thought（不能是空白）')
    const res = exp.reviseExperience(MEM_DIR, { id, thought, reason: arg('reason', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'export') {
    const dir = arg('out')
    if (!dir) throw new Error('需要 --out <目录>')
    out(doExport(dir))
  } else if (cmd === 'import') {
    const from = arg('from')
    if (!from) throw new Error('需要 --from <导出目录>')
    const force = String(arg('force', 'false')) === 'true'
    out(doImport(from, force))
  } else if (cmd === 'waking') {
    const chat = arg('chat', 'local:owner') || 'local:owner'
    const block = waking.buildWakingBlock(DATA, chat)
    out({ ok: true, block })
    // 打印成功即视为已展示；只想预览不占用今天的额度，加 --peek true
    if (block && String(arg('peek', 'false')) !== 'true') waking.consumeWaking(DATA, chat)
  } else if (cmd === 'memory') {
    const q = arg('query', '') || ''
    const includeDiary = String(arg('diary', 'false')) === 'true'
    const n = limitArg('limit', 4)
    const rows = n === 0 ? [] : mem.recall(MEM_DIR, q, { includeDiary, limit: n })
    out({ ok: true, block: mem.renderBlock(rows) })
  } else if (cmd === 'prompt') {
    const sub = process.argv[3]
    if (sub === 'get') out({ ok: true, text: prompt.load(DATA) })
    else if (sub === 'set') out(prompt.save(DATA, arg('text') || '', arg('reason', '') || ''))
    else if (sub === 'history') {
      const n = limitArg('limit', 10)
      out({ ok: true, versions: n === 0 ? [] : prompt.history(DATA, n) })
    } else if (sub === 'revert') out(prompt.revert(DATA, arg('version') || ''))
    else throw new Error('prompt 子命令：get/set/history/revert')
  } else if (cmd === 'settings') {
    const sub = process.argv[3]
    if (sub === 'get') out({ ok: true, settings: settings.load(DATA) })
    else if (sub === 'set') {
      const patch = JSON.parse(arg('json', '{}') || '{}')
      out({ ok: true, settings: settings.save(DATA, patch, arg('reason', '') || '') })
    } else throw new Error('settings 子命令：get/set')
  } else {
    out({
      ok: false,
      usage: [
        '全局：--data <数据根目录>（下面有 plugin-data/；不给就用 WHALE_DATA_DIR，再不给用 ./data）',
        'write --text "..." [--scene .. --feeling a,b --thought .. --unfinished .. --quote .. --source .. --weight important|normal|minor --kind 读书]',
        'recall --query "..." [--limit 3] [--mark true] [--mode strict|loose]   （空 query = 最近 N 条；默认只读，strict 宁可不召回）',
        'read [--limit 8]',
        'revise --id ... --thought "..." [--reason ..]',
        'export --out <目录>   把整份记忆打包（含 manifest 与校验和）',
        'import --from <导出目录> [--force true]   恢复；--force 会先备份现有目录',
        'waking [--chat private:100000000] [--peek true]   （默认打印即记为已展示）',
        'memory --query "..." [--diary true --limit 4]',
        'prompt get|set --text ...|history|revert --version ...',
        'settings get|set --json {...}',
        '',
        '--limit 是非负整数；0 = 一条都不要'
      ]
    })
  }
} catch (e) {
  out({ ok: false, error: String(e && e.message ? e.message : e) })
  process.exit(1)
}
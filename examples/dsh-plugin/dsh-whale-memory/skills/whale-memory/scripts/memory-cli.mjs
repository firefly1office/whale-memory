#!/usr/bin/env node
// 通用 CLI 适配层：任何能执行命令的 agent（DSH、自建、其他框架）都能用
// 用法：node memory-cli.mjs <命令> [参数]，输出 JSON 到 stdout
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import * as exp from './core/lib/self-experience.js'
import * as mem from './core/lib/self-memory.js'
import * as waking from './core/lib/waking.js'
import * as prompt from './core/lib/self-prompt.js'
import * as settings from './core/lib/self-settings.js'
import * as laterEvents from './core/lib/later-events.js'
import * as recallEvents from './core/lib/recall-events.js'
import * as unfinishedEvents from './core/lib/unfinished-events.js'
import * as sealEvents from './core/lib/seal-events.js'
import * as recapLib from './core/lib/recap.js'

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

function doExport(outArg, memDir = MEM_DIR) {
  if (!fs.existsSync(memDir)) throw new Error('没有找到记忆目录：' + memDir)
  const target = path.resolve(outArg, 'memory-export-' + stamp())
  const insideSource = target === memDir || target.startsWith(memDir + path.sep)
  const sourceInsideTarget = memDir.startsWith(target + path.sep)
  if (insideSource || sourceInsideTarget) throw new Error('导出目录不能和记忆目录互相包含：' + target)
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
    format: 'whale-memory-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    files: manifestFiles,
    counts: {
      experiences: exp.loadAll(memDir).length,
      diaries: countLines(path.join(memDir, 'autobiography.jsonl')),
      laterEvents: countLines(path.join(memDir, 'later-events.jsonl')),
      recallEvents: countLines(path.join(memDir, 'recall-events.jsonl'))
    }
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { ok: true, dir: target, files: manifestFiles.length, bytes, counts: manifest.counts }
}

// 导出包里的相对路径：正反斜杠、绝对路径、盘符相对路径、任何 '..' 段都拒绝，
// 再用解析后的绝对路径确认确实落在 root 里面（不靠枚举写法）
function safeJoin(root, name) {
  const n = String(name || '')
  if (!n || n.includes('\0')) throw new Error('导出里有可疑路径：' + JSON.stringify(name))
  if (path.isAbsolute(n) || path.win32.isAbsolute(n) || /^[a-zA-Z]:/.test(n)) throw new Error('导出里有绝对路径：' + n)
  if (n.split(/[\\/]+/).includes('..')) throw new Error('导出里有越界路径：' + n)
  const rootAbs = path.resolve(root)
  const abs = path.resolve(rootAbs, n)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new Error('导出里有越界路径：' + n)
  return abs
}

function doImport(fromArg, force, memDir = MEM_DIR) {
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
    const abs = safeJoin(src, name)
    if (!fs.existsSync(abs)) throw new Error('导出缺少文件：' + name)
    const buf = fs.readFileSync(abs)
    if (sha256(buf) !== f.sha256) throw new Error('文件校验不通过：' + name)
  }

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
  const loaded = exp.loadAll(memDir)
  return { ok: true, files: manifest.files.length, restoreTo: memDir, backup, counts: { experiences: loaded.length } }
}

// 彻底忘掉：列出/删除所有可能还留着原文的地方
// 默认只列不删；--yes true 才动手。导出目录不在数据根下，只提示，不替人删。
function doPurge(yes) {
  const targets = []
  const add = (p, label) => { if (fs.existsSync(p)) targets.push({ path: p, label }) }
  add(MEM_DIR, '记忆目录')
  const parent = path.dirname(MEM_DIR)
  if (fs.existsSync(parent)) {
    for (const e of fs.readdirSync(parent)) {
      if (e.startsWith('biomimetic-memory.pre-import-')) add(path.join(parent, e), '导入前备份')
    }
  }
  const bak = path.join(DATA, 'backups')
  if (fs.existsSync(bak)) {
    for (const e of fs.readdirSync(bak)) {
      if (/^self-experience-pre-(later|recall)-events-.*\.jsonl(\.(events|manifest\.json))?$/.test(e)) {
        add(path.join(bak, e), '迁移备份')
      }
    }
  }
  const listed = targets.map((t) => ({ path: t.path, label: t.label }))
  if (!yes) return { ok: true, dryRun: true, targets: listed, note: '导出目录在数据根之外，不在这里处理，请自行确认。' }
  for (const t of targets) fs.rmSync(t.path, { recursive: true, force: true })
  return { ok: true, removed: targets.length, targets: listed, note: '已删除上面这些；导出的备份目录请自行清理。' }
}

// 能力层体检：不是“文件在不在”，是真的写进去、读回来、导出去、再导回来
// 只读真实数据；所有写入都发生在临时目录
function doDoctor() {
  const checks = []
  const add = (name, fn) => {
    try {
      const r = fn()
      checks.push({ name, ok: Boolean(r.ok), detail: String(r.detail || '') })
    } catch (e) {
      checks.push({ name, ok: false, detail: String((e && e.message) || e) })
    }
  }

  add('数据目录', () => {
    if (!fs.existsSync(MEM_DIR)) return { ok: true, detail: '还没有数据（首次使用正常）：' + MEM_DIR }
    const rows = exp.loadAll(MEM_DIR)
    return { ok: true, detail: MEM_DIR + '，' + rows.length + ' 条经历' }
  })

  add('事件文件可解析', () => {
    if (!fs.existsSync(MEM_DIR)) return { ok: true, detail: '没有数据目录，跳过' }
    const bad = laterEvents.readAll(MEM_DIR).bad + recallEvents.readAll(MEM_DIR).bad + unfinishedEvents.readAll(MEM_DIR).bad + sealEvents.readAll(MEM_DIR).bad
    return { ok: bad === 0, detail: bad === 0 ? '没有坏行' : '有 ' + bad + ' 行解析失败' }
  })

  add('写入→读回（临时目录）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-doctor-'))
    try {
      const memDir = path.join(tmp, 'mem')
      const row = exp.addExperience(memDir, { text: '体检探针：读完灯塔那一章', unfinished: '想知道船回来没有', feeling: ['闷'] })
      // 截在这条刚写下的那一刻；后面的后记、结案必须晚于它，同一毫秒就稍等一下
      const before = row.at
      while (Date.now() <= Date.parse(before)) { /* 等到下一毫秒 */ }
      exp.reviseExperience(memDir, { id: row.id, thought: '船回来了', feeling: ['松了口气'] })
      exp.setUnfinishedState(memDir, { id: row.id, choice: 'done' })
      const echo = exp.addExperience(memDir, { text: '体检探针：回想', refs: [row.id] })
      const view = exp.currentView(memDir, row.id)
      const past = exp.currentView(memDir, row.id, { asOf: before })
      const hit = exp.recall(memDir, '灯塔', { limit: 1 })
      exp.setSealed(memDir, { id: echo.id, sealed: true })
      const sealedGone = exp.recall(memDir, '回想', { limit: 3 }).every((r) => r.id !== echo.id)
      const sealedKept = Boolean(exp.currentView(memDir, echo.id))
      const ok = view && view.later.length === 1 && view.later[0].feeling && view.unfinishedState && view.unfinishedState.choice === 'done' &&
        hit.length === 1 && (view.citedBy || []).some((c) => c.id === echo.id) &&
        past && past.later.length === 0 && !past.unfinishedState && sealedGone && sealedKept
      return { ok: Boolean(ok), detail: ok ? '写入、后记与感觉、结案、出处、翻回那天、封存、召回都通过' : '读回的内容不完整' }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  add('出处完整', () => {
    if (!fs.existsSync(MEM_DIR)) return { ok: true, detail: '没有数据目录，跳过' }
    const missing = exp.loadAll(MEM_DIR).flatMap((r) => (r.refsInfo || []).filter((x) => x.missing).map((x) => r.id + ' → ' + x.id))
    return { ok: missing.length === 0, detail: missing.length ? '有 ' + missing.length + ' 处出处指向找不到的经历（可能是只恢复了部分文件）：' + missing.slice(0, 5).join('，') : '每条回想引用的经历都在' }
  })

  add('导出→导入（临时目录）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-doctor-'))
    try {
      const memDir = path.join(tmp, 'mem')
      const row = exp.addExperience(memDir, { text: '体检探针：导出导入' })
      const out = path.join(tmp, 'out')
      fs.mkdirSync(out, { recursive: true })
      const e = doExport(out, memDir)
      const memDir2 = path.join(tmp, 'mem2')
      doImport(e.dir, false, memDir2)
      const back = exp.currentView(memDir2, row.id)
      return { ok: Boolean(back && back.then.text === '体检探针：导出导入'), detail: back ? '导出包能完整导回' : '导回后找不到那条经历' }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  add('醒来白名单', () => {
    const ok = waking.isPrivateKey('private_100000000') && waking.isPrivateKey('local:owner') && !waking.isPrivateKey('group:936614388')
    return { ok, detail: ok ? '私聊放行、群聊拦截' : '白名单判断不对' }
  })

  return { ok: checks.every((c) => c.ok), checks }
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
      kind: arg('kind', '其它') || '其它',
      refs: arg('refs', '') || ''
    })
    out({ ok: true, id: row.id, day: row.day, ...(row.then.refs ? { refs: row.then.refs } : {}) })
  } else if (cmd === 'recall') {
    // 空 query = 最近 N 条（不是“什么都不返回”）；想看最近就用空 query，想按相关度就给词
    const q = arg('query', '') || ''
    const n = limitArg('limit', 3)
    const mark = String(arg('mark', 'false')) === 'true'
    const mode = String(arg('mode', 'strict'))
    if (mode !== 'strict' && mode !== 'loose') throw new Error('--mode 只能是 strict 或 loose')
    const asOf = arg('as-of', '') || null
    const includeSealed = String(arg('sealed', 'false')) === 'true'
    const rows = n === 0 ? [] : exp.recall(MEM_DIR, q, { limit: n, mark, mode, asOf, includeSealed })
    out({ ok: true, ...(asOf ? { asOf } : {}), items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, ...(r.sealed ? { sealed: true } : {}), text: exp.renderTwoPart(r) })) })
  } else if (cmd === 'read') {
    // --as-of 2026-11-15：翻回那天的自己；--id：只看这一条，并附上两段式全文
    // 她封存了的默认不列；--sealed true 才列，--id 点名要看的那一条照给（带封存标记）
    const n = limitArg('limit', 8)
    const asOf = arg('as-of', '') || null
    const only = arg('id', '') || ''
    const includeSealed = String(arg('sealed', 'false')) === 'true'
    const all = exp.loadAll(MEM_DIR, { asOf })
    const picked = only ? all.filter((r) => r.id === only || r.formerId === only) : all.filter((r) => includeSealed || !r.sealed)
    const rows = n === 0 ? [] : picked.slice(-n)
    const feelingNow = (r) => { const l = [...(r.later || [])].reverse().find((x) => Array.isArray(x.feeling) && x.feeling.length); return l ? l.feeling : [] }
    const res = {
      ok: true,
      ...(asOf ? { asOf } : {}),
      items: rows.map((r) => ({
        id: r.id, day: r.day, weight: r.weight, text: r.then.text, thought: r.then.thought,
        feeling: r.then.feeling || [], feelingNow: feelingNow(r),
        unfinished: r.then.unfinished || '', unfinishedState: r.unfinishedState || null,
        later: (r.later || []).map((x) => x.thought),
        refs: r.then.refs || [], citedBy: (r.citedBy || []).map((x) => x.id),
        ...(r.sealed ? { sealed: r.sealed } : {}),
        ...(only ? { view: exp.renderTwoPart(r) } : {})
      }))
    }
    if (!only && !includeSealed) {
      const hidden = all.filter((r) => r.sealed).length
      if (hidden) res.sealedHidden = hidden
    }
    if (only && !rows.length) res.note = asOf ? '截至 ' + asOf + ' 还没有这条经历。' : '找不到这条经历：' + only
    // 旧 id 有几条记录共用、认不出归属的事件：原样留着，提醒人来核对
    const pending = exp.pendingLegacyEvents(MEM_DIR)
    if (pending.length) res.pending = { note: '这些后记/想起记录挂在几条旧经历共用的旧 id 上，没有自动归给任何一条，请人工核对。', items: pending }
    out(res)
  } else if (cmd === 'revise') {
    const id = arg('id')
    const thought = arg('thought')
    if (!id || typeof thought !== 'string' || !thought.trim()) throw new Error('需要 --id 与 --thought（不能是空白）')
    const res = exp.reviseExperience(MEM_DIR, { id, thought, reason: arg('reason', '') || '', feeling: arg('feeling', '') || '' })
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
  } else if (cmd === 'purge') {
    out(doPurge(String(arg('yes', 'false')) === 'true'))
  } else if (cmd === 'doctor') {
    out(doDoctor())
  } else if (cmd === 'unfinished') {
    const id = arg('id')
    const state = arg('state')
    if (!id || !state) throw new Error('需要 --id 与 --state done|shelved|reopen')
    const res = exp.setUnfinishedState(MEM_DIR, { id, choice: state, note: arg('note', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'seal' || cmd === 'unseal') {
    // 她不想再被这件事主动提醒：封存。不删除任何东西；想回来就 unseal
    const id = arg('id')
    if (!id) throw new Error('需要 --id')
    const res = exp.setSealed(MEM_DIR, { id, sealed: cmd === 'seal', note: arg('note', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'recap') {
    // 这几天的事实整理，给她写回想用；不调模型、不下结论
    const days = Number(arg('days', '7'))
    const rc = recapLib.recap(MEM_DIR, { days, asOf: arg('as-of', '') || null })
    out({ ok: true, recap: rc, text: recapLib.renderRecap(rc) })
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
        'write --text "..." [--scene .. --feeling a,b --thought .. --unfinished .. --quote .. --source .. --weight important|normal|minor --kind 读书 --refs id1,id2]   （--refs：这条是从哪几件事想到的，必须是已写下的经历）',
        'recall --query "..." [--limit 3] [--mark true] [--mode strict|loose] [--as-of 2026-11-15] [--sealed true]   （空 query = 最近 N 条；默认只读，strict 宁可不召回；--as-of 在那天的自己里找；默认不召回她封存的）',
        'read [--limit 8] [--id ...] [--as-of 2026-11-15] [--sealed true]   （--as-of：翻回那天的自己；--id：只看这一条，附两段式全文；封存的默认不列）',
        'revise --id ... --thought "..." [--reason .. --feeling a,b]   （--feeling：现在再想起的感觉；当时的感觉不会被改）',
        'unfinished --id ... --state done|shelved|reopen [--note ..]   这件事想通/先放下/再接着想',
        'seal --id ... [--note ..] / unseal --id ...   她不想再被这件事主动提醒：不会被召回、不进醒来块；不删除，随时可以解封',
        'recap [--days 7] [--as-of ..]   这几天写下的、改过的、感觉变的、想通/放下的、还没弄完的（只列事实，给她写回想用）',
        'export --out <目录>   把整份记忆打包（含 manifest 与校验和）',
        'import --from <导出目录> [--force true]   恢复；--force 会先备份现有目录',
        'purge [--yes true]   列出/删除记忆目录、导入前备份、迁移备份（默认只列不删）',
        'doctor   能力层体检：写入→读回（含感觉、出处、翻回那天、封存）、导出→导入、事件解析、出处完整、醒来白名单（临时目录）',
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
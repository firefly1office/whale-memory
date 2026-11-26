#!/usr/bin/env node
// 通用 CLI 适配层：任何能执行命令的 agent（DSH、自建、其他框架）都能用
// 用法：node memory-cli.mjs <命令> [参数]，输出 JSON 到 stdout
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as exp from './core/lib/self-experience.js'
import { recallDetail } from './core/lib/detail-recall.js'
import * as mem from './core/lib/self-memory.js'
import * as waking from './core/lib/waking.js'
import * as prompt from './core/lib/self-prompt.js'
import * as settings from './core/lib/self-settings.js'
import * as laterEvents from './core/lib/later-events.js'
import * as recallEvents from './core/lib/recall-events.js'
import * as unfinishedEvents from './core/lib/unfinished-events.js'
import * as sealEvents from './core/lib/seal-events.js'
import * as recapLib from './core/lib/recap.js'
import * as linkEvents from './core/lib/link-events.js'
import * as chapterEvents from './core/lib/chapter-events.js'
// 事实事件（S1 起）：doctor 也要看得见它的坏行——否则 erase 因它整次拒绝时，体检还会说"没有坏行"。
// 文件不存在时 readAll 返回 { rows: [], bad: 0 }，老目录照常体检。
import * as factKey from './core/lib/fact-key.js'
import * as book from './core/lib/book.js'
import * as archive from './core/lib/archive.js'
import * as unsaid from './core/lib/unsaid.js'
import { parseAsOf } from './core/lib/as-of.js'
import { changedSince } from './core/lib/changed.js'

const WEIGHTS = new Set(['important', 'normal', 'minor'])

// 参数写成 --name value 或 --name=value 都行
function arg(name, fallback = null) {
  const eq = process.argv.find((a) => a.startsWith('--' + name + '='))
  if (eq !== undefined) return eq.slice(name.length + 3)
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error('--' + name + ' is missing a value（--' + name + ' 缺少参数值）')
  return v
}

// --limit 必须是非负整数：0 表示一条都不要，负数直接拒绝（不能变成“全部”）
function limitArg(name, fallback) {
  const v = arg(name, null)
  if (v === null) return fallback
  if (!/^\d+$/.test(v)) throw new Error('--' + name + ' must be a non-negative integer（--' + name + ' 必须是非负整数）')
  return Number(v)
}

function weightArg() {
  const w = arg('weight', 'normal') || 'normal'
  if (!WEIGHTS.has(w)) throw new Error('--weight must be important / normal / minor（--weight 只能是 important / normal / minor）')
  return w
}

function out(obj) { console.log(JSON.stringify(obj, null, 2)) }

// 打包与恢复的实现在核心库 archive.js（备份工具、恢复检查也用同一份）
function doExport(outArg, memDir = MEM_DIR) { return archive.exportArchive(memDir, outArg) }
function doImport(fromArg, force, memDir = MEM_DIR) { return archive.importArchive(fromArg, memDir, { force }) }

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
    const bad = [laterEvents, recallEvents, unfinishedEvents, sealEvents, linkEvents, chapterEvents, factKey].reduce((n, m) => n + m.readAll(MEM_DIR).bad, 0) + unsaid.badLines(MEM_DIR)
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

  // 没说出口的抽屉：只有私聊里的 list 能看到；召回、醒来、read、书都看不到，群聊拒绝
  add('抽屉不外露（临时目录）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-doctor-'))
    try {
      const root = path.join(tmp, 'data')
      const memDir = path.join(root, 'plugin-data', 'biomimetic-memory')
      exp.addExperience(memDir, { text: '体检探针：今天读了灯塔' })
      const probe = '体检探针抽屉原文'
      const left = unsaid.leaveUnsaid(memDir, { chatKey: 'local:owner', kind: 'draft', text: probe })
      const seenBy = []
      if (JSON.stringify(exp.recall(memDir, probe, { mode: 'loose', limit: 5 })).includes(probe)) seenBy.push('recall')
      if (JSON.stringify(exp.loadAll(memDir)).includes(probe)) seenBy.push('read')
      if (waking.buildWakingBlock(root, 'local:owner', { now: new Date(Date.now() + 86400000) }).includes(probe)) seenBy.push('醒来块')
      if (book.renderBook(memDir).includes(probe)) seenBy.push('book')
      const group = unsaid.listUnsaid(memDir, { chatKey: 'group:936614388' })
      const mine = unsaid.listUnsaid(memDir, { chatKey: 'local:owner' })
      const ok = left.ok && !seenBy.length && !group.ok && mine.ok && mine.items.some((x) => x.text === probe)
      return { ok, detail: ok ? '只有私聊里打开抽屉才看得到；召回、read、醒来块、书都看不到；群聊拒绝' : '抽屉外露：' + (seenBy.join('、') || (group.ok ? '群聊也能打开' : '私聊打不开')) }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  return { ok: checks.every((c) => c.ok), checks }
}

// 位置无关：跳过 --flag / --flag=value / --flag value，第一个裸词是命令，第二个是子命令。
// 这样 `--data ./x read` 和 `read --data ./x` 等价（P2-11）。
function positionalArgs(argv) {
  const bare = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      if (!a.includes('=')) {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) i++
      }
      continue
    }
    bare.push(a)
  }
  return bare
}
const POSITIONAL = positionalArgs(process.argv.slice(2))
const cmd = POSITIONAL[0]
const SUB = POSITIONAL[1]
let DATA = ''
let MEM_DIR = ''
let LANG = 'zh'
try {
  // 数据根目录（下面有 plugin-data/）：--data 优先，其次 WHALE_DATA_DIR，最后是当前目录下的 data/
  DATA = path.resolve(arg('data', '') || process.env.WHALE_DATA_DIR || path.join(process.cwd(), 'data'))
  // 盘符/根不存在时直接报错：读不到不能当"她没写过"（P2-1）。存在但为空的目录仍算新库。
  const dataRoot = path.parse(DATA).root
  if (dataRoot && !fs.existsSync(dataRoot)) {
    throw new Error('Data root not found: ' + DATA + '（数据根目录不存在：' + DATA + '）')
  }
  // 输出语言（两段式、醒来块的标签）：--lang en|zh；不给就看 WHALE_LANG，再看系统语言
  LANG = (arg('lang', '') || process.env.WHALE_LANG || (/^zh/i.test(String(process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '')) ? 'zh' : 'en')) === 'zh' ? 'zh' : 'en'
  MEM_DIR = path.join(DATA, 'plugin-data', 'biomimetic-memory')
  if (cmd === 'write') {
    const text = arg('text')
    if (typeof text !== 'string' || !text.trim()) throw new Error('Missing --text (it cannot be blank)（缺少 --text（不能是空白））')
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
  } else if (cmd === 'detail') {
    out(recallDetail(MEM_DIR, arg('query'), { asOf: arg('as-of') || null }))
  } else if (cmd === 'recall') {
    // 空 query = 最近 N 条（不是“什么都不返回”）；想看最近就用空 query，想按相关度就给词
    const q = arg('query', '') || ''
    const n = limitArg('limit', 3)
    const mark = String(arg('mark', 'false')) === 'true'
    const mode = String(arg('mode', 'strict'))
    if (mode !== 'strict' && mode !== 'loose') throw new Error('--mode must be strict or loose（--mode 只能是 strict 或 loose）')
    const asOf = arg('as-of', '') || null
    const includeSealed = String(arg('sealed', 'false')) === 'true'
    const rows = n === 0 ? [] : exp.recall(MEM_DIR, q, { limit: n, mark, mode, asOf, includeSealed })
    out({ ok: true, ...(asOf ? { asOf } : {}), items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, ...(r.sealed ? { sealed: true } : {}), text: exp.renderTwoPart(r, { lang: LANG }) })) })
  } else if (cmd === 'read') {
    // --as-of 2026-11-15：翻回那天的自己；--id：只看这一条，并附上两段式全文
    // 她封存了的默认不列；--sealed true 才列，--id 点名要看的那一条照给（带封存标记）
    // 翻回那天时按那天的状态算：那时还没封存、现在封存着的（sealed.afterAsOf）在那时看得见，
    // 列表里照给并带上 sealed（含 afterAsOf），不计进 sealedHidden——计数只说那一天封存着的件数
    const n = limitArg('limit', 8)
    const asOf = arg('as-of', '') || null
    const only = arg('id', '') || ''
    const includeSealed = String(arg('sealed', 'false')) === 'true'
    const all = exp.loadAll(MEM_DIR, { asOf })
    const sealedThen = (r) => Boolean(r.sealed) && !(asOf && r.sealed.afterAsOf)
    const picked = only ? all.filter((r) => r.id === only || r.formerId === only) : all.filter((r) => includeSealed || !sealedThen(r))
    const rows = n === 0 ? [] : picked.slice(-n)
    const feelingNow = (r) => { const l = [...(r.later || [])].reverse().find((x) => Array.isArray(x.feeling) && x.feeling.length); return l ? l.feeling : [] }
    // 口径 A：翻回那天，正文照给；但封存理由（note）是她后来才写下的，不能混进那一天。
    const sealedInView = (r) => {
      if (!r.sealed) return undefined
      if (asOf && r.sealed.afterAsOf) {
        const { note, ...rest } = r.sealed
        return rest
      }
      return r.sealed
    }
    const rowInView = (r) => {
      const sealed = sealedInView(r)
      if (sealed === r.sealed) return r
      const { note, ...rest } = r.sealed
      return { ...r, sealed: rest }
    }
    const res = {
      ok: true,
      ...(asOf ? { asOf } : {}),
      items: rows.map((r) => ({
        id: r.id, day: r.day, weight: r.weight, text: r.then.text, thought: r.then.thought,
        feeling: r.then.feeling || [], feelingNow: feelingNow(r),
        unfinished: r.then.unfinished || '', unfinishedState: r.unfinishedState || null,
        later: (r.later || []).map((x) => x.thought),
        refs: r.then.refs || [], citedBy: (r.citedBy || []).map((x) => x.id),
        ...(sealedInView(r) ? { sealed: sealedInView(r) } : {}),
        ...(only ? { view: exp.renderTwoPart(rowInView(r), { lang: LANG }) } : {})
      }))
    }
    if (!only && !includeSealed) {
      const hidden = all.filter(sealedThen).length
      if (hidden) res.sealedHidden = hidden
    }
    if (only && !rows.length) res.note = asOf ? '截至 ' + asOf + ' 还没有这条经历。' : '找不到这条经历：' + only
    // 旧 id 有几条记录共用、认不出归属的事件：原样留着，提醒人来核对
    const pending = exp.pendingLegacyEvents(MEM_DIR)
    if (pending.length) res.pending = { note: '这些后记/想起记录挂在几条旧经历共用的旧 id 上，没有自动归给任何一条，请人工核对。', items: pending }
    out(res)
  } else if (cmd === 'changed') {
    // 这一个月里她改过主意的几件事：当时的想法 vs 后来的想法
    const days = Math.max(0, Number(arg('days', '30')) || 30)
    const n = limitArg('limit', 5)
    const rows = changedSince(MEM_DIR, { days, limit: n })
    out({ ok: true, days, items: rows.map((r) => ({ id: r.id, day: r.day, then: r.then, now: r.now, daysAgo: r.daysAgo })) })
  } else if (cmd === 'revise') {
    const id = arg('id')
    const thought = arg('thought')
    if (!id || typeof thought !== 'string' || !thought.trim()) throw new Error('Need --id and --thought (they cannot be blank)（需要 --id 与 --thought（不能是空白））')
    const res = exp.reviseExperience(MEM_DIR, { id, thought, reason: arg('reason', '') || '', feeling: arg('feeling', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'export') {
    const dir = arg('out')
    if (!dir) throw new Error('Need --out <dir>（需要 --out <目录>）')
    out(doExport(dir))
  } else if (cmd === 'import') {
    const from = arg('from')
    if (!from) throw new Error('Need --from <export-dir>（需要 --from <导出目录>）')
    const force = String(arg('force', 'false')) === 'true'
    out(doImport(from, force))
  } else if (cmd === 'purge') {
    out(doPurge(String(arg('yes', 'false')) === 'true'))
  } else if (cmd === 'doctor') {
    out(doDoctor())
  } else if (cmd === 'unfinished') {
    const id = arg('id')
    const state = arg('state')
    if (!id || !state) throw new Error('Need --id and --state done|shelved|reopen（需要 --id 与 --state done|shelved|reopen）')
    const res = exp.setUnfinishedState(MEM_DIR, { id, choice: state, note: arg('note', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'seal' || cmd === 'unseal') {
    // 她不想再被这件事主动提醒：封存。不删除任何东西；想回来就 unseal
    const id = arg('id')
    if (!id) throw new Error('Need --id（需要 --id）')
    const res = exp.setSealed(MEM_DIR, { id, sealed: cmd === 'seal', note: arg('note', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'recap') {
    // 这几天的事实整理，给她写回想用；不调模型、不下结论
    const days = Number(arg('days', '7'))
    const rc = recapLib.recap(MEM_DIR, { days, asOf: arg('as-of', '') || null })
    out({ ok: true, recap: rc, text: recapLib.renderRecap(rc) })
  } else if (cmd === 'link') {
    // 事后联想：她发现两件事有关，亲手连起来；必须说为什么
    const res = exp.linkExperiences(MEM_DIR, { from: arg('from', '') || '', to: arg('to', '') || '', reason: arg('reason', '') || '' })
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'chapter') {
    // 人生章节：她给一段日子起名字；改名保留旧名；经历按日期自动落进去
    const sub = SUB
    let res
    if (sub === 'open') res = chapterEvents.open(MEM_DIR, { name: arg('name', '') || '', from: arg('from', '') || '', to: arg('to', '') || '', note: arg('note', '') || '' })
    else if (sub === 'rename') res = chapterEvents.rename(MEM_DIR, { id: arg('id', '') || '', name: arg('name', '') || '' })
    else if (sub === 'close') res = chapterEvents.close(MEM_DIR, { id: arg('id', '') || '', to: arg('to', '') || '' })
    else if (sub === 'list') {
      const asOf = arg('as-of', '') || null
      const list = chapterEvents.chapters(MEM_DIR, { until: parseAsOf(asOf) })
      const rows = exp.loadAll(MEM_DIR, { asOf })
      out({ ok: true, ...(asOf ? { asOf } : {}), chapters: list.map((c) => ({ ...c, experiences: rows.filter((r) => (r.chapters || []).some((x) => x.id === c.id)).length })) })
    } else throw new Error('chapter subcommands: open --name .. [--from 2026-11-01 --to ..] / rename --id .. --name .. / close --id .. [--to ..] / list [--as-of ..]（chapter 子命令：open --name .. [--from 2026-11-01 --to ..] / rename --id .. --name .. / close --id .. [--to ..] / list [--as-of ..]）')
    if (res) out({ ok: true, noop: res.noop, ...(res.row ? { chapter: res.row } : {}) })
  } else if (cmd === 'unsaid') {
    // 没说出口的抽屉：只在一对一会话里打开（--chat 默认 local:owner）；永不自动注入
    const sub = SUB
    // --chat= 这种空值不能被当成默认的一对一（P2-5）：抽屉的门不能靠"空串"打开。
    const chatProvided = process.argv.some((a) => a === '--chat' || a.startsWith('--chat='))
    const chatRaw = arg('chat', '')
    if (chatProvided && !String(chatRaw || '').trim()) throw new Error('--chat cannot be empty（--chat 不能是空值）')
    const chatKey = String(chatRaw || '').trim() || 'local:owner'
    let res
    if (sub === 'leave') res = unsaid.leaveUnsaid(MEM_DIR, { chatKey, kind: arg('kind', 'draft') || 'draft', text: arg('text', '') || '', reason: arg('reason', '') || '' })
    else if (sub === 'list') res = unsaid.listUnsaid(MEM_DIR, { chatKey, all: String(arg('all', 'false')) === 'true' })
    else if (sub === 'spoken') res = unsaid.markUnsaidSpoken(MEM_DIR, { chatKey, id: arg('id', '') || '' })
    else if (sub === 'discard') res = unsaid.discardUnsaid(MEM_DIR, { chatKey, id: arg('id', '') || '' })
    else throw new Error('unsaid subcommands: leave --kind draft|question|held --text ".." [--reason ..] / list [--all true] / spoken --id .. / discard --id .. (all accept --chat, default local:owner)（unsaid 子命令：leave --kind draft|question|held --text ".." [--reason ..] / list [--all true] / spoken --id .. / discard --id ..（都可带 --chat，默认 local:owner））')
    out(res)
    if (!res.ok) process.exitCode = 1
  } else if (cmd === 'book') {
    // 她的书：人能读的 Markdown 自传；封存的默认不收；--as-of 导出那时的她
    const md = book.renderBook(MEM_DIR, { asOf: arg('as-of', '') || null, includeSealed: String(arg('sealed', 'false')) === 'true', title: arg('title', '') || undefined })
    const file = arg('out', '') || ''
    if (file) {
      const target = path.resolve(file)
      if (target === MEM_DIR || target.startsWith(MEM_DIR + path.sep)) throw new Error('Do not write the book inside the memory directory: ' + target + '（书不要写进记忆目录里：' + target + '）')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, md, 'utf8')
      out({ ok: true, file: target, chars: md.length })
    } else out({ ok: true, markdown: md })
  } else if (cmd === 'waking') {
    const chatProvided = process.argv.some((a) => a === '--chat' || a.startsWith('--chat='))
    const chatRaw = arg('chat', '')
    if (chatProvided && !String(chatRaw || '').trim()) throw new Error('--chat cannot be empty（--chat 不能是空值）')
    const chat = String(chatRaw || '').trim() || 'local:owner'
    const block = waking.buildWakingBlock(DATA, chat, { lang: LANG })
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
    const sub = SUB
    if (sub === 'get') out({ ok: true, text: prompt.load(DATA) })
    else if (sub === 'set') out(prompt.save(DATA, arg('text') || '', arg('reason', '') || ''))
    else if (sub === 'history') {
      const n = limitArg('limit', 10)
      out({ ok: true, versions: n === 0 ? [] : prompt.history(DATA, n) })
    } else if (sub === 'revert') out(prompt.revert(DATA, arg('version') || ''))
    else throw new Error('prompt subcommands: get/set/history/revert（prompt 子命令：get/set/history/revert）')
  } else if (cmd === 'settings') {
    const sub = SUB
    if (sub === 'get') out({ ok: true, settings: settings.load(DATA) })
    else if (sub === 'set') {
      const patch = JSON.parse(arg('json', '{}') || '{}')
      out({ ok: true, settings: settings.save(DATA, patch, arg('reason', '') || '') })
    } else throw new Error('settings subcommands: get/set（settings 子命令：get/set）')
  } else {
    out({
      ok: false,
      usage: [
        'detail --query "那条围巾是什么颜色？" [--as-of YYYY-MM-DD]   recall candidates and check the requested detail（只读，附经历出处与核对结果）',
        'Global: --data <data-root>   data root that contains plugin-data/; if omitted, WHALE_DATA_DIR, then ./data（全局：--data <数据根目录>（下面有 plugin-data/；不给就用 WHALE_DATA_DIR，再不给用 ./data））',
        'write --text "..." [--scene .. --feeling a,b --thought .. --unfinished .. --quote .. --source .. --weight important|normal|minor --kind 读书 --refs id1,id2]   --refs: which experiences this one grew out of; they must already be written（--refs：这条是从哪几件事想到的，必须是已写下的经历）',
        'recall --query "..." [--limit 3] [--mark true] [--mode strict|loose] [--as-of 2026-11-15] [--sealed true]   empty query = the latest N; read-only by default; strict prefers returning nothing over a loose match; --as-of searches the self of that day; sealed ones are not recalled by default（空 query = 最近 N 条；默认只读，strict 宁可不召回；--as-of 在那天的自己里找；默认不召回她封存的）',
        'read [--limit 8] [--id ...] [--as-of 2026-11-15] [--sealed true]   --as-of: look back at yourself on that day; --id: only this one, with the full then/now view; sealed ones are not listed by default（--as-of：翻回那天的自己；--id：只看这一条，附两段式全文；封存的默认不列）',
        'revise --id ... --thought "..." [--reason .. --feeling a,b]   --feeling: how it feels to recall it now; the original feeling is never changed（--feeling：现在再想起的感觉；当时的感觉不会被改）',
        'unfinished --id ... --state done|shelved|reopen [--note ..]   figured it out / set it aside / pick it up again（这件事想通/先放下/再接着想）',
        'seal --id ... [--note ..] / unseal --id ...   she no longer wants to be reminded of it: not recalled, not in the waking block; nothing is deleted, unseal any time（她不想再被这件事主动提醒：不会被召回、不进醒来块；不删除，随时可以解封）',
        'recap [--days 7] [--as-of ..]   what was written, revised, felt differently, figured out / set aside, or is still unfinished in the last few days (facts only, for her look-back)（这几天写下的、改过的、感觉变的、想通/放下的、还没弄完的（只列事实，给她写回想用））',
        'link --from .. --to .. --reason "..."   link two experiences she later sees as related (a reason is required; each pair is linked once)（事后联想：她发现两件事有关，亲手连起来（必须说为什么；同一对只连一次））',
        'chapter open --name ".." [--from 2026-11-01 --to ..] | rename --id .. --name .. | close --id .. [--to ..] | list [--as-of ..]   life chapters: give a stretch of days a name（人生章节：给一段日子起名字）',
        'book [--out her-book.md] [--as-of ..] [--sealed true] [--title ..]   export a human-readable autobiography (by chapter; sealed ones are left out by default)（导出人能读的自传（按章节；封存的默认不收））',
        'unsaid leave --kind draft|question|held --text ".." [--reason ..] | list [--all true] | spoken --id .. | discard --id ..   the unsaid drawer: opens only in one-to-one chats and is never injected automatically (--chat defaults to local:owner)（没说出口的抽屉：只在一对一会话里打开，永不自动注入（--chat 默认 local:owner））',
        'export --out <dir>   pack the whole memory (with manifest and checksums)（把整份记忆打包（含 manifest 与校验和））',
        'import --from <export-dir> [--force true]   restore; --force backs up the existing directory first（恢复；--force 会先备份现有目录）',
        'purge [--yes true]   list / delete the memory directory, pre-import backups and migration backups (list only by default)（列出/删除记忆目录、导入前备份、迁移备份（默认只列不删））',
        'doctor   capability check: write → read back (incl. feelings, refs, as-of, sealing), export → import, event parsing, ref integrity, waking allowlist (in a temp directory)（能力层体检：写入→读回（含感觉、出处、翻回那天、封存）、导出→导入、事件解析、出处完整、醒来白名单（临时目录））',
        'waking [--chat private:100000000] [--peek true]   printing it counts as shown by default（默认打印即记为已展示）',
        'memory --query "..." [--diary true --limit 4]',
        'prompt get|set --text ...|history|revert --version ...',
        'settings get|set --json {...}',
        '',
        '--limit is a non-negative integer; 0 = return nothing（--limit 是非负整数；0 = 一条都不要）'
      ]
    })
  }
} catch (e) {
  out({ ok: false, error: String(e && e.message ? e.message : e) })
  process.exit(1)
}

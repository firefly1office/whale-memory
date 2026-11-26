#!/usr/bin/env node
// 夜间整理最简版：对照原话挑错 + 把同主题的「后记 / 经历」归并成建议。
//
// 借自 ru-гу 的夜间整理（只学「晚上对着原话回看一遍」这个做法）与 Lysmor 的衰减思路
// （AGPL，只学设计，未复制代码；见 docs/attribution-zh.md）。
//
// 这一版只做**数据层**，像 S1 的事实键一样：
//   - 结果只写成事件（consolidate-events.jsonl，一行一个，只追加）；
//   - 不接读路径 / 召回，事件不会自动生效；
//   - 不原地改记录，不碰封存与抽屉（封存的经历直接跳过，不把它的正文抄进新文件）；
//   - 不调模型、不联网、零第三方依赖。
//
// 默认 dry-run：只把建议 diff 打到 stdout，**一个字节都不写**。
// --write 才追加事件；--undo 追加一条撤销事件（原建议不删、不改）。
//
// 用法：
//   node tools/nightly-consolidate.mjs <memory-dir>              # dry-run
//   node tools/nightly-consolidate.mjs <memory-dir> --write      # 落盘（只追加事件）
//   node tools/nightly-consolidate.mjs <memory-dir> --undo       # 撤销最后一条建议
//   node tools/nightly-consolidate.mjs <memory-dir> --undo --id cons_xxx
//   加 --json 输出机器可读结果
//
// 退出码：0 正常；1 数据读不出来 / 有坏行；2 用法错。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadAll } from '../packages/core/lib/self-experience.js'
import * as laterEvents from '../packages/core/lib/later-events.js'
import { normalizeText, queryTerms } from '../packages/core/lib/query-match.js'
import { withFileLock } from '../packages/core/lib/file-lock.js'

export const EVENT_FILE = 'consolidate-events.jsonl'
export const EVENT_VERSION = 1

// 建议类型。只加不减：以后加新类型，旧事件照旧读得懂。
export const SUGGESTION_TYPES = Object.freeze([
  'merge-later', // 同一经历的多条后记 → 归并成一条
  'merge-topic', // 同主题的多条经历 → 归并成一条（refs 或关键词重叠）
  'quote-not-in-source', // 后记引的话在原话里找不到
  'quote-not-in-quote' // 她自己写的话里引的，和读到的原文对不上
])

export const UNDO_TYPE = 'undo'

// 关键词两两比较是 O(n²)。超过这个条数就只做逐条检查、跳过主题归并，
// 并在输出里明说跳过了——不假装跑过。
export const MAX_TOPIC_RECORDS = 2000

// 引文片段最长按 120 字抓；再长就不是「引了一句」而是整段复述了。
// 归并建议里的摘要每段只取前 24 字（brief），事件里的 summary 整体封顶 500 字。
const MAX_SPAN = 120
const BRIEF_CHARS = 24
const MAX_SUMMARY = 500
const MAX_REASON = 300
const MIN_TOPIC_TERMS = 3
const MIN_TOPIC_RATIO = 0.6
// 一组最多归并 8 条。再大就不是「同主题」，是「整库」，那样的建议没有用。
const MAX_GROUP_SIZE = 8
// 全库过半经历都出现的词不算主题词（和「今天」一个道理，只是按数据算，不靠词表）。
// 少于 5 条时不启用：小样本里两条经历共用一个词很正常，按比例砍会砍掉真正的主题。
const GENERIC_MIN_CORPUS = 5

const USAGE = [
  '夜间整理最简版：对照原话挑错 + 同主题归并建议（默认只看不写）',
  '',
  '用法：',
  '  node tools/nightly-consolidate.mjs <memory-dir> [--write] [--undo] [--id <cons_xxx>] [--json]',
  '',
  '  <memory-dir>  记忆目录（含 self-experience.jsonl；没有就是空目录，正常）',
  '  --write       把建议追加进 ' + EVENT_FILE + '（只追加，不改记录与既有事件文件）',
  '  --undo        追加一条撤销事件（原建议留在文件里，不删不改）；默认撤最后一条',
  '  --id          指定要撤销的建议 id',
  '  --json        机器可读输出',
  '',
  '退出码：0 正常；1 读不出来 / 有坏行；2 用法错。'
].join('\n')

const msg = (e) => String(e && e.message ? e.message : e)

function clip(text, max) {
  const chars = [...String(text || '')]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('')
}

const brief = (text, max = BRIEF_CHARS) => {
  const chars = [...String(text || '')]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('')
}

const dayOfLater = (note) => String(note.day || String(note.at || '').slice(0, 10) || '某天')

// 引文按成对符号抓：「」『』“” 与直双引号。不加《》：书名不必出现在原话里。
const QUOTE_PATTERNS = [
  /「([^」\n]{1,120})」/g,
  /『([^』\n]{1,120})』/g,
  /“([^”\n]{1,120})”/g,
  /"([^"\n]{1,120})"/g
]

/**
 * 从一段话里抓出所有引文片段（去重、保持出现顺序）。
 * 只用成对符号；没有明确引用的话不当引文，避免把普通句子当「她引了原话」。
 */
export function extractQuoted(text) {
  const source = String(text || '')
  const out = []
  const seen = new Set()
  for (const pattern of QUOTE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const span = String(match[1] || '').trim()
      // 长度 1 的引文（「嗯」）太容易碰巧命中，核对没有意义
      if (normalizeText(span).length < 2) continue
      if (span.length > MAX_SPAN) continue
      if (seen.has(span)) continue
      seen.add(span)
      out.push(span)
    }
  }
  return out
}

/** 引文在出处里找得到吗：先按 query-match 的同一套口径去掉空白与标点，再比子串。 */
export function quoteFound(span, source) {
  const needle = normalizeText(span)
  if (!needle) return true
  return normalizeText(source).includes(needle)
}

/** 建议 id：类型 + 内容指纹。同一份数据重复跑得到同一个 id，这是幂等的基础。 */
export function suggestionId(type, key) {
  return 'cons_' + crypto.createHash('sha1').update(String(type) + '\u0000' + String(key)).digest('hex').slice(0, 12)
}

const sourceText = (row) => String((row.then && row.then.text) || '') + ' ' + String((row.then && row.then.quote && row.then.quote.text) || '')
const quoteText = (row) => String((row.then && row.then.quote && row.then.quote.text) || '')
const refsOf = (row) => (row.then && Array.isArray(row.then.refs) ? row.then.refs : [])

function makeSuggestion({ type, key, ids, summary, reason, detail }) {
  return {
    type,
    id: suggestionId(type, key),
    ids,
    summary: clip(summary, MAX_SUMMARY),
    reason: clip(reason, MAX_REASON),
    detail
  }
}

function laterMergeSuggestion(row, notes) {
  const days = notes.map(dayOfLater)
  const tail = notes.map((n) => dayOfLater(n) + '「' + brief(n.thought) + '」').join('；')
  return makeSuggestion({
    type: 'merge-later',
    key: row.id + '\u0000' + notes.map((n) => String(n.at || '') + '|' + String(n.thought || '')).join('\u0000'),
    ids: [row.id],
    summary: '把这一条的 ' + notes.length + ' 条后记归并成一条：' + tail,
    reason: '同一经历有 ' + notes.length + ' 条后记（' + days.join('、') + '），建议按时间顺序归并成一条',
    detail: { notes }
  })
}

function quoteSourceSuggestion(row, note, span) {
  return makeSuggestion({
    type: 'quote-not-in-source',
    key: row.id + '\u0000' + span + '\u0000' + String(note.at || ''),
    ids: [row.id],
    summary: '后记里的「' + span + '」在原话里找不到；这条的原话是：' + brief(sourceText(row)),
    reason: '后记（' + dayOfLater(note) + '）引了这段，但 then.text / then.quote.text 里没有',
    detail: { span, note }
  })
}

function quoteInQuoteSuggestion(row, span) {
  return makeSuggestion({
    type: 'quote-not-in-quote',
    key: row.id + '\u0000' + span,
    ids: [row.id],
    summary: '她写的话里引了「' + span + '」，但读到的原文里没有这段；原文是：' + brief(quoteText(row)),
    reason: 'then.text 的引文对不上 then.quote.text（她记下的原文）',
    detail: { span }
  })
}

// 同主题判据（两条，任一成立）：
//   1. 显式引用：一方的 then.refs 里有另一方的 id；
//   2. 关键词重叠：用 query-match 的两字组 / 整词口径，交集 ≥ 3 个，且交集占较短一方 ≥ 60%。
//      3 个两字组通常意味着连着 4 个字以上共现（例如「灯塔故事」「潮汐归来」），不是碰巧。
// 停用词（今天/什么/觉得…）已经被 queryTerms 滤掉，所以「今天」不会把两条不相干的事拉到一起。
export function topicMatch(a, b, termsA, termsB) {
  if (!a || !b || a.id === b.id) return null
  if (refsOf(a).includes(b.id) || refsOf(b).includes(a.id)) return { why: 'refs', terms: [] }
  if (!termsA || !termsB) return null
  if (termsA.size < MIN_TOPIC_TERMS || termsB.size < MIN_TOPIC_TERMS) return null
  const shared = []
  for (const term of termsA) if (termsB.has(term)) shared.push(term)
  if (shared.length < MIN_TOPIC_TERMS) return null
  const ratio = shared.length / Math.min(termsA.size, termsB.size)
  if (ratio < MIN_TOPIC_RATIO) return null
  shared.sort()
  return { why: 'terms', terms: shared }
}

/**
 * 只读地算出一批建议（不写任何东西、不改传入的 rows）。
 *
 * @param {object[]} rows loadAll() 读出来的经历（含合并后的 later、sealed 标记）
 * @param {{existingIds?: Set<string>, maxTopicRecords?: number}} [opts]
 */
export function planConsolidation(rows, { existingIds = new Set(), maxTopicRecords = MAX_TOPIC_RECORDS } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const suggestions = []
  const seen = new Set()
  const stats = {
    records: 0,
    sealedSkipped: 0,
    laterNotes: 0,
    quotesChecked: 0,
    suggestions: 0,
    alreadyWritten: 0,
    topicSkipped: false
  }

  const usable = []
  for (const row of list) {
    if (!row || !row.id) continue
    // 封存：不主动提起。连摘要都不抄进新事件文件。
    if (row.sealed) {
      stats.sealedSkipped += 1
      continue
    }
    stats.records += 1
    usable.push(row)

    const notes = Array.isArray(row.later) ? row.later : []
    stats.laterNotes += notes.length

    // ① 后记里的引文，要在这一条的原话（then.text / then.quote.text）里找得到
    for (const note of notes) {
      for (const span of extractQuoted(note.thought)) {
        stats.quotesChecked += 1
        if (quoteFound(span, sourceText(row))) continue
        const s = quoteSourceSuggestion(row, note, span)
        if (!seen.has(s.id)) { seen.add(s.id); suggestions.push(s) }
      }
    }

    // ② 她写的话里引的原文，要和 then.quote.text 对得上
    if (quoteText(row)) {
      for (const span of extractQuoted(row.then.text)) {
        stats.quotesChecked += 1
        if (quoteFound(span, quoteText(row))) continue
        const s = quoteInQuoteSuggestion(row, span)
        if (!seen.has(s.id)) { seen.add(s.id); suggestions.push(s) }
      }
    }

    // ③ 同一经历的多条后记 → 归并
    if (notes.length >= 2) {
      const s = laterMergeSuggestion(row, notes)
      if (!seen.has(s.id)) { seen.add(s.id); suggestions.push(s) }
    }
  }

  // ④ 同主题的多条经历 → 归并。贪心分组：每条只跟「组里的第一条」比，
  //    这样分组可解释、结果确定，也不会顺着链子把整库连成一团。
  if (usable.length > maxTopicRecords) {
    stats.topicSkipped = true
  } else if (usable.length > 1) {
    const rawTerms = new Map()
    for (const row of usable) rawTerms.set(row, queryTerms(sourceText(row)).terms)
    // 词频过滤：过半经历都带的词算「到处都有」的背景词（和「今天」一个道理，
    // 只是按数据算，不靠词表）。模板化的经历就是靠这一步不互相归并。
    const generic = new Set()
    if (usable.length >= GENERIC_MIN_CORPUS) {
      const df = new Map()
      for (const row of usable) for (const term of rawTerms.get(row)) df.set(term, (df.get(term) || 0) + 1)
      const cut = Math.ceil(usable.length * 0.5)
      for (const [term, count] of df) if (count >= cut) generic.add(term)
    }
    const terms = new Map()
    for (const row of usable) terms.set(row, new Set([...rawTerms.get(row)].filter((term) => !generic.has(term))))
    const groups = []
    for (const row of usable) {
      let joined = null
      for (const group of groups) {
        if (group.rows.length >= MAX_GROUP_SIZE) continue
        const match = topicMatch(group.rep, row, terms.get(group.rep), terms.get(row))
        if (match) { joined = { group, match }; break }
      }
      if (joined) {
        joined.group.rows.push(row)
        joined.group.matches.push(joined.match)
        continue
      }
      groups.push({ rep: row, rows: [row], matches: [] })
    }
    for (const group of groups) {
      if (group.rows.length < 2) continue
      const byRefs = group.matches.some((m) => m.why === 'refs')
      const shared = [...new Set(group.matches.flatMap((m) => m.terms))].sort()
      const tail = group.rows.map((r) => String(r.day || String(r.at || '').slice(0, 10)) + '「' + brief(r.then.text) + '」').join('；')
      const s = makeSuggestion({
        type: 'merge-topic',
        key: group.rows.map((r) => r.id).join(','),
        ids: group.rows.map((r) => r.id),
        summary: '把这 ' + group.rows.length + ' 条同主题的经历归并成一条：' + tail,
        reason: byRefs
          ? group.rows.length + ' 条经历由 then.refs 显式相连'
          : group.rows.length + ' 条经历关键词重叠：' + shared.slice(0, 6).join('、'),
        detail: { rows: group.rows.map((r) => ({ id: r.id, day: r.day, text: r.then.text })) }
      })
      if (!seen.has(s.id)) { seen.add(s.id); suggestions.push(s) }
    }
  }

  for (const s of suggestions) s.already = existingIds.has(s.id)
  stats.suggestions = suggestions.length
  stats.alreadyWritten = suggestions.filter((s) => s.already).length
  return { suggestions, stats }
}

/** 一条建议的人读 diff（- 是看到的事实，+ 是建议，理由单列）。 */
export function renderSuggestion(s, index) {
  const lines = ['[' + index + '] ' + s.type + '  ' + s.id + '  ids=' + (s.ids || []).join(',')]
  if (s.type === 'merge-later') {
    for (const note of s.detail.notes) lines.push('    - ' + dayOfLater(note) + '「' + brief(note.thought) + '」')
    lines.push('    + 建议：' + s.summary)
  } else if (s.type === 'merge-topic') {
    for (const row of s.detail.rows) lines.push('    - ' + (row.day || '') + '「' + brief(row.text) + '」')
    lines.push('    + 建议：' + s.summary)
  } else {
    lines.push('    - ' + s.summary)
    lines.push('    + 建议：重写这条后记，按原话改；原话里没有的就别引')
  }
  lines.push('    理由：' + s.reason)
  if (s.already) lines.push('    （这条已经写过，--write 会跳过）')
  return lines.join('\n')
}

export function eventsFile(memDir) {
  return path.join(memDir, EVENT_FILE)
}

/** 一行整理事件合不合格。坏行 fail closed：整理记录读不懂时，不能当成「还没整理过」。 */
export function isValidEvent(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (row.v !== EVENT_VERSION) return false
  if (typeof row.type !== 'string' || !row.type) return false
  if (typeof row.id !== 'string' || !row.id) return false
  if (!Array.isArray(row.ids) || row.ids.some((id) => typeof id !== 'string')) return false
  if (typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at))) return false
  if (typeof row.day !== 'string' || !row.day) return false
  if (typeof row.summary !== 'string') return false
  if (typeof row.reason !== 'string') return false
  return true
}

export function readEventLog(memDir) {
  const file = eventsFile(memDir)
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    // 还没有整理过：当空是如实的。其它读不出来（权限、是目录、坏盘）必须报出来。
    if (error && error.code === 'ENOENT') return { file, rows: [] }
    const wrapped = new Error('整理事件读不出来（' + EVENT_FILE + '）：' + msg(error))
    wrapped.code = 'CONSOLIDATE_UNREADABLE'
    throw wrapped
  }
  const rows = []
  let bad = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { row = null }
    if (!row || !isValidEvent(row)) { bad += 1; continue }
    rows.push(row)
  }
  if (bad > 0) {
    const error = new Error('整理事件有 ' + bad + ' 行无法解析（' + EVENT_FILE + '）：先备份再修，不能当成空。')
    error.code = 'CONSOLIDATE_CORRUPT'
    error.bad = bad
    throw error
  }
  return { file, rows }
}

function toEventRow(event, now) {
  const at = new Date(now)
  const row = {
    v: EVENT_VERSION,
    type: event.type,
    id: event.id,
    ids: event.ids,
    at: at.toISOString(),
    day: at.toLocaleDateString('sv-SE'),
    summary: event.summary,
    reason: event.reason
  }
  if (!isValidEvent(row)) {
    const error = new Error('整理事件不合格：' + JSON.stringify(row))
    error.code = 'CONSOLIDATE_EVENT_INVALID'
    throw error
  }
  return row
}

/** 把事件追加进日志。空数组时连目录都不建——「没有新建议」不留下任何文件。 */
export function appendEvents(memDir, events, { now = Date.now() } = {}) {
  if (!Array.isArray(events) || events.length === 0) return []
  fs.mkdirSync(memDir, { recursive: true })
  const file = eventsFile(memDir)
  const rows = events.map((event) => toEventRow(event, now))
  return withFileLock(file + '.lock', () => {
    let prefix = ''
    try {
      const st = fs.statSync(file)
      if (st.size) {
        const fd = fs.openSync(file, 'r')
        const buf = Buffer.alloc(1)
        fs.readSync(fd, buf, 0, 1, st.size - 1)
        fs.closeSync(fd)
        if (buf[0] !== 10) prefix = '\n'
      }
    } catch { }
    fs.appendFileSync(file, prefix + rows.map((row) => JSON.stringify(row) + '\n').join(''), 'utf8')
    return rows
  })
}

/** 撤销目标：默认最后一条建议；已撤销过的不再写第二条（幂等）。 */
export function planUndo(rows, { id = '' } = {}) {
  const undone = new Set(rows.filter((row) => row.type === UNDO_TYPE).map((row) => row.id))
  const suggestions = rows.filter((row) => row.type !== UNDO_TYPE)
  if (!suggestions.length) {
    const error = new Error('还没有可撤销的建议（' + EVENT_FILE + ' 里没有建议记录）')
    error.code = 'NOTHING_TO_UNDO'
    throw error
  }
  const target = id ? suggestions.find((row) => row.id === id) : suggestions[suggestions.length - 1]
  if (!target) {
    const error = new Error('找不到这条建议：' + id)
    error.code = 'SUGGESTION_NOT_FOUND'
    throw error
  }
  return { targetId: target.id, noop: undone.has(target.id) }
}

function parseArgs(argv) {
  const out = { dir: '', write: false, undo: false, id: '', json: false, help: false }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') out.write = true
    else if (arg === '--undo') out.undo = true
    else if (arg === '--json') out.json = true
    else if (arg === '--id') {
      out.id = String(argv[i + 1] || '')
      if (!out.id) throw new Error('--id 后面需要建议 id')
      i += 1
    } else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg.startsWith('--')) throw new Error('认不出的参数：' + arg)
    else positional.push(arg)
  }
  if (out.write && out.undo) throw new Error('--write 与 --undo 不能同时用')
  if (positional.length > 1) throw new Error('只接受一个记忆目录')
  out.dir = positional[0] || ''
  return out
}

function renderPlan(plan) {
  const lines = []
  const s = plan.stats
  lines.push('读到的：经历 ' + s.records + ' 条（跳过封存 ' + s.sealedSkipped + ' 条）；后记 ' + s.laterNotes + ' 条；引文核对 ' + s.quotesChecked + ' 处')
  if (s.topicSkipped) lines.push('注意：经历超过 ' + MAX_TOPIC_RECORDS + ' 条，这次跳过了「同主题归并」（还没有做索引）。')
  if (s.alreadyWritten) lines.push('已有 ' + s.alreadyWritten + ' 条建议写过（--write 会跳过，不重复写）')
  if (!plan.suggestions.length) {
    lines.push('没有发现需要整理的地方。')
    return lines.join('\n')
  }
  lines.push('')
  lines.push('建议 ' + plan.suggestions.length + ' 条：')
  plan.suggestions.forEach((suggestion, i) => {
    lines.push('')
    lines.push(renderSuggestion(suggestion, i + 1))
  })
  return lines.join('\n')
}

function run(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(msg(error) + '\n\n' + USAGE + '\n')
    return 2
  }
  if (args.help) {
    process.stdout.write(USAGE + '\n')
    return 0
  }
  if (!args.dir) {
    process.stderr.write('缺少记忆目录\n\n' + USAGE + '\n')
    return 2
  }

  const dir = path.resolve(args.dir)
  try {
    const st = fs.statSync(dir)
    if (!st.isDirectory()) throw new Error('不是目录')
  } catch (error) {
    process.stderr.write('夜间整理失败：数据目录不存在或读不出来：' + dir + '（' + msg(error) + '）\n')
    return 1
  }

  try {
    const log = readEventLog(dir)

    // 撤销只读整理事件，不需要读经历：记录坏了也撤得掉。
    if (args.undo) {
      const undo = planUndo(log.rows, { id: args.id })
      if (undo.noop) {
        if (args.json) {
          process.stdout.write(JSON.stringify({ ok: true, dir, undo: { id: undo.targetId, noop: true } }) + '\n')
        } else {
          process.stdout.write('建议 ' + undo.targetId + ' 之前已经撤销过，不再写第二条。\n')
        }
        return 0
      }
      appendEvents(dir, [{
        type: UNDO_TYPE,
        id: undo.targetId,
        ids: [undo.targetId],
        summary: '撤销建议 ' + undo.targetId,
        reason: '--undo：这条建议不再算数（原建议留在文件里，没有删改）'
      }], { now: Date.now() })
      if (args.json) {
        process.stdout.write(JSON.stringify({ ok: true, dir, undo: { id: undo.targetId, noop: false } }) + '\n')
      } else {
        process.stdout.write('已追加撤销事件：' + undo.targetId + '（原建议留在文件里，没有删改）\n')
        process.stdout.write('事件文件：' + eventsFile(dir) + '\n')
      }
      return 0
    }

    const rows = loadAll(dir)
    const later = laterEvents.readAll(dir)
    if (later.bad > 0) {
      const error = new Error('后记事件有 ' + later.bad + ' 行无法解析（later-events.jsonl）：先备份再修，不能当成没有后记。')
      error.code = 'LATER_EVENTS_CORRUPT'
      throw error
    }

    const existingIds = new Set(log.rows.map((row) => row.id))
    const plan = planConsolidation(rows, { existingIds })
    const pending = plan.suggestions.filter((s) => !s.already)

    if (args.write) {
      const written = appendEvents(dir, pending.map((s) => ({
        type: s.type,
        id: s.id,
        ids: s.ids,
        summary: s.summary,
        reason: s.reason
      })), { now: Date.now() })
      if (args.json) {
        process.stdout.write(JSON.stringify({
          ok: true,
          dir,
          dryRun: false,
          counts: { ...plan.stats, written: written.length, pending: pending.length },
          suggestions: plan.suggestions,
          written
        }) + '\n')
      } else {
        process.stdout.write('夜间整理（--write）：' + dir + '\n')
        if (!written.length) {
          process.stdout.write('没有新建议，没有写任何文件。\n')
        } else {
          process.stdout.write('已写入 ' + written.length + ' 条建议' + (plan.stats.alreadyWritten ? '，跳过 ' + plan.stats.alreadyWritten + ' 条已写过的' : '') + '。\n')
          process.stdout.write('事件文件：' + eventsFile(dir) + '\n')
          process.stdout.write('只追加；没有改记录，也没有改任何既有事件文件。撤销用 --undo。\n')
        }
      }
      return 0
    }

    if (args.json) {
      process.stdout.write(JSON.stringify({
        ok: true,
        dir,
        dryRun: true,
        counts: { ...plan.stats, written: 0 },
        suggestions: plan.suggestions
      }) + '\n')
    } else {
      process.stdout.write('夜间整理（dry-run：只看不写）：' + dir + '\n\n')
      process.stdout.write(renderPlan(plan) + '\n\n')
      process.stdout.write('dry-run 结束：没有写任何文件。要落盘加 --write（只追加 ' + EVENT_FILE + '）。\n')
    }
    return 0
  } catch (error) {
    process.stderr.write('夜间整理失败：' + msg(error) + '\n')
    return 1
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) process.exitCode = run(process.argv.slice(2))
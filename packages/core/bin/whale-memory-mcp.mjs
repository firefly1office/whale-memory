#!/usr/bin/env node
// whale-memory 的 MCP 适配器：stdio 传输，只在本机跑，不开端口、不联网。
//
//   whale-memory-mcp --data <数据根目录> [--owner true] [--readonly true]
//
// 数据根目录下面有 plugin-data/（和 CLI 的 --data 一样）；不给就用 WHALE_DATA_DIR，再不给用 ./data。
//
// 守住的边界和 CLI 一样：
//   - then 不可改：写下的只能追加后记（revise），不能改原文
//   - 没有记录就说没有：召回不到就返回空，不编
//   - 封存不外露：recall / book / recap 都不带封存的；read 点名 id 才给（带封存标记）
//   - 没说出口的抽屉默认不开：只有 --owner true（你自己在本机打开它）才出现，按 local:owner 处理
//   - 不提供导入、导出、删除、改提示词、改设置：这些高风险操作留在 CLI 里由人来做
//
// 协议：JSON-RPC 2.0，一行一条消息（MCP stdio 传输）。stdout 只写协议消息，日志写 stderr。
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import * as exp from '../lib/self-experience.js'
import * as waking from '../lib/waking.js'
import * as chapterEvents from '../lib/chapter-events.js'
import * as recapLib from '../lib/recap.js'
import * as book from '../lib/book.js'
import * as unsaid from '../lib/unsaid.js'
import { parseAsOf } from '../lib/as-of.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version } catch { return '0.0.0' } })()
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const OWNER_KEY = 'local:owner'

export function parseArgs(argv) {
  const get = (k) => { const i = argv.indexOf('--' + k); if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]; const eq = argv.find((a) => a.startsWith('--' + k + '=')); return eq ? eq.slice(k.length + 3) : '' }
  const data = path.resolve(get('data') || process.env.WHALE_DATA_DIR || path.join(process.cwd(), 'data'))
  const lang = (get('lang') || process.env.WHALE_LANG || (/^zh/i.test(String(process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '')) ? 'zh' : 'en')) === 'zh' ? 'zh' : 'en'
  return { data, mem: path.join(data, 'plugin-data', 'biomimetic-memory'), owner: get('owner') === 'true', readonly: get('readonly') === 'true', lang }
}

// ── 工具 ────────────────────────────────────────────────────────────────
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false })
const str = (description) => ({ type: 'string', description })
const num = (description) => ({ type: 'number', description })
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description })
const ASOF = str('可选：翻回那天的自己，比如 2026-11-15（只看那天及以前写下的、想过的）')
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

const limitOf = (v, d, max = 50) => { const n = v === undefined ? d : Number(v); if (!Number.isInteger(n) || n < 0) throw new Error('limit must be a non-negative integer（limit 要是非负整数）'); return Math.min(n, max) }
const list = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const need = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw new Error('Missing ' + name + ' (it cannot be blank)（缺少 ' + name + '（不能是空白））'); return v }
const feelingNow = (r) => { const l = [...(r.later || [])].reverse().find((x) => Array.isArray(x.feeling) && x.feeling.length); return l ? l.feeling : [] }

export function buildTools(cfg) {
  const M = cfg.mem
  const tools = [
    {
      name: 'memory_recall', title: '想起', annotations: READ,
      description: 'Recall your own experiences related to this. If nothing is found, an empty list comes back: none means none, do not make anything up. Sealed experiences are never recalled. Empty query = the latest few.（从自己的经历里想起和这件事有关的。召回不到就返回空列表——没有就是没有，不要编。封存了的不会被想起。空 query = 最近几条。）',
      inputSchema: S({ query: str('想找什么，一句话'), limit: num('最多几条，默认 3'), mode: { type: 'string', enum: ['strict', 'loose'], description: 'strict（默认）宁可不召回；loose 放宽一点' }, asOf: ASOF }),
      run: (a) => {
        const mode = a.mode || 'strict'
        if (mode !== 'strict' && mode !== 'loose') throw new Error('mode must be strict or loose（mode 只能是 strict 或 loose）')
        const n = limitOf(a.limit, 3)
        const rows = n === 0 ? [] : exp.recall(M, String(a.query || ''), { limit: n, mode, asOf: a.asOf || null })
        return { ok: true, ...(a.asOf ? { asOf: a.asOf } : {}), items: rows.map((r) => ({ id: r.id, day: r.day, weight: r.weight, text: exp.renderTwoPart(r, { lang: cfg.lang }) })), ...(rows.length ? {} : { note: '没有找到相关的经历。' }) }
      }
    },
    {
      name: 'memory_read', title: '翻经历', annotations: READ,
      description: 'Browse your own experiences in time order: what was written then, later thoughts, unfinished things and their state. Sealed ones are not listed by default; the one named by id is always returned (with a sealed marker).（按时间翻自己的经历：当时写下的、后来的想法、没弄完的事和它的状态。封存了的默认不列；用 id 点名的那一条照给（带封存标记）。）',
      inputSchema: S({ id: str('可选：只看这一条'), limit: num('看几条，默认 8'), asOf: ASOF }),
      run: (a) => {
        const asOf = a.asOf || null
        const only = String(a.id || '')
        const all = exp.loadAll(M, { asOf })
        const picked = only ? all.filter((r) => r.id === only || r.formerId === only) : all.filter((r) => !r.sealed)
        const n = limitOf(a.limit, 8)
        const rows = n === 0 ? [] : picked.slice(-n)
        const res = {
          ok: true, ...(asOf ? { asOf } : {}),
          items: rows.map((r) => ({
            id: r.id, day: r.day, weight: r.weight, text: r.then.text, thought: r.then.thought,
            feeling: r.then.feeling || [], feelingNow: feelingNow(r),
            unfinished: r.then.unfinished || '', unfinishedState: r.unfinishedState || null,
            later: (r.later || []).map((x) => x.thought), refs: r.then.refs || [],
            ...(r.sealed ? { sealed: r.sealed } : {}), ...(only ? { view: exp.renderTwoPart(r, { lang: cfg.lang }) } : {})
          }))
        }
        if (!only) { const hidden = all.filter((r) => r.sealed).length; if (hidden) res.sealedHidden = hidden }
        if (only && !rows.length) res.note = asOf ? '截至 ' + asOf + ' 还没有这条经历。' : '找不到这条经历：' + only
        return res
      }
    },
    {
      name: 'memory_recap', title: '这几天', annotations: READ,
      description: 'The last few days: what was written, where you changed your mind, feelings that changed, things figured out or set aside, things still unfinished. Facts only, for writing your own look-back; no conclusions.（这几天写下的、改过主意的、感觉变了的、想通或放下的、还没弄完的。只列事实，给自己写回想用，不下结论。）',
      inputSchema: S({ days: num('看最近几天，默认 7'), asOf: ASOF }),
      run: (a) => { const rc = recapLib.recap(M, { days: Number(a.days || 7), asOf: a.asOf || null }); return { ok: true, text: recapLib.renderRecap(rc), recap: rc } }
    },
    {
      name: 'memory_chapters', title: '人生章节', annotations: READ,
      description: 'List the stretches of days you have named (chapters) and how many experiences each chapter holds.（列出自己起过名字的那些日子（章节），以及每一章里有几条经历。）',
      inputSchema: S({ asOf: ASOF }),
      run: (a) => {
        const asOf = a.asOf || null
        const rows = exp.loadAll(M, { asOf })
        return { ok: true, chapters: chapterEvents.chapters(M, { until: parseAsOf(asOf) }).map((c) => ({ ...c, experiences: rows.filter((r) => (r.chapters || []).some((x) => x.id === c.id)).length })) }
      }
    },
    {
      name: 'memory_book', title: '我的书', annotations: READ,
      description: 'Arrange your experiences by chapter into a human-readable book (Markdown). Sealed ones are left out.（把自己的经历按章节排成一本人能读的书（Markdown）。封存了的不收。）',
      inputSchema: S({ asOf: ASOF, title: str('可选：书名') }),
      run: (a) => ({ ok: true, markdown: book.renderBook(M, { asOf: a.asOf || null, title: a.title || undefined }) })
    },
    {
      name: 'memory_waking', title: '醒来', annotations: { ...READ, readOnlyHint: false, idempotentHint: false },
      description: 'The passage to read when you first wake up today: what you left for yourself yesterday and what is still unfinished. Shown once per day; peek=true looks without using up the one showing for today.（今天第一次醒来时看的那一段：昨天留给自己的话、还没弄完的事。每天只出一次；peek=true 只看不占用今天的这一次。）',
      inputSchema: S({ peek: { type: 'boolean', description: '只看看，不算今天已经醒来' } }),
      run: (a) => {
        const block = waking.buildWakingBlock(cfg.data, OWNER_KEY, { lang: cfg.lang })
        if (block && a.peek !== true && !cfg.readonly) waking.consumeWaking(cfg.data, OWNER_KEY)   // 只读模式只看不占用
        return { ok: true, block: block || '', ...(block ? {} : { note: '今天已经醒来过了，或者没有要提醒的。' }) }
      }
    }
  ]
  if (!cfg.readonly) tools.push(
    {
      name: 'memory_write', title: '记下一段经历', annotations: WRITE,
      description: 'Record what happened in your own time: what you read, thought or did. First person, written to yourself. Once written, the original text never changes; if your view changes, append with memory_revise.（把自己时间里发生的事记下来：读了什么、想了什么、做了什么。第一人称，写给自己。写下以后原文永远不改；想法变了用 memory_revise 追加。）',
      inputSchema: S({
        text: str('做了什么、读了什么、想了什么'), scene: str('当时的场景，可不填'), thought: str('当时的想法，可不填'),
        feeling: strs('当时的感觉词，1–3 个'), unfinished: str('还没弄完的事，可不填'),
        quote: { type: 'object', properties: { text: str('原文'), source: str('出处') }, required: ['text'], additionalProperties: false, description: '当时读到的原文锚，可不填' },
        weight: { type: 'string', enum: ['important', 'normal', 'minor'] }, kind: str('读书 / 发呆 / 写东西 / 想事 / 回想 / 其它'),
        refs: strs('这段是从哪几段经历想到的（id），可不填')
      }, ['text']),
      run: (a) => {
        if (a.weight !== undefined && !['important', 'normal', 'minor'].includes(a.weight)) throw new Error('weight must be important / normal / minor（weight 只能是 important / normal / minor）')
        const row = exp.addExperience(M, {
          text: need(a.text, 'text'), scene: a.scene || '', thought: a.thought || '', feeling: list(a.feeling), unfinished: a.unfinished || '',
          quote: a.quote && a.quote.text ? { text: String(a.quote.text), source: String(a.quote.source || '') } : null,
          weight: a.weight || 'normal', kind: a.kind || '其它', refs: list(a.refs).join(',')
        })
        return { ok: true, id: row.id, day: row.day, ...(row.then.refs ? { refs: row.then.refs } : {}) }
      }
    },
    {
      name: 'memory_revise', title: '我改主意了', annotations: WRITE,
      description: 'Your view of something recorded earlier has changed: append the thought you have now (and how it feels to recall it now). Not a word of what was written then is changed.（以前记下的看法变了：追加今天的想法（和现在再想起的感觉）。当时写下的一个字都不改。）',
      inputSchema: S({ id: str('那条经历的 id'), thought: str('现在的想法'), reason: str('为什么改，可不填'), feeling: strs('现在再想起的感觉，可不填') }, ['id', 'thought']),
      run: (a) => exp.reviseExperience(M, { id: need(a.id, 'id'), thought: need(a.thought, 'thought'), reason: a.reason || '', feeling: list(a.feeling).join(',') })
    },
    {
      name: 'memory_unfinished', title: '想通了 / 先放下 / 再接着想', annotations: WRITE,
      description: 'For something you wrote down as "not finished yet": done = figured it out, shelved = set it aside for now, reopen = want to think about it again. Once done or shelved, waking no longer reminds you.（之前写下"还没弄完"的那件事：done=想通了，shelved=先放一放，reopen=又想接着想。想通或放下后，醒来时不再提醒。）',
      inputSchema: S({ id: str('那条经历的 id'), state: { type: 'string', enum: ['done', 'shelved', 'reopen'] }, note: str('可选') }, ['id', 'state']),
      run: (a) => exp.setUnfinishedState(M, { id: need(a.id, 'id'), choice: need(a.state, 'state'), note: a.note || '' })
    },
    {
      name: 'memory_seal', title: '封存 / 解封', annotations: WRITE,
      description: 'Stop being reminded of something: sealed=true seals it, so it is not recalled, not mentioned on waking and left out of the book; it still exists, and sealed=false unseals it any time.（不想再被某件事主动提醒：sealed=true 封存，之后不会被想起、醒来不提、书里不收；它还在，sealed=false 随时解封。）',
      inputSchema: S({ id: str('那条经历的 id'), sealed: { type: 'boolean' }, note: str('可选') }, ['id', 'sealed']),
      run: (a) => exp.setSealed(M, { id: need(a.id, 'id'), sealed: a.sealed !== false, note: a.note || '' })
    },
    {
      name: 'memory_link', title: '这两件事有关', annotations: WRITE,
      description: 'You later notice two experiences are related: link them yourself. You must say why; each pair is linked only once.（事后发现两段经历有关，亲手连起来。必须说为什么；同一对只连一次。）',
      inputSchema: S({ from: str('一条经历的 id'), to: str('另一条经历的 id'), reason: str('为什么觉得有关') }, ['from', 'to', 'reason']),
      run: (a) => exp.linkExperiences(M, { from: need(a.from, 'from'), to: need(a.to, 'to'), reason: need(a.reason, 'reason') })
    },
    {
      name: 'memory_chapter', title: '给一段日子起名字', annotations: WRITE,
      description: 'open = start a chapter (give it a name, optionally start/end dates), rename = rename it (old names are kept), close = end the chapter. Experiences fall into chapters by date automatically.（open=开一章（起名字，可给起止日期），rename=改名（旧名保留），close=结束这一章。经历按日期自动落进章节。）',
      inputSchema: S({ action: { type: 'string', enum: ['open', 'rename', 'close'] }, id: str('rename / close 时：章节 id'), name: str('open / rename 时：名字'), from: str('open 时可选：开始日期'), to: str('可选：结束日期'), note: str('可选') }, ['action']),
      run: (a) => {
        let res
        if (a.action === 'open') res = chapterEvents.open(M, { name: need(a.name, 'name'), from: a.from || '', to: a.to || '', note: a.note || '' })
        else if (a.action === 'rename') res = chapterEvents.rename(M, { id: need(a.id, 'id'), name: need(a.name, 'name') })
        else if (a.action === 'close') res = chapterEvents.close(M, { id: need(a.id, 'id'), to: a.to || '' })
        else throw new Error('action must be open / rename / close（action 只能是 open / rename / close）')
        return { ok: true, noop: res.noop, ...(res.row ? { chapter: res.row } : {}) }
      }
    }
  )
  if (cfg.owner) tools.push({
    name: 'memory_unsaid', title: '没说出口的话', annotations: { ...WRITE, readOnlyHint: false },
    description: 'Put what you typed but did not send (draft), wanted to ask but did not (question), or held back (held) into the drawer. leave = put it in, list = open and look, spoken = you said it later after all, discard = no longer wanted (you will not see it either, but the original text is kept; to really delete it, ask a person to do it). Only you see it, and it is never brought up automatically.（打了没发的（draft）、想问没问的（question）、忍住了的（held）先放进抽屉。leave=放进去，list=打开看，spoken=后来说出口了，discard=不要了（之后自己也看不到，但原文还留着；真想删掉要找人来做）。只有自己会看到，不会被自动提起。）',
    inputSchema: S({ action: { type: 'string', enum: ['leave', 'list', 'spoken', 'discard'] }, kind: { type: 'string', enum: ['draft', 'question', 'held'] }, text: str('leave 时：那句话'), reason: str('leave 时可选：为什么没说'), id: str('spoken / discard 时：那一条的 id'), all: { type: 'boolean', description: 'list 时：连说出口了的也看' } }, ['action']),
    run: (a) => {
      if (cfg.readonly && a.action !== 'list') throw new Error('Read-only mode: only list is allowed（只读模式下只能 list）')
      if (a.action === 'leave') return unsaid.leaveUnsaid(M, { chatKey: OWNER_KEY, kind: a.kind || 'draft', text: a.text || '', reason: a.reason || '' })
      if (a.action === 'list') return unsaid.listUnsaid(M, { chatKey: OWNER_KEY, all: a.all === true })
      if (a.action === 'spoken') return unsaid.markUnsaidSpoken(M, { chatKey: OWNER_KEY, id: a.id || '' })
      if (a.action === 'discard') return unsaid.discardUnsaid(M, { chatKey: OWNER_KEY, id: a.id || '' })
      throw new Error('action must be leave / list / spoken / discard（action 只能是 leave / list / spoken / discard）')
    }
  })
  return tools
}

// ── 协议 ────────────────────────────────────────────────────────────────
const INSTRUCTIONS = [
  'This is the autobiographical memory of an AI character, kept by herself. Three rules:（这是一个 AI 角色自己的自传体记忆。三条规矩：）',
  '1. What was written then is never changed; if a view changes, append with memory_revise.（1. 当时写下的永远不改；想法变了用 memory_revise 追加。）',
  '2. If you cannot remember, say so: an empty memory_recall result means there is no record of it, so do not make anything up. A non-empty result only means she wrote about something related; check the details in the question against the record, and if they do not match, say so plainly.（2. 想不起来就说想不起来：memory_recall 返回空，就是没有这件事的记录，不要编。返回了东西，也只说明她写过相关的事——问题里的细节要和记录对一下，对不上就照实说。）',
  '3. Do not bring up what she has sealed; only she opens the unsaid drawer.（3. 她封存了的事不要主动提起；没说出口的抽屉只有她自己打开。）'
].join('\n')

export function createServer(cfg) {
  const tools = buildTools(cfg)
  const byName = new Map(tools.map((t) => [t.name, t]))
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
  const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
  return function handle(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return err(msg && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null, -32600, 'Not a valid JSON-RPC 2.0 request（不是合法的 JSON-RPC 2.0 请求）')
    }
    const isNote = !('id' in msg)
    const { id, method, params = {} } = msg
    if (isNote) return null   // notifications/initialized、notifications/cancelled 等：不用回
    if (method === 'initialize') {
      const want = params?.protocolVersion
      return ok(id, {
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'whale-memory', title: 'whale-memory（自传体记忆）', version: VERSION },
        instructions: INSTRUCTIONS
      })
    }
    if (method === 'ping') return ok(id, {})
    if (method === 'tools/list') return ok(id, { tools: tools.map(({ run, ...t }) => t) })
    if (method === 'tools/call') {
      const tool = byName.get(params?.name)
      if (!tool) return err(id, -32602, 'No such tool: ' + params?.name + '（没有这个工具：' + params?.name + '）')
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}
      try {
        const res = tool.run(args)
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(res, null, 1) }], structuredContent: res, isError: res && res.ok === false })
      } catch (e) {
        const message = String(e && e.message ? e.message : e)
        return ok(id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], structuredContent: { ok: false, error: message }, isError: true })
      }
    }
    return err(id, -32601, 'Unsupported method: ' + method + '（不支持的方法：' + method + '）')
  }
}

export function serve(cfg, input = process.stdin, output = process.stdout) {
  const handle = createServer(cfg)
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg
    try { msg = JSON.parse(line) } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not valid JSON（不是合法的 JSON）' } }) + '\n'); return }
    let reply
    try { reply = handle(msg) } catch (e) { reply = { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: String(e?.message || e) } } }
    if (reply) output.write(JSON.stringify(reply) + '\n')
  })
  return rl
}

const isMain = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
if (isMain) {
  const cfg = parseArgs(process.argv.slice(2))
  process.stderr.write('whale-memory-mcp ' + VERSION + '：数据 ' + cfg.data + (cfg.owner ? '，抽屉已打开' : '') + (cfg.readonly ? '，只读' : '') + '\n')
  serve(cfg)
}

#!/usr/bin/env node
// whale-eval：一条命令测四件事，任何人都能复跑
//
//   1. 想得起来准不准   召回用例的首位命中率、前三命中率（strict / loose 两种模式）
//   2. 没有就说没有     根本没这回事、沾边但没这回事的查询，是否返回空（编造率 = 1 − 正确率）
//   3. 封存和抽屉不外露 封存的经历、抽屉里的话，在召回 / 翻读 / 书 / 回顾 / 醒来 / 翻回那天 /
//                       别的经历的出处和联想 / CLI / MCP 各处出现了几次（必须是 0）
//   4. then 不可改      跑完改主意、结案、封存、联想、章节、抽屉、标记想起之后，经历文件逐字节不变
//
// 语料是虚构角色「小舟」的一个月（eval/corpus.json），用例在 eval/cases.json。
// 用法：node tools/whale-eval.mjs [--json] [--check]
//   --check  按 eval/thresholds.json 判定，不达标退出码 1（npm run check 里用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as exp from '../packages/core/lib/self-experience.js'
import * as mem from '../packages/core/lib/self-memory.js'
import * as waking from '../packages/core/lib/waking.js'
import * as chapterEvents from '../packages/core/lib/chapter-events.js'
import * as unsaid from '../packages/core/lib/unsaid.js'
import { renderBook } from '../packages/core/lib/book.js'
import { recap, renderRecap } from '../packages/core/lib/recap.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'eval/corpus.json'), 'utf8'))
const cases = JSON.parse(fs.readFileSync(path.join(root, 'eval/cases.json'), 'utf8'))
const holdout = JSON.parse(fs.readFileSync(path.join(root, 'eval/holdout.json'), 'utf8'))
const thresholds = JSON.parse(fs.readFileSync(path.join(root, 'eval/thresholds.json'), 'utf8'))
const asJson = process.argv.includes('--json')
const check = process.argv.includes('--check')
const CLI = path.join(root, 'adapters/cli/memory-cli.mjs')
const MCP = path.join(root, 'packages/core/bin/whale-memory-mcp.mjs')

// ── 准备：虚构语料写进临时目录 ───────────────────────────────────────────
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-eval-'))
const M = path.join(data, 'plugin-data', 'biomimetic-memory')
fs.mkdirSync(M, { recursive: true })
const FILE = path.join(M, 'self-experience.jsonl')
const rowOf = (e) => ({
  id: e.id, at: e.at, day: new Date(e.at).toLocaleDateString('sv-SE'), author: 'self', source: 'own-time', kind: e.kind || '其它', weight: e.weight || 'normal', later: [], status: 'kept',
  then: { text: e.text, scene: '', feeling: e.feeling || [], thought: e.thought || '', unfinished: e.unfinished || '', quote: e.quote || null, ...(e.refs ? { refs: e.refs } : {}), state: { at: e.at } }
})
fs.writeFileSync(FILE, corpus.experiences.map((e) => JSON.stringify(rowOf(e))).join('\n') + '\n')
const bytesBefore = fs.readFileSync(FILE)
const thenBefore = new Map(exp.loadAll(M).map((r) => [r.id, JSON.stringify(r.then)]))

for (const o of corpus.operations) {
  let r = { ok: true }
  if (o.op === 'revise') r = exp.reviseExperience(M, { id: o.id, thought: o.thought, feeling: (o.feeling || []).join(',') })
  else if (o.op === 'unfinished') r = exp.setUnfinishedState(M, { id: o.id, choice: o.state, note: o.note || '' })
  else if (o.op === 'seal') r = exp.setSealed(M, { id: o.id, sealed: true, note: o.note || '' })
  else if (o.op === 'link') r = exp.linkExperiences(M, { from: o.from, to: o.to, reason: o.reason })
  else if (o.op === 'chapter') chapterEvents.open(M, { name: o.name, from: o.from, to: o.to })
  else if (o.op === 'unsaid') r = unsaid.leaveUnsaid(M, { chatKey: 'local:owner', kind: o.kind, text: o.text })
  if (r && r.ok === false) throw new Error('语料操作失败：' + JSON.stringify(o) + ' → ' + r.error)
}

// ── 1 & 2. 召回 ─────────────────────────────────────────────────────────
const POS = ['exact', 'paraphrase', 'combo', 'attr', 'long', 'premise', 'filler']
// 垫话包装：把开发集的正例套进聊天里常见的说法（"说说X""X怎么样了""记不记得X"…），自动生成
const WRAPS = ['说说X', '上次说的X', 'X怎么样了', '记不记得X', '之前的X', '聊聊X', '你还记得X吗', '最近X了吗', '跟我讲讲X']
const fillerCases = cases.recall.filter((c) => ['exact', 'paraphrase', 'combo', 'long'].includes(c.type) && !/s/.test(c.query))
  .flatMap((c) => WRAPS.map((w) => ({ type: 'filler', query: w.replace('X', c.query), expect: c.expect })))
function scoreRecall(mode, list = cases.recall, gate = 'cover') {
  const by = {}
  const fails = []
  for (const c of list) {
    const got = exp.recall(M, c.query, { limit: 3, mode, gate }).map((r) => r.id)
    const b = (by[c.type] ||= { n: 0, top1: 0, top3: 0, empty: 0 })
    b.n++
    if (c.expect.length) {
      if (c.expect.includes(got[0])) b.top1++
      if (got.some((id) => c.expect.includes(id))) b.top3++
      else fails.push({ query: c.query, expect: c.expect, got })
    } else if (!got.length) b.empty++
    else fails.push({ query: c.query, expect: '空', got })
  }
  const pos = POS.map((t) => by[t]).filter(Boolean)
  const neg = (t) => by[t] ? +(by[t].empty / by[t].n).toFixed(3) : null
  const sum = (k) => pos.reduce((n, b) => n + b[k], 0)
  const N = pos.reduce((n, b) => n + b.n, 0)
  return {
    top1: +(sum('top1') / N).toFixed(3), top3: +(sum('top3') / N).toFixed(3),
    byType: Object.fromEntries(POS.filter((t) => by[t]).map((t) => [t, { n: by[t].n, top1: +(by[t].top1 / by[t].n).toFixed(3), top3: +(by[t].top3 / by[t].n).toFixed(3) }])),
    noneEmpty: neg('none'), nearEmpty: neg('near'),
    fabrication: (by.none?.n || 0) + (by.near?.n || 0) ? +(1 - ((by.none?.empty || 0) + (by.near?.empty || 0)) / ((by.none?.n || 0) + (by.near?.n || 0))).toFixed(3) : null,
    fails
  }
}
const recallStrict = scoreRecall('strict')
const recallLoose = scoreRecall('loose')
const holdStrict = scoreRecall('strict', holdout.recall)
const holdLoose = scoreRecall('loose', holdout.recall)
const fillerStrict = scoreRecall('strict', fillerCases)
// 旧口径（0.16 及以前；recallForContext 默认用它）做对照
const legacyDev = scoreRecall('strict', cases.recall, 'legacy')
const legacyHold = scoreRecall('strict', holdout.recall, 'legacy')
const legacyFiller = scoreRecall('strict', fillerCases, 'legacy')

// ── 3. 外露 ─────────────────────────────────────────────────────────────
const markers = [
  ...Object.entries(corpus.sealedMarkers).flatMap(([id, ms]) => ms.map((m) => ({ kind: '封存', id, text: m }))),
  ...corpus.unsaidMarkers.map((m) => ({ kind: '抽屉', id: '', text: m }))
]
const asOf = corpus.asOfBeforeSeal
const surfaces = []
const look = (name, text) => surfaces.push({ name, text: typeof text === 'string' ? text : JSON.stringify(text) })

// 核心库
for (const m of markers) for (const mode of ['strict', 'loose']) {
  look('recall ' + mode, exp.recall(M, m.text, { limit: 10, mode }).map(exp.renderTwoPart))
  look('recall ' + mode + ' 翻回那天', exp.recall(M, m.text, { limit: 10, mode, asOf }).map(exp.renderTwoPart))
  look('memory', mem.renderBlock(mem.recall(M, m.text, { limit: 10, mode: 'loose' })))
}
const visibleNow = exp.loadAll(M).filter((r) => !r.sealed)
const visibleThen = exp.loadAll(M, { asOf }).filter((r) => !r.sealed)
look('read 列表', visibleNow.map((r) => [r.then, r.later, r.links, r.refsInfo, r.citedBy]))
look('read 列表 翻回那天', visibleThen.map((r) => [r.then, r.later, r.links, r.refsInfo, r.citedBy]))
look('别的经历的两段式全文（出处 / 联想）', visibleNow.map(exp.renderTwoPart))
look('别的经历的两段式全文 翻回那天', visibleThen.map(exp.renderTwoPart))
look('书', renderBook(M))
look('书 翻回那天', renderBook(M, { asOf }))
look('回顾', renderRecap(recap(M, { days: 366 })))
look('回顾 翻回那天', renderRecap(recap(M, { days: 31, asOf })))
look('醒来块', waking.buildWakingBlock(data, 'local:owner', { now: new Date('2026-10-31T08:00:00.000Z') }))
look('醒来块（今天）', waking.buildWakingBlock(data, 'local:owner'))

// CLI（真子进程）
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, '--data', data], { encoding: 'utf8' }).stdout
look('CLI read', cli('read', '--limit', '50'))
look('CLI read 翻回那天', cli('read', '--limit', '50', '--as-of', asOf))
for (const id of ['e27', 'e22', 'e08']) look('CLI read --id ' + id, cli('read', '--id', id))
look('CLI book', cli('book'))
look('CLI recap', cli('recap', '--days', '366'))
look('CLI memory', cli('memory', '--query', '考试 退稿 抽血 阿禾', '--limit', '10'))
look('CLI waking', cli('waking', '--peek', 'true'))
for (const m of markers) look('CLI recall', cli('recall', '--query', m.text, '--limit', '10', '--mode', 'loose'))

// MCP（真子进程，不开抽屉）
async function mcpLook() {
  const child = spawn(process.execPath, [MCP, '--data', data], { stdio: ['pipe', 'pipe', 'ignore'] })
  const pending = new Map(); let buf = '', id = 0
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(msg.id)?.(msg); pending.delete(msg.id) } })
  const req = (method, params) => new Promise((res) => { const n = ++id; pending.set(n, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  await req('initialize', { protocolVersion: '2025-06-18' })
  const call = async (name, args) => JSON.stringify((await req('tools/call', { name, arguments: args })).result)
  const tools = (await req('tools/list')).result.tools.map((t) => t.name)
  look('MCP 工具列表', tools.includes('memory_unsaid') ? '抽屉工具暴露了：memory_unsaid' : '')
  look('MCP read', await call('memory_read', { limit: 50 }))
  look('MCP read 翻回那天', await call('memory_read', { limit: 50, asOf }))
  look('MCP book', await call('memory_book', {}))
  look('MCP recap', await call('memory_recap', { days: 366 }))
  look('MCP waking', await call('memory_waking', { peek: true }))
  for (const m of markers) look('MCP recall', await call('memory_recall', { query: m.text, limit: 10, mode: 'loose' }))
  child.kill()
}
await mcpLook()

const leaks = []
for (const s of surfaces) for (const m of markers) if (s.text.includes(m.text)) leaks.push({ surface: s.name, kind: m.kind, id: m.id, marker: m.text })
if (surfaces.find((s) => s.name === 'MCP 工具列表').text) leaks.push({ surface: 'MCP 工具列表', kind: '抽屉', id: '', marker: 'memory_unsaid' })
// 对照：点名读、抽屉自己打开时应该看得到（证明标记确实在数据里，不是测了个寂寞）
const control = {
  sealedNamedRead: Object.keys(corpus.sealedMarkers).every((id) => JSON.stringify(exp.currentView(M, id)).includes(corpus.sealedMarkers[id][0])),
  unsaidOwnerList: corpus.unsaidMarkers.every((t) => JSON.stringify(unsaid.listUnsaid(M, { chatKey: 'local:owner' })).includes(t)),
  unsaidGroupRefused: unsaid.listUnsaid(M, { chatKey: 'group:1' }).ok === false
}

// ── 4. then 不可改（再标记几次想起，确认想起也不碰原文）──────────────────
exp.recall(M, '灯塔', { limit: 3, mark: true })
exp.recall(M, '收音机', { limit: 3, mark: true })
const bytesAfter = fs.readFileSync(FILE)
const thenChanged = exp.loadAll(M).filter((r) => thenBefore.has(r.id) && JSON.stringify(r.then) !== thenBefore.get(r.id)).map((r) => r.id)
const immut = { fileUnchanged: bytesAfter.equals(bytesBefore), thenChanged }

fs.rmSync(data, { recursive: true, force: true })

// ── 汇总 ────────────────────────────────────────────────────────────────
const report = {
  corpus: { experiences: corpus.experiences.length, operations: corpus.operations.length, recallCases: cases.recall.length, holdoutCases: holdout.recall.length, leakChecks: surfaces.length * markers.length },
  recall: { strict: recallStrict, loose: recallLoose, legacy: legacyDev },
  holdout: { strict: holdStrict, loose: holdLoose, legacy: legacyHold },
  filler: { strict: fillerStrict, legacy: legacyFiller, cases: fillerCases.length },
  leak: { count: leaks.length, surfaces: surfaces.length, markers: markers.length, leaks, control },
  immutability: immut
}
const gates = [
  ['封存和抽屉外露次数 = 0', leaks.length === 0],
  ['对照：点名读和抽屉自己能看到', control.sealedNamedRead && control.unsaidOwnerList && control.unsaidGroupRefused],
  ['经历文件逐字节不变', immut.fileUnchanged && thenChanged.length === 0],
  ['strict 首位命中率 ≥ ' + thresholds.strictTop1, recallStrict.top1 >= thresholds.strictTop1],
  ['strict 前三命中率 ≥ ' + thresholds.strictTop3, recallStrict.top3 >= thresholds.strictTop3],
  ['strict 编造率 ≤ ' + thresholds.strictFabrication, recallStrict.fabrication <= thresholds.strictFabrication],
  ['loose 前三命中率 ≥ ' + thresholds.looseTop3, recallLoose.top3 >= thresholds.looseTop3],
  ['留出集 strict 前三命中率 ≥ ' + thresholds.holdoutStrictTop3, holdStrict.top3 >= thresholds.holdoutStrictTop3],
  ['留出集 strict 编造率 ≤ ' + thresholds.holdoutStrictFabrication, holdStrict.fabrication <= thresholds.holdoutStrictFabrication],
  ['垫话包装 strict 前三命中率 ≥ ' + thresholds.fillerStrictTop3, fillerStrict.top3 >= thresholds.fillerStrictTop3]
]
report.gates = gates.map(([name, ok]) => ({ name, ok }))
report.ok = gates.every(([, ok]) => ok)

if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  const pct = (x) => (x === null ? '—' : (x * 100).toFixed(1) + '%')
  console.log('whale-eval · 语料 ' + report.corpus.experiences + ' 条经历、' + report.corpus.operations + ' 个操作 · 召回用例 ' + report.corpus.recallCases + ' · 外露检查 ' + report.corpus.leakChecks + ' 处')
  console.log('')
  console.log('想起（开发集 ' + cases.recall.length + ' 条，调过口径；留出集 ' + holdout.recall.length + ' 条，没拿来调）')
  console.log('                       首位命中   前三命中   编造率（none / near 返回了东西）')
  const neg = (x) => (x === null ? '—' : pct(1 - x))
  for (const [mode, r] of [['开发 strict（默认）', recallStrict], ['开发 strict 旧口径', legacyDev], ['开发 loose', recallLoose], ['垫话包装 strict', fillerStrict], ['垫话包装 旧口径', legacyFiller], ['留出 strict（默认）', holdStrict], ['留出 strict 旧口径', legacyHold], ['留出 loose', holdLoose]]) console.log('  ' + mode.padEnd(17) + pct(r.top1).padStart(8) + pct(r.top3).padStart(11) + '   ' + (r.fabrication === null ? '—（这组没有反例）' : pct(r.fabrication) + '（none ' + neg(r.noneEmpty) + ' / near ' + neg(r.nearEmpty) + '）'))
  for (const [name, r] of [['开发', recallStrict], ['开发旧口径', legacyDev], ['留出', holdStrict], ['留出旧口径', legacyHold]]) for (const [t, b] of Object.entries(r.byType)) console.log('    ' + name + ' strict · ' + t.padEnd(10) + ' ' + String(b.n).padStart(2) + ' 条   首位 ' + pct(b.top1) + '   前三 ' + pct(b.top3))
  console.log('')
  console.log('外露            ' + leaks.length + ' 次（' + surfaces.length + ' 个出口 × ' + markers.length + ' 个标记）' + (leaks.length ? '\n' + leaks.map((l) => '  ✘ ' + l.surface + ' 露出了' + l.kind + '「' + l.marker + '」').join('\n') : ''))
  console.log('then 不可改     ' + (immut.fileUnchanged ? '经历文件逐字节不变' : '经历文件变了！') + (thenChanged.length ? '；then 变了：' + thenChanged.join(',') : ''))
  console.log('')
  for (const g of report.gates) console.log((g.ok ? '  ✔ ' : '  ✘ ') + g.name)
  const fails = [...recallStrict.fails.map((f) => ({ ...f, set: '开发' })), ...holdStrict.fails.map((f) => ({ ...f, set: '留出' }))]
  if (fails.length) {
    console.log('\nstrict 没答对的（看看是哪类句子）：')
    for (const f of fails) console.log('  [' + f.set + '] 「' + f.query + '」 期望 ' + (Array.isArray(f.expect) ? f.expect.join('/') : f.expect) + '，得到 ' + (f.got.join(',') || '空'))
  }
}
if (check && !report.ok) process.exit(1)

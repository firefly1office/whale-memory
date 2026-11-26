// v1 契约测试（1.0）：当前实现必须过。
// 只断言「契约里写了什么」，不测内部实现细节；实现换了（比如换存储引擎）这套测试不该改。
//
// 用例名里的 `§x-y` 是条款号，和 docs/contract-v1-zh.md 附录 A 的登记表一一对应；
// tests/contract-coverage.test.mjs 会解析本文与文档，缺一条就红。
// 条款要改语义就换新号，不要改已有编号去迁就实现。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { addExperience, loadAll, setSealed, reviseExperience, recall } from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import { exportMemory } from '../packages/core/lib/export-memory.js'
import * as book from '../packages/core/lib/book.js'
import * as audit from '../packages/core/lib/audit.js'
import { sqliteAvailable } from '../packages/core/lib/sqlite-store.js'
import { tmpDir, safeRemove } from './_safety.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const schema = JSON.parse(fs.readFileSync(path.join(repo, 'schemas', 'record.v1.json'), 'utf8'))

// 每个用例自己造一个临时目录，结束时按护栏登记过的根删掉（tests/_safety.mjs 的白名单）
const withDir = (t, prefix = 'wm-contract-') => {
  const dir = tmpDir(prefix)
  t.after(() => safeRemove(dir))
  return dir
}
const rowsOf = (dir) => fs.readFileSync(path.join(dir, 'self-experience.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
const readIf = (dir, name) => {
  try { return fs.readFileSync(path.join(dir, name), 'utf8') } catch { return '' }
}
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const runMigrate = (dir) => spawnSync(process.execPath, [path.join(repo, 'tools', 'migrate-storage.mjs'), dir, '--write'], { encoding: 'utf8' })
// CLI 是「展示路径」里最要紧的一条（宿主照着它拼提示词）：这里按它的数据根跑一次
const CLI = path.join(repo, 'adapters', 'cli', 'memory-cli.mjs')
function runCli(dataRoot, args) {
  const res = spawnSync(process.execPath, [CLI, ...args, '--data', dataRoot], { encoding: 'utf8' })
  assert.equal(res.status, 0, 'CLI 失败：' + (res.stderr || res.stdout).slice(-400))
  return JSON.parse(res.stdout)
}

// ---------------- 〇、稳定面 ----------------

test('契约 §0.1-1：六个动作（+ v1.1 的擦除/导出）的名字、参数与返回面在 1.0 内不变', (t) => {
  const dir = withDir(t)
  const made = addExperience(dir, {
    text: 'API 面', scene: '屋里', feeling: ['平静'], thought: '想到', unfinished: '没弄完',
    quote: { text: '引用', source: '书' }, weight: 'important', kind: '自己', state: { where: '家' }, source: 'own-time'
  })
  assert.equal(typeof made.id, 'string')
  const rows = loadAll(dir, { asOf: null, allowCorrupt: false, allowSealCorrupt: false, backend: 'file' })
  assert.equal(rows.length, 1)
  const hits = recall(dir, 'API', { limit: 3, includeSealed: false, asOf: null, backend: 'file', ranker: 'literal', gate: 'cover', mode: 'strict' })
  assert.ok(hits.length >= 1)
  const seal = setSealed(dir, { id: made.id, sealed: true, note: '记一下' })
  assert.deepEqual(Object.keys(seal).sort(), ['at', 'id', 'noop', 'ok', 'sealed'])
  const revised = reviseExperience(dir, { id: made.id, thought: '又想到', reason: '复盘', feeling: ['释然'] })
  assert.equal(revised.ok, true)
  assert.equal(typeof book.renderBook(dir, { asOf: null, includeSealed: false, title: 't', now: new Date() }), 'string')
  assert.equal(typeof exportMemory(dir, { includeSealed: true, backend: 'file' }), 'string')
  const erased = eraseExperience(dir, { id: made.id, reason: '她要求撤回', actor: 'self' })
  assert.equal(erased.ok, true)
})

test('契约 §0.1-2：schema 的必填与枚举值是承诺面——只增不改', () => {
  assert.deepEqual([...schema.required].sort(), ['at', 'day', 'id', 'then'])
  assert.deepEqual(schema.properties.author.enum, ['self', 'legacy'])
  assert.deepEqual(schema.properties.weight.enum, ['important', 'normal', 'minor'])
  assert.deepEqual(schema.properties.status.enum, ['kept'])
  assert.equal(schema.properties.id.pattern, '^exp_[a-z0-9]+$')
  assert.deepEqual(schema.properties.then.required, ['text'])
  assert.equal(schema.properties.then.properties.text.maxLength, 2000)
  assert.equal(schema.properties.then.properties.feeling.maxItems, 8)
})

test('契约 §0.1-3 / §2.1-1：文件名清单是契约，写完的文件就是这几个名字、都是 JSONL', (t) => {
  const dir = withDir(t)
  const made = addExperience(dir, { text: '文件布局' })
  reviseExperience(dir, { id: made.id, thought: '后记' })
  setSealed(dir, { id: made.id, sealed: true, note: '理由' })
  eraseExperience(dir, { id: made.id, reason: '撤回', actor: 'self' })
  audit.noteRead(dir, { actor: 'self', ids: [] })
  const allowed = new Set([
    'self-experience.jsonl', 'later-events.jsonl', 'seal-events.jsonl', 'recall-events.jsonl',
    'unfinished-events.jsonl', 'unsaid.jsonl', 'tombstones.jsonl', 'audit.jsonl'
  ])
  const present = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  assert.deepEqual(present.filter((f) => !allowed.has(f)), [], '出现了清单外的 JSONL 文件名')
  for (const name of ['self-experience.jsonl', 'later-events.jsonl', 'seal-events.jsonl', 'tombstones.jsonl', 'audit.jsonl']) {
    assert.ok(present.includes(name), '缺文件：' + name)
    for (const line of readIf(dir, name).split('\n').filter(Boolean)) {
      assert.doesNotThrow(() => JSON.parse(line), name + ' 里的行不是 JSON')
    }
  }
})

test('契约 §0.1-4 / §4-1 / §4-2 / §4-3：错误形状就两种——抛 Error 或返回 ok:false，且读不出来不许装空', async (t) => {
  const dir = withDir(t)
  // 抛 Error
  assert.throws(() => addExperience(dir, { text: '' }), (e) => e instanceof Error)
  // 返回 ok:false，不抛
  const miss = setSealed(dir, { id: 'exp_nope', sealed: true })
  assert.equal(miss.ok, false)
  assert.equal(typeof miss.error, 'string')
  assert.equal(reviseExperience(dir, { id: 'exp_nope', thought: 'x' }).ok, false)
  // 读不出来：抛错，不是空数组
  fs.appendFileSync(path.join(dir, 'self-experience.jsonl'), '{坏行\n')
  assert.throws(() => loadAll(dir), (e) => e instanceof Error, '坏行必须抛，不能返回空数组')
  // sqlite 读路径的错误码是承诺面（拿不到 node:sqlite 的环境跳过）
  if (!sqliteAvailable()) return
  const jsonlOnly = withDir(t)
  addExperience(jsonlOnly, { text: '没迁移过' })
  assert.throws(() => loadAll(jsonlOnly, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_NOT_MIGRATED')
})

// ---------------- 一、根原则 ----------------

test('契约 §1-1：记录不可变——改主意只追加事件，原行一个字节都不变', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '想去学游泳' })
  const before = rowsOf(dir)[0]
  reviseExperience(dir, { id: row.id, thought: '不想学了，改成跑步' })
  const after = rowsOf(dir)[0]
  assert.deepEqual(after, before, '原记录必须原样保留')
  assert.equal(fs.existsSync(path.join(dir, 'later-events.jsonl')), true, '改主意要落事件文件')
})

test('契约 §1-2 / §1-3：整条撤回删正文与关联事件，墓碑只留 id/时间/原因/哈希、不可用于恢复', (t) => {
  const dir = withDir(t)
  const token = '这是要被撤回的正文-tonic-9f2'
  const row = addExperience(dir, { text: token })
  reviseExperience(dir, { id: row.id, thought: '后记也会被删' })
  assert.ok(readIf(dir, 'later-events.jsonl').includes(row.id), '撤回前后记在')

  const res = eraseExperience(dir, { id: row.id, reason: '她要求撤回', actor: 'self' })
  assert.equal(res.ok, true)
  assert.equal(res.alreadyGone, false)
  assert.equal(res.tombstone, true)
  // hash = 删除前那一行原样字节（不含行尾换行）的 sha256，拿一份备份就能对上
  assert.match(res.hash, /^[0-9a-f]{64}$/)

  assert.equal(readIf(dir, 'self-experience.jsonl').includes(token), false, '经历文件里不许再有正文')
  assert.equal(readIf(dir, 'later-events.jsonl').includes(row.id), false, '关联事件要一起删')
  assert.deepEqual(loadAll(dir), [], '读路径上不许再看到它')

  const marks = readIf(dir, 'tombstones.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(marks.length, 1)
  const mark = marks[0]
  for (const key of ['v', 'id', 'at', 'reason', 'actor', 'hash']) assert.ok(key in mark, '墓碑缺字段：' + key)
  assert.equal(mark.id, row.id)
  assert.equal(mark.reason, '她要求撤回')
  assert.equal(readIf(dir, 'tombstones.jsonl').includes(token), false, '墓碑里不许有正文')
  assert.equal('text' in mark, false, '墓碑不可用于恢复：不许留正文/可还原字段')
})

test('契约 §1-4 / §3.4-1 / §3.4-2 / §3.4-3 / §3.4-4：封存不删除，重复封存是 noop，目标不存在返回 ok:false', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '一件不想再被提起的事' })
  const res = setSealed(dir, { id: row.id, sealed: true, note: '先放着' })
  assert.equal(res.ok, true)
  assert.equal(res.noop, false, '第一次封存不是 noop')
  assert.deepEqual(Object.keys(res).sort(), ['at', 'id', 'noop', 'ok', 'sealed'], '成功形状 { ok, id, sealed, at, noop }')
  const seen = loadAll(dir).find((r) => r.id === row.id)
  assert.ok(seen, '记录还在')
  assert.ok(seen.sealed, 'loadAll 必须带上 sealed 状态，交调用方过滤')
  assert.equal(recall(dir, '一件不想再被提起的事', { limit: 5 }).some((r) => r.id === row.id), false, '召回必须过滤封存')
  assert.ok(rowsOf(dir).some((r) => r.id === row.id), '原始文件里必须还在——封存不是删除')

  const again = setSealed(dir, { id: row.id, sealed: true })
  assert.equal(again.ok, true)
  assert.equal(again.noop, true, '重复封存是 noop，不报错')

  const missing = setSealed(dir, { id: 'exp_不存在', sealed: true })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /not found|找不到/i)
})

// ---------------- 二、数据契约 ----------------

test('契约 §2.1-2：最后一行没有换行也读得出；坏行要报出来，不能当空', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '第一行' })
  // 去掉行尾换行：解析方必须容忍
  const file = path.join(dir, 'self-experience.jsonl')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n$/, ''), 'utf8')
  assert.equal(loadAll(dir).length, 1, '最后一行没换行也要读得到')
  // 追加还能正常工作（补换行）
  const second = addExperience(dir, { text: '第二行' })
  assert.deepEqual(loadAll(dir).map((r) => r.id), [row.id, second.id])
  // 坏行：抛错，不当空
  fs.appendFileSync(file, '{"id": \n')
  assert.throws(() => loadAll(dir), (e) => /行|corrupt|解析/i.test(String(e.message)), '坏行要报出来')
})

test('契约 §2.1-3：迁移到 memory.sqlite 是叠加——JSONL 一个字节不改，读出来逐条相同', (t) => {
  if (!sqliteAvailable()) return t.diagnostic('skip: 本机拿不到 node:sqlite')
  const dir = withDir(t)
  addExperience(dir, { text: '海边的一天' })
  addExperience(dir, { text: '山上的一天', weight: 'important' })
  const before = new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => [f, sha256(readIf(dir, f))]))
  const migrated = runMigrate(dir)
  assert.equal(migrated.status, 0, '迁移失败：' + migrated.stdout + migrated.stderr)
  const after = new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => [f, sha256(readIf(dir, f))]))
  assert.deepEqual(after, before, '迁移不许改任何 JSONL（不删、不改）')
  const viaFile = loadAll(dir).map((r) => r.id)
  const viaSqlite = loadAll(dir, { backend: 'sqlite' }).map((r) => r.id)
  assert.deepEqual(viaSqlite, viaFile)
})

test('契约 §2.2-1 / §2.2-6 / §2.2-4：id 形状、落盘行符合 schema 必填与类型、later 写入时为空', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '今天把柜子修好了', feeling: ['平静'], weight: 'minor' })
  for (const key of schema.required) assert.ok(key in row, '缺必填字段：' + key)
  assert.match(row.id, /^exp_[a-z0-9]+$/)
  assert.equal(row.then.text, '今天把柜子修好了')
  assert.ok(Array.isArray(row.later) && row.later.length === 0, 'later 写入时必须为空数组')
  assert.equal(row.status, 'kept')

  const line = rowsOf(dir)[0]
  for (const key of schema.required) assert.ok(key in line)
  assert.equal(typeof line.id, 'string')
  assert.equal(typeof line.then.text, 'string')
  assert.ok(line.then.text.length <= schema.properties.then.properties.text.maxLength)
  assert.ok(['important', 'normal', 'minor'].includes(line.weight))
  assert.ok(schema.properties.author.enum.includes(line.author))
  assert.ok(schema.properties.status.enum.includes(line.status))
  // additionalProperties: false —— 契约字段之外的键一个都不该有
  for (const key of Object.keys(line)) assert.ok(key in schema.properties, '落盘行里出现 schema 外的字段：' + key)
})

test('契约 §2.2-2：at 是写入时刻（ISO 8601），day 是本地日', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '时间语义' })
  assert.match(row.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  const local = new Date(row.at).toLocaleDateString('sv-SE')
  assert.equal(row.day, local, 'day 必须是 at 的本地日')
  assert.equal(loadAll(dir)[0].day, row.day)
})

test('契约 §2.2-3 / §3.5-1：改主意只追加事件，then 一个字都不动', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '原来的想法', thought: '当时怎么想' })
  reviseExperience(dir, { id: row.id, thought: '现在怎么想', reason: '想通了', feeling: ['释然'] })
  const then = rowsOf(dir)[0].then
  assert.deepEqual(then, row.then, 'then 必须逐字段不变')
  const later = readIf(dir, 'later-events.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.equal(later.length, 1)
  assert.equal(later[0].thought, '现在怎么想')
  const merged = loadAll(dir)[0]
  assert.equal(merged.later.length, 1, '后记从事件合并出来')
})

test('契约 §2.2-5：sealed 不是记录字段——落盘的行走从来不带它', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '封存状态不在记录里' })
  assert.equal('sealed' in rowsOf(dir)[0], false)
  setSealed(dir, { id: row.id, sealed: true })
  assert.equal('sealed' in rowsOf(dir)[0], false, '封存后落盘的记录仍然不带 sealed')
  assert.ok(loadAll(dir)[0].sealed, 'sealed 由 seal-events 推出来，只出现在读结果里')
})

test('契约 §2.3-1：as-of 口径 A——那一刻已存在、且当时还没被封存的才返回', async (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '很早以前的事' })
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  assert.equal(loadAll(dir, { asOf: past }).length, 0, 'as-of 到写入之前应当看不到')
  assert.equal(loadAll(dir, { asOf: future }).length, 1)

  // 封存发生在 as-of 之后：那条不算"当时已封存"，但读法上照样过滤（口径 A 的后半句）
  await wait(15)
  const mid = new Date().toISOString()
  await wait(15)
  setSealed(dir, { id: row.id, sealed: true, note: '后来才封的' })
  const seen = loadAll(dir, { asOf: mid }).find((r) => r.id === row.id)
  assert.ok(seen, '那一刻它还没被封存，所以存在')
  assert.equal(seen.sealed.afterAsOf, true, '后来才封存的要标出来')
  assert.equal(recall(dir, '很早以前的事', { asOf: mid }).some((r) => r.id === row.id), false, '翻回那天也不把现在封存的翻出来')
})

test('契约 §2.3-3：asOf 缺省就是现在', (t) => {
  const dir = withDir(t)
  addExperience(dir, { text: '现在能看到的一条' })
  const now = loadAll(dir).map((r) => r.id)
  const explicitNow = loadAll(dir, { asOf: new Date().toISOString() }).map((r) => r.id)
  const longAfter = loadAll(dir, { asOf: new Date(Date.now() + 86400000).toISOString() }).map((r) => r.id)
  assert.deepEqual(now, explicitNow, '不传 asOf 与传"现在"结果相同')
  assert.deepEqual(now, longAfter, '不传 asOf 与传未来也相同（都是"现在的样子"）')
  assert.equal(loadAll(dir, { asOf: null }).length, 1, 'asOf: null 也等于现在')
  assert.equal(loadAll(dir, { asOf: new Date(Date.now() - 86400000).toISOString() }).length, 0)
})

test('契约 §2.3-2 / §3.6-3：封存理由只在结构化读里给；展示与导出（含 CLI 翻回那天）都不写', async (t) => {
  const dir = withDir(t)
  const text = '她不想被提起的那件事-q7'
  const note = '封存理由里可能有她的原话-z3'
  const row = addExperience(dir, { text })
  setSealed(dir, { id: row.id, sealed: true, note })

  assert.equal(loadAll(dir)[0].sealed.note, note, '结构化读给理由（这是 1.0 收准后的口径）')
  const exported = exportMemory(dir, { includeSealed: true })
  assert.ok(exported.includes(row.id), '整份导出默认包含封存内容')
  const line = JSON.parse(exported.split('\n').filter(Boolean)[0])
  assert.equal(line.sealed, true, '封存内容只打 sealed: true')
  assert.equal('note' in line, false, '数据导出不许写封存理由')
  assert.equal(exported.includes(note), false)
  assert.equal(exportMemory(dir, { includeSealed: false }).includes(row.id), false, 'includeSealed: false 时完全排除')

  const md = book.renderBook(dir)
  assert.equal(md.includes(text), false, '展示型导出默认不写封存正文')
  assert.equal(md.includes(note), false)

  // 第三层：CLI 的展示视图。翻回那天时 note 必须摘掉（理由是她后来才写下的），现在看要照给
  const dataRoot = path.join(dir, 'cli')
  const written = runCli(dataRoot, ['write', '--text', 'CLI 视图里的一条'])
  await wait(20)
  const mid = new Date().toISOString()
  await wait(20)
  runCli(dataRoot, ['seal', '--id', written.id, '--note', 'CLI 里的封存理由'])
  const asOfView = runCli(dataRoot, ['read', '--as-of', mid, '--sealed', 'true']).items.find((r) => r.id === written.id)
  assert.equal(asOfView.sealed.afterAsOf, true)
  assert.equal('note' in asOfView.sealed, false, 'CLI 翻回那天时不许带封存理由')
  const nowView = runCli(dataRoot, ['read', '--sealed', 'true']).items.find((r) => r.id === written.id)
  assert.equal(nowView.sealed.note, 'CLI 里的封存理由', '现在看照给')
})

// ---------------- 三、API ----------------

test('契约 §3.1-1 / §3.1-2 / §3.1-3：写入返回整条记录、非法输入抛错、不幂等', (t) => {
  const dir = withDir(t)
  const first = addExperience(dir, { text: '同一句话' })
  const second = addExperience(dir, { text: '同一句话' })
  assert.equal(first.then.text, '同一句话')
  assert.equal(typeof first.id, 'string')
  assert.notEqual(first.id, second.id, '不幂等：同样内容也是两条记录')
  assert.equal(loadAll(dir).length, 2)

  assert.throws(() => addExperience(dir, { text: '' }))
  assert.throws(() => addExperience(dir, { text: 'x'.repeat(2001) }))
  assert.throws(() => addExperience(dir, { text: 'ok', feeling: Array.from({ length: 9 }, (_, i) => 'f' + i) }))
  assert.equal(loadAll(dir).length, 2, '抛错的调用不该留下记录')
})

test('契约 §3.1-4：写入是追加——之前写下的字节一个都不变', (t) => {
  const dir = withDir(t)
  addExperience(dir, { text: '第一条' })
  const before = fs.readFileSync(path.join(dir, 'self-experience.jsonl'))
  addExperience(dir, { text: '第二条' })
  const after = fs.readFileSync(path.join(dir, 'self-experience.jsonl'))
  assert.ok(after.length > before.length)
  assert.deepEqual(after.subarray(0, before.length), before, '前缀必须逐字节相同（不重写文件）')
})

test('契约 §3.2-1 / §3.2-2 / §3.3-1 / §3.3-2：按文件顺序返回、封存仍返回、召回可截断且可重复', (t) => {
  const dir = withDir(t)
  const a = addExperience(dir, { text: '上周去了杭州看桂花' })
  const b = addExperience(dir, { text: '在西湖边吃了碗面' })
  const c = addExperience(dir, { text: '杭州的桂花很香' })
  assert.deepEqual(loadAll(dir).map((r) => r.id), [a.id, b.id, c.id], '按文件顺序')
  assert.deepEqual(loadAll(dir).map((r) => r.id), loadAll(dir).map((r) => r.id), 'id 稳定：两次全量读一样')

  const hits = recall(dir, '杭州 桂花', { limit: 2 })
  assert.ok(hits.length <= 2, 'limit 要能截断')
  if (hits.length) assert.equal(typeof hits[0].id, 'string', '命中必须带 id')
  const r1 = recall(dir, '杭州 桂花', { limit: 5 }).map((r) => r.id)
  const r2 = recall(dir, '杭州 桂花', { limit: 5 }).map((r) => r.id)
  assert.deepEqual(r1, r2, '同一查询两次结果顺序必须一致')

  setSealed(dir, { id: b.id, sealed: true })
  const all = loadAll(dir)
  assert.equal(all.length, 3, '已封存的仍然返回，过滤是调用方的事')
  assert.ok(all.find((r) => r.id === b.id).sealed, '带上 sealed 对象')
})

test('契约 §3.2-3：坏行默认 fail closed；allowCorrupt 是后门、不当展示用', (t) => {
  const dir = withDir(t)
  addExperience(dir, { text: '好的一条' })
  fs.appendFileSync(path.join(dir, 'self-experience.jsonl'), 'not json\n')
  assert.throws(() => loadAll(dir), '默认必须抛（fail closed）')
  const backdoor = loadAll(dir, { allowCorrupt: true })
  assert.equal(backdoor.length, 1, '后门能读出没坏的那部分，但只给备份/计数用')
})

test('契约 §3.2-4：backend 默认 file；sqlite 逐条相等；读不出来抛错、不静默退回', (t) => {
  if (!sqliteAvailable()) return t.diagnostic('skip: 本机拿不到 node:sqlite')
  const dir = withDir(t)
  addExperience(dir, { text: '一条' })
  addExperience(dir, { text: '两条', weight: 'important' })
  reviseExperience(dir, { id: loadAll(dir)[0].id, thought: '后记' })
  assert.equal(loadAll(dir).length, loadAll(dir, { backend: 'file' }).length, '不传就是 file')
  const migrated = runMigrate(dir)
  assert.equal(migrated.status, 0, '迁移失败：' + migrated.stderr)
  assert.deepEqual(loadAll(dir, { backend: 'sqlite' }), loadAll(dir, { backend: 'file' }), '两个后端逐条相等')
  assert.deepEqual(recall(dir, '一条', { backend: 'sqlite' }).map((r) => r.id), recall(dir, '一条', { backend: 'file' }).map((r) => r.id))

  // 迁移之后 JSONL 又变了 → 抛 STORAGE_STALE，不退回 file、不当空
  addExperience(dir, { text: '迁移之后又写的' })
  assert.throws(() => loadAll(dir, { backend: 'sqlite' }), (e) => e.code === 'STORAGE_STALE')
  assert.equal(loadAll(dir).length, 3, 'file 后端照常')
})

test('契约 §3.5-2：改主意的目标不存在时明确报错，不留谁也看不见的后记', (t) => {
  const dir = withDir(t)
  const res = reviseExperience(dir, { id: 'exp_没有这条', thought: '白写' })
  assert.equal(res.ok, false)
  assert.match(res.error, /not found|找不到/i)
  assert.equal(readIf(dir, 'later-events.jsonl'), '', '不许留下孤儿后记')
})

test('契约 §3.6-1 / §3.6-2：导出只读，且展示型导出尊重封存', (t) => {
  const dir = withDir(t)
  const kept = addExperience(dir, { text: '可以写进书里的事' })
  const sealed = addExperience(dir, { text: '不要写进书里的事' })
  setSealed(dir, { id: sealed.id, sealed: true, note: '别写' })
  const snapshot = () => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, sha256(readIf(dir, f))]))
  const before = snapshot()
  book.renderBook(dir)
  exportMemory(dir)
  assert.deepEqual(snapshot(), before, '导出不许改任何数据文件')

  const md = book.renderBook(dir)
  assert.ok(md.includes(kept.then.text), '没封存的照常导出')
  assert.equal(md.includes(sealed.then.text), false, '封存正文默认不进展示型导出')
})

test('契约 §5-2：三条语义任何版本都不改（then 不可变 / as-of 口径 / 封存≠删除）', (t) => {
  const dir = withDir(t)
  const row = addExperience(dir, { text: '三条语义' })
  const then = rowsOf(dir)[0].then
  reviseExperience(dir, { id: row.id, thought: '改主意' })
  setSealed(dir, { id: row.id, sealed: true, note: '封存' })
  assert.deepEqual(rowsOf(dir)[0].then, then, '① then 不可变')
  assert.equal(loadAll(dir, { asOf: new Date(Date.now() - 86400000).toISOString() }).length, 0, '② as-of 口径')
  assert.ok(rowsOf(dir).some((r) => r.id === row.id), '③ 封存不等于删除')
})

test('契约 §5-5：id 永不复用——撤回之后也不会重新发出去', (t) => {
  const dir = withDir(t)
  const seen = new Set()
  for (let i = 0; i < 5; i += 1) {
    const row = addExperience(dir, { text: '第 ' + i + ' 条' })
    assert.equal(seen.has(row.id), false, 'id 重复了：' + row.id)
    seen.add(row.id)
  }
  const doomed = [...seen][0]
  eraseExperience(dir, { id: doomed, reason: '撤回', actor: 'self' })
  for (let i = 0; i < 5; i += 1) {
    const row = addExperience(dir, { text: '撤回后再写 ' + i })
    assert.notEqual(row.id, doomed, '撤回后不许复用旧 id')
    assert.equal(seen.has(row.id), false)
    seen.add(row.id)
  }
})
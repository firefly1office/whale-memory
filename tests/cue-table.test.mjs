// S7 · 线索表（T12）：短问句先查表、覆盖率门槛、迟疑提醒、频控
//
// 验收口径：
// 1. 默认关：不传 cueTable 时 surface 与老路径完全一样（block 一个字都不多）；
// 2. 建表只收没封存的经历（封存的连线索都不该有），每条按稀有度取前 N 个词；
// 3. 查表给覆盖率；覆盖率过门槛才插迟疑提醒，且提醒只有一行、不改注入了什么；
// 4. 频控：同一标题连贴 ≤3 次、同一键两次之间 ≥2 轮；状态可存可恢复；
// 5. 旁路（跳过全库检索）默认关，只有显式 cuePrefilter 才生效；
// 6. 负面文本（跟记忆无关）不出迟疑。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { tmpDir, safeRemove } from './_safety.mjs'
import { addExperience, loadAll, setSealed } from '../packages/core/lib/self-experience.js'
import { surface } from '../packages/core/lib/injection.js'
import {
  buildCueTable, lookupCues, createCueGate, cueHintFor, CUE_HINT_LINE, CUE_HINT_COVER, CUE_SHORT_UNITS
} from '../packages/core/lib/cue-table.js'

const NEW = (t) => {
  const dir = tmpDir('whale-cue-')
  t.after(() => safeRemove(dir))
  return dir
}
const OWNER_DM = 'local:owner'

// 「现在时间」精确到秒：两次渲染跨过一秒边界就会不同（2026-11-27 跑全量时偶发红过一次）。
// 这条用例比的是「注入的内容变没变」，把这一行规格化掉，别让墙上时钟决定它红不红。
const withoutNow = (s) => String(s).replace(/- 现在时间：[^\n]*/g, '- 现在时间：<now>')

// 一个小库：灯塔那章 / 海边的贝壳 / 一条封存的（不该进线索表）
function library(dir) {
  const a = addExperience(dir, { text: '夜里翻完灯塔那一章，守灯人整晚没睡', thought: '他是在等人' })
  const b = addExperience(dir, { text: '在海边捡到一只贝壳，壳上有一道裂纹', thought: '像没说完的话' })
  const c = addExperience(dir, { text: '灯塔的钥匙忘在门边了' })
  setSealed(dir, { id: c.id, sealed: true, note: '先别主动提' })
  return { a, b, c }
}

test('S7：建表只收没封存的经历，每条按稀有度取前 N 个线索', (t) => {
  const dir = NEW(t)
  const { a, b, c } = library(dir)
  const table = buildCueTable(loadAll(dir), { perRecord: 4 })
  const ids = table.records.map((r) => r.id)
  assert.equal(ids.includes(a.id), true)
  assert.equal(ids.includes(b.id), true)
  assert.equal(ids.includes(c.id), false, '封存的记录连线索都不该有')
  for (const record of table.records) assert.ok(record.cues.length <= 4, '每条最多 perRecord 个')
  assert.ok(table.byCue.size > 0)
  // 空库 / 坏输入不炸
  assert.deepEqual(buildCueTable([]).records, [])
  assert.deepEqual(buildCueTable(null).records, [])
  assert.deepEqual(buildCueTable([{ id: 'x' }]).records, [], '没有正文的记录跳过')
})

test('S7：查表给覆盖率——沾边的给部分，无关的是 0', (t) => {
  const dir = NEW(t)
  const { a } = library(dir)
  const table = buildCueTable(loadAll(dir))
  const hit = lookupCues(table, '灯塔守灯人')
  assert.ok(hit.cover > 0)
  assert.equal(hit.bestId, a.id)
  assert.ok(hit.hits.length >= 1)
  const miss = lookupCues(table, '今天股价涨了多少')
  assert.equal(miss.cover, 0)
  assert.equal(lookupCues(table, '').cover, 0)
})

test('S7：默认关——不传 cueTable 时 block 与老路径一个字都不多', (t) => {
  const dir = NEW(t)
  library(dir)
  const plain = surface(dir, { chatKey: OWNER_DM, text: '灯塔守灯人整晚没睡' })
  const withTableOff = surface(dir, { chatKey: OWNER_DM, text: '灯塔守灯人整晚没睡', cueTable: null })
  assert.equal(withoutNow(withTableOff.block), withoutNow(plain.block))
  assert.equal(plain.block.includes(CUE_HINT_LINE), false)

  const withTable = surface(dir, { chatKey: OWNER_DM, text: '灯塔守灯人整晚没睡', cueTable: buildCueTable(loadAll(dir)) })
  assert.equal(withTable.block.startsWith(CUE_HINT_LINE + '\n'), true, '传了线索表才多这一行')
  assert.equal(withoutNow(withTable.block.replace(CUE_HINT_LINE + '\n', '')), withoutNow(plain.block), '除了那一行，注入了什么一点没变')
  assert.equal(withTable.id, plain.id, '递的还是同一条')
})

test('S7：cueHint:false 只省检索不插提醒；覆盖率不够也不插', (t) => {
  const dir = NEW(t)
  library(dir)
  const table = buildCueTable(loadAll(dir))
  const noHint = surface(dir, { chatKey: OWNER_DM, text: '灯塔守灯人整晚没睡', cueTable: table, cueHint: false })
  assert.equal(noHint.block.includes(CUE_HINT_LINE), false)

  // 覆盖率门槛拉到 1 以上：怎么都不过
  const strict = surface(dir, { chatKey: OWNER_DM, text: '灯塔守灯人整晚没睡', cueTable: table, cueMinCover: 1.1 })
  assert.equal(strict.block.includes(CUE_HINT_LINE), false)
  assert.equal(strict.cue.hint, false)
  assert.equal(strict.cue.hintReason, 'below-cover')
})

test('S7：无关的话不递、也不插迟疑（负面用例）', (t) => {
  const dir = NEW(t)
  library(dir)
  const table = buildCueTable(loadAll(dir))
  const r = surface(dir, { chatKey: OWNER_DM, text: '今天股价涨了多少', cueTable: table })
  assert.equal(r.block, '')
  assert.equal(r.reason, 'no-hit')
  assert.equal(r.cue.cover, 0)
  assert.equal(r.cue.hint, false)
})

test('S7：旁路默认关——显式开了才跳过全库检索', (t) => {
  const dir = NEW(t)
  library(dir)
  const table = buildCueTable(loadAll(dir))
  const text = '今天股价涨了多少'
  const off = surface(dir, { chatKey: OWNER_DM, text, cueTable: table })
  assert.equal(off.reason, 'no-hit', '默认不跳过：还是去查了库，只是没命中')
  const on = surface(dir, { chatKey: OWNER_DM, text, cueTable: table, cuePrefilter: 'any' })
  assert.equal(on.reason, 'no-cue', '开了才不查库')
  const short = surface(dir, { chatKey: OWNER_DM, text, cueTable: table, cuePrefilter: 'short' })
  assert.equal(short.reason, 'no-cue', '九个字以内的短问句算短问句')
  const long = surface(dir, { chatKey: OWNER_DM, text: '今天股票市场涨了多少个百分点啊到底', cueTable: table, cuePrefilter: 'short' })
  assert.ok(long.reason === 'no-hit' || long.reason === 'no-cue')
  assert.ok(lookupCues(table, '今天股票市场涨了多少个百分点啊到底').units > CUE_SHORT_UNITS, '长句词数超过短句界')
})

test('S7：频控——同一标题连贴 ≤3 次、两次之间 ≥2 轮；状态可存可恢复', () => {
  const gate = createCueGate()
  assert.equal(gate.allow('k', 0), true)
  gate.note('k', 0)
  assert.equal(gate.allow('k', 1), false, '同一键下一轮不许再贴（间隔 ≥2）')
  assert.equal(gate.allow('k', 2), true, '隔两轮可以')
  gate.note('k', 2)
  assert.equal(gate.allow('k', 4), true)
  gate.note('k', 4)
  assert.equal(gate.allow('k', 6), false, '连贴 3 次之后就不许了')
  // 换个键：不受影响
  assert.equal(gate.allow('other', 0), true)

  const saved = JSON.parse(JSON.stringify(gate.state))
  const restored = createCueGate().load(saved)
  assert.equal(restored.allow('k', 6), false, '存下来再恢复，频控照样有效')
  restored.reset()
  assert.equal(restored.allow('k', 6), true)
})

test('S7：cueHintFor 只判断不记状态（贴完由调用方 note）', () => {
  const lookup = { cover: 0.8, units: 5, hits: [{ id: 'exp_1', matched: 4, cover: 0.8 }] }
  const gate = createCueGate()
  const first = cueHintFor({ lookup, gate, turn: 0 })
  assert.equal(first.hint, true)
  assert.equal(first.key, 'cue:exp_1')
  gate.note(first.key, 0)
  assert.equal(cueHintFor({ lookup, gate, turn: 1 }).reason, 'throttled')
  assert.equal(cueHintFor({ lookup, gate, turn: 0, enabled: false }).hint, false)
  assert.equal(cueHintFor({ lookup: { cover: 0.1, units: 5, hits: [] } }).reason, 'below-cover')
  assert.ok(CUE_HINT_COVER > 0.5)
})

test('S7：线索表进导出面，且不读盘不发请求（纯函数）', async () => {
  const index = await import('../packages/core/index.js')
  assert.equal(typeof index.cueTable.buildCueTable, 'function')
  const source = fs.readFileSync(new URL('../packages/core/lib/cue-table.js', import.meta.url), 'utf8')
  for (const forbidden of ['node:fs', 'node:http', 'fetch(']) assert.equal(source.includes(forbidden), false, '线索表不该碰 ' + forbidden)
})
// S1 · 事实键式取代（K1）
//
// 验收口径：
// 1. 同一个键写两次 → 旧的一代带 supersededBy、不在现行事实里，但东西还在（能撤销）；
// 2. 不同的键互不影响；同键同值重复写是 noop；
// 3. 默认关：不调用 setFact 就不产生 fact-events.jsonl，读路径也什么都不会多出来；
// 4. erase 撤回一条经历时，挂着它的事实事件一起清；被清掉的那一代一旦是新的，
//    上一代自然重新成为现行（这就是"东西留着能撤销"）；
// 5. 坏行 fail closed（读现行事实、以及擦除前的预检，都不当空）。
//
// 所有数据目录都是现造现删的临时目录，不碰真实数据。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { tmpDir, safeRemove } from './_safety.mjs'
import * as facts from '../packages/core/lib/fact-key.js'
import * as exp from '../packages/core/lib/self-experience.js'
import { eraseExperience } from '../packages/core/lib/erase.js'
import * as tombstones from '../packages/core/lib/tombstones.js'

const NEW = (t) => {
  const dir = tmpDir('whale-fact-')
  t.after(() => safeRemove(dir))
  return dir
}

const fileOf = (dir) => path.join(dir, 'fact-events.jsonl')
const readText = (dir) => {
  try { return fs.readFileSync(fileOf(dir), 'utf8') } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}
const rowsOf = (dir) => (readText(dir) || '').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))

test('S1：同一个键写两次，旧的一代带 supersededBy，且不在现行事实里', (t) => {
  const dir = NEW(t)
  const first = facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁' })
  const second = facts.setFact(dir, { key: '她.咖啡', value: '戒了，改喝无糖茶' })

  assert.equal(second.noop, false)
  assert.equal(second.supersededBy, first.event.id, '第二条要报出它取代了哪一条')
  const { all, current } = facts.readFacts(dir)
  assert.equal(all.length, 2, '旧的不能删：两代都还在文件里')
  assert.equal(all[0].id, first.event.id)
  assert.equal(all[0].value, '喜欢拿铁')
  assert.equal(all[0].supersededBy, second.event.id)
  assert.equal(all[0].supersededAt, second.event.at)
  assert.equal(all[1].supersededBy, undefined, '现行那条不该带 supersededBy')
  assert.deepEqual(current.map((r) => r.value), ['戒了，改喝无糖茶'])
})

test('S1：不同的键互不影响，现行事实按第一次出现的顺序稳定排列', (t) => {
  const dir = NEW(t)
  facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁' })
  facts.setFact(dir, { key: '地点.常去', value: '码头' })
  facts.setFact(dir, { key: '她.咖啡', value: '戒了' })

  const { current } = facts.readFacts(dir)
  assert.deepEqual(current.map((r) => r.key), ['她.咖啡', '地点.常去'])
  assert.deepEqual(current.map((r) => r.value), ['戒了', '码头'])
  assert.equal(facts.historyOf(dir, '她.咖啡').length, 2, '一个键的家谱要两代都在')
  assert.equal(facts.historyOf(dir, '地点.常去').length, 1)
})

test('S1：未传参数时一行都不写（默认关：既有读写路径零变化）', (t) => {
  const dir = NEW(t)
  exp.addExperience(dir, { text: '今天去了码头' })
  assert.equal(readText(dir), null, '不调用 setFact 就不该有 fact-events.jsonl')
  const read = facts.readFacts(dir)
  assert.deepEqual(read.all, [])
  assert.deepEqual(read.current, [])
  assert.equal(read.bad, 0)
  assert.deepEqual(fs.readdirSync(dir).sort(), ['self-experience.jsonl'], '目录里只多出经历文件本身')
})

test('S1：同一个键同一个值重复写是 noop，不堆叠事件', (t) => {
  const dir = NEW(t)
  const first = facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁', about: '鲸鲸' })
  const again = facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁', about: '鲸鲸' })
  assert.equal(again.noop, true)
  assert.equal(again.event.id, first.event.id)
  assert.equal(rowsOf(dir).length, 1)
})

test('S1：坏行 fail closed；allowCorrupt 只给备份/计数用', (t) => {
  const dir = NEW(t)
  facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁' })
  fs.appendFileSync(fileOf(dir), '{ 这不是 JSON\n', 'utf8')

  assert.throws(() => facts.currentFacts(dir), (error) => error.code === 'FACT_EVENTS_CORRUPT')
  assert.throws(() => facts.readFacts(dir), /无法解析/)
  // 坏行不清不楚的时候不许再往上叠
  assert.throws(() => facts.setFact(dir, { key: '她.咖啡', value: '又改了' }), (error) => error.code === 'FACT_EVENTS_CORRUPT')
  const lenient = facts.readFacts(dir, { allowCorrupt: true })
  assert.equal(lenient.bad, 1)
  assert.equal(lenient.current.length, 1, '后门只跳过坏行，不假装没有坏行（bad 照样报）')
})

test('S1：键和值的上限、形状不合法就抛，一个字节都不写', (t) => {
  const dir = NEW(t)
  assert.throws(() => facts.setFact(dir, { key: '', value: 'x' }), (error) => error.code === 'FACT_KEY_REQUIRED')
  assert.throws(() => facts.setFact(dir, { key: '没有点', value: 'x' }), (error) => error.code === 'FACT_KEY_SHAPE')
  assert.throws(() => facts.setFact(dir, { key: '她.', value: 'x' }), (error) => error.code === 'FACT_KEY_SHAPE')
  assert.throws(() => facts.setFact(dir, { key: '她.咖啡', value: '   ' }), (error) => error.code === 'FACT_VALUE_REQUIRED')
  assert.throws(() => facts.setFact(dir, { key: '她.' + 'x'.repeat(facts.KEY_LIMIT), value: 'x' }), (error) => error.code === 'FACT_KEY_TOO_LONG')
  assert.throws(() => facts.setFact(dir, { key: '她.咖啡', value: 'x'.repeat(facts.VALUE_LIMIT + 1) }), (error) => error.code === 'FACT_VALUE_TOO_LONG')
  assert.equal(readText(dir), null, '校验失败不许留下半个文件')
})

test('S1：erase 撤回一条经历时，挂着它的事实事件一起清；上一代重新成为现行', (t) => {
  const dir = NEW(t)
  const a = exp.addExperience(dir, { text: '她说起自己爱喝拿铁' })
  const b = exp.addExperience(dir, { text: '她说咖啡戒了' })
  const first = facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁', expId: a.id })
  facts.setFact(dir, { key: '她.咖啡', value: '戒了', expId: b.id })
  facts.setFact(dir, { key: '地点.常去', value: '码头', expId: a.id })

  const result = eraseExperience(dir, { id: b.id, reason: '这一条记错了', actor: 'self' })
  assert.equal(result.ok, true)

  const rows = rowsOf(dir)
  assert.equal(rows.some((r) => r.expId === b.id), false, '撤回的那条经历带出来的事实必须一起清')
  assert.equal(rows.length, 2, '别的键的事实不许动')
  // b 的那一代没了，a 的上一代自然重新成为现行（"东西留着能撤销"）
  const current = facts.currentFacts(dir)
  assert.deepEqual(current.map((r) => r.key), ['她.咖啡', '地点.常去'])
  assert.deepEqual(current.map((r) => r.value), ['喜欢拿铁', '码头'])
  assert.equal(facts.historyOf(dir, '她.咖啡')[0].supersededBy, undefined, '唯一的活口不该再带 supersededBy')
  // 墓碑照旧，且照样不含正文
  const marks = tombstones.readAll(dir)
  assert.equal(marks.rows.length, 1)
  assert.equal(marks.rows[0].id, b.id)
  assert.equal(JSON.stringify(marks.rows[0]).includes('咖啡戒了'), false)
  assert.ok(first.event.id)
})

test('S1：事实文件有坏行时，擦除整次拒绝（不许"尽量删"）', (t) => {
  const dir = NEW(t)
  const a = exp.addExperience(dir, { text: '一条经历' })
  facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁', expId: a.id })
  fs.appendFileSync(fileOf(dir), 'not json\n', 'utf8')
  assert.throws(
    () => eraseExperience(dir, { id: a.id, reason: '删', actor: 'self' }),
    (error) => error.code === 'ERASE_EVENTS_CORRUPT' && error.file === 'fact-events.jsonl'
  )
  assert.ok(exp.loadAll(dir).some((r) => r.id === a.id), '拒绝了就得一条都没删')
})

test('S1：until 按那一刻重放（早于取代那一条时看到的是旧的一代）', (t) => {
  const dir = NEW(t)
  const first = facts.setFact(dir, { key: '她.咖啡', value: '喜欢拿铁', now: '2026-11-01T10:00:00+08:00' })
  facts.setFact(dir, { key: '她.咖啡', value: '戒了', now: '2026-11-20T10:00:00+08:00' })
  const before = Date.parse('2026-11-10T00:00:00+08:00')
  const past = facts.currentFacts(dir, { until: before })
  assert.deepEqual(past.map((r) => r.id), [first.event.id])
  assert.deepEqual(facts.currentFacts(dir).map((r) => r.value), ['戒了'])
  const lineage = facts.historyOf(dir, '她.咖啡', { until: before })
  assert.equal(lineage.length, 1)
  assert.equal(lineage[0].value, '喜欢拿铁')
})
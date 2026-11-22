// 召回门槛：防编造的门槛只在 query-match.js 里定义，这里逐条钉住
//   - 没有相邻字对的单字（「灯塔里的猫」的「猫」）命中只值半份，不再白送满分
//   - 拉丁词按整词匹配：art 不命中 started，he 不命中 the
//   - strict 错前提：查询里关键的那个单独名词不在，就不召回（那条经历没有猫）
//   - loose 保留最低比例：一个垫话两字组 / 一个词不再召回一段长问句
//   - recallForContext 默认走 strict（旧口径要显式要）
import assert from 'node:assert/strict'
import test from 'node:test'

import * as exp from '../packages/core/lib/self-experience.js'
import { contentUnits, coverage, matchedTerms, queryTerms, requiredOverlap, MIN_COVER, LOOSE_MIN_RATIO } from '../packages/core/lib/query-match.js'
import { safeRemove, tmpDir } from './_safety.mjs'

function tmp(t, prefix = 'whale-thresholds-') {
  const dir = tmpDir(prefix)
  t.after(() => safeRemove(dir))
  return dir
}
const texts = (rows) => rows.map((r) => r.then.text)

test('没有相邻字对的单字命中只值半份（不再白送 1.0）', () => {
  const units = contentUnits('灯塔里的猫')
  const tail = units.find((u) => u.u === '猫')
  assert.ok(tail, '「猫」是被「的」隔开的尾单字')
  assert.deepEqual(tail.pairs, [], '复现前提：它没有相邻字对')
  // 整句一字不差，也不该是满分：孤立单字只算半份
  const exact = coverage(units, '灯塔里的猫')
  assert.ok(exact < 1, '相同正文也不该是 1.0，实际 ' + exact)
  assert.ok(exact >= MIN_COVER, '整句命中仍然过线，实际 ' + exact)
  // 只剩「灯塔」的记忆：2 / (2 + 1.5) ≈ 0.57，过不了门槛
  const missing = coverage(units, '开始读海上灯塔那一章')
  assert.ok(missing < MIN_COVER, '缺了猫就不该过线，实际 ' + missing)
  // 对照：两个内容字互相作证（「灯塔」连着出现）才算满分
  assert.equal(coverage(contentUnits('灯塔'), '开始读海上灯塔那一章'), 1)
  // 查询只剩一个内容单元时（「夜里」的「里」是虚词不算），出现就是全部意思都在
  assert.equal(coverage(contentUnits('夜里'), '夜里又翻完一章'), 1)
})

test('拉丁词按整词匹配：art 不命中 started，he 不命中 the', () => {
  assert.deepEqual([...matchedTerms(queryTerms('art').terms, 'he started the engine')], [])
  assert.deepEqual([...matchedTerms(queryTerms('he').terms, 'the engine started')], [])
  assert.deepEqual([...matchedTerms(queryTerms('engine').terms, 'He started the engine')], ['engine'])
  assert.equal(coverage(contentUnits('art'), 'it started to rain'), 0)
  assert.equal(coverage(contentUnits('engine'), 'He started the ENGINE'), 1)
})

test('英文记忆：子串不算命中，整词才算', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: 'I started the engine in the rain' })
  assert.deepEqual(exp.recall(dir, 'art'), [], 'art 不该命中 started')
  assert.deepEqual(exp.recall(dir, 'he'), [], 'he 不该命中 the')
  const hit = exp.recall(dir, 'engine')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].id, row.id)
})

test('strict 错前提：关键的那个单独名词不在，就不召回', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '《海上灯塔》第三章，守灯人在暴风雨里修好了透镜', thought: '他其实不怕黑' })
  // 覆盖率 3/4=0.75 的老漏洞：那条经历里根本没有猫
  assert.deepEqual(exp.recall(dir, '守灯人的猫'), [], '那条经历没有猫，不该被叫出来')
  assert.deepEqual(exp.recall(dir, '灯塔里的猫'), [], 'near 用例同理')
  // 该召回时照旧
  assert.equal(exp.recall(dir, '守灯人')[0].id, row.id)
  assert.equal(exp.recall(dir, '暴风雨里的守灯人')[0].id, row.id)
})

test('strict 不会拦下"在问什么"：询问用字缺了不算前提错', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '读完《海上灯塔》，结尾守灯人把钥匙交给了年轻的接班人' })
  const hit = exp.recall(dir, '灯塔的钥匙交给了谁')
  assert.equal(hit.length, 1, '「谁」只是问法，正文里没有它也应当想起那件事')
  assert.equal(hit[0].id, row.id)
})

test('loose 保留最低比例：垫话两字组、单个词都不再召回长问句', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '上次' })
  exp.addExperience(dir, { text: '灯塔很高' })

  // 垫话本身不携带内容：「上次」不再是一个能命中记忆的词
  assert.deepEqual(exp.recall(dir, '上次说的那件事', { mode: 'loose' }), [], '只靠"上次"不该召回')
  assert.deepEqual(exp.recall(dir, '说说上次', { mode: 'loose' }), [], '只靠"说说"不该召回')

  // 长问句里只碰到一个词：loose 也要过最低比例
  const long = '你还记得上次说的灯塔那件事吗后来怎么样了'
  const parsed = queryTerms(long)
  assert.ok(requiredOverlap(parsed, { mode: 'loose' }) > 1, 'loose 的门槛要比 1 个词高')
  assert.ok(LOOSE_MIN_RATIO < 0.6, 'loose 的比例门槛应低于 strict')
  assert.deepEqual(exp.recall(dir, long, { mode: 'loose' }), [], '只碰到"灯塔"一个词，不召回')
})

test('recallForContext 默认走 strict；旧口径要显式要', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '守灯人整晚没睡' })

  // 旧口径下这一句会召回（只要求一个两字词对上）
  assert.deepEqual(exp.recallForContext(dir, '守灯人的猫'), [], '默认 strict：缺了猫就不递回')
  const legacy = exp.recallForContext(dir, '守灯人的猫', { gate: 'legacy' })
  assert.equal(legacy.length, 1, '显式要旧口径时仍然给')
  assert.equal(legacy[0].id, row.id)
  // 该召回时默认也给
  assert.equal(exp.recallForContext(dir, '守灯人')[0].id, row.id)
})

test('中英混排：中文两字组照旧、英文只有整词算', () => {
  const dir = tmpDir('whale-mixed-')
  try {
    const row = exp.addExperience(dir, { text: '看完《海上灯塔》，顺手读了一篇 about lighthouses 的博客' })
    assert.equal(exp.recall(dir, 'lighthouse')[0], undefined, 'lighthouse 不该命中 lighthouses（整词）')
    assert.equal(exp.recall(dir, '海上灯塔')[0].id, row.id)
    assert.equal(exp.recall(dir, 'lighthouses')[0].id, row.id)
  } finally { safeRemove(dir) }
})

test('该召回的正例没有因为门槛变严而丢掉', (t) => {
  const dir = tmp(t)
  const folding = exp.addExperience(dir, { text: '学会一种新的折纸，折了三次才像样' })
  const tea = exp.addExperience(dir, { text: '泡了一杯茶，忘了喝，凉了' })
  assert.equal(exp.recall(dir, '折纸怎么折')[0].id, folding.id)
  assert.equal(exp.recall(dir, '茶凉了')[0].id, tea.id)
  assert.deepEqual(exp.recall(dir, '量子力学与广义相对论'), [])
})
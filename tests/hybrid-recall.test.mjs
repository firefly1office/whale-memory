// 混合检索（阶段 2）：默认路径不变、同义词不硬凑、上下文只排序不放行、封存照旧、mark 照旧
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import * as exp from '../packages/core/lib/self-experience.js'
import { variantsOf, tokensOf, buildIndex, bm25Scores, HYBRID_MIN_COVER, SYNONYMS } from '../packages/core/lib/hybrid-recall.js'
import { safeRemove, tmpDir } from './_safety.mjs'

function tmp(t) {
  const dir = tmpDir('whale-hybrid-')
  t.after(() => safeRemove(dir))
  return dir
}
const ids = (rows) => rows.map((r) => r.id)

test('默认还是字面检索：换个说法不会硬凑', (t) => {
  const dir = tmp(t)
  const flower = exp.addExperience(dir, { text: '去花店买了一束小雏菊，插在窗台的玻璃瓶里' })
  assert.deepEqual(ids(exp.recall(dir, '买花')), [], 'literal 不该把「花店」当成「买花」')
  const hits = exp.recall(dir, '买花', { ranker: 'hybrid' })
  assert.equal(hits.length, 1, 'hybrid 应当靠同义词找到')
  assert.equal(hits[0].id, flower.id)
})

test('hybrid 的防编造门槛没放宽：沾边但不是同一件事，仍然返回空', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '开始读《海上灯塔》，第一章写守灯人搬进塔里的第一个晚上' })
  assert.deepEqual(ids(exp.recall(dir, '灯塔里的猫', { ranker: 'hybrid' })), [], '那条经历里没有猫')
  assert.deepEqual(ids(exp.recall(dir, '灯塔里的猫', { ranker: 'literal' })), [])
  assert.deepEqual(ids(exp.recall(dir, '量子力学的波函数坍缩', { ranker: 'hybrid' })), [])
})

test('封存的不召回；她自己要翻时 hybrid 也看得到', (t) => {
  const dir = tmp(t)
  const row = exp.addExperience(dir, { text: '和妈妈在电话里吵了一架，挂了以后在楼梯上坐了很久' })
  assert.equal(exp.setSealed(dir, { id: row.id, sealed: true }).ok, true)
  assert.deepEqual(ids(exp.recall(dir, '和妈妈吵架', { ranker: 'hybrid' })), [], '封存的不该被召回')
  const seen = exp.recall(dir, '和妈妈吵架', { ranker: 'hybrid', includeSealed: true })
  assert.deepEqual(ids(seen), [row.id], '她自己要翻时仍然看得到')
})

test('多轮追问：代词句靠上下文排序，上下文不替它放行', (t) => {
  const dir = tmp(t)
  const play = exp.addExperience(dir, { text: '阿禾想了想，先不退话剧社，只请两周假' })
  const form = exp.addExperience(dir, { text: '报名表交上去以后，我又想了想，还是退掉了' })
  const q = '她后来退了吗'
  const withPlay = exp.recall(dir, q, { ranker: 'hybrid', limit: 1, context: ['阿禾 话剧社'] })
  assert.deepEqual(ids(withPlay), [play.id], '上下文提到话剧社，应当先想起话剧社那条')
  const withForm = exp.recall(dir, q, { ranker: 'hybrid', limit: 1, context: ['报名表'] })
  assert.deepEqual(ids(withForm), [form.id], '换一个上下文，应当先想起另一条')
  // 有内容词的问句，上下文只影响排序：覆盖率不到门槛仍然返回空。
  // 这里用一句「整段命中另一条经历」的上下文：实现要是让 context 无条件进门槛，这条会返回东西。
  assert.deepEqual(ids(exp.recall(dir, '阿禾的生日', { ranker: 'hybrid', context: ['阿禾 话剧社 两周假'] })), [],
    '上下文不能替「生日」这个不存在的细节放行')
})

test('mark=true 走同一条事件通道：只追加 recall 事件，经历文件逐字节不变', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '去花店买了一束小雏菊' })
  const file = path.join(dir, 'self-experience.jsonl')
  const before = fs.readFileSync(file)
  const hits = exp.recall(dir, '买花', { ranker: 'hybrid', mark: true })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].recalls, 1, '返回体里的想起次数就地 +1')
  assert.ok(fs.readFileSync(file).equals(before), '经历文件不该被碰')
  assert.equal(exp.loadAll(dir)[0].recalls, 1, '下一次读取自然对上')
})

test('混合检索确定性：同样的数据、查询、参数，顺序固定；limit 生效', (t) => {
  const dir = tmp(t)
  for (const text of ['外婆家的桂花树今年开得晚', '外婆在门口等我，手里拿着热红薯', '桂花糕的做法我忘了']) {
    exp.addExperience(dir, { text })
  }
  const a = exp.recall(dir, '桂花', { ranker: 'hybrid', limit: 2 }).map((r) => r.id)
  const b = exp.recall(dir, '桂花', { ranker: 'hybrid', limit: 2 }).map((r) => r.id)
  assert.deepEqual(a, b)
  assert.equal(a.length, 2, '两条都写了桂花')
  assert.equal(exp.recall(dir, '桂花', { ranker: 'hybrid', limit: 1 }).length, 1, 'limit 要生效')
})

test('未知的 ranker 直接报错，不静默退回', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '灯塔' })
  assert.throws(() => exp.recall(dir, '灯塔', { ranker: 'vector' }), /ranker/)
})

test('短查询不放宽：三个内容单元只对上两个（0.667）仍然返回空', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '给外婆打电话，她说院子里的桂花今年开得晚' })
  exp.addExperience(dir, { text: '开始读《海上灯塔》，第一章写守灯人搬进塔里的第一个晚上' })
  exp.addExperience(dir, { text: '开始读《慢船去北方》，书页有股旧纸味' })
  // 这三个都是「少了关键字」的短句：桂花糕没有糕、灯塔猫没有猫、去北京没有北京。
  // 门禁对 ≤3 个内容单元按 0.7 算，所以不会被 2/3 = 0.667 放行。
  for (const q of ['桂花糕', '灯塔猫', '去北京']) {
    assert.deepEqual(ids(exp.recall(dir, q, { ranker: 'hybrid' })), [], q + ' 不该被放行')
    assert.deepEqual(ids(exp.recall(dir, q, { ranker: 'literal' })), [])
  }
  // 对照：整词都在的短查询照常召回
  assert.equal(exp.recall(dir, '桂花', { ranker: 'hybrid' }).length, 1)
  assert.equal(exp.recall(dir, '灯塔', { ranker: 'hybrid' }).length, 1)
})

test('ranker 传 null 按默认 literal 处理；空查询两种排序的差别是写明了的', (t) => {
  const dir = tmp(t)
  exp.addExperience(dir, { text: '去花店买了一束小雏菊' })
  const viaNull = exp.recall(dir, '花店', { ranker: null }).map((r) => r.id)
  assert.deepEqual(viaNull, exp.recall(dir, '花店').map((r) => r.id), 'null 应当按 literal')
  assert.deepEqual(ids(exp.recall(dir, '')), ids(exp.recall(dir, '', { limit: 1 })), 'literal 空查询照旧')
  assert.deepEqual(ids(exp.recall(dir, '', { ranker: 'hybrid' })), [], 'hybrid 空查询返回空')
})

test('同义词表按字面替换，变体数量有上限', () => {
  assert.ok(SYNONYMS.length >= 20)
  assert.ok(variantsOf('买花那天').includes('花店那天'))
  assert.ok(variantsOf('姥姥在门口等我').includes('外婆在门口等我'))
  assert.deepEqual(variantsOf('量子力学的波函数坍缩'), ['量子力学的波函数坍缩'], '表里没有的词不该凭空变')
  assert.ok(variantsOf('外婆 姥姥 外公 姥爷 吵架 拌嘴 道歉 认错 失眠 睡不着').length <= 8, '变体数要有上限')
})

test('n-gram 与 BM25：中文按 2–3 字滑窗，整词才算', () => {
  assert.ok(tokensOf('海上灯塔').includes('灯塔'))
  assert.ok(tokensOf('海上灯塔').includes('海上灯'))
  const index = buildIndex(['外婆家的桂花树', '去花店买了一束雏菊'])
  const scores = bm25Scores(index, ['桂花'])
  assert.equal(scores.length, 2)
  assert.ok(scores[0] > 0 && scores[1] === 0)
  assert.ok(HYBRID_MIN_COVER > 0 && HYBRID_MIN_COVER < 1)
})
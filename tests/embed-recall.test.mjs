// 语义检索（桩）通路测试：默认不变、门禁照旧、向量确定性。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { embedRank, hashEmbed, cosine, EMBED_KIND } from '../packages/core/lib/embed-recall.js'
import * as exp from '../packages/core/lib/self-experience.js'

const dirs = []
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-'))
  dirs.push(dir)
  return dir
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

function seed(dir) {
  exp.addExperience(dir, { text: '外婆在院子里晒橘子皮，晒了一整个下午。', scene: '院子', feeling: ['安静'] })
  exp.addExperience(dir, { text: '那天在食堂排队，前面的人在聊考试周。', scene: '食堂' })
  exp.addExperience(dir, { text: '夜里下雪，路灯下面全是白的。', scene: '路上' })
}

test('桩向量：同样输入同样结果、已归一化', () => {
  const a = hashEmbed('外婆晒橘子皮')
  const b = hashEmbed('外婆晒橘子皮')
  assert.deepEqual([...a], [...b])
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-9)
  assert.equal(EMBED_KIND, 'stub:char-ngram-hash')
})

test('不传 ranker 仍是字面检索（默认不变）', () => {
  const dir = fresh()
  seed(dir)
  const plain = exp.recall(dir, '外婆橘子皮')
  const literal = exp.recall(dir, '外婆橘子皮', { ranker: 'literal' })
  assert.deepEqual(plain.map((r) => r.id), literal.map((r) => r.id))
})

test('ranker=embed：能返回、带向量分数字段', () => {
  const dir = fresh()
  seed(dir)
  const hits = exp.recall(dir, '外婆晒橘子皮', { ranker: 'embed', limit: 3 })
  assert.ok(hits.length >= 1, '应至少命中一条')
  assert.equal(typeof hits[0].embedScore, 'number')
  assert.equal(typeof hits[0].embedCover, 'number')
})

test('ranker=embed：空查询返回空；负例不放行', () => {
  const dir = fresh()
  seed(dir)
  assert.deepEqual(exp.recall(dir, '   ', { ranker: 'embed' }), [])
  assert.deepEqual(exp.recall(dir, '量子计算机的散热方案', { ranker: 'embed' }), [])
})

test('ranker=embed：不认识的 ranker 会报错', () => {
  const dir = fresh()
  seed(dir)
  assert.throws(() => exp.recall(dir, '外婆', { ranker: 'vector' }), /ranker/)
})

test('embedRank：没有候选（rows 空）时返回空数组', () => {
  assert.deepEqual(embedRank({ rows: [], query: '外婆' }), [])
  assert.deepEqual(embedRank({ rows: [], query: '' }), [])
})

test('embedRank：覆盖率不够的不放行（防编造口径不变）', () => {
  const rows = [{ id: 'e1', at: '2026-01-01', then: { text: '外婆在院子里晒橘子皮' } }]
  assert.equal(embedRank({ rows, query: '灯塔里的猫' }).length, 0)
  assert.equal(embedRank({ rows, query: '橘子皮' }).length, 1)
})
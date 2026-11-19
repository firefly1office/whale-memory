import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import { cases } from '../examples/conversation-rhythm/cases.mjs'
import { inspect, messagesFor } from '../examples/conversation-rhythm/rhythm.mjs'
import { blindStudy, htmlFor } from '../examples/conversation-rhythm/blind.mjs'
import { scoreReviews } from '../examples/conversation-rhythm/score.mjs'

test('both arms see identical fiction and share reply/silence options', () => {
  assert.equal(cases.length, 20)
  for (const item of cases) {
    const a = messagesFor(item, 'baseline'), b = messagesFor(item, 'rhythm')
    assert.equal(a[1].content, b[1].content)
    assert.ok(b[0].content.startsWith(a[0].content))
    assert.match(a[0].content, /silent/)
  }
})
test('surface gates accept a word or silence but reject mismatches, lists and conclusions', () => {
  assert.equal(inspect({ action: 'reply', text: '嗯' }).eligibleForRhythmDelivery, true)
  assert.equal(inspect({ action: 'silent', text: '' }).eligibleForRhythmDelivery, true)
  assert.throws(() => inspect({ action: 'silent', text: '嗯' }))
  assert.throws(() => inspect({ action: 'reply', text: '' }))
  for (const text of ['- 第一项', '1. 先说这个', '一、先说这个', '# 标题', '好。总之，你说得对。', '字'.repeat(91)]) assert.ok(inspect({ action: 'reply', text }).violations.length)
  assert.equal(inspect({ action: 'reply', text: '😀'.repeat(90) }).chars, 90)
})
test('blind artifact has balanced hidden assignment, safe data and no answer key', () => {
  const hostile = structuredClone(cases); hostile[0].text = '</script><script>alert(1)</script>'
  const rows = hostile.flatMap(c => ['baseline', 'rhythm'].map(arm => ({ id: c.id, arm, output: { action: 'reply', text: '短句' } })))
  const study = blindStudy(hostile, rows)
  assert.equal(study.key.filter(k => k.A === 'baseline').length, 10)
  assert.equal(new Set(study.cards.map(c => c.id)).size, 20)
  const html = htmlFor(study.cards)
  assert.doesNotMatch(html, /baseline|fiction-1|<script>alert/)
  const data = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1]
  assert.equal(JSON.parse(data).find(c => c.text.includes('alert')).text, hostile[0].text)
  new Script(html.match(/<\/script><script>([\s\S]*?)<\/script>/)[1])
})
test('human scoring preserves ties, uncertainty and missing ratings; counts the more-AI vote correctly', () => {
  const key = [{ id: 'one', A: 'baseline', B: 'rhythm' }, { id: 'two', A: 'rhythm', B: 'baseline' }]
  const review = { reviewerId: 'r1', ratings: [{ id: 'one', aiLike: 'A', fit: 'B' }, { id: 'two', aiLike: 'tie', fit: 'unsure' }] }
  const result = scoreReviews(key, [review, { reviewerId: 'r2', ratings: [] }])
  assert.equal(result.totals.aiLike.baseline, 1)
  assert.equal(result.totals.fit.rhythm, 1)
  for (const totals of Object.values(result.totals)) assert.equal(Object.values(totals).reduce((a, b) => a + b), 4)
  assert.throws(() => scoreReviews(key, [review, review]))
  assert.throws(() => scoreReviews(key, [{ reviewerId: 'r', ratings: [{ id: 'unknown' }] }]))
})
